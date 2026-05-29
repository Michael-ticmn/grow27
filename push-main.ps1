$FROM="UserUpdates"
$TO="main"

# Sync latest scraped data from main into UserUpdates before merging
# (scrapers commit directly to main, so UserUpdates data files fall behind)
git fetch origin $TO
git checkout "origin/$TO" -- data/prices/
git add data/prices/
git diff --staged --quiet
$hasChanges = $LASTEXITCODE -ne 0   # --quiet exits 1 when there ARE staged changes
if ($hasChanges) {
    git commit -m "data: sync latest scraped data from main"
    git push origin $FROM
}

git checkout $TO
if ($LASTEXITCODE -ne 0) {
    Write-Host "checkout $TO failed (uncommitted changes?) - aborting before reset" -ForegroundColor Red
    git checkout $FROM
    exit 1
}
git reset --hard "origin/$TO"
git merge $FROM --no-edit
if ($LASTEXITCODE -ne 0) {
    Write-Host "Merge conflict - resolve in VS Code before pushing" -ForegroundColor Red
    git checkout $FROM
    exit 1
}
git push origin $TO
git checkout $FROM
