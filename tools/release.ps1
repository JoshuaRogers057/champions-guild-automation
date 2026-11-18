# Publishes a new version of Champions Guild Automation to GitHub.
#
#   .\tools\release.ps1 -Version 0.2.0          build, package, commit, tag, push, create the GitHub release
#   .\tools\release.ps1 -Version 0.2.0 -DryRun  build and package into dist\ only; no git or GitHub changes
#
# Before running: add a "## <version>" section to CHANGELOG.md (it becomes the release notes) and return
# Foundry to the Setup screen if a world with this module is open (the packs must not be locked).
# DMs' Foundry reads the manifest at releases/latest/download/module.json, so a normal (non-pre) release is what
# makes "Update" show up for them.
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [switch]$DryRun
)
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$repo = "JoshuaRogers057/champions-guild-automation"
$tag = "v$Version"
Set-Location $root

if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must look like 1.2.3" }

# Release notes from the CHANGELOG section for this version.
$changelog = [System.IO.File]::ReadAllText((Join-Path $root "CHANGELOG.md"))
$m = [regex]::Match($changelog, '(?ms)^## ' + [regex]::Escape($Version) + '[ \t]*\r?\n(.*?)(?=^## |\z)')
if (-not $m.Success) { throw "CHANGELOG.md has no '## $Version' section - add one first." }
$notes = $m.Groups[1].Value.Trim()

if (-not $DryRun) {
  $dirty = git status --porcelain | Where-Object { $_ -notmatch 'module\.json$' -and $_ -notmatch 'CHANGELOG\.md$' }
  if ($dirty) { throw "Uncommitted changes besides module.json/CHANGELOG.md:`n$($dirty -join "`n")`nCommit them first." }
  if (git tag --list $tag) { throw "Tag $tag already exists." }
}

# 1. Stamp version + download URL into module.json (UTF-8 without BOM - Foundry rejects a BOM).
$manifestPath = Join-Path $root "module.json"
$json = [System.IO.File]::ReadAllText($manifestPath)
$json = [regex]::Replace($json, '"version":\s*"[^"]*"', "`"version`": `"$Version`"")
$json = [regex]::Replace($json, '"download":\s*"[^"]*"', "`"download`": `"https://github.com/$repo/releases/download/$tag/module.zip`"")
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($manifestPath, $json, $utf8)

# 2. Build the compendiums.
& (Join-Path $PSScriptRoot "build.ps1")
if ($LASTEXITCODE -ne 0) { throw "Build failed." }

# 3. Package. Zip entries must use forward slashes (PowerShell 5's Compress-Archive writes backslashes,
#    which breaks installs on Linux hosts such as The Forge).
$dist = Join-Path $root "dist"
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory $dist | Out-Null
$zipPath = Join-Path $dist "module.zip"
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$include = @("module.json", "README.md", "CHANGELOG.md", "LICENSE", "scripts", "packs")
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, "Create")
try {
  foreach ($entry in $include) {
    $full = Join-Path $root $entry
    $files = if (Test-Path $full -PathType Container) { Get-ChildItem $full -Recurse -File } else { Get-Item $full }
    foreach ($f in $files) {
      if ($f.Name -in @("LOCK", "LOG", "LOG.old")) { continue }
      $rel = $f.FullName.Substring($root.Length + 1).Replace('\', '/')
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $rel) | Out-Null
    }
  }
} finally { $zip.Dispose() }
Copy-Item $manifestPath (Join-Path $dist "module.json")
Write-Host "Packaged $zipPath"

if ($DryRun) { Write-Host "Dry run: stopped before git/GitHub. module.json now says $Version."; exit 0 }

# 4. Commit, tag, push, release.
git add -A
git commit -m "Release $tag"
if ($LASTEXITCODE -ne 0) { throw "git commit failed." }
git tag $tag
git push origin HEAD --tags
if ($LASTEXITCODE -ne 0) { throw "git push failed." }
$notesFile = Join-Path $dist "notes.md"
[System.IO.File]::WriteAllText($notesFile, $notes, $utf8)
gh release create $tag $zipPath (Join-Path $dist "module.json") --repo $repo --title "Champions Guild Automation $Version" --notes-file $notesFile --latest
if ($LASTEXITCODE -ne 0) { throw "gh release create failed." }
Write-Host "Released $tag. DMs: Setup -> Add-on Modules -> Update, then CAT shield -> Mass Apply / Update."
