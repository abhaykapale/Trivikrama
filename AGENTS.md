# Trivikrama Architecture Documentation Rules

## Purpose

Trivikrama maintains lightweight architecture documentation using
`ARCHITECTURE.md` Markdown files.

These files exist to allow developers to understand the architecture,
responsibilities, dependencies, and important execution flows without
reading the entire source code.

Source code is always the source of truth.

---

# Documentation Synchronization

Architecture documentation is synchronized before creating a PR.

The documentation workflow analyzes the Git changes introduced by the
current branch compared with its base branch.

The relevant comparison is:

    git diff <base-branch>...HEAD

The workflow must consider:

- added files
- modified files
- deleted files
- renamed files

---

# Architecture Impact

Determine whether a code change affects:

- architecture
- module responsibilities
- execution flow
- request flow
- data flow
- API routes
- middleware
- authentication
- authorization
- database interactions
- external services
- module dependencies
- lifecycle behavior
- important error flows
- security mechanisms
- architectural boundaries

Only update documentation when the documented architecture or an
important documented flow has changed.

---

# No-Impact Changes

Do NOT update architecture documentation for insignificant changes such as:

- variable renaming
- formatting
- comments
- typo fixes
- internal refactoring that preserves architecture
- implementation details that do not change documented behavior

---

# Documentation Hierarchy

Use the nearest meaningful `ARCHITECTURE.md`.

Examples:

    backend/src/modules/auth/ARCHITECTURE.md

    backend/src/modules/users/ARCHITECTURE.md

    collector/ARCHITECTURE.md

Use higher-level architecture documents for higher-level architecture.

For example:

    src/ARCHITECTURE.md

describes the architecture of the source tree rather than every
implementation detail.

Do not create an architecture document for every trivial folder.

---

# New Modules

When a meaningful new module is introduced:

1. Create an appropriate `ARCHITECTURE.md`.
2. Explain its responsibility.
3. List only important components.
4. Explain important dependencies.
5. Add concise Mermaid diagrams.
6. Update parent architecture documentation when required.

---

# Mermaid

Use Mermaid diagrams when they improve architectural understanding.

Preferred diagram types:

- `flowchart TD` for execution/control flow
- `sequenceDiagram` for request/response interactions
- `stateDiagram-v2` for meaningful state transitions
- `erDiagram` for important database relationships

Keep diagrams small, readable, and focused.

Do not create giant diagrams.

---

# Documentation Content

Architecture documentation should focus on:

- responsibility
- important components
- dependencies
- execution flow
- request flow
- data flow
- important architectural decisions
- security behavior
- important failure paths

Do NOT document:

- every function
- every variable
- every import
- every TypeScript type
- obvious implementation details
- boilerplate
- line-by-line source code

---

# Documentation Size

Keep documentation concise.

A meaningful module should generally remain around 50-150 lines unless
additional complexity genuinely requires more.

Prefer diagrams over large blocks of explanatory text when a diagram
communicates the architecture more effectively.

---

# Cross-Module Changes

If only one module changes:

Update that module's architecture documentation.

If multiple modules change:

Update the relevant module documentation.

If the overall system architecture changes:

Update the appropriate top-level architecture documentation.

Avoid duplicating detailed module documentation in higher-level files.

---

# Source Code Safety

The architecture synchronization workflow must ONLY create or modify
architecture Markdown files.

Allowed:

    *.md

Especially:

    ARCHITECTURE.md

Do NOT modify:

- TypeScript
- JavaScript
- tests
- configuration
- package files
- database files
- environment files
- source code

Do not automatically commit changes.

Do not push changes.

---

# Accuracy

Before updating documentation:

1. Inspect the actual implementation.
2. Trace relevant dependencies.
3. Verify the execution flow.
4. Verify referenced files exist.
5. Remove stale architectural information.

Never invent architecture.

If the implementation is unclear, inspect more source code before
documenting it.

---

# Final Verification

After documentation synchronization:

1. Verify only architecture Markdown files were modified or created.
2. Verify Mermaid syntax is structurally valid.
3. Verify referenced files exist.
4. Verify no secrets or credentials appear in documentation.
5. Verify unrelated documentation was not modified.

The resulting documentation must represent the current implementation.
