# Builds the extension and mirrors dist/ into the OneDrive-synced unpacked
# folder that Chrome loads on both machines. After this, updating the
# extension is just chrome://extensions -> reload.
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$target = "C:\Users\NathanBetters\OneDrive - Betters Agency LLC\App Library\EZLynx-Quote-Bridge\D365-Insurance-Quote-Connector-picker-fix"

Push-Location $repo
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "build failed" }
} finally { Pop-Location }

robocopy "$repo\dist" $target /MIR /NFL /NDL /NJH | Out-Null
if ($LASTEXITCODE -gt 7) { throw "robocopy failed with exit $LASTEXITCODE" }
Write-Host "Published to $target — reload the extension in chrome://extensions."
