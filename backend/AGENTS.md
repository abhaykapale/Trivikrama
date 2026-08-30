# Trivikrama Backend 

## 1. Backend Responsibility

The backend is responsible for the server-side application logic of
Trivikrama.

It may contain:

- HTTP/API handling
- authentication
- users
- ingestion
- domain/application logic
- persistence
- security
- external integrations
- shared backend infrastructure

The actual implementation is the source of truth.

Do not assume an architectural pattern exists merely because a folder or
file name suggests it.

---

# 2. Backend Architecture

Before modifying or documenting backend code, understand the relevant
architectural boundary.

For every meaningful backend module, identify:

- entry points
- routes
- controllers/handlers
- middleware
- application services/use cases
- domain logic
- interfaces/contracts
- repositories
- infrastructure implementations
- external integrations
- persistence
- dependency injection
- error handling
- security boundaries

Trace the actual imports and runtime calls to determine how these
components are connected.

---

# 3. Backend Module Boundaries

Treat each meaningful directory under the backend source tree as a
potential architectural boundary.

Examples may include:

- auth
- users
- ingestion
- runtime
- infrastructure
- shared
- domain
- application

Do not assume every directory is an architectural module.

A directory should be documented as an architectural boundary only when
it contains meaningful responsibilities or relationships.

---

# 4. Request / Execution Flow

For HTTP/API functionality, trace the complete execution flow.

Where applicable, document:

Request
  ↓
HTTP server
  ↓
Middleware
  ↓
Router
  ↓
Route
  ↓
Controller / Handler
  ↓
Application Service / Use Case
  ↓
Domain Logic
  ↓
Repository / Infrastructure
  ↓
Database / External System
  ↓
Result
  ↓
Response

Do not use this exact flow unless it matches the implementation.

Use the actual class names, function names, interfaces, and files.

The documentation should make it possible to understand the request flow
without opening every source file.

---

# 5. Dependency Injection

Dependency Injection is an important architectural concern.

Whenever DI exists, trace it completely.

Identify:

- composition root
- dependency factory functions
- dependency creation
- interfaces
- concrete implementations
- constructors
- function parameters
- router factories
- service factories
- application factories
- middleware factories
- dependency wiring

For each important injected dependency, determine:

1. Who creates it?
2. What interface/contract does it implement?
3. Where is it wired?
4. Which class/function receives it?
5. How is it used?
6. What infrastructure does it ultimately access?

Architecture documentation should make the complete relationship visible.

Example:

Composition Root
      ↓
Concrete Implementation
      ↓
Interface / Contract
      ↓
Injected into Use Case
      ↓
Use Case invokes interface
      ↓
Concrete implementation executes operation

Use actual implementation names.

Do not document DI merely because interfaces exist.

---

# 6. Dependency Inversion

When interfaces/contracts are used, identify the dependency direction.

For example:

Application
     ↓
IUserRepository
     ↑
PostgresUserRepository

The documentation should distinguish between:

- abstraction
- implementation
- consumer
- composition/wiring

Do not confuse "imports an interface" with "dependency injection".

Verify the actual runtime wiring.

---

# 7. Class and Function Relationships

For important backend flows, trace relationships at the class and function
level.

Document meaningful relationships such as:

Route
  ↓
createAuthRouter()
  ↓
loginHandler()
  ↓
LoginUseCase.execute()
  ↓
IUserRepository.findByEmail()
  ↓
PostgresUserRepository.findByEmail()
  ↓
Database

Use actual names from the source code.

Do not document every helper function.

Focus on functions and classes that explain the architecture or an
important runtime path.

---

# 8. Factory Functions

Pay special attention to factory functions.

Factories may perform:

- dependency construction
- dependency wiring
- object composition
- router creation
- middleware creation
- application initialization

When a factory is architecturally important, show:

Factory
  ↓
Create dependency A
  ↓
Create dependency B
  ↓
Inject A + B
  ↓
Create consumer
  ↓
Return configured component

Trace the actual implementation rather than assuming what the factory
does.

---

# 9. Composition Root

Identify the backend composition root.

The composition root is the location where concrete implementations are
assembled into the application.

Look for:

- application bootstrap
- main/server entry point
- dependency factories
- module composition functions
- application factories

Document:

