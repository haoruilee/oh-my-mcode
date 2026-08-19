# Copy oh-my-mcode into the MiniMax Code local marketplace.
# Empirically on mcode 0.1.6, ~/.minimax/plugins/<name> auto-installs and enables.
# Packages cannot contain symlinks; this script copies files.
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Resolve-Path (Join-Path $ScriptDir "..")
$DestRoot = if ($env:MINIMAX_HOME) { $env:MINIMAX_HOME } else { Join-Path $HOME ".minimax" }
$Dest = Join-Path $DestRoot "plugins\oh-my-mcode"

if (-not (Test-Path (Join-Path $Root "plugin.json")) -or -not (Test-Path (Join-Path $Root ".minimax-plugin\plugin.json"))) {
  Write-Error "install: missing plugin manifests in $Root"
}

New-Item -ItemType Directory -Force -Path (Join-Path $DestRoot "plugins") | Out-Null
if (Test-Path $Dest) {
  Remove-Item -Recurse -Force $Dest
}
New-Item -ItemType Directory -Force -Path $Dest | Out-Null

$excludeNames = @(".git", "node_modules", ".DS_Store")
Get-ChildItem -Force -Path $Root | Where-Object { $excludeNames -notcontains $_.Name } | ForEach-Object {
  Copy-Item -Recurse -Force -Path $_.FullName -Destination (Join-Path $Dest $_.Name)
}

Get-ChildItem -Recurse -Force -Path $Dest | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint } | ForEach-Object {
  throw "install: refused to leave a reparse point in the package: $($_.FullName)"
}

Write-Host "Installed oh-my-mcode to $Dest"
Write-Host ""
Write-Host "This is a local marketplace drop-in. Official MiniMax catalog listing is separate"
Write-Host "and this plugin does not claim to be listed there."
Write-Host ""
Write-Host "Confirm on mcode 0.1.6:"
Write-Host "  mcode --version"
Write-Host "  mcode plugin list -m local"
Write-Host "  mcode plugin list -m local --json"
Write-Host ""
Write-Host "Then in MiniMax Code (desktop or mcode TUI) say:"
Write-Host "  max mode: <your task>"
Write-Host ""

$mcode = Get-Command mcode -ErrorAction SilentlyContinue
if ($mcode) {
  Write-Host "mcode is on PATH: $($mcode.Source)"
  & mcode --version
} else {
  Write-Host "mcode is not on PATH in this shell. Open the MiniMax Code terminal or install the CLI, then re-run the list commands."
}
