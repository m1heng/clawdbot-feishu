---
name: release
description: Publish a new release of the Feishu plugin. Use when the user asks to release, publish, or cut a new version.
allowed-tools: Bash(npm version:*), Bash(npm publish:*), Bash(npx tsc:*), Bash(gh release:*), Bash(git tag:*), Bash(git push:*)
---

# Release Workflow

Publish a new version of `@m1heng-clawd/feishu` to npm and create a GitHub release.

## Prerequisites

- Working tree is clean (all changes committed to `main`)
- `npm login` session is active with publish access to `@m1heng-clawd` scope
- `gh` CLI is authenticated

## Steps

### 1. Determine version bump

Check what changed since the last release:

```bash
# Find latest release tag
gh release list --limit 1

# Review commits and diff stat
git log <last-tag>..HEAD --oneline
git diff <last-tag>..HEAD --stat
```

Choose bump type: `patch` (bug fixes), `minor` (new features), or `major` (breaking changes).

### 2. Type check

```bash
npx tsc --noEmit
```

Do NOT proceed if type check fails.

### 3. Draft release notes

Review the full diff to write release notes:

```bash
git diff <last-tag>..HEAD
```

Create a GitHub release **draft** first:

```bash
gh release create v<new-version> --draft --title "v<new-version>" --target main --notes "<release notes markdown>"
```

### 4. Bump version in package.json

Edit `package.json` to update the `"version"` field to `<new-version>`.

### 5. Commit, tag, and push

```bash
git add package.json
git commit -m "chore: bump version to <new-version>"
git tag v<new-version>
git push && git push --tags
```

### 6. Publish to npm

```bash
npm publish
```

If auth fails, ask the user to run `npm login` first, then retry.

### 7. Publish GitHub release

```bash
gh release edit v<new-version> --draft=false
```

## Release Notes Format

Follow the established format (see previous releases for reference):

```markdown
## Features

- **Feature title** — Description. (#PR)

## Bug Fixes

- **Fix title** — Description. (#PR)

## Internal

- Internal change description.
```

## Troubleshooting

### npm publish 404 / auth error

```bash
npm login          # re-authenticate
npm whoami         # verify logged in
npm publish        # retry
```

### Tag already exists

If the tag was created but publish failed, delete and recreate after fixing:

```bash
git tag -d v<version>
git push origin :refs/tags/v<version>
# fix issue, then re-tag and push
```
