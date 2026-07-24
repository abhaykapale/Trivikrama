# Database Implementation Decisions

## Status
Accepted for initial database implementation.

## Scope
The first database implementation will prepare:

- PostgreSQL, MongoDB, and Redis lifecycle
- Database health checks
- Graceful shutdown
- PostgreSQL migration system
- PostgreSQL schema foundation
Repositories will be implemented after the database foundation is stable.

## Environment Variables
Canonical database environment variables:

- DATABASE_URL
- MONGODB_URI
- REDIS_URL
Legacy split PostgreSQL variables are not used by the application runtime.

## Migration Location
PostgreSQL SQL migrations live under:

migrations/postgres/

They are deployable runtime artifacts, not compiled TypeScript source.

## Database Client Choices

- PostgreSQL: pg / Knex.js
- MongoDB: Mongoose
- Redis: ioredis

## Layering Rule
src/database owns infrastructure lifecycle only:

- clients
- health checks
- migration runner
- connection shutdown
Repository interfaces belong inside module domain layers.
Repository implementations belong inside module infrastructure layers.

## Cross-Database Consistency
The system will not use distributed transactions across PostgreSQL and MongoDB.

Cross-store writes will be implemented as ordered, idempotent operations with retry-safe identifiers.
