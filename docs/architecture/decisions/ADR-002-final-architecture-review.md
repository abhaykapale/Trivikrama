# ADR-002: Final Architecture Validation and Design Freeze

| Field | Value |
|---|---|
| **ADR ID** | ADR-002 |
| **Title** | Final Architecture Validation |
| **Status** | 🔒 **Accepted — Frozen** |
| **Date** | 2026-07-19 |
| **Decision Makers** | Principal Software Architect |
| **Supersedes** | N/A |

---

## 1. Context

The system architecture and design documents (HLD, SRS, APIs, database schema, security, deployment, etc.) have been fully drafted according to the constraints defined in [ADR-001](file:///d:/AI%20SIEM/docs/architecture/decisions/ADR-001-modular-monolith.md). Before moving to the implementation phase, a final comprehensive architecture review is required to ensure complete cross-document consistency, security, and scalability alignment.

## 2. Decision

We have validated the architecture suite and formally **freeze the design phase**. The architecture is internally consistent and ready for implementation. 

During the validation, the following architectural rectifications were made and applied across all documents:

1. **PM2 Startup Consistency**: Standardized production container startup to use `pm2-runtime` for the backend Node.js cluster, replacing raw `node` commands, aligning with the scaling strategy.
2. **Monitoring Infrastructure Clarification**: Clarified that infrastructure Prometheus exporters (`postgres-exporter`, `mongodb-exporter`, `redis-exporter`, `node-exporter`) are deployed via native infrastructure agents rather than bloating the core Docker Compose stack, maintaining the Modular Monolith simplicity.
3. **API Endpoint Consistency**: Added the `POST /api/v1/classify/threat` endpoint to the REST API documentation (`api.md`), which was previously defined in the HLD and ADR but missing from the API spec.
4. **WebSocket Security**: Enforced and documented strict WebSocket security controls in `security.md`, including `siem_token` (JWT) authentication during the HTTP Upgrade phase and independent frame rate limiting.

## 3. Consequences

- **Positive**: The architecture is fully cohesive, secure, and ready for immediate implementation. There are no orphan endpoints, missing database indexes, or undocumented security gaps.
- **Positive**: Single-engineer constraints are perfectly met through the strictly bounded Modular Monolith, Docker Compose deployment, and unified UI.
- **Negative (Accepted)**: No microservices or cloud-native replacements will be used in the MVP, ensuring the single-engineer timeline remains achievable at the cost of horizontal backend autoscaling.

---

> **This ADR formalizes the completion of the design phase. Implementation will proceed according to this finalized document suite.**
