#!/usr/bin/env bash
set -e

PR=$1

if [ -z "$PR" ]; then
  echo "Usage: ./scripts/merge-upstream-pr.sh <PR_NUMBER>"
  echo ""
  echo "Lists open upstream PRs:"
  curl -s "https://api.github.com/repos/getpaseo/paseo/pulls?state=open&per_page=50" \
    | node -e "const d=[];process.stdin.on('data',c=>d.push(c));process.stdin.on('end',()=>{const prs=JSON.parse(d.join(''));prs.forEach(p=>console.log('#'+p.number+'\t'+p.title))})"
  exit 1
fi

# Ensure upstream remote exists
if ! git remote get-url upstream &>/dev/null; then
  echo "Adding upstream remote..."
  git remote add upstream https://github.com/getpaseo/paseo.git
fi

echo "Fetching PR #$PR from upstream..."
git fetch upstream "pull/$PR/head:pr-$PR"

echo "Merging PR #$PR into current branch..."
git merge "pr-$PR" --no-edit

echo ""
echo "Done! PR #$PR merged into $(git branch --show-current)."
echo "Run 'git push origin $(git branch --show-current)' to push to your fork."
