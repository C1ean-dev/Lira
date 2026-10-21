param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Backup', 'Restore', 'Commit', 'Cleanup')]
  [string]$Action,
  [Parameter(Mandatory = $true)]
  [string]$InstallDir,
  [Parameter(Mandatory = $true)]
  [string]$UserDataDir,
  [long]$ProgressWindow = 0
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($Action -in @('Backup', 'Restore')) { . "$PSScriptRoot\update-io.ps1" }

function Get-ManagedPath([string]$Target) {
  $absolute = [IO.Path]::GetFullPath($Target).TrimEnd('\')
  if ($absolute -eq [IO.Path]::GetPathRoot($Target).TrimEnd('\') -or $null -eq [IO.Directory]::GetParent($absolute)) {
    throw 'An update directory must not be a drive root.'
  }
  return $absolute
}

# Backup/staging are outside INSTDIR because electron-builder removes it during updates.
$installPath = Get-ManagedPath $InstallDir
$userDataPath = Get-ManagedPath $UserDataDir
$parent = [IO.Directory]::GetParent($installPath)
$profileParent = [IO.Directory]::GetParent($userDataPath).FullName
$profileName = [IO.Path]::GetFileName($userDataPath)
$backupPath = Join-Path $parent.FullName 'lira.backup'
$stagingPath = Join-Path $parent.FullName 'lira.backup.new'
$pendingPath = Join-Path $parent.FullName 'lira.update-pending.json'
$pendingTempPath = "$pendingPath.tmp"
$progressPath = Join-Path $parent.FullName 'lira.update-progress.jsonl'
$profileStagingPath = "$userDataPath.update-restore"
$managedTrees = @($installPath, $backupPath, $stagingPath, $userDataPath, $profileStagingPath)
foreach ($left in $managedTrees) {
  foreach ($right in $managedTrees) {
    if ($left -ne $right -and $left.StartsWith($right + '\', [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Application, profile and backup directories must not overlap.'
    }
  }
}
if (@($managedTrees | ForEach-Object { $_.ToUpperInvariant() } | Select-Object -Unique).Count -ne $managedTrees.Count -or $pendingPath -in $managedTrees) {
  throw 'Invalid update directories.'
}

function Assert-RegularPath([string]$Target) {
  $ancestor = $Target
  while ($ancestor) {
    if (Test-Path -LiteralPath $ancestor) {
      $item = Get-Item -LiteralPath $ancestor -Force
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked path: $ancestor" }
    }
    $ancestorDirectory = [IO.Directory]::GetParent($ancestor)
    $ancestor = if ($ancestorDirectory) { $ancestorDirectory.FullName } else { $null }
  }
}

function Assert-RegularTree([string]$Target) {
  # Reject junctions and symlinks before any recursive copy/removal, including ancestors.
  Assert-RegularPath $Target
  if (Test-Path -LiteralPath $Target) {
    foreach ($item in Get-ChildItem -LiteralPath $Target -Recurse -Force) {
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked path: $($item.FullName)" }
    }
  }
}

function Remove-UpdateTree([string]$Target) {
  # Check exact, resolved targets before every recursive removal.
  $resolved = [IO.Path]::GetFullPath($Target)
  if ($resolved -notin @($installPath, $backupPath, $stagingPath, $profileStagingPath)) { throw 'Removal outside update directories.' }
  Assert-RegularTree $resolved
  if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}

$script:stage = 'Preparando backup'
$script:totalFiles = 0
$script:totalBytes = 0L
$script:movedAppBytes = 0L
$script:verificationBase = 0L
$script:progressClock = [Diagnostics.Stopwatch]::StartNew()
$script:lastProgress = -1000L

function Report-Progress([string]$Stage = $script:stage, [bool]$Force = $false) {
  if ($Stage -ne $script:stage) { $script:stage = $Stage; $Force = $true }
  if (-not $Force -and $script:progressClock.ElapsedMilliseconds - $script:lastProgress -lt 250) { return }
  $script:lastProgress = $script:progressClock.ElapsedMilliseconds
  $bytes = if ($Stage.StartsWith('Verificando')) { [LiraUpdateIO]::VerificationReadBytes - $script:verificationBase } else { [LiraUpdateIO]::SourceReadBytes }
  $text = '{0}: {1}/{2} arquivos - {3:N1}/{4:N1} MB' -f $Stage, [LiraUpdateIO]::FilesCopied, $script:totalFiles, ($bytes / 1MB), ($script:totalBytes / 1MB)
  [LiraUpdateIO]::SetProgress($ProgressWindow, $text)
  $event = [pscustomobject]@{
    Stage = $Stage; FilesCopied = [LiraUpdateIO]::FilesCopied; TotalFiles = $script:totalFiles
    SourceReadBytes = [LiraUpdateIO]::SourceReadBytes; VerificationReadBytes = [LiraUpdateIO]::VerificationReadBytes
    TotalBytes = $script:totalBytes; MovedAppBytes = $script:movedAppBytes
    ElapsedMs = $script:progressClock.ElapsedMilliseconds
  }
  # Progress diagnostics must never interrupt a completed transaction (e.g. on a full disk).
  try {
    Assert-RegularPath $progressPath
    [IO.File]::AppendAllText($progressPath, ($event | ConvertTo-Json -Compress) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
  } catch {}
}

function Get-ProfilePath([string]$Name) {
  if ([IO.Path]::GetFileName($Name) -ne $Name -or
      ($Name -ne $profileName -and -not $Name.StartsWith("$profileName-inst-", [StringComparison]::OrdinalIgnoreCase))) {
    throw 'Invalid profile in backup manifest.'
  }
  $target = Join-Path $profileParent $Name
  foreach ($managed in @($installPath, $backupPath, $stagingPath, $profileStagingPath, $pendingPath)) {
    if ($target -eq $managed -or $target.StartsWith($managed + '\', [StringComparison]::OrdinalIgnoreCase) -or
        $managed.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase)) {
      throw 'The profile overlaps an application or recovery directory.'
    }
  }
  return $target
}

function Remove-ProfileTree([string]$Name) {
  $target = Get-ProfilePath $Name
  Assert-RegularTree $target
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
}

function Test-DisposableProfileEntry([string]$Relative) {
  # Match only known Chromium profile locations; never filter custom asset/save folders by name.
  $caches = '(?:Cache|Code Cache|GPUCache|GPUPersistentCache|DawnGraphiteCache|DawnWebGPUCache|ShaderCache|GrShaderCache|Crashpad|BrowserMetrics|logs)'
  return $Relative -match "^(?:$caches)(?:\\|$)" -or
    $Relative -match "^spotify-browser\\(?:(?:Default|Profile [^\\]+)\\)?$caches(?:\\|$)" -or
    $Relative -match "^Partitions\\[^\\]+\\$caches(?:\\|$)" -or
    $Relative -match '^(?:spotify-browser\\(?:(?:Default|Profile [^\\]+)\\)?)?Service Worker\\(?:CacheStorage|ScriptCache)(?:\\|$)' -or
    $Relative -match '^spotify-browser\\optimization_guide_model_store(?:\\|$)' -or
    $Relative -match '^(?:spotify-browser\\)?BrowserMetrics-spare\.pma$' -or
    $Relative -match '^(?:DevToolsActivePort|SingletonCookie|SingletonLock|SingletonSocket|lockfile)$'
}

function Get-TreeSnapshot([string]$Source, [bool]$Profile = $false) {
  Assert-RegularPath $Source
  $existed = Test-Path -LiteralPath $Source -PathType Container
  $files = [Collections.Generic.List[object]]::new()
  $directories = [Collections.Generic.List[string]]::new()
  if ($existed) {
    $pendingDirectories = [Collections.Generic.Stack[string]]::new()
    $pendingDirectories.Push($Source)
    while ($pendingDirectories.Count) {
      foreach ($item in Get-ChildItem -LiteralPath $pendingDirectories.Pop() -Force) {
        $relative = $item.FullName.Substring($Source.Length + 1)
        if ($Profile -and (Test-DisposableProfileEntry $relative)) { continue }
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked path: $($item.FullName)" }
        if ($item.PSIsContainer) {
          $directories.Add($relative)
          $pendingDirectories.Push($item.FullName)
        } else {
          $files.Add([pscustomobject]@{ Name = $relative; Length = $item.Length; Hash = $null })
        }
      }
    }
  }
  return [pscustomobject]@{ Existed = [bool]$existed; Files = @($files.ToArray()); Directories = @($directories.ToArray()); Storage = $null }
}

function Get-RenamedApplicationSnapshot {
  Assert-RegularPath $installPath
  $existed = Test-Path -LiteralPath (Join-Path $installPath 'Lira.exe') -PathType Leaf
  $files = @(if ($existed) {
    # Directory.Move preserves the entire tree. Only the entry points are needed for recovery checks;
    # enumerating Chromium/resources before the rename needlessly visits thousands of files.
    foreach ($name in @('Lira.exe', 'resources\app.asar', 'Uninstall Lira.exe')) {
      $file = Join-Path $installPath $name
      if ($name -eq 'Uninstall Lira.exe' -and -not (Test-Path -LiteralPath $file)) { continue }
      Assert-RegularPath $file
      $item = Get-Item -LiteralPath $file -Force
      if ($item.PSIsContainer) { throw "Invalid application entry point: $name" }
      [pscustomobject]@{ Name = $name; Length = $item.Length; Hash = $null }
    }
  })
  return [pscustomobject]@{ Existed = [bool]$existed; Files = $files; Directories = @(); Storage = 'renamed' }
}

function Get-SnapshotChild([string]$Directory, [string]$Name) {
  $candidate = [IO.Path]::GetFullPath((Join-Path $Directory $Name))
  if (-not $candidate.StartsWith($Directory + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid backup entry.' }
  return $candidate
}

function Assert-TreeSnapshot($Tree, [string]$Directory, [bool]$Moved = $false) {
  if ($Tree.Existed -isnot [bool]) { throw 'Invalid snapshot state.' }
  if (-not $Tree.Existed) {
    if (@($Tree.Files).Count -ne 0) { throw 'Invalid absent directory snapshot.' }
    return
  }
  if (-not (Test-Path -LiteralPath $Directory -PathType Container)) { throw "Missing backup directory: $Directory" }
  [LiraUpdateIO]::VerifyTree($Directory, [LiraUpdateFile[]]@($Tree.Files), $Moved, [Action]{ Report-Progress })
}

function Assert-ManifestIdentity($Snapshot) {
  if ($Snapshot.InstallDir -ne $installPath) { throw 'Invalid backup installation directory.' }
  if ($Snapshot.PSObject.Properties.Name -contains 'FormatVersion') {
    if ($Snapshot.FormatVersion -notin @(2, 3, 4) -or $Snapshot.UserDataDir -ne $userDataPath) { throw 'Invalid backup profile directory.' }
    if ($Snapshot.FormatVersion -eq 4) {
      $transaction = [Guid]::Empty
      if (-not [Guid]::TryParse([string]$Snapshot.TransactionId, [ref]$transaction)) { throw 'Invalid recovery transaction.' }
    }
  }
}

function Get-RollbackMarker($Snapshot, [string]$Directory) {
  return Get-SnapshotChild $Directory ".lira-rollback-$($Snapshot.TransactionId)"
}

function Get-RenamedApplicationSource($Snapshot, [string]$Directory) {
  $source = Join-Path $Directory 'app'
  if ($Snapshot.Application.Existed -and -not (Test-Path -LiteralPath $source -PathType Container)) {
    # The directory rename is atomic, but a later profile replacement may fail. The marker moves
    # with the original directory and lets the next attempt recognize an already restored app.
    $marker = Get-RollbackMarker $Snapshot $installPath
    Assert-RegularPath $marker
    if (-not (Test-Path -LiteralPath $marker -PathType Leaf) -or
        [IO.File]::ReadAllText($marker) -ne $Snapshot.TransactionId) { throw 'Missing renamed application backup.' }
    return $installPath
  }
  return $source
}

function Assert-BackupSnapshot($Snapshot, [string]$Directory) {
  Assert-ManifestIdentity $Snapshot
  $renamed = $Snapshot.PSObject.Properties.Name -contains 'FormatVersion' -and $Snapshot.FormatVersion -eq 4
  if ($renamed) { Assert-RegularPath $Directory } else { Assert-RegularTree $Directory }
  if ($Snapshot.PSObject.Properties.Name -notcontains 'FormatVersion') {
    # Pending backups made by the previous release contained only application files.
    if (@($Snapshot.Files).Count -eq 0) { throw 'Empty legacy backup.' }
    Assert-TreeSnapshot ([pscustomobject]@{ Existed = $true; Files = $Snapshot.Files }) $Directory
    return
  }
  $moved = $renamed -or ($Snapshot.FormatVersion -eq 3 -and $Snapshot.Application.Storage -eq 'moved')
  $appSource = if ($renamed) { Get-RenamedApplicationSource $Snapshot $Directory } else { Join-Path $Directory 'app' }
  Assert-RegularPath $appSource
  Assert-TreeSnapshot $Snapshot.Application $appSource $moved
  $names = @()
  foreach ($profile in $Snapshot.Profiles) {
    $null = Get-ProfilePath $profile.Name
    if ($profile.Name -in $names) { throw 'Duplicate backup profile.' }
    $names += $profile.Name
    $profileSource = Join-Path (Join-Path $Directory 'user-data') $profile.Name
    Assert-RegularTree $profileSource
    Assert-TreeSnapshot $profile $profileSource
  }
  if ($profileName -notin $names) { throw 'Missing primary profile snapshot.' }
}

function Copy-SnapshotTree($Tree, [string]$Source, [string]$Destination, [string]$CopyStage = 'Copiando saves') {
  if ($Tree.Existed) {
    $directories = if ($Tree.PSObject.Properties.Name -contains 'Directories') { $Tree.Directories } else {
      @(Get-ChildItem -LiteralPath $Source -Directory -Recurse -Force | ForEach-Object { $_.FullName.Substring($Source.Length + 1) })
    }
    Report-Progress $CopyStage $true
    # Cross the PowerShell/.NET boundary once per tree. Per-file cmdlets and callbacks dominate
    # small Chromium save files even when there are only a few hundred megabytes to copy.
    $entries = [LiraUpdateFile[]]@($Tree.Files)
    [LiraUpdateIO]::CopyTree($Source, $Destination, $entries, [string[]]$directories, [Action]{ Report-Progress })
    # Keep the entries updated by native IO as one array, including the hashes for the manifest.
    $Tree.Files = $entries
    $verificationStage = if ($CopyStage -eq 'Copiando saves') { 'Verificando backup' } else { 'Verificando restauracao' }
    Report-Progress $verificationStage $true
    Assert-TreeSnapshot $Tree $Destination
  }
}

function Move-UpdateTree([string]$Source, [string]$Destination) {
  $sourcePath = [IO.Path]::GetFullPath($Source)
  $destinationPath = [IO.Path]::GetFullPath($Destination)
  $stageApp = Join-Path $stagingPath 'app'
  $backupApp = Join-Path $backupPath 'app'
  $allowed = ($sourcePath -eq $installPath -and $destinationPath -eq $stageApp) -or
    ($sourcePath -in @($stageApp, $backupApp) -and $destinationPath -eq $installPath) -or
    ($sourcePath -eq $stagingPath -and $destinationPath -eq $backupPath)
  if (-not $allowed) { throw 'Move outside update directories.' }
  # Renaming a directory does not traverse its descendants. Validate the exact source/destination
  # and ancestors, leaving recursive checks for operations which actually read or delete a tree.
  Assert-RegularPath $sourcePath
  Assert-RegularPath $destinationPath
  [IO.Directory]::Move($sourcePath, $destinationPath)
}

function Write-Pending($Journal) {
  Assert-RegularTree $pendingPath
  Assert-RegularTree $pendingTempPath
  [IO.File]::WriteAllText($pendingTempPath, ($Journal | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
  [LiraUpdateIO]::PublishFile($pendingTempPath, $pendingPath)
}

function Read-Recovery {
  Assert-RegularTree $pendingPath
  $journal = Get-Content -LiteralPath $pendingPath -Raw -Encoding UTF8 | ConvertFrom-Json
  Assert-ManifestIdentity $journal
  if ($journal.PSObject.Properties.Name -notcontains 'BackupDir') {
    return [pscustomobject]@{ Journal = $journal; Snapshot = $journal; Directory = $backupPath; Preparing = $false }
  }
  if ($journal.BackupDir -notin @($backupPath, $stagingPath)) { throw 'Invalid recovery location.' }
  # A crash between the atomic rename and journal replacement may leave either location.
  foreach ($location in @($journal.BackupDir, $backupPath, $stagingPath) | Select-Object -Unique) {
    Assert-RegularPath $location
    $file = Join-Path $location 'snapshot.json'
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { continue }
    Assert-RegularTree $file
    $snapshot = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($snapshot.TransactionId -eq $journal.TransactionId) {
      Assert-ManifestIdentity $snapshot
      return [pscustomobject]@{ Journal = $journal; Snapshot = $snapshot; Directory = $location; Preparing = $journal.Phase -eq 'Preparing' }
    }
  }
  throw 'The recovery snapshot could not be found.'
}

function Undo-Preparation($Recovery) {
  Report-Progress 'Devolvendo aplicativo' $true
  $appSource = Join-Path $Recovery.Directory 'app'
  if ($Recovery.Snapshot.Application.Existed -and (Test-Path -LiteralPath $appSource -PathType Container)) {
    Assert-TreeSnapshot $Recovery.Snapshot.Application $appSource $true
    Remove-UpdateTree $installPath
    Move-UpdateTree $appSource $installPath
  } elseif ($Recovery.Snapshot.Application.Existed -and -not (Test-Path -LiteralPath (Join-Path $installPath 'Lira.exe'))) {
    throw 'The original application is missing.'
  }
  Remove-UpdateTree $Recovery.Directory
  Remove-Item -LiteralPath $pendingPath -Force
}

switch ($Action) {
  'Backup' {
    Assert-RegularTree $pendingPath
    if (Test-Path -LiteralPath $pendingPath) { throw 'An unfinished update must be recovered first.' }
    Assert-RegularPath $backupPath
    Assert-RegularPath $stagingPath
    Assert-RegularTree $progressPath
    if (Test-Path -LiteralPath $progressPath) { Remove-Item -LiteralPath $progressPath -Force }
    Report-Progress 'Preparando backup' $true
    $application = Get-RenamedApplicationSnapshot
    $profileNames = @($profileName)
    if (Test-Path -LiteralPath $profileParent) {
      foreach ($entry in Get-ChildItem -LiteralPath $profileParent -Directory -Force) {
        if ($entry.Name.StartsWith("$profileName-inst-", [StringComparison]::OrdinalIgnoreCase)) { $profileNames += $entry.Name }
      }
    }
    $profiles = @(foreach ($name in $profileNames) {
      $tree = Get-TreeSnapshot (Get-ProfilePath $name) $true
      [pscustomobject]@{ Name = $name; Existed = $tree.Existed; Files = $tree.Files; Directories = $tree.Directories }
    })
    if (-not $application.Existed -and @($profiles | Where-Object { $_.Existed }).Count -eq 0) { return }
    $snapshot = [pscustomobject]@{
      FormatVersion = 4; TransactionId = [Guid]::NewGuid().ToString(); InstallDir = $installPath; UserDataDir = $userDataPath
      Application = $application; Profiles = $profiles
    }
    Remove-UpdateTree $stagingPath
    $null = [IO.Directory]::CreateDirectory($stagingPath)
    foreach ($profile in $profiles) {
      $script:totalFiles += @($profile.Files).Count
      foreach ($file in $profile.Files) { $script:totalBytes += $file.Length }
    }
    try {
      foreach ($profile in $profiles) {
        Copy-SnapshotTree $profile (Get-ProfilePath $profile.Name) (Join-Path (Join-Path $stagingPath 'user-data') $profile.Name)
      }
      # Save the old uninstaller before moving INSTDIR. NSIS still needs it at its original path.
      $uninstaller = Join-Path $installPath 'Uninstall Lira.exe'
      $uninstallerBytes = if ($application.Existed -and (Test-Path -LiteralPath $uninstaller)) { [IO.File]::ReadAllBytes($uninstaller) } else { $null }
      Set-Content -LiteralPath (Join-Path $stagingPath 'snapshot.json') -Value ($snapshot | ConvertTo-Json -Depth 8) -Encoding UTF8
      $journal = [pscustomobject]@{
        FormatVersion = 4; TransactionId = $snapshot.TransactionId; InstallDir = $installPath; UserDataDir = $userDataPath
        BackupDir = $stagingPath; Phase = 'Preparing'
      }
      Write-Pending $journal
      if ($application.Existed) {
        Report-Progress 'Movendo aplicativo' $true
        Move-UpdateTree $installPath (Join-Path $stagingPath 'app')
        foreach ($file in $application.Files) { $script:movedAppBytes += $file.Length }
        if ($null -ne $uninstallerBytes) {
          $null = [IO.Directory]::CreateDirectory($installPath)
          [IO.File]::WriteAllBytes($uninstaller, $uninstallerBytes)
        }
      }
      # Each profile has already had exactly one destination verification; a directory move copies no app bytes.
      Report-Progress 'Removendo backup anterior' $true
      Remove-UpdateTree $backupPath
      Move-UpdateTree $stagingPath $backupPath
      $journal.BackupDir = $backupPath
      $journal.Phase = 'Installing'
      Write-Pending $journal
      Report-Progress 'Backup pronto' $true
    } catch {
      $backupFailure = $_
      try {
        if (Test-Path -LiteralPath $pendingPath) { Undo-Preparation (Read-Recovery) }
        else { Remove-UpdateTree $stagingPath }
      } catch { Write-Warning "Recovery files were preserved: $_" }
      throw $backupFailure
    }
  }
  'Restore' {
    Assert-RegularTree $pendingPath
    if (-not (Test-Path -LiteralPath $pendingPath)) { return }
    $recovery = Read-Recovery
    if ($recovery.Preparing) { Undo-Preparation $recovery; return }
    $snapshot = $recovery.Snapshot
    $snapshotDirectory = $recovery.Directory
    Report-Progress 'Restaurando Lira' $true
    Assert-BackupSnapshot $snapshot $snapshotDirectory
    Assert-RegularTree $installPath
    $legacy = $snapshot.PSObject.Properties.Name -notcontains 'FormatVersion'
    $renamed = -not $legacy -and $snapshot.FormatVersion -eq 4
    $application = if ($legacy) { [pscustomobject]@{ Existed = $true; Files = $snapshot.Files } } else { $snapshot.Application }
    if (-not $renamed) {
      $script:totalFiles = @($application.Files).Count
      foreach ($file in $application.Files) { $script:totalBytes += $file.Length }
    }
    if (-not $legacy) {
      foreach ($profile in $snapshot.Profiles) {
        $script:totalFiles += @($profile.Files).Count
        foreach ($file in $profile.Files) { $script:totalBytes += $file.Length }
      }
    }
    $script:verificationBase = [LiraUpdateIO]::VerificationReadBytes
    $appSource = if ($renamed) { Get-RenamedApplicationSource $snapshot $snapshotDirectory } elseif ($legacy) { $snapshotDirectory } else { Join-Path $snapshotDirectory 'app' }
    if ($snapshotDirectory -eq $stagingPath) {
      # Preserve the recovery source after an interrupted publication before reusing staging.
      Remove-UpdateTree $backupPath
      Move-UpdateTree $stagingPath $backupPath
      $snapshotDirectory = $backupPath
      $appSource = if ($renamed) { Get-RenamedApplicationSource $snapshot $backupPath } else { Join-Path $backupPath 'app' }
    }
    # Stage and verify saved profiles before replacing live data. New application backups return
    # by directory rename; old copied formats still need their original copy-based recovery.
    Remove-UpdateTree $stagingPath
    if (-not $renamed) { Copy-SnapshotTree $application $appSource (Join-Path $stagingPath 'app') 'Restaurando aplicativo' }
    if (-not $legacy) {
      Remove-UpdateTree $profileStagingPath
      foreach ($profile in $snapshot.Profiles) {
        Assert-RegularTree (Get-ProfilePath $profile.Name)
        Copy-SnapshotTree $profile (Join-Path (Join-Path $snapshotDirectory 'user-data') $profile.Name) (Join-Path $profileStagingPath $profile.Name) 'Restaurando saves'
      }
    }
    if ($renamed) {
      if (-not $application.Existed) { Remove-UpdateTree $installPath }
      elseif ($appSource -ne $installPath) {
        Report-Progress 'Devolvendo aplicativo' $true
        Remove-UpdateTree $installPath
        $marker = Get-RollbackMarker $snapshot $appSource
        Assert-RegularPath $marker
        [IO.File]::WriteAllText($marker, $snapshot.TransactionId)
        Move-UpdateTree $appSource $installPath
      }
    } else {
      Remove-UpdateTree $installPath
      if ($application.Existed) { Move-UpdateTree (Join-Path $stagingPath 'app') $installPath }
    }
    if (-not $legacy) {
      foreach ($profile in $snapshot.Profiles) {
        Remove-ProfileTree $profile.Name
        if ($profile.Existed) {
          # Staging alongside APPDATA also supports installations on another volume.
          $source = Get-SnapshotChild $profileStagingPath $profile.Name
          $destination = Get-ProfilePath $profile.Name
          Assert-RegularTree $source
          Assert-RegularPath $destination
          [IO.Directory]::Move($source, $destination)
        }
      }
      Remove-UpdateTree $profileStagingPath
    }
    Remove-UpdateTree $stagingPath
    Remove-Item -LiteralPath $pendingPath -Force
    if ($renamed -and $application.Existed) {
      # Removing this small marker is best effort only after the transaction is committed.
      try { Remove-Item -LiteralPath (Get-RollbackMarker $snapshot $installPath) -Force -ErrorAction Stop } catch {}
    }
    Report-Progress 'Lira restaurado' $true
  }
  'Commit' {
    Assert-RegularTree $pendingPath
    if (Test-Path -LiteralPath $pendingPath) {
      $snapshot = Get-Content -LiteralPath $pendingPath -Raw -Encoding UTF8 | ConvertFrom-Json
      Assert-ManifestIdentity $snapshot
      Remove-Item -LiteralPath $pendingPath -Force
    }
  }
  'Cleanup' {
    # A full uninstall removes recovery artifacts, while retaining the live profile.
    foreach ($target in @($backupPath, $stagingPath, $profileStagingPath, $pendingPath, $pendingTempPath, $progressPath)) { Assert-RegularTree $target }
    Remove-UpdateTree $backupPath
    Remove-UpdateTree $stagingPath
    Remove-UpdateTree $profileStagingPath
    if (Test-Path -LiteralPath $pendingPath) { Remove-Item -LiteralPath $pendingPath -Force }
    if (Test-Path -LiteralPath $pendingTempPath) { Remove-Item -LiteralPath $pendingTempPath -Force }
    if (Test-Path -LiteralPath $progressPath) { Remove-Item -LiteralPath $progressPath -Force }
  }
}
