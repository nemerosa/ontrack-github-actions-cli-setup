#!/usr/bin/env bash

set -euo pipefail

# Usage: ./tag.sh v5.0.3

version=${1:-}
if [[ -z "$version" ]]; then
  echo "Usage: $0 <version> (e.g. v5.0.3)" >&2
  exit 1
fi

# Ensure version looks like vX.Y.Z
if [[ ! $version =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Version must be of the form vX.Y.Z (e.g. v5.0.3)" >&2
  exit 1
fi

numeric=${version#v}
major=${numeric%%.*}                    # 5 from v5.0.3
rest=${numeric#*.}                      # 0.3
minor=${rest%%.*}                       # 0
major_minor="v${major}.${minor}"        # v5.0
major_tag="v${major}"                  # v5

current_branch=$(git rev-parse --abbrev-ref HEAD)
expected_branch="main"

if [[ "$current_branch" != "$expected_branch" ]]; then
  echo "You must be on branch '$expected_branch' to tag version $version. Current: $current_branch" >&2
  exit 1
fi

echo "Fetching tags from origin..."
git fetch --tags origin

tag_and_push() {
  local tag=$1
  local allow_delete=${2:-false}

  if $allow_delete; then
    if git rev-parse -q --verify "refs/tags/${tag}" >/dev/null; then
      echo "Deleting local tag ${tag}"
      git tag -d "$tag" >/dev/null
    fi
    echo "Deleting remote tag ${tag} (if exists)"
    git push origin ":refs/tags/${tag}" >/dev/null 2>&1 || true
  fi

  echo "Creating tag ${tag}"
  git tag -a "$tag" -m "Release ${tag}"
  echo "Pushing tag ${tag}"
  git push origin "refs/tags/${tag}"
}

# 1) tag & push vX.Y.Z
tag_and_push "$version" false

# 2) tag & push vX.Y (delete previous)
tag_and_push "$major_minor" true

# 3) tag & push vX (delete previous)
tag_and_push "$major_tag" true

echo "Done."

