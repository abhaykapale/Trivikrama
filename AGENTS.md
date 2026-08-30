# Trivikrama 

## Repository Overview

Trivikrama is a multi-component software repository.

Major components may include:

- backend
- frontend
- collector
- contracts
- database
- scripts
- shared infrastructure
- architecture/documentation

The repository is organized into architectural boundaries.
Understand the relevant boundary before making changes.

The source code is the source of truth.

## Source of Truth

Always inspect the actual implementation before making architectural claims.

Do not infer behavior solely from:

- filenames
- folder names
- comments
- existing documentation
- variable names
- assumptions about common architecture patterns

Verify relationships using the actual source code, imports, function calls,
constructors, interfaces, factories, dependency wiring, and runtime entry
points.

Never invent architecture.

## Architecture

When analyzing the repository, identify:

- application boundaries
- module boundaries
- domain boundaries
- infrastructure boundaries
- shared components
- external integrations
- persistence
- contracts
- composition roots

For important components determine:

- who owns the responsibility
- who calls it
- what it calls
- what it depends on
- what depends on it
- where data enters
- where data leaves
- how errors propagate
- how security is enforced


## Dependency Injection

Whenever Dependency Injection exists, trace it completely.

Identify:

- composition root
- dependency factories
- dependency creation
- interfaces/contracts
- concrete implementations
- constructor injection
- function-parameter injection
- factory-based injection
- middleware injection
- router injection
- service/use-case injection
- dependency wiring

Documentation should show:

Concrete Implementation
        ↓
Interface / Contract
        ↓
Injected Into
        ↓
Consumer
        ↓
Runtime Usage

Do not merely state that Dependency Injection is used.

Show where the dependency is created, where it is wired, where it is
injected, and how the consumer uses it.

Only document DI relationships verified from the implementation.


## Architecture Documentation

ARCHITECTURE.md files are visual documentation of the actual implementation.

Their purpose is to allow a developer to understand a folder/module
without reading the entire source code.

Each meaningful architectural folder should have an ARCHITECTURE.md.

Documentation should explain:

1. Folder/module responsibility
2. Internal folder structure
3. Important components
4. Relationships between components
5. Relationships with other folders/modules
6. Important classes
7. Important functions
8. Dependency Injection
9. Execution flow
10. Request/response flow when applicable
11. Data flow
12. Persistence flow
13. Security flow when applicable
14. Important error/failure flow
15. External integrations
16. Important interfaces/contracts

## Architecture Diagrams

Prefer detailed Mermaid diagrams over large amounts of prose.

Diagrams must show actual implementation relationships.

A useful diagram should allow a developer to answer:

- Where does execution start?
- What happens next?
- Which function calls which function?
- Which class creates which object?
- Which class depends on which interface?
- Which implementation satisfies the interface?
- Where does Dependency Injection occur?
- Where does data move?
- Where does the request end?
- Where are errors handled?
- Where does the database/external service enter the flow?

Do not create diagrams containing only high-level boxes such as:

Controller → Service → Repository

unless that is genuinely the complete architecture.

Use actual class and function names whenever possible.

Prefer multiple focused detailed diagrams over one giant unreadable diagram.


## Mermaid Standards

Use the diagram type that best represents the information.

Use:

- flowchart TD for execution and dependency flows
- sequenceDiagram for request/response interactions
- stateDiagram-v2 for state transitions
- erDiagram for important database relationships

Use subgraphs when they help represent architectural boundaries.

Clearly distinguish:

- callers
- consumers
- interfaces
- implementations
- infrastructure
- external systems
- databases
- composition roots

## Folder Relationships

Architecture documentation must show how meaningful folders connect.

For example:

HTTP Layer
    ↓
Application Layer
    ↓
Domain Layer
    ↓
Infrastructure Layer
    ↓
Database

However, do not assume this structure.

Trace the actual implementation and use the real project structure.