- what gets constructed
- in what logical order
- which implementations are selected
- what gets injected
- how the resulting components reach the application/router

If multiple composition roots exist, document their responsibilities
separately.

---

# 10. Authentication

The authentication module must be documented based on its actual
implementation.

When applicable, trace:

- login
- logout
- refresh
- current-user retrieval
- credential validation
- password hashing
- token creation
- token verification
- session creation
- session validation
- authentication middleware
- authorization checks

For important authentication flows, show:

Client
  ↓
Route
  ↓
Handler
  ↓
Use Case
  ↓
Authentication logic
  ↓
Repository / security dependency
  ↓
Session / token
  ↓
Response

Only include components that actually exist.

---

# 11. Users

For user-related functionality, document:

- user creation
- user retrieval
- user updates
- user identity
- repositories
- persistence
- authentication relationships
- authorization relationships

Where authentication depends on users, show the relationship between the
auth and users modules.

Avoid duplicating the entire users architecture inside auth documentation.

---

# 12. Ingestion

For ingestion functionality, document the actual pipeline.

Where applicable, identify:

- ingestion entry point
- request/message parsing
- validation
- schema validation
- semantic validation
- canonicalization
- hashing
- signature/HMAC verification
- trust verification
- persistence
- downstream processing
- response/error handling

For security-sensitive ingestion flows, show the order of operations.

For example:

Incoming Message
      ↓
Strict JSON Parsing
      ↓
Envelope Validation
      ↓
Schema Validation
      ↓
Semantic Validation
      ↓
Canonicalization
      ↓
Hash / HMAC Verification
      ↓
Trust Validation
      ↓
Accepted Message
      ↓
Persistence / Processing

Do NOT assume this exact pipeline.
Trace the implementation and document the actual order.

---

# 13. Security Boundaries

When documenting backend architecture, identify important trust boundaries.

Examples:

External Client
      ↓
HTTP Boundary
      ↓
Validation
      ↓
Authentication
      ↓
Authorization
      ↓
Application Logic
      ↓
Persistence

For security-sensitive components, identify:

- what is trusted
- what is untrusted
- where validation happens
- where authentication happens
- where authorization happens
- where cryptographic verification happens
- where secrets are consumed

Never expose actual secrets.

---

# 14. Error Flow

For important backend flows, document meaningful failure paths.

Examples:

Invalid Request
      ↓
Validation Failure
      ↓
Error Mapping
      ↓
HTTP Error Response

Authentication Failure
      ↓
Authentication Error
      ↓
Error Handler
      ↓
Unauthorized Response

Persistence Failure
      ↓
Repository Error
      ↓
Application Error Handling
      ↓
HTTP Response

Only document error flows that are supported by the actual implementation.

Do not invent error handling.

---

# 15. Data Flow

For important backend operations, identify how data moves through layers.

Example:

HTTP JSON
   ↓
Request DTO
   ↓
Validation
   ↓
Domain/Application Input
   ↓
Repository
   ↓
Database Model
   ↓
Domain/Application Output
   ↓
Response DTO
   ↓
HTTP JSON

Use actual types and transformations where they are architecturally
important.

Do not document trivial field assignments.

---

# 16. Interfaces and Contracts

Identify important interfaces/types/contracts that define boundaries
between backend components.

Document:

- who owns the contract
- who consumes it
- who implements it
- where the implementation is wired
- why the boundary exists when that is clear from the architecture

Prefer actual names.

Example:

IUserRepository
      ▲
      │ implements
      │
PostgresUserRepository
      │
      │ injected into
      ▼
LoginUseCase

---

# 17. Architecture Documentation

Every meaningful backend architectural folder should have an
ARCHITECTURE.md.

The document should allow a developer to understand the folder without
reading the entire source code.

Each document should contain only the information necessary to understand:

- responsibility
- folder structure
- important components
- relationships with other folders
- important classes
- important functions
- dependency flow
- DI
- execution flow
- data flow
- security flow
- important error flow
- external integrations

Prefer diagrams over long explanations.

---

# 18. Required Architecture Diagrams

For a meaningful backend module, use diagrams where they provide value.

Potential diagrams include:

### Folder Architecture

Show:

Module
├── application
├── domain
├── infrastructure
└── presentation

and how those areas connect.

