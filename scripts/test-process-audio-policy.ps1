$ErrorActionPreference = 'Stop'
$vswhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
$installPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $installPath) { throw 'C++ Build Tools are required for native audio policy tests.' }
$toolset = if (Test-Path -LiteralPath (Join-Path $installPath 'MSBuild\Microsoft\VC\v180\Platforms\x64\PlatformToolsets\v145')) { 'v145' } else { 'v143' }
$testDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('lira-audio-policy-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDirectory | Out-Null
$projectPath = Join-Path $PSScriptRoot '..\native\process-audio-capture\process-audio-capture.vcxproj'
[xml]$project = Get-Content -LiteralPath $projectPath
$ns = New-Object System.Xml.XmlNamespaceManager($project.NameTable)
$ns.AddNamespace('m', 'http://schemas.microsoft.com/developer/msbuild/2003')
$project.SelectSingleNode('//m:ClCompile[@Include]', $ns).SetAttribute('Include', (Join-Path $PSScriptRoot '..\native\process-audio-capture\tests\audioPolicy.test.cpp'))
$project.SelectSingleNode('//m:OutDir', $ns).InnerText = "$testDirectory\"
$project.SelectSingleNode('//m:IntDir', $ns).InnerText = "$testDirectory\obj\"
$project.SelectSingleNode('//m:TargetName', $ns).InnerText = 'audio-policy-test'
$testProject = Join-Path $testDirectory 'audio-policy-test.vcxproj'
$project.Save($testProject)
& (Join-Path $installPath 'MSBuild\Current\Bin\MSBuild.exe') $testProject '/t:Build' "/p:Configuration=Release;Platform=x64;PlatformToolset=$toolset" '/verbosity:quiet' '/nologo'
if ($LASTEXITCODE -ne 0) { throw 'Native audio policy test compilation failed.' }
& (Join-Path $testDirectory 'audio-policy-test.exe')
if ($LASTEXITCODE -ne 0) { throw 'Native audio policy tests failed.' }
