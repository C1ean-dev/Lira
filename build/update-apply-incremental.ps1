param(
  [Parameter(Mandatory = $true)]
  [string]$InstallDir,
  [Parameter(Mandatory = $true)]
  [string]$UserDataDir,
  [Parameter(Mandatory = $true)]
  [string]$StageDir,
  [int]$WaitPid = 0,
  [switch]$LaunchAfter,
  [switch]$SilentBoot,
  [switch]$ForceKill,
  [string]$TargetVersion = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$installPath = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
$userDataPath = [IO.Path]::GetFullPath($UserDataDir).TrimEnd('\')
$stagePath = [IO.Path]::GetFullPath($StageDir).TrimEnd('\')
$payloadPath = Join-Path $stagePath 'payload'
$parentDir = [IO.Directory]::GetParent($installPath).FullName
$pendingPath = Join-Path $parentDir 'lira.update-pending.json'
$lockPath = Join-Path $parentDir 'lira.update-applying.lock'
$launchFlagPath = Join-Path $parentDir 'lira.launch-after-update.flag'
$logPath = Join-Path $env:TEMP 'lira_incremental_update.log'
$recoveryScript = Join-Path $PSScriptRoot 'update-recovery.ps1'

function Write-UpdateLog([string]$Message) {
  try {
    $line = '[{0}] {1}' -f ([DateTime]::UtcNow.ToString('o')), $Message
    [IO.File]::AppendAllText($logPath, $line + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
  } catch {}
}

function Get-RunningLiraProcesses([string]$InstallRoot) {
  $exePath = Join-Path $InstallRoot 'Lira.exe'
  $found = @()
  foreach ($proc in @(Get-Process -Name 'Lira' -ErrorAction SilentlyContinue)) {
    try {
      $procPath = $proc.MainModule.FileName
      if ($procPath -and [string]::Equals($procPath, $exePath, [StringComparison]::OrdinalIgnoreCase)) {
        $found += $proc
      }
    } catch {
      # Access denied or exiting process: treat as potentially belonging to Lira.
      $found += $proc
    }
  }
  return $found
}

function Stop-InstalledAppProcesses([string]$InstallRoot) {
  foreach ($proc in (Get-RunningLiraProcesses $InstallRoot)) {
    try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
  $helperPath = Join-Path $InstallRoot 'resources\native\process-audio-capture.exe'
  foreach ($proc in @(Get-Process -Name 'process-audio-capture' -ErrorAction SilentlyContinue)) {
    try {
      $procPath = $proc.MainModule.FileName
      if (-not $procPath -or [string]::Equals($procPath, $helperPath, [StringComparison]::OrdinalIgnoreCase)) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
      }
    } catch {
      try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}
    }
  }
  Start-Sleep -Milliseconds 350
}

function Update-UninstallDisplayVersion([string]$InstallRoot, [string]$Version) {
  if ([string]::IsNullOrWhiteSpace($Version)) { return }
  $cleanVer = $Version.Trim().TrimStart('v', 'V')
  try {
    $rootKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
    if (-not (Test-Path -LiteralPath $rootKey)) { return }
    foreach ($subKey in @(Get-ChildItem -LiteralPath $rootKey -ErrorAction SilentlyContinue)) {
      try {
        $props = Get-ItemProperty -LiteralPath $subKey.PSPath -ErrorAction SilentlyContinue
        $loc = if ($props.PSObject.Properties.Name -contains 'InstallLocation') { [string]$props.InstallLocation } else { '' }
        $uninst = if ($props.PSObject.Properties.Name -contains 'UninstallString') { [string]$props.UninstallString } else { '' }
        $matchesInstall =
          ($loc -and [string]::Equals($loc.TrimEnd('\'), $InstallRoot, [StringComparison]::OrdinalIgnoreCase)) -or
          ($uninst -and $uninst.IndexOf($InstallRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0)
        if ($matchesInstall) {
          Set-ItemProperty -LiteralPath $subKey.PSPath -Name 'DisplayVersion' -Value $cleanVer -ErrorAction SilentlyContinue
          Write-UpdateLog "Updated Uninstall DisplayVersion to $cleanVer at $($subKey.PSChildName)"
        }
      } catch {}
    }
  } catch {
    Write-UpdateLog "Non-fatal Uninstall registry update error: $_"
  }
}

function Invoke-RecoveryAction([string]$ActionName, [string]$Payload = '') {
  $recoveryParams = @{
    Action = $ActionName
    InstallDir = $installPath
    UserDataDir = $userDataPath
  }
  if ($Payload) { $recoveryParams.PayloadDir = $Payload }
  & $recoveryScript @recoveryParams
}

function Remove-StageDirectorySafely([string]$Directory) {
  try {
    if (-not (Test-Path -LiteralPath $Directory)) { return }
    $item = Get-Item -LiteralPath $Directory -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { return }
    Remove-Item -LiteralPath $Directory -Recurse -Force -ErrorAction SilentlyContinue
  } catch {}
}

$lockCreated = $false
$shouldLaunch = [bool]$LaunchAfter
$applied = $false
$deferredForActiveApp = $false

try {
  Write-UpdateLog "Starting incremental apply. InstallDir=$installPath StageDir=$stagePath WaitPid=$WaitPid SilentBoot=$SilentBoot LaunchAfter=$LaunchAfter TargetVersion=$TargetVersion"

  if (-not (Test-Path -LiteralPath $payloadPath -PathType Container)) {
    throw "Staged payload directory not found: $payloadPath"
  }

  # Publish active applier lock so a concurrent user click can request launch-after-update instead of racing.
  $lockPayload = [pscustomobject]@{
    Pid = $PID
    StartedAt = [DateTime]::UtcNow.ToString('o')
    TargetVersion = $TargetVersion
  } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($lockPath, $lockPayload, [Text.UTF8Encoding]::new($false))
  $lockCreated = $true

  if ($WaitPid -gt 0) {
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    while ([DateTime]::UtcNow -lt $deadline) {
      $p = Get-Process -Id $WaitPid -ErrorAction SilentlyContinue
      if ($null -eq $p) { break }
      Start-Sleep -Milliseconds 100
    }
  }

  $running = @(Get-RunningLiraProcesses $installPath)
  if ($running.Count -gt 0) {
    if ($SilentBoot -and -not $ForceKill) {
      # The user opened Lira before silent boot finished staging. Never kill an active user session;
      # leave the verified staged update in place so the running app can offer instant one-click apply.
      $deferredForActiveApp = $true
      Write-UpdateLog "Active Lira instance detected during SilentBoot ($($running.Count) process(es)); deferring apply and preserving stage."
      exit 0
    }
    Stop-InstalledAppProcesses $installPath
  }

  if (Test-Path -LiteralPath $pendingPath) {
    Write-UpdateLog 'Recovering unfinished previous transaction before sparse delta apply.'
    Invoke-RecoveryAction 'Restore'
  }

  Invoke-RecoveryAction 'SparseDeltaUpdate' $payloadPath
  Invoke-RecoveryAction 'Commit'
  $applied = $true

  if ([string]::IsNullOrWhiteSpace($TargetVersion)) {
    try {
      $manifestObj = Get-Content -LiteralPath (Join-Path $installPath 'resources\update-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
      $TargetVersion = [string]$manifestObj.Version
    } catch {}
  }
  Update-UninstallDisplayVersion $installPath $TargetVersion
  Write-UpdateLog "Incremental update applied and committed successfully (version=$TargetVersion)."
} catch {
  $errMsg = $_.Exception.GetBaseException().Message
  $errPos = if ($_.InvocationInfo) { $_.InvocationInfo.ScriptName + ':' + $_.InvocationInfo.ScriptLineNumber } else { '' }
  Write-UpdateLog "Incremental apply failed ($errPos): $errMsg"
  if (-not $applied -and (Test-Path -LiteralPath $pendingPath)) {
    try {
      Write-UpdateLog 'Rolling back failed incremental update.'
      Invoke-RecoveryAction 'Restore'
      Write-UpdateLog 'Rollback completed cleanly.'
    } catch {
      Write-UpdateLog "Rollback also failed (backup preserved): $($_.Exception.GetBaseException().Message)"
    }
  }
  exit 1
} finally {
  if (Test-Path -LiteralPath $launchFlagPath) {
    $shouldLaunch = $true
    try { Remove-Item -LiteralPath $launchFlagPath -Force -ErrorAction SilentlyContinue } catch {}
  }
  if ($lockCreated -and (Test-Path -LiteralPath $lockPath)) {
    try { Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue } catch {}
  }
  if ($applied -or -not $deferredForActiveApp) {
    Remove-StageDirectorySafely $stagePath
  }
  if ($shouldLaunch -and ($applied -or -not (Test-Path -LiteralPath $pendingPath))) {
    $appExe = Join-Path $installPath 'Lira.exe'
    if (Test-Path -LiteralPath $appExe -PathType Leaf) {
      try {
        Write-UpdateLog "Launching Lira: $appExe --post-update"
        Start-Process -FilePath $appExe -ArgumentList '--post-update' -WorkingDirectory $installPath | Out-Null
      } catch {
        Write-UpdateLog "Failed to launch Lira after update: $_"
      }
    }
  }
}
