# Builds the extension and mirrors dist/ into the OneDrive-synced unpacked
# folder that Chrome loads on both machines. After this, updating the
# extension is just chrome://extensions -> reload.
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$target = "C:\Users\NathanBetters\OneDrive - Betters Agency LLC\App Library\EZLynx-Quote-Bridge\D365-Insurance-Quote-Connector-picker-fix"

Push-Location $repo
try {
  # Every publish gets its own version so chrome://extensions shows which
  # build is loaded (manifest.config.ts reads the version from package.json).
  npm version patch --no-git-tag-version | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "version bump failed" }
  $ver = (Get-Content package.json | ConvertFrom-Json).version
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "build failed" }
  git add package.json package-lock.json
  git commit -m "release: v$ver`n`nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>" | Out-Null
  git push | Out-Null
} finally { Pop-Location }

robocopy "$repo\dist" $target /MIR /NFL /NDL /NJH | Out-Null
if ($LASTEXITCODE -gt 7) { throw "robocopy failed with exit $LASTEXITCODE" }
Write-Host "Published v$ver to $target - reload the extension in chrome://extensions."

