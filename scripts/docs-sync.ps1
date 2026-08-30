$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "============================================="
Write-Host "     TRIVIKRAMA ARCHITECTURE DOC SYNC"
Write-Host "============================================="
Write-Host ""

# --------------------------------------------------
# 1. Verify we are inside a Git repository
# --------------------------------------------------

$repoRoot = git rev-parse --show-toplevel

if ($LASTEXITCODE -ne 0) {
    Write-Error "Not inside a Git repository."
    exit 1
}

Set-Location $repoRoot

Write-Host "Repository: $repoRoot"

# --------------------------------------------------
# 2. Determine current branch
# --------------------------------------------------

$currentBranch = git branch --show-current

if ([string]::IsNullOrWhiteSpace($currentBranch)) {
    Write-Error "Unable to determine current Git branch."
    exit 1
}

Write-Host "Current branch: $currentBranch"

# --------------------------------------------------
# 3. Determine base branch
# --------------------------------------------------

$baseBranch = "main"

Write-Host "Base branch:    $baseBranch"
Write-Host ""

# --------------------------------------------------
# 4. Verify base branch exists
# --------------------------------------------------

git rev-parse --verify $baseBranch *> $null

if ($LASTEXITCODE -ne 0) {
    Write-Error "Base branch '$baseBranch' does not exist."
    exit 1
}

# --------------------------------------------------
# 5. Get changes introduced by this branch
# --------------------------------------------------

Write-Host "Analyzing Git changes..."
Write-Host ""

$changedFiles = git diff --name-status "$baseBranch...HEAD"

if ($LASTEXITCODE -ne 0) {
    Write-Error "Unable to calculate Git diff."
    exit 1
}

if ([string]::IsNullOrWhiteSpace($changedFiles)) {
    Write-Host "No changes detected against $baseBranch."
    exit 0
}

Write-Host "Changed files:"
Write-Host "---------------------------------------------"
Write-Host $changedFiles
Write-Host "---------------------------------------------"
Write-Host ""

# --------------------------------------------------
# 6. Save the diff for Codex
# --------------------------------------------------

$diffFile = Join-Path $repoRoot ".docs-sync-diff.txt"

git diff "$baseBranch...HEAD" -- . > $diffFile

if ($LASTEXITCODE -ne 0) {
    Write-Error "Unable to generate Git diff."
    exit 1
}

# --------------------------------------------------
# 7. Snapshot working tree before Codex
# --------------------------------------------------

$beforeStatus = git status --porcelain

# --------------------------------------------------
# 8. Run Codex
# --------------------------------------------------

Write-Host "Starting Codex..."
Write-Host ""

$prompt = @"
You are synchronizing Trivikrama architecture documentation.

Read and follow AGENTS.md before doing anything.

The complete Git diff between the base branch and HEAD is available in:

.docs-sync-diff.txt

Use the Git diff as the initial scope of investigation.

Then inspect the actual source code affected by those changes.

Determine whether the changes affect documented architecture or important
documented execution/data/request flows.

If architecture has changed:

- update the relevant ARCHITECTURE.md files
- create an ARCHITECTURE.md for a new meaningful module when necessary
- update parent architecture documentation when necessary
- update Mermaid diagrams when necessary
- remove stale architectural information when necessary

If architecture has NOT changed:

- do not modify any ARCHITECTURE.md files.

IMPORTANT SAFETY RULE:

You may ONLY create or modify architecture Markdown documentation.

Allowed:
- ARCHITECTURE.md files
- other Markdown files only if explicitly required by existing
  architecture documentation rules

Do NOT modify:
- TypeScript
- JavaScript
- tests
- configuration
- package files
- database files
- environment files
- source code

Do NOT commit.
Do NOT push.

Keep documentation concise and readable.

The source code is the source of truth.

After making changes, verify that the documentation accurately represents
the current implementation.
"@

$prompt | codex exec `
    -C $repoRoot `
    -s workspace-write `
    --ask-for-approval never `
    --ephemeral `
    -

if ($LASTEXITCODE -ne 0) {
    Write-Error "Codex documentation synchronization failed."
    exit 1
}

# --------------------------------------------------
# 9. Remove temporary diff
# --------------------------------------------------

Remove-Item $diffFile -Force -ErrorAction SilentlyContinue

# --------------------------------------------------
# 10. Check what changed
# --------------------------------------------------

Write-Host ""
Write-Host "============================================="
Write-Host "             POST-SYNC CHECK"
Write-Host "============================================="
Write-Host ""

$afterStatus = git status --porcelain

if ([string]::IsNullOrWhiteSpace($afterStatus)) {
    Write-Host "No documentation changes were required."
    Write-Host ""
    exit 0
}

Write-Host "Working tree changes:"
Write-Host "---------------------------------------------"
Write-Host $afterStatus
Write-Host "---------------------------------------------"
Write-Host ""

# --------------------------------------------------
# 11. Verify only Markdown files changed
# --------------------------------------------------

$invalidChanges = @()

foreach ($line in ($afterStatus -split "`n")) {

    if ([string]::IsNullOrWhiteSpace($line)) {
        continue
    }

    # Git status format:
    # XY filename

    $file = $line.Substring(3).Trim()

    if ($file -notmatch "\.md$") {
        $invalidChanges += $file
    }
}

if ($invalidChanges.Count -gt 0) {

    Write-Host ""
    Write-Host "❌ SAFETY CHECK FAILED" -ForegroundColor Red
    Write-Host ""
    Write-Host "Codex modified non-Markdown files:"

    foreach ($file in $invalidChanges) {
        Write-Host "  $file"
    }

    Write-Host ""
    Write-Host "Review your working tree before continuing."
    exit 1
}

Write-Host "✓ Only Markdown files were modified."
Write-Host ""
Write-Host "Architecture documentation synchronization complete."
Write-Host ""
