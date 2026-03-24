# grow27 - push to UserUpdates with auto minor version bump
# Update MSG, then run from the grow27 folder in VS Code terminal

# Safety: ensure we're on UserUpdates
git checkout UserUpdates

# Bump minor version (e.g. 1.12 -> 1.13)
$vf = "version.json"
$v = Get-Content $vf | ConvertFrom-Json
$parts = $v.version.Split(".")
$v.version = "$($parts[0]).$([int]$parts[1] + 1)"
$v | ConvertTo-Json -Compress | Set-Content $vf
Write-Host "Version bumped to $($v.version)" -ForegroundColor Yellow

# Update service worker cache name
$sw = Get-Content "sw.js" -Raw
$sw = $sw -replace "const CACHE = 'grow27-v[\d.]+';", "const CACHE = 'grow27-v$($v.version)';"
Set-Content "sw.js" $sw
Write-Host "Service worker cache updated to grow27-v$($v.version)" -ForegroundColor Yellow

# Update cache-bust query strings and feedback version in index.html
$idx = Get-Content "index.html" -Raw
$idx = $idx -replace '\?v=[\d.]+', "?v=$($v.version)"
$idx = $idx -replace 'Version%3A%20v[\d.]+', "Version%3A%20v$($v.version)"
$idx = $idx -replace 'class="app-version">v[\d.]+', "class=`"app-version`">v$($v.version)"
Set-Content "index.html" $idx
Write-Host "index.html version refs updated to $($v.version)" -ForegroundColor Yellow

if (-not $MSG) { $MSG = "v$($v.version) - your commit message here" } else { $MSG = "v$($v.version) - $MSG" }
git add -u
git add version.json sw.js
git commit -m $MSG
git push origin UserUpdates
