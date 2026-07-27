$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root "routes\enterpriseRoutes.js"
$source = Join-Path $root "routes\enterpriseRoutes.js"

if (!(Test-Path $target)) {
  throw "Arquivo não encontrado: $target"
}

node --check $target
