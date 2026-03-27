$FROM="UserUpdates"
$TO="main"

# Sync latest scraped data from main into UserUpdates before merging
# (scrapers commit directly to main, so UserUpdates data files fall behind)
git fetch origin $TO
git checkout "origin/$TO" -- data/prices/
git add data/prices/
$hasChanges = git diff --staged --quiet; $LASTEXITCODE -ne 0
if ($hasChanges) {
    git commit -m "data: sync latest scraped data from main"
    git push origin $FROM
}

git checkout $TO
git merge $FROM --no-edit
if ($LASTEXITCODE -ne 0) {
    Write-Host "Merge conflict - resolve in VS Code before pushing" -ForegroundColor Red
    git checkout $FROM
    exit 1
}
git push origin $TO
git checkout $FROM