### Runtime Flow

Show the actual execution path.

### Dependency / DI Flow

Show:

Composition Root
      ↓
Concrete Dependencies
      ↓
Interfaces
      ↓
Consumers

### Sequence Flow

Use sequenceDiagram when multiple components interact over time.

### Data Flow

Show how important data moves through the module.

### Error Flow

Show important failure paths.

### Integration Flow

Show relationships with:

- database
- external APIs
- queues
- collectors
- other backend modules

Do not create every diagram type for every module.

Only create diagrams that improve understanding.

---

# 19. Diagram Detail Standard

Diagrams must be detailed enough that a developer can explain the
implementation by looking at the diagram.

Avoid shallow diagrams such as:

Controller → Service → Repository

when the actual implementation contains many meaningful steps.

Instead, show the important actual components:

Router
  ↓
authenticateRequest()
  ↓
AuthController.login()
  ↓
LoginUseCase.execute()
  ↓
IUserRepository.findByEmail()
  ↓
PostgresUserRepository.findByEmail()
  ↓
Database
  ↓
User
  ↓
PasswordVerifier.verify()
  ↓
TokenService.create()
  ↓
SessionRepository.create()
  ↓
HTTP Response

Only include steps confirmed by the implementation.

---

# 20. Documentation Scope

Do not document:

- every file
- every import
- every variable
- every private helper
- trivial functions
- obvious implementation details

Document components that are important for understanding architecture,
dependencies, execution, security, or data flow.

The goal is:

"Understand the implementation by reading the architecture documentation."

The goal is NOT:

"Rewrite the source code as Markdown."

---

# 21. Parent and Child Documentation

Avoid duplication.

A higher-level backend ARCHITECTURE.md should explain:

- backend structure
- major modules
- relationships between modules

A module-level ARCHITECTURE.md should explain:

- internal structure
- detailed classes
- detailed functions
- detailed execution flow
- DI wiring
- important data/security/error flows

Do not copy the entire module documentation into the backend-level
documentation.

---

# 22. Architecture Documentation Safety

When performing an architecture documentation task:

ONLY Markdown files may be created or modified.

Allowed:

- *.md

Do NOT modify:

- TypeScript
- JavaScript
- TSX/JSX
- tests
- package.json
- lock files
- configuration
- .env files
- database files
- source code

Do not commit.
Do not push.

Treat source code as read-only.

---

# 23. Git-Based Documentation Updates

When asked to synchronize architecture documentation with a branch:

1. Inspect git status.
2. Inspect git diff.
3. Identify changed backend files.
4. Map changed files to architectural modules.
5. Inspect the changed implementation.
6. Trace affected dependencies.
7. Determine whether documented architecture changed.
8. Update only relevant ARCHITECTURE.md files.

Do not update documentation simply because a source file changed.

Update documentation when the change affects:

- module boundaries
- dependencies
- DI
- important classes
- important functions
- execution flow
- data flow
- security
- persistence
- integrations
- interfaces/contracts
- error flow

---

# 24. Backend Coding Rules

For normal coding tasks:

- preserve existing architecture
- follow existing naming conventions
- reuse existing abstractions where appropriate
- avoid unnecessary coupling
- avoid unnecessary abstractions
- keep modules cohesive
- keep infrastructure concerns out of domain/application logic when the
  existing architecture separates them
- use existing DI patterns
- avoid directly constructing infrastructure dependencies inside
  consumers when the architecture uses DI
- modify only necessary files

Do not introduce a new architectural pattern without understanding the
existing design.

---

# 25. Verification

Before completing backend work:

1. Inspect the final diff.
2. Verify only intended files changed.
3. Verify imports.
4. Verify dependency relationships.
5. Verify DI wiring.
6. Verify runtime flow.
7. Verify error handling.
8. Verify security-sensitive behavior.
9. Run relevant tests/checks when performing coding work.

For architecture documentation tasks additionally verify:

1. Only Markdown files were modified.
2. Every referenced source file exists.
3. Class/function names match the implementation.
4. DI relationships match the implementation.
5. Interface/implementation relationships are correct.
6. Mermaid diagrams are valid and readable.
7. Documentation does not contain invented behavior.
8. Parent/child documents do not unnecessarily duplicate each other.
9. No secrets are exposed.