Where a component depends on another folder/module, show the relationship
using actual files, classes, interfaces, or functions.

## Class and Function Flow

For important flows, trace execution beyond the folder level.

Show meaningful relationships such as:

Route
  ↓
Controller function
  ↓
Use-case function
  ↓
Repository method
  ↓
Database operation

and:

Factory
  ↓
Dependency construction
  ↓
Dependency injection
  ↓
Consumer constructor
  ↓
Runtime method call

Do not document every helper function.

Focus on functions and classes that are important for understanding the
architecture and execution flow.

## Security

When security is relevant, document the actual security flow.

Examples include:

- authentication
- authorization
- token validation
- session validation
- password hashing
- HMAC verification
- cryptographic verification
- input validation
- trust boundaries
- secret handling

Never expose actual secrets.

Never place:

- passwords
- API keys
- tokens
- private keys
- credentials

inside documentation.

## Documentation Size

Documentation should be concise but architecturally complete.

Do NOT:

- document every file
- document every import
- document every variable
- copy source code
- repeat implementation details unnecessarily
- write textbook explanations of common programming concepts

DO:

- document important architectural relationships
- document important execution paths
- document important dependencies
- use diagrams to replace unnecessary prose

The objective is:

"Understand the architecture without reading the entire source code."

Not:

"Create a written copy of the source code."


## Documentation Hierarchy

Avoid unnecessary duplication between ARCHITECTURE.md files.

Higher-level ARCHITECTURE.md files should explain:

- major architectural boundaries
- major components
- relationships between modules

Lower-level ARCHITECTURE.md files should explain:

- internal structure
- detailed class/function flow
- detailed dependency flow
- DI wiring
- detailed runtime behavior

Do not copy an entire child architecture into its parent.

## Initial Architecture Documentation

When asked to generate the initial architecture documentation:

1. Inspect the complete repository structure.
2. Identify meaningful architectural boundaries.
3. Inspect the implementation of each meaningful boundary.
4. Trace important dependencies.
5. Trace important execution flows.
6. Trace Dependency Injection.
7. Trace important data flows.
8. Trace security flows where applicable.
9. Create ARCHITECTURE.md files in appropriate folders.

Do not create documentation for trivial folders.

Do not create documentation based solely on folder names.

The initial documentation should represent the architecture that actually
exists in the current codebase.


## Architecture Documentation Updates

When asked to update architecture documentation based on Git changes:

1. Inspect the current Git status.
2. Inspect the relevant Git diff.
3. Compare the current branch against the appropriate base branch.
4. Identify changed files.
5. Determine which architectural boundaries are affected.
6. Inspect the affected implementation.
7. Determine whether the documented architecture changed.
8. Update only the relevant ARCHITECTURE.md files.

Do not update documentation merely because source code changed.

Update documentation when changes affect:

- architecture
- module boundaries
- dependencies
- DI wiring
- important classes
- important functions
- execution flow
- data flow
- security flow
- persistence
- external integrations
- interfaces/contracts

## Documentation-Only Safety Rule

When the task is explicitly an architecture documentation task:

ONLY Markdown files may be created or modified.

Allowed:

- *.md

Forbidden:

- *.ts
- *.tsx
- *.js
- *.jsx
- package.json
- lock files
- configuration files
- .env files
- database files
- scripts
- source code
- tests

Do not commit.
Do not push.

The source code must be treated as read-only during documentation tasks.

## Documentation Verification

Before completing an architecture documentation task:

1. Verify every documented relationship against the implementation.
2. Verify referenced files exist.
3. Verify class names are correct.
4. Verify function names are correct.
5. Verify interface/implementation relationships.
6. Verify DI relationships.
7. Verify execution flows.
8. Verify data flows.
9. Verify Mermaid syntax.
10. Ensure diagrams are readable.
11. Ensure there is no unnecessary duplication.
12. Ensure no secrets are exposed.
13. Verify that ONLY Markdown files were modified.
