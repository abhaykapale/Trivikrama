Update the architecture documentation for the changes in this branch.

Read and follow `AGENTS.md`.

First inspect the Git diff between the base branch and HEAD.

Analyze:

- added files
- modified files
- deleted files
- renamed files

Then inspect the affected source code and trace the actual
implementation.

Determine whether the changes affect architecture or documented flows.

If architecture changed:

- update the relevant ARCHITECTURE.md
- create an ARCHITECTURE.md for a new meaningful module when necessary
- update parent architecture documentation when necessary
- update Mermaid diagrams when necessary
- remove stale documentation when necessary

If architecture did not change:

- do not modify architecture documentation

IMPORTANT:

Only create or modify architecture Markdown documentation.

Do not modify application source code.

Do not modify tests.

Do not modify configuration.

Do not modify package files.

Do not modify unrelated documentation.

Do not create unnecessary documentation.

Keep the documentation concise.

After making changes, verify the documentation against the actual
source code.
