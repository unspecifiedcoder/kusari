# Activate project-local tools for this terminal session only.
# Usage (from C:\ravi-workplace):   . .\env.ps1
$T = Join-Path $PSScriptRoot '.tools'
$env:PATH = "$T\node;$T\git\cmd;$T\foundry;$T\gh\bin;$env:PATH"
$env:GH_CONFIG_DIR     = "$T\gh-config"          # GitHub CLI login stays project-only
$env:PLAYWRIGHT_BROWSERS_PATH = "$T\ms-playwright"  # headless Chromium for the Anon-RPC reader
$env:npm_config_prefix = "$T\node"          # npm -g installs stay inside the project
$env:npm_config_cache  = "$T\npm-cache"
$env:FOUNDRY_DIR       = "$T\foundry"
Write-Host "Project tools active: node $(node --version), $(git --version), $(forge --version | Select-Object -First 1)"
