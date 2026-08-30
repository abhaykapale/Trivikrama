# Architecture Documentation Instructions

## Purpose

This repository maintains lightweight architecture documentation using
`ARCHITECTURE.md` Markdown files.

These files exist so that a developer can understand the codebase,
architecture, and important execution flows without reading every
source file.

---

## Source of Truth

The source code is always the source of truth.

Never invent:

- components
- dependencies
- execution flows
- APIs
- middleware
- database interactions
- architectural relationships

If something cannot be confirmed from the source code, do not document
it as fact.

---

## Documentation Workflow

Architecture documentation is synchronized before creating a PR.

The documentation workflow uses the Git diff between the current branch
and its base branch to identify changes.

Analyze:

    git diff <base-branch>...HEAD

The workflow must consider:

- modified files
- added files
- deleted files
- renamed files

---

## What To Update

Update architecture documentation when changes affect:

- module responsibilities
- request flow
- execution flow
- data flow
- API routes
- middleware
- authentication
- authorization
- database interactions
- external services
- module dependencies
- lifecycle behavior
- security mechanisms
- important error flows
- new architectural components
- removed architectural components

---

## What NOT To Update

Do not modify architecture documentation for changes that do not affect
the documented architecture.

Examples:

- variable renaming
- formatting
- comments
- minor refactoring
- internal implementation changes
- typo fixes
- insignificant optimizations

---

## Documentation Location

Use the closest meaningful `ARCHITECTURE.md`.

Examples:

src/modules/auth/
→ src/modules/auth/ARCHITECTURE.md

src/modules/users/
→ src/modules/users/ARCHITECTURE.md

src/database/
→ src/database/ARCHITECTURE.md

Use:

src/ARCHITECTURE.md

for overall source architecture.

Do not create an architecture document for every trivial folder.

---

## New Files

When a new source file is added:

1. Determine its architectural responsibility.
2. Determine which module owns it.
3. Check the nearest ARCHITECTURE.md.
4. Update the documentation if the new file changes the architecture
   or an important flow.

Do not automatically create documentation just because a file exists.

---

## New Modules

When a new meaningful module is introduced:

1. Create an ARCHITECTURE.md for the module.
2. Describe its responsibility.
3. List only important files.
4. Describe important dependencies.
5. Add concise Mermaid diagrams.
6. Update parent architecture documentation when necessary.

---

## Mermaid

Prefer:

- `flowchart TD` for execution/control flow
- `sequenceDiagram` for request/response flows
- `stateDiagram-v2` for meaningful state transitions
- `erDiagram` for important database relationships

Keep diagrams small and readable.

Do not create giant diagrams.

Quote Mermaid labels containing special characters when necessary.

---

## Documentation Size

Keep architecture documentation concise.

Prefer approximately 50-150 lines for a meaningful module.

Do not document:

- every function
- every variable
- every import
- every TypeScript type
- obvious implementation details
- boilerplate
- source code line-by-line

Focus on:

- responsibility
- architecture
- dependencies
- execution flow
- important decisions
- security behavior
- data flow

---

## Cross-Module Changes

If a change affects one module:

Update that module's ARCHITECTURE.md.

If a change affects multiple modules:

Update the relevant module documentation.

If the overall architecture changes:

Also update:

src/ARCHITECTURE.md

Avoid duplicating detailed module documentation in the root document.

---

## Safety

The documentation workflow must ONLY create or modify architecture
Markdown documentation.

It must NOT modify:

- TypeScript
- JavaScript
- configuration
- database files
- tests
- package files
- environment files

Never expose:

- passwords
- API keys
- JWT secrets
- database credentials
- private keys
- tokens

in documentation.

---

## Verification

After updating documentation:

- verify referenced files exist
- verify relationships against source code
- verify execution order
- verify Mermaid syntax
- verify Markdown links
- remove stale information
- ensure no unrelated files were modified

The final result must describe the CURRENT implementation.
