$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '../..')
if (-not $env:VERSION) { throw 'Version requise.' }
$packages = @(Get-ChildItem 'apps/HorusDesktop/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*.exe')
if ($packages.Count -ne 1) { throw 'Un unique installateur NSIS est requis.' }
$parent = Join-Path $env:RUNNER_TEMP ('horus-install-' + [guid]::NewGuid())
$destination = Join-Path $parent 'Horus Desktop'
New-Item -ItemType Directory -Path $parent | Out-Null
# /D must be the final argument; NSIS accepts spaces without quotes after /D=.
$installer = Start-Process -FilePath $packages[0].FullName -ArgumentList "/S /D=$destination" -Wait -PassThru
if ($installer.ExitCode -ne 0) { throw "Échec NSIS : $($installer.ExitCode)" }
try {
  & node scripts/release/verify-desktop-files.mjs windows $destination 2>&1 | Tee-Object '.ci-logs/installer.log'
  if ($LASTEXITCODE -ne 0) { throw 'Vérification des fichiers installés en échec.' }
  New-Item -ItemType Directory -Force 'build/installers' | Out-Null
  Copy-Item $packages[0].FullName "build/installers/HorusDesktop-$($env:VERSION)-windows-x64.exe"
} finally {
  $uninstaller = Join-Path $destination 'uninstall.exe'
  if (Test-Path $uninstaller) {
    $process = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Échec désinstallation : $($process.ExitCode)" }
  }
}
