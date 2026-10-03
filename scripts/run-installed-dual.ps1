param(
  [string]$ExecutablePath
)

$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent $PSScriptRoot
$candidates = @()
if ($ExecutablePath) {
  $candidates += $ExecutablePath
}
$candidates += @(
  (Join-Path $workspaceRoot 'release\win-unpacked\Lira.exe'),
  (Join-Path $env:LOCALAPPDATA 'Programs\Lira\Lira.exe'),
  (Join-Path $env:LOCALAPPDATA 'Lira\Lira.exe')
)

$resolvedExecutable = $null
foreach ($candidate in $candidates) {
  if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
    $resolvedExecutable = (Resolve-Path -LiteralPath $candidate).Path
    break
  }
}

if (-not $resolvedExecutable) {
  throw "Executável do Lira não encontrado. Gere o pacote ou informe -ExecutablePath 'C:\caminho\Lira.exe'."
}

$workingDirectory = Split-Path -Parent $resolvedExecutable
Write-Host "Abrindo duas instâncias instaladas: $resolvedExecutable"

# Both instances use explicit isolated profiles and bypass the normal
# single-instance focus lock, so they behave like two installed users.
Start-Process -FilePath $resolvedExecutable -WorkingDirectory $workingDirectory -ArgumentList @('--multi', '--instance=1')
Start-Sleep -Milliseconds 1200
Start-Process -FilePath $resolvedExecutable -WorkingDirectory $workingDirectory -ArgumentList @('--multi', '--instance=2')

Write-Host 'Duas instâncias iniciadas. Use perfis/contas diferentes para entrar na mesma sala.'
