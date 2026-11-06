# Actual class/interface flow for PUT /users/:id

This file explains exactly when the PostgreSQL repository object is passed into the mutation flow.

## The key point

The Postgres repo object is not passed directly from the controller to the update method.

It is passed indirectly through the transaction context:

1. `main.ts` creates the real Postgres repositories.
2. `createUserManagementDependencies(...)` creates a transaction adapter.
3. `UpdateUserUseCase.execute(...)` calls `this.unitOfWork.execute(...)`.
4. Inside the transaction callback, the unit of work provides `repositories`.
5. That `repositories.users` is the actual `PostgresUserRepository` instance.
6. It is wrapped in `UserMutationRepositoryAdapter`, and only then is its `updateUser(...)` method called.

```mermaid
flowchart LR
    subgraph Bootstrap[Bootstrap Wiring]
        A[main ts bootstrap] --> B[createPostgresRepositories]
        B --> C[users repo instance]
        B --> D[audit repo instance]

        A --> E[createPostgresUnitOfWork]
        E --> F[unitOfWork instance]

        A --> G[createUserManagementDependencies]
        G --> H[Transaction adapter instance]
        H --> I[UpdateUserUseCase instance]
    end

    subgraph Request[Request Execution]
        R1[PUT request] --> R2[createUsersRouter]
        R2 --> R3[handleUpdateUser]
        R3 --> R4[use case execute call]
        R4 --> R5[UpdateUserUseCase execute]
    end

    subgraph Transaction[Transaction Callback]
        R5 --> T1[unitOfWork execute]
        T1 --> T2[PostgresUnitOfWork execute]
        T2 --> T3[transaction repositories]
        T3 --> T4[users repo from transaction]
        T3 --> T5[audit repo from transaction]

        T1 --> T6[adapter receives repos]
        T6 --> T7[adapter stores users repo]
        T7 --> T8[repository updateByIdAndOrg call]
        T8 --> T9[SQL UPDATE in public users]
    end

    subgraph Audit[Audit Insert]
        R5 --> A1[audit writer record]
        A1 --> A2[auditRepository create]
        A2 --> A3[PostgresAuditRepository create]
        A3 --> A4[SQL insert in audit logs]
    end

    T9 --> R6[updated user returned]
    A4 --> R6
    R6 --> R7[HTTP 200 response]

    classDef bootstrap fill:#E3F2FD,stroke:#1E88E5,stroke-width:1px;
    classDef request fill:#E8F5E9,stroke:#43A047,stroke-width:1px;
    classDef tx fill:#FFF3E0,stroke:#FB8C00,stroke-width:1px;
    classDef audit fill:#F3E5F5,stroke:#8E24AA,stroke-width:1px;

    class A,B,C,D,E,F,G,H,I bootstrap;
    class R1,R2,R3,R4,R5 request;
    class T1,T2,T3,T4,T5,T6,T7,T8,T9 tx;
    class A1,A2,A3,A4 audit;
```

## Actual code path

### 1) Repository objects are created once at bootstrap

In [src/main.ts](../main.ts):

- `const repositories = createPostgresRepositories(databaseClients.postgres);`
- `const unitOfWork = createPostgresUnitOfWork(databaseClients.postgres);`

The actual Postgres repo instance is created here:

- [src/database/repositories/postgres-repository.factory.ts](../database/repositories/postgres-repository.factory.ts)

```ts
return {
  users: new PostgresUserRepository(client),
  audit: new PostgresAuditRepository(client),
};
```

So `repositories.users` is a real `PostgresUserRepository` instance.

### 2) The repo is passed into the app dependency container

In [src/main.ts](../main.ts):

```ts
const UserManagementDependencies = createUserManagementDependencies({
  userRepository: repositories.users,
  userCreationRepository: repositories.users,
  passwordHasher: authApplicationDependencies.passwordService,
  unitOfWork,
});
```

That means the management composition layer receives the actual Postgres repo object.

### 3) The use case receives a transaction adapter, not the repo directly

In [src/modules/users/composition/user-management.dependencies.ts](../modules/users/composition/user-management.dependencies.ts):

```ts
const userMutationUnitOfWork = new PostgresUserMutationUnitOfWorkAdapter(input.unitOfWork);
const updateUserUseCase = new UpdateUserUseCase(userMutationUnitOfWork);
```

The `UpdateUserUseCase` only knows about `IUserMutationUnitOfWork`.

### 4) The actual Postgres repo is injected during transaction execution

Inside `PostgresUserMutationUnitOfWorkAdapter.execute(...)`:

```ts
return this.unitOfWork.execute(
  async ({ repositories }) => operation({
    users: new UserMutationRepositoryAdapter(repositories.users),
    audit: new UserMutationAuditWriterAdapter(repositories.audit),
  }),
  { ... }
);
```

This is the exact moment when the real repository object is handed over:

- `repositories.users` -> actual `PostgresUserRepository`
- wrapped as `new UserMutationRepositoryAdapter(repositories.users)`

Now the domain layer can call:

```ts
await users.updateUser({ userId, orgId, role, displayName });
```

### 5) That adapter calls the repo method

In [src/modules/users/infrastructure/user-mutation.repository.adapter.ts](../modules/users/infrastructure/user-mutation.repository.adapter.ts):

```ts
public async updateUser(input: UpdateManagedUserInput): Promise<MutatedManagedUser | null> {
  const user = await this.userRepository.updateByIdAndOrg(input.userId, input.orgId, {
    role: input.role,
    displayName: input.displayName,
  });
  return user === null ? null : mapUser(user);
}
```

At this point, `this.userRepository` is the actual `PostgresUserRepository` object created earlier.

### 6) The real SQL executes in the Postgres repository

In [src/database/repositories/users/postgres-user.repository.ts](../database/repositories/users/postgres-user.repository.ts):

```ts
const [row] = await this.db<UserRow>(USERS_TABLE)
  .where("id", ensureNonBlank(id, "id"))
  .andWhere("org_id", ensureNonBlank(orgId, "orgId"))
  .update(patch)
  .returning("*");
```

That is the actual database update.

## Short answer to your question

The Postgres repo object is sent into the update flow when the transaction callback runs:

- `unitOfWork.execute(...)`
- inside that callback: `repositories.users`
- then `new UserMutationRepositoryAdapter(repositories.users)`
- then `this.userRepository.updateByIdAndOrg(...)`

So the real DB object is not injected into the controller; it is injected into the transaction context at runtime and then wrapped by the repository adapter before the update executes.
