# Builds the compendiums from src\ using Foundry's bundled Electron as Node (no separate Node install needed).
#   .\tools\build.ps1           build packs\
#   .\tools\build.ps1 -Check    validate src\ only, write nothing
param(
  [switch]$Check,
  [string]$FoundryExe = "E:\Foundry\Foundry Virtual Tabletop\Foundry Virtual Tabletop.exe"
)
if (-not (Test-Path $FoundryExe)) { Write-Error "Foundry not found at $FoundryExe - pass -FoundryExe <path to Foundry Virtual Tabletop.exe>"; exit 1 }
$env:ELECTRON_RUN_AS_NODE = "1"
$env:FOUNDRY_APP = Join-Path (Split-Path $FoundryExe) "resources\app"
$script = Join-Path $PSScriptRoot "build.mjs"
$extra = @()
if ($Check) { $extra += "--check" }
# Electron prints nothing unless its output is piped.
& $FoundryExe $script @extra 2>&1 | Out-String | Write-Host
exit $LASTEXITCODE
