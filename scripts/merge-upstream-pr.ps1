param(
  [string]$PR
)

if (-not $PR) {
  Write-Host "Usage: .\scripts\merge-upstream-pr.ps1 <PR_NUMBER>"
  Write-Host ""
  Write-Host "Open upstream PRs:"
  $prs = Invoke-RestMethod "https://api.github.com/repos/getpaseo/paseo/pulls?state=open&per_page=50"
  foreach ($p in $prs) {
    Write-Host ("#" + $p.number + "`t" + $p.title)
  }
  exit 1
}

# Ensure upstream remote exists
$remotes = git remote
if ($remotes -notcontains "upstream") {
  Write-Host "Adding upstream remote..."
  git remote add upstream https://github.com/getpaseo/paseo.git
}

Write-Host "Fetching PR #$PR from upstream..."
git fetch upstream "pull/$PR/head:pr-$PR"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Merging PR #$PR into current branch..."
git merge "pr-$PR" --no-edit
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$branch = git branch --show-current
Write-Host ""
Write-Host "Done! PR #$PR merged into $branch."
Write-Host "Run 'git push origin $branch' to push to your fork."
