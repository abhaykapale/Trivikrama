$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot

Write-Host ""
Write-Host "========================================="
Write-Host " Trivikrama Architecture Documentation"
Write-Host "========================================="
Write-Host ""

Set-Location $RepoRoot

Write-Host "Checking repository..."
git status --short

Write-Host ""
Write-Host "Checking changes against main..."
Write-Host ""

Write-Host "Committed changes compared with main:"
Write-Host ""

git diff --name-status main...HEAD

Write-Host ""
Write-Host "Uncommitted tracked changes:"
Write-Host ""

git diff --name-status

Write-Host ""
Write-Host "Untracked files:"
Write-Host ""

git ls-files --others --exclude-standard

Write-Host ""
Write-Host "Starting Codex..."
Write-Host ""

$prompt = @"
Read and follow the repository AGENTS.md and any applicable nested
AGENTS.md files before doing anything.

This is an architecture documentation synchronization task.

Repository root:

$RepoRoot

============================================================
OBJECTIVE
============================================================

Update the existing ARCHITECTURE.md documentation so that it accurately
represents the current implementation.

The source code is the source of truth.

Use Git changes to identify the likely architectural scope, but inspect the
actual implementation before changing documentation.

First inspect:

git status --short

Then inspect:

git diff main...HEAD

Also inspect unstaged and untracked changes when relevant.

============================================================
IMPORTANT
============================================================

You may ONLY create or modify Markdown (.md) files.

DO NOT modify:

- TypeScript
- JavaScript
- TSX
- JSX
- tests
- package.json
- lock files
- configuration
- .env files
- database files
- scripts
- source code
- any other non-Markdown files

Do NOT commit.
Do NOT push.

============================================================
CHANGE ANALYSIS
============================================================

Determine which architectural areas are affected by the current changes.

Do not assume that every changed source file requires documentation.

Determine whether the change affects:

- architecture
- module boundaries
- folder relationships
- dependencies
- Dependency Injection
- composition root
- interfaces/contracts
- concrete implementations
- class relationships
- function relationships
- execution flow
- data flow
- security flow
- persistence
- external integrations
- error flow

If a change does not affect architecture or architectural understanding,
do not unnecessarily modify ARCHITECTURE.md.

============================================================
DOCUMENTATION UPDATE
============================================================

For each affected architectural area:

1. Read the existing ARCHITECTURE.md.
2. Inspect the changed implementation.
3. Inspect related classes/functions/interfaces.
4. Trace dependencies.
5. Trace Dependency Injection.
6. Trace the runtime flow.
7. Determine what changed architecturally.
8. Update only the relevant Markdown documentation.

Preserve accurate existing documentation.

Do not rewrite documents unnecessarily.

============================================================
DEPENDENCY INJECTION
============================================================

If the change affects Dependency Injection, update the DI documentation.

Verify:

- composition root
- dependency construction
- concrete implementations
- interfaces/contracts
- dependency wiring
- constructor injection
- function injection
- factory injection
- router/application factory injection
- consumers
- runtime usage

Show the actual implementation names.

Do not use generic names when actual names are available.

============================================================
DI + RUNTIME
============================================================

Keep static dependency wiring and runtime execution understandable.

Where useful, maintain separate diagrams:

STATIC DI:

Composition Root
      ↓
Dependency Construction
      ↓
Concrete Implementation
      ↓
Interface / Contract
      ↓
Injection
      ↓
Consumer


RUNTIME:

Request/Event
      ↓
Entry Point
      ↓
Handler
      ↓
Consumer
      ↓
Injected Dependency
      ↓
Concrete Implementation
      ↓
Database / External System
      ↓
Result

Use actual implementation names.

============================================================
DETAILED DIAGRAMS
============================================================

Architecture diagrams must be detailed enough that a developer can
understand the implementation by looking at the diagram.

Show important:

- folders
- files
- classes
- functions
- interfaces
- implementations
- dependencies
- DI wiring
- execution steps
- data movement
- external systems

Avoid shallow diagrams such as:

Controller -> Service -> Repository

when the implementation contains more meaningful relationships.

Use multiple focused diagrams rather than one giant unreadable diagram.

============================================================
EXISTING DOCUMENTATION
============================================================

Do not blindly append information.

If an existing ARCHITECTURE.md can be made:

- clearer
- more accurate
- easier to understand
- more detailed where necessary
- less repetitive
- better structured
- better diagrammed

improve it.

If it is already accurate and sufficiently clear, leave it alone.

============================================================
FOLDER DOCUMENTATION
============================================================

Update the appropriate ARCHITECTURE.md based on the architectural
boundary affected by the change.

Do not create documentation for trivial folders.

Do not duplicate the same architectural information unnecessarily between
parent and child ARCHITECTURE.md files.

============================================================
VERIFICATION
============================================================

Before finishing:

1. Verify every documented relationship against the source.
2. Verify every class/function name.
3. Verify interfaces and implementations.
4. Verify DI wiring.
5. Verify runtime flow.
6. Verify folder relationships.
7. Verify referenced files exist.
8. Verify Mermaid syntax.
9. Ensure diagrams are readable.
10. Ensure no secrets are exposed.
11. Ensure documentation is concise.
12. Ensure only Markdown files were modified.

Finally run:

git status --short

and verify that no non-Markdown files were modified.

Do not revert existing user changes.

Do not commit.
Do not push.

The task is complete only when the architecture documentation accurately
represents the current implementation.
"@

codex exec `
    -C $RepoRoot `
    -s workspace-write `
    -- "$prompt"

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Codex failed. Architecture documentation was NOT updated." -ForegroundColor Red
    Write-Host "Exit code: $LASTEXITCODE" -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "========================================="
Write-Host " Architecture update complete"
Write-Host "========================================="
Write-Host ""

Write-Host "Changed files:"
git status --short

Write-Host ""
Write-Host "Review the Markdown changes before committing."
Write-Host ""
Write-Host "Validating documentation-only changes..."
Write-Host ""

$changedFiles = git status --short

$invalidFiles = @()

foreach ($line in $changedFiles) {
    if ($line.Length -lt 4) {
        continue
    }

    $file = $line.Substring(3).Trim()

    if ($file -notmatch '\.md$') {
        $invalidFiles += $file
    }
}

if ($invalidFiles.Count -gt 0) {
    Write-Host ""
    Write-Host "ERROR: Non-Markdown files were modified:" -ForegroundColor Red

    foreach ($file in $invalidFiles) {
        Write-Host "  $file" -ForegroundColor Red
    }

    Write-Host ""
    Write-Host "Review the changes before proceeding."

    exit 1
}

Write-Host "Documentation-only validation passed."
