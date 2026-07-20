# Deployment Architecture

## AI-Powered Security Analytics Platform

| Field | Value |
|---|---|
| **Document ID** | DEPLOY-001 |
| **Version** | 1.0 |
| **Date** | 2026-07-19 |
| **Status** | Draft |
| **Architecture Reference** | [ADR-001](file:///d:/AI%20SIEM/docs/architecture/decisions/ADR-001-modular-monolith.md) |
| **Scaling Reference** | [SCALE-001](file:///d:/AI%20SIEM/docs/scaling.md) |
| **Security Reference** | [SEC-001](file:///d:/AI%20SIEM/docs/security.md) |

---

## Table of Contents

1. [Environments](#1-environments)
2. [Docker](#2-docker)
3. [Directory Structure](#3-directory-structure)
4. [Configuration](#4-configuration)
5. [Monitoring](#5-monitoring)
6. [Logging](#6-logging)

---

## 1. Environments

### 1.1 Environment Overview

```mermaid
graph LR
    DEV["Development<br/>Local machine<br/>docker-compose.dev.yml"]
    TEST["Testing<br/>CI/CD runner<br/>docker-compose.test.yml"]
    PROD["Production<br/>Server(s)<br/>docker-compose.prod.yml"]

    DEV -->|"PR merge"| TEST
    TEST -->|"all tests pass<br/>+ manual approval"| PROD

    style DEV fill:#27ae60,color:#fff
    style TEST fill:#f39c12,color:#fff
    style PROD fill:#e74c3c,color:#fff
```

### 1.2 Environment Comparison

| Dimension | Development | Testing | Production |
|---|---|---|---|
| **Purpose** | Local coding, debugging | Automated test suite, CI/CD | Live deployment serving real traffic |
| **Docker Compose** | `docker-compose.dev.yml` | `docker-compose.test.yml` | `docker-compose.prod.yml` |
| **Backend** | Hot-reload (`ts-node-dev`) | Build + run | PM2 cluster (`pm2-runtime`) |
| **Frontend** | Hot-reload (`next dev`) | Build + static export | Production build (`next start`) |
| **AI Engine** | Hot-reload (`uvicorn --reload`) | Test fixtures | Production (`gunicorn`) |
| **Collector** | Mock data generator | Test fixtures | Compiled C++ binary |
| **PostgreSQL** | Local, seeded with sample data | Ephemeral, migrated per run | Persistent volume, backups |
| **MongoDB** | Local, seeded with sample events | Ephemeral, seeded per run | Persistent volume, backups |
| **Redis** | Local, no persistence | Ephemeral | AOF persistence, Sentinel (Tier 3+) |
| **HTTPS** | Disabled (HTTP) | Disabled | Enabled (nginx TLS termination) |
| **Secrets** | `.env` file | CI/CD secrets | Docker secrets / env from vault |
| **Logging** | Console (pretty-print) | Console (JSON) | JSON to files + stdout |
| **Monitoring** | None | Health checks in CI | Prometheus + Grafana |
| **Data** | Seed scripts | Test fixtures | Real production data |
| **Volumes** | Bind mounts (live code) | tmpfs (fast, ephemeral) | Named volumes (persistent) |

---

### 1.3 Development Environment

```mermaid
graph TB
    subgraph DEV_ENV["Development (docker-compose.dev.yml)"]

        subgraph CODE["Developer Machine"]
            IDE["IDE / Editor<br/>(VS Code)"]
            SRC["Source Code<br/>(bind mounted)"]
        end

        subgraph DOCKER_DEV["Docker Containers"]
            BE_DEV["backend-dev<br/>ts-node-dev --respawn<br/>Port 3000"]
            FE_DEV["frontend-dev<br/>next dev<br/>Port 3001"]
            AI_DEV["ai-engine-dev<br/>uvicorn --reload<br/>Port 8000"]
            PG_DEV["postgres-dev<br/>Port 5432"]
            MDB_DEV["mongo-dev<br/>Port 27017"]
            RD_DEV["redis-dev<br/>Port 6379"]
            MOCK_COL["mock-collector<br/>(generates sample batch files<br/>every 5 seconds)"]
        end
    end

    SRC -->|"bind mount"| BE_DEV
    SRC -->|"bind mount"| FE_DEV
    SRC -->|"bind mount"| AI_DEV
    IDE --> SRC

    MOCK_COL -->|"writes to<br/>./collector/data/"| BE_DEV
    BE_DEV --> PG_DEV
    BE_DEV --> MDB_DEV
    BE_DEV --> RD_DEV
    BE_DEV --> AI_DEV
    FE_DEV -->|"http://backend-dev:3000"| BE_DEV

    style DEV_ENV fill:#1a1a2e,color:#fff
```

**Key features:**
- **Bind mounts** for live code reloading — edit a file, container auto-restarts
- **Mock Collector** generates synthetic OCSF batch files to simulate real log ingestion
- **Database seed scripts** populate sample incidents, rules, users, and events
- **All ports exposed** to localhost for direct DB inspection (pgAdmin, MongoDB Compass)
- **No TLS, no auth complexity** — developer experience prioritized

---

### 1.4 Testing Environment

```mermaid
graph TB
    subgraph CI["CI/CD Pipeline (GitHub Actions)"]
        TRIGGER["PR opened / Push to main"]
        LINT["Lint + Type Check<br/>(ESLint, tsc)"]
        UNIT["Unit Tests<br/>(Jest / Vitest)"]
        INTEGRATION["Integration Tests<br/>(Supertest + Docker DBs)"]
        E2E["E2E Tests<br/>(Playwright against built app)"]
        BUILD["Docker Build<br/>(all images)"]
        REPORT["Test Report + Coverage"]
    end

    subgraph TEST_INFRA["docker-compose.test.yml"]
        BE_TEST["backend-test<br/>(compiled, NODE_ENV=test)"]
        AI_TEST["ai-engine-test<br/>(test model loaded)"]
        PG_TEST["postgres-test<br/>(ephemeral, tmpfs)"]
        MDB_TEST["mongo-test<br/>(ephemeral, tmpfs)"]
        RD_TEST["redis-test<br/>(ephemeral)"]
    end

    TRIGGER --> LINT --> UNIT --> INTEGRATION --> E2E --> BUILD --> REPORT
    INTEGRATION --> TEST_INFRA
    E2E --> TEST_INFRA

    style CI fill:#1a1a2e,color:#fff
```

**Key features:**
- **Ephemeral databases** on tmpfs — fast, clean slate every run
- **Migration + seed** runs before integration tests
- **Test model** for AI Engine — small pre-trained Isolation Forest for deterministic inference
- **Coverage gates** — PR blocked if coverage drops below threshold
- **Build verification** — all Docker images must build successfully

**Test commands:**

| Stage | Command | Description |
|---|---|---|
| Lint | `npm run lint && npm run type-check` | ESLint + TypeScript strict mode |
| Unit | `npm run test:unit` | Jest/Vitest unit tests (no Docker needed) |
| Integration | `docker compose -f docker-compose.test.yml up -d && npm run test:integration` | Tests against real DB containers |
| E2E | `npm run test:e2e` | Playwright browser tests against built app |
| AI Unit | `cd ai-engine && pytest tests/` | Python unit + inference tests |
| AI Integration | `pytest tests/integration/` | FastAPI routes against test model |

---

### 1.5 Production Environment

```mermaid
graph TB
    subgraph PROD_ENV["Production (docker-compose.prod.yml)"]

        subgraph PROXY["Reverse Proxy"]
            NGINX["Nginx<br/>:443 (HTTPS)<br/>TLS termination<br/>Rate limiting"]
        end

        subgraph APP_PROD["Application Containers"]
            BE_PROD["backend<br/>(pm2-runtime dist/main.js)<br/>PM2 cluster ×4<br/>Internal :3000"]
            FE_PROD["frontend<br/>(next start)<br/>Internal :3001"]
            AI_PROD["ai-engine<br/>(gunicorn + uvicorn)<br/>2 workers<br/>Internal :8000"]
        end

        subgraph DATA_PROD["Data Containers"]
            PG_PROD["postgres<br/>Named volume: pg_data<br/>Internal :5432"]
            MDB_PROD["mongo<br/>Named volume: mongo_data<br/>Internal :27017"]
            RD_PROD["redis<br/>Named volume: redis_data<br/>AOF persistence<br/>Internal :6379"]
        end

        subgraph COLLECTOR_PROD["Collector"]
            COL_PROD["collector<br/>(compiled C++ binary)<br/>Named volume: collector_data"]
        end

        subgraph MONITORING_PROD["Monitoring Stack"]
            PROM["Prometheus<br/>Internal :9090"]
            GRAFANA["Grafana<br/>:3002 (via nginx)"]
            ALERT_MGR["Alertmanager<br/>Internal :9093"]
        end
    end

    NGINX -->|"/"| FE_PROD
    NGINX -->|"/api/"| BE_PROD
    NGINX -->|"/grafana/"| GRAFANA
    BE_PROD --> PG_PROD
    BE_PROD --> MDB_PROD
    BE_PROD --> RD_PROD
    BE_PROD --> AI_PROD
    COL_PROD -->|"batch files"| BE_PROD
    PROM --> BE_PROD
    PROM --> AI_PROD
    PROM --> PG_PROD
    ALERT_MGR --> PROM

    style PROD_ENV fill:#1a1a2e,color:#fff
    style PROXY fill:#e74c3c,color:#fff
```

**Key features:**
- **Compiled/optimized** images — no dev dependencies, multi-stage builds
- **Named volumes** for all persistent data — survives container restarts
- **Nginx TLS termination** — only `:443` exposed to the network
- **PM2 cluster** — 4 Node.js workers for backend concurrency
- **Gunicorn** — production WSGI server for AI Engine
- **Health checks** on every container — Docker auto-restarts unhealthy containers
- **Monitoring stack** — Prometheus + Grafana + Alertmanager

---

## 2. Docker

### 2.1 Docker Image Architecture

```mermaid
graph TB
    subgraph IMAGES["Docker Images"]

        subgraph BE_IMG["backend"]
            BE_BASE["node:20-alpine"]
            BE_BUILD["Build Stage<br/>npm ci + tsc compile"]
            BE_RUN["Run Stage<br/>pm2-runtime dist/main.js<br/>~150 MB image"]
        end

        subgraph FE_IMG["frontend"]
            FE_BASE["node:20-alpine"]
            FE_BUILD["Build Stage<br/>npm ci + next build"]
            FE_RUN["Run Stage<br/>next start<br/>~200 MB image"]
        end

        subgraph AI_IMG["ai-engine"]
            AI_BASE["python:3.11-slim"]
            AI_DEPS["pip install requirements.txt"]
            AI_RUN["Run Stage<br/>gunicorn + uvicorn<br/>~800 MB image"]
        end

        subgraph COL_IMG["collector"]
            COL_BASE["ubuntu:22.04"]
            COL_BUILD["Build Stage<br/>CMake + gcc compile"]
            COL_RUN["Run Stage<br/>compiled binary<br/>~50 MB image"]
        end
    end

    style BE_RUN fill:#27ae60,color:#fff
    style FE_RUN fill:#3498db,color:#fff
    style AI_RUN fill:#f39c12,color:#fff
    style COL_RUN fill:#8e44ad,color:#fff
```

### 2.2 Dockerfiles

#### Backend Dockerfile

```dockerfile
# backend/Dockerfile

# ---- Build Stage ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --production=false
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ---- Production Stage ----
FROM node:20-alpine AS production
WORKDIR /app
RUN addgroup -S siem && adduser -S siem -G siem

COPY package*.json ./
RUN npm ci --production && npm cache clean --force && npm install -g pm2
COPY --from=builder /app/dist ./dist
COPY migrations/ ./migrations/

USER siem
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/v1/health || exit 1

CMD ["pm2-runtime", "start", "dist/main.js", "-i", "4"]
```

#### Frontend Dockerfile

```dockerfile
# frontend/Dockerfile

# ---- Build Stage ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Production Stage ----
FROM node:20-alpine AS production
WORKDIR /app
RUN addgroup -S siem && adduser -S siem -G siem

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

USER siem
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3001/ || exit 1

CMD ["node", "server.js"]
```

#### AI Engine Dockerfile

```dockerfile
# ai-engine/Dockerfile

FROM python:3.11-slim AS production
WORKDIR /app
RUN groupadd -r siem && useradd -r -g siem siem

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY models/ ./models/

USER siem
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/v1/health')" || exit 1

CMD ["gunicorn", "app.main:app", "-k", "uvicorn.workers.UvicornWorker", \
     "--workers", "2", "--bind", "0.0.0.0:8000", "--timeout", "120"]
```

#### Collector Dockerfile

```dockerfile
# collector/Dockerfile

# ---- Build Stage ----
FROM ubuntu:22.04 AS builder
RUN apt-get update && apt-get install -y cmake g++ libssl-dev
WORKDIR /app
COPY CMakeLists.txt ./
COPY src/ ./src/
COPY include/ ./include/
RUN mkdir build && cd build && cmake .. -DCMAKE_BUILD_TYPE=Release && make -j$(nproc)

# ---- Production Stage ----
FROM ubuntu:22.04 AS production
RUN apt-get update && apt-get install -y libssl3 && rm -rf /var/lib/apt/lists/*
RUN groupadd -r siem && useradd -r -g siem siem

COPY --from=builder /app/build/collector /usr/local/bin/collector
COPY config/ /etc/collector/

RUN mkdir -p /var/log/collector /var/lib/collector/data /var/lib/collector/checkpoints && \
    chown -R siem:siem /var/log/collector /var/lib/collector

USER siem

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD test -f /var/lib/collector/heartbeat.json && \
      test $(( $(date +%s) - $(stat -c %Y /var/lib/collector/heartbeat.json) )) -lt 60

CMD ["collector", "--config", "/etc/collector/config.yaml"]
```

### 2.3 Docker Compose — Development

```yaml
# docker-compose.dev.yml

version: "3.9"

services:
  backend-dev:
    build:
      context: ./backend
      dockerfile: Dockerfile.dev
    ports:
      - "3000:3000"
      - "9229:9229"  # Node.js debugger
    volumes:
      - ./backend/src:/app/src
      - ./backend/migrations:/app/migrations
    environment:
      - NODE_ENV=development
      - DATABASE_URL=postgresql://siem_app:devpass@postgres-dev:5432/siem_db
      - MONGODB_URI=mongodb://mongo-dev:27017/siem_events
      - REDIS_URL=redis://redis-dev:6379
      - JWT_SECRET=dev-only-secret-not-for-production-use-change-me-please-64chars
      - COLLECTOR_DIR=/data/collector
      - AI_ENGINE_URL=http://ai-engine-dev:8000
      - LOG_LEVEL=debug
      - LOG_FORMAT=pretty
    depends_on:
      postgres-dev:
        condition: service_healthy
      mongo-dev:
        condition: service_started
      redis-dev:
        condition: service_started
    networks:
      - siem-dev

  frontend-dev:
    build:
      context: ./frontend
      dockerfile: Dockerfile.dev
    ports:
      - "3001:3001"
    volumes:
      - ./frontend/src:/app/src
    environment:
      - NEXT_PUBLIC_API_URL=http://localhost:3000
      - NEXT_PUBLIC_WS_URL=ws://localhost:3000/ws
    depends_on:
      - backend-dev
    networks:
      - siem-dev

  ai-engine-dev:
    build:
      context: ./ai-engine
      dockerfile: Dockerfile.dev
    ports:
      - "8000:8000"
    volumes:
      - ./ai-engine/app:/app/app
      - ./ai-engine/models:/app/models
    environment:
      - ENVIRONMENT=development
      - LOG_LEVEL=debug
    networks:
      - siem-dev

  mock-collector:
    build:
      context: ./tools/mock-collector
    volumes:
      - collector_data:/data/collector
    environment:
      - EVENTS_PER_BATCH=50
      - BATCH_INTERVAL_SECONDS=5
    networks:
      - siem-dev

  postgres-dev:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_DB=siem_db
      - POSTGRES_USER=siem_app
      - POSTGRES_PASSWORD=devpass
    volumes:
      - pg_dev_data:/var/lib/postgresql/data
      - ./backend/migrations/init.sql:/docker-entrypoint-initdb.d/01-init.sql
      - ./tools/seed/seed_postgres.sql:/docker-entrypoint-initdb.d/02-seed.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U siem_app -d siem_db"]
      interval: 5s
      retries: 5
    networks:
      - siem-dev

  mongo-dev:
    image: mongo:7
    ports:
      - "27017:27017"
    volumes:
      - mongo_dev_data:/data/db
      - ./tools/seed/seed_mongo.js:/docker-entrypoint-initdb.d/seed.js
    networks:
      - siem-dev

  redis-dev:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    networks:
      - siem-dev

volumes:
  pg_dev_data:
  mongo_dev_data:
  collector_data:

networks:
  siem-dev:
    driver: bridge
```

### 2.4 Docker Compose — Testing

```yaml
# docker-compose.test.yml

version: "3.9"

services:
  postgres-test:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=siem_db_test
      - POSTGRES_USER=siem_app
      - POSTGRES_PASSWORD=testpass
    tmpfs:
      - /var/lib/postgresql/data  # RAM-backed for speed
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U siem_app -d siem_db_test"]
      interval: 2s
      retries: 10
    networks:
      - siem-test

  mongo-test:
    image: mongo:7
    tmpfs:
      - /data/db
    networks:
      - siem-test

  redis-test:
    image: redis:7-alpine
    networks:
      - siem-test

networks:
  siem-test:
    driver: bridge
```

### 2.5 Docker Compose — Production

```yaml
# docker-compose.prod.yml

version: "3.9"

services:
  nginx:
    image: nginx:alpine
    ports:
      - "443:443"
      - "80:80"      # Redirect to 443
    volumes:
      - ./deploy/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./deploy/nginx/ssl:/etc/nginx/ssl:ro
    depends_on:
      backend:
        condition: service_healthy
      frontend:
        condition: service_healthy
    restart: always
    networks:
      - siem-prod

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
      target: production
    environment:
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL}
      - MONGODB_URI=${MONGODB_URI}
      - REDIS_URL=${REDIS_URL}
      - JWT_SECRET=${JWT_SECRET}
      - COLLECTOR_DIR=/data/collector
      - AI_ENGINE_URL=http://ai-engine:8000
      - LOG_LEVEL=info
      - LOG_FORMAT=json
      - PM2_INSTANCES=4
    volumes:
      - collector_data:/data/collector:ro
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/v1/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s
    restart: always
    deploy:
      resources:
        limits:
          cpus: "4.0"
          memory: 4G
        reservations:
          cpus: "2.0"
          memory: 2G
    networks:
      - siem-prod

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
      target: production
    environment:
      - NEXT_PUBLIC_API_URL=https://${DOMAIN}
      - NEXT_PUBLIC_WS_URL=wss://${DOMAIN}/ws
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3001/"]
      interval: 30s
      timeout: 5s
      retries: 3
    restart: always
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 1G
    networks:
      - siem-prod

  ai-engine:
    build:
      context: ./ai-engine
      dockerfile: Dockerfile
      target: production
    volumes:
      - ai_models:/app/models:ro
    environment:
      - ENVIRONMENT=production
      - LOG_LEVEL=info
      - WORKERS=2
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/v1/health')"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
    restart: always
    deploy:
      resources:
        limits:
          cpus: "4.0"
          memory: 4G
    networks:
      - siem-prod

  collector:
    build:
      context: ./collector
      dockerfile: Dockerfile
      target: production
    volumes:
      - collector_data:/var/lib/collector/data
      - collector_checkpoints:/var/lib/collector/checkpoints
      - collector_logs:/var/log/collector
      - /var/log:/host/var/log:ro              # Host log access
    environment:
      - COLLECTOR_ID=collector-01
      - COLLECTOR_HMAC_SECRET=${COLLECTOR_HMAC_SECRET}
    restart: always
    deploy:
      resources:
        limits:
          cpus: "2.0"
          memory: 512M
    networks:
      - siem-prod

  postgres:
    image: postgres:16-alpine
    volumes:
      - pg_data:/var/lib/postgresql/data
      - ./deploy/postgres/postgresql.conf:/etc/postgresql/postgresql.conf:ro
      - ./deploy/postgres/pg_hba.conf:/etc/postgresql/pg_hba.conf:ro
    environment:
      - POSTGRES_DB=siem_db
      - POSTGRES_USER=${PG_USER}
      - POSTGRES_PASSWORD=${PG_PASSWORD}
    command: postgres -c config_file=/etc/postgresql/postgresql.conf
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${PG_USER} -d siem_db"]
      interval: 10s
      retries: 5
    restart: always
    deploy:
      resources:
        limits:
          cpus: "4.0"
          memory: 8G
    networks:
      - siem-prod

  mongo:
    image: mongo:7
    volumes:
      - mongo_data:/data/db
      - ./deploy/mongo/mongod.conf:/etc/mongod.conf:ro
    command: mongod --config /etc/mongod.conf
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 10s
      retries: 5
    restart: always
    deploy:
      resources:
        limits:
          cpus: "4.0"
          memory: 8G
    networks:
      - siem-prod

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
      - ./deploy/redis/redis.conf:/usr/local/etc/redis/redis.conf:ro
    command: redis-server /usr/local/etc/redis/redis.conf
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      retries: 5
    restart: always
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 2G
    networks:
      - siem-prod

  # --- Monitoring Stack ---

  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./deploy/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - ./deploy/prometheus/alerts.yml:/etc/prometheus/alerts.yml:ro
      - prometheus_data:/prometheus
    command:
      - "--config.file=/etc/prometheus/prometheus.yml"
      - "--storage.tsdb.retention.time=30d"
    restart: always
    networks:
      - siem-prod

  grafana:
    image: grafana/grafana:latest
    volumes:
      - grafana_data:/var/lib/grafana
      - ./deploy/grafana/provisioning:/etc/grafana/provisioning:ro
      - ./deploy/grafana/dashboards:/var/lib/grafana/dashboards:ro
    environment:
      - GF_SERVER_ROOT_URL=https://${DOMAIN}/grafana
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_PASSWORD}
    restart: always
    networks:
      - siem-prod

  alertmanager:
    image: prom/alertmanager:latest
    volumes:
      - ./deploy/alertmanager/alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro
    restart: always
    networks:
      - siem-prod

volumes:
  pg_data:
  mongo_data:
  redis_data:
  collector_data:
  collector_checkpoints:
  collector_logs:
  ai_models:
  prometheus_data:
  grafana_data:

networks:
  siem-prod:
    driver: bridge
    ipam:
      config:
        - subnet: 172.28.0.0/16
```

### 2.6 Nginx Configuration (Production)

```nginx
# deploy/nginx/nginx.conf

upstream backend {
    server backend:3000;
}

upstream frontend {
    server frontend:3001;
}

upstream grafana {
    server grafana:3000;
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name _;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate     /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # Security headers
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Request size limits
    client_max_body_size 5m;

    # API routes → Backend
    location /api/ {
        proxy_pass http://backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Rate limiting (additional layer)
        limit_req zone=api burst=20 nodelay;
    }

    # WebSocket → Backend
    location /ws {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400s;
    }

    # Grafana → Monitoring
    location /grafana/ {
        proxy_pass http://grafana/;
        proxy_set_header Host $host;
    }

    # Everything else → Frontend
    location / {
        proxy_pass http://frontend;
        proxy_set_header Host $host;
    }
}

# Rate limit zone
limit_req_zone $binary_remote_addr zone=api:10m rate=100r/m;
```

### 2.7 Container Security

| Measure | Implementation |
|---|---|
| **Non-root user** | All containers run as `siem` user (UID 1001). Never root |
| **Read-only rootfs** | Production containers use `read_only: true` where possible |
| **No new privileges** | `security_opt: ["no-new-privileges:true"]` |
| **Minimal base images** | Alpine-based for Node.js/Redis/PostgreSQL. Slim for Python |
| **Multi-stage builds** | Build tools excluded from production images |
| **Health checks** | Every container has a `HEALTHCHECK`. Docker restarts unhealthy containers |
| **Resource limits** | CPU and memory limits on every production container |
| **No exposed ports** | Only nginx `:443` and `:80` exposed. All other ports are internal |

---

## 3. Directory Structure

### 3.1 Complete Project Structure

```
ai-siem/
│
├── backend/                          # Node.js + TypeScript Backend (Process 2)
│   ├── src/
│   │   ├── main.ts                   # Entry point, Express app setup
│   │   ├── app.ts                    # Express app configuration
│   │   ├── server.ts                 # HTTP server, WebSocket, graceful shutdown
│   │   │
│   │   ├── config/                   # Configuration
│   │   │   ├── index.ts              # Centralized config loader
│   │   │   ├── database.ts           # PostgreSQL + MongoDB connection config
│   │   │   ├── redis.ts              # Redis connection config
│   │   │   └── validateSecrets.ts    # Startup secret validation
│   │   │
│   │   ├── middleware/               # Express middleware
│   │   │   ├── auth.ts               # JWT verification
│   │   │   ├── rbac.ts               # Role-based access control
│   │   │   ├── rateLimiter.ts        # Rate limiting (Redis-backed)
│   │   │   ├── validator.ts          # Zod schema validation
│   │   │   ├── errorHandler.ts       # Global error handler
│   │   │   ├── requestLogger.ts      # HTTP request logging
│   │   │   └── securityHeaders.ts    # Helmet configuration
│   │   │
│   │   ├── modules/                  # Domain modules (Clean Architecture)
│   │   │   ├── auth/
│   │   │   │   ├── domain/           # Entities, interfaces
│   │   │   │   ├── application/      # Use cases (AuthService)
│   │   │   │   ├── infrastructure/   # PostgresUserRepository, JWTService
│   │   │   │   └── routes/           # Express routes
│   │   │   │
│   │   │   ├── incidents/
│   │   │   │   ├── domain/           # Incident, Alert, TimelineEntry
│   │   │   │   ├── application/      # IncidentService, Correlator
│   │   │   │   ├── infrastructure/   # PostgresIncidentRepository
│   │   │   │   └── routes/           # Express routes
│   │   │   │
│   │   │   ├── events/
│   │   │   │   ├── domain/           # NormalizedEvent, SearchFilters
│   │   │   │   ├── application/      # EventService
│   │   │   │   ├── infrastructure/   # MongoEventRepository
│   │   │   │   └── routes/           # Express routes
│   │   │   │
│   │   │   ├── rules/
│   │   │   │   ├── domain/           # Rule, CompiledRule
│   │   │   │   ├── application/      # RuleService, RuleCompiler, RuleEvaluator
│   │   │   │   ├── infrastructure/   # PostgresRuleRepository
│   │   │   │   └── routes/           # Express routes
│   │   │   │
│   │   │   ├── users/
│   │   │   │   ├── domain/
│   │   │   │   ├── application/
│   │   │   │   ├── infrastructure/
│   │   │   │   └── routes/
│   │   │   │
│   │   │   ├── assets/
│   │   │   │   ├── domain/
│   │   │   │   ├── application/
│   │   │   │   ├── infrastructure/
│   │   │   │   └── routes/
│   │   │   │
│   │   │   ├── dashboard/
│   │   │   │   ├── application/      # DashboardService (aggregations)
│   │   │   │   └── routes/
│   │   │   │
│   │   │   ├── audit/
│   │   │   │   ├── domain/
│   │   │   │   ├── application/      # AuditLogger
│   │   │   │   ├── infrastructure/   # PostgresAuditRepository
│   │   │   │   └── routes/
│   │   │   │
│   │   │   └── collector/
│   │   │       ├── application/      # DirectoryWatcher, FileValidator
│   │   │       └── routes/           # Collector status routes
│   │   │
│   │   ├── pipeline/                 # Ingestion & Detection Pipeline
│   │   │   ├── workers/              # BullMQ worker implementations
│   │   │   │   └── pipelineWorker.ts
│   │   │   ├── stages/              # Pipeline stages
│   │   │   │   ├── parser.ts
│   │   │   │   ├── normalizer.ts
│   │   │   │   ├── featureExtractor.ts
│   │   │   │   └── detector.ts
│   │   │   ├── queue/               # Queue abstraction
│   │   │   │   ├── IProcessingQueue.ts
│   │   │   │   └── BullMQProcessingQueue.ts
│   │   │   └── ai/                  # AI Client
│   │   │       ├── IAIClient.ts
│   │   │       └── HttpAIClient.ts
│   │   │
│   │   ├── shared/                  # Shared utilities
│   │   │   ├── logger.ts            # Winston logger
│   │   │   ├── errors.ts            # Custom error classes
│   │   │   └── types.ts             # Shared TypeScript types
│   │   │
│   │   └── websocket/              # WebSocket server
│   │       ├── WebSocketServer.ts
│   │       └── channels.ts
│   │
│   ├── migrations/                  # Database migrations
│   │   ├── init.sql                 # Initial schema
│   │   ├── 001_create_users.sql
│   │   ├── 002_create_incidents.sql
│   │   ├── 003_create_rules.sql
│   │   └── ...
│   │
│   ├── tests/
│   │   ├── unit/
│   │   ├── integration/
│   │   └── fixtures/
│   │
│   ├── Dockerfile
│   ├── Dockerfile.dev
│   ├── package.json
│   ├── tsconfig.json
│   └── jest.config.ts
│
├── frontend/                        # Next.js Frontend (Process 4)
│   ├── src/
│   │   ├── app/                     # App Router pages
│   │   ├── components/              # React components
│   │   ├── hooks/                   # Custom hooks
│   │   ├── services/                # API clients
│   │   ├── stores/                  # Zustand stores
│   │   ├── types/                   # TypeScript types
│   │   ├── utils/                   # Utilities
│   │   └── styles/                  # CSS
│   │
│   ├── middleware.ts
│   ├── Dockerfile
│   ├── Dockerfile.dev
│   ├── package.json
│   ├── tsconfig.json
│   └── next.config.js
│
├── ai-engine/                       # Python FastAPI AI Engine (Process 3)
│   ├── app/
│   │   ├── main.py                  # FastAPI entry point
│   │   ├── routes/
│   │   ├── core/
│   │   ├── schemas/
│   │   └── config.py
│   │
│   ├── models/                      # Trained model artifacts
│   │   ├── config.json
│   │   └── v20260718_120000/
│   │       ├── model.joblib
│   │       └── scaler.joblib
│   │
│   ├── scripts/
│   │   ├── train_model.py
│   │   └── export_training_data.py
│   │
│   ├── tests/
│   ├── Dockerfile
│   ├── Dockerfile.dev
│   └── requirements.txt
│
├── collector/                       # C++ Collector Agent (Process 1)
│   ├── src/
│   │   ├── main.cpp
│   │   ├── readers/
│   │   ├── ocsf/
│   │   ├── batch/
│   │   ├── checkpoint/
│   │   └── config/
│   │
│   ├── include/
│   ├── config/
│   │   └── config.yaml
│   ├── tests/
│   ├── CMakeLists.txt
│   └── Dockerfile
│
├── deploy/                          # Deployment configurations
│   ├── nginx/
│   │   ├── nginx.conf
│   │   └── ssl/
│   │       ├── cert.pem
│   │       └── key.pem
│   │
│   ├── postgres/
│   │   ├── postgresql.conf          # Tuned PostgreSQL config
│   │   └── pg_hba.conf
│   │
│   ├── mongo/
│   │   └── mongod.conf              # Tuned MongoDB config
│   │
│   ├── redis/
│   │   └── redis.conf               # Redis with AOF persistence
│   │
│   ├── prometheus/
│   │   ├── prometheus.yml           # Scrape targets
│   │   └── alerts.yml               # Alert rules
│   │
│   ├── grafana/
│   │   ├── provisioning/
│   │   │   ├── datasources/
│   │   │   └── dashboards/
│   │   └── dashboards/
│   │       ├── siem-overview.json
│   │       ├── backend-metrics.json
│   │       ├── ai-engine-metrics.json
│   │       └── collector-metrics.json
│   │
│   ├── alertmanager/
│   │   └── alertmanager.yml
│   │
│   └── backup/
│       ├── backup_postgres.sh
│       ├── backup_mongo.sh
│       └── crontab
│
├── tools/                           # Development tools
│   ├── mock-collector/              # Generates fake OCSF batch files
│   │   ├── Dockerfile
│   │   └── generate.py
│   │
│   └── seed/                        # Database seed scripts
│       ├── seed_postgres.sql
│       └── seed_mongo.js
│
├── docs/                            # Design documents
│   ├── architecture/
│   │   └── decisions/
│   │       └── ADR-001-modular-monolith.md
│   ├── SRS.md
│   ├── HLD.md
│   ├── collector.md
│   ├── backend.md
│   ├── backend-detection.md
│   ├── database.md
│   ├── rule-engine.md
│   ├── ai-engine.md
│   ├── frontend.md
│   ├── incidents.md
│   ├── api.md
│   ├── security.md
│   ├── scaling.md
│   └── deployment.md
│
├── docker-compose.dev.yml
├── docker-compose.test.yml
├── docker-compose.prod.yml
├── .env.example
├── .gitignore
├── Makefile
└── README.md
```

---

## 4. Configuration

### 4.1 Configuration Hierarchy

```mermaid
graph TB
    subgraph CONFIG_HIER["Configuration Priority (highest → lowest)"]
        L1["1. Environment Variables<br/>(docker-compose / .env)"]
        L2["2. Database Config<br/>(PostgreSQL configuration table)"]
        L3["3. Config Files<br/>(config.yaml, redis.conf, etc.)"]
        L4["4. Application Defaults<br/>(hardcoded in source code)"]
    end

    L1 -->|"overrides"| L2
    L2 -->|"overrides"| L3
    L3 -->|"overrides"| L4

    style L1 fill:#e74c3c,color:#fff
    style L4 fill:#95a5a6,color:#fff
```

### 4.2 Backend Configuration

```typescript
// backend/src/config/index.ts

export const config = {
  // Server
  port: parseInt(process.env.PORT || "3000"),
  nodeEnv: process.env.NODE_ENV || "development",

  // Database
  databaseUrl: process.env.DATABASE_URL!,
  mongodbUri: process.env.MONGODB_URI!,
  redisUrl: process.env.REDIS_URL!,

  // Auth
  jwt: {
    secret: process.env.JWT_SECRET!,
    accessTokenExpiry: process.env.JWT_ACCESS_TOKEN_EXPIRY || "1h",
    maxSessionDuration: process.env.JWT_MAX_SESSION_DURATION || "7d",
    cookieName: "siem_token",
    issuer: "ai-siem",
  },

  // Collector
  collector: {
    dir: process.env.COLLECTOR_DIR || "./collector/data",
    hmacSecret: process.env.COLLECTOR_HMAC_SECRET || "",
    watchInterval: parseInt(process.env.COLLECTOR_WATCH_INTERVAL || "1000"),
  },

  // AI Engine
  ai: {
    url: process.env.AI_ENGINE_URL || "http://ai-engine:8000",
    timeout: parseInt(process.env.AI_TIMEOUT || "5000"),
    batchSize: parseInt(process.env.AI_BATCH_SIZE || "100"),
    anomalyThreshold: parseFloat(process.env.AI_THRESHOLD || "0.65"),
  },

  // Queue
  queue: {
    concurrency: parseInt(process.env.QUEUE_CONCURRENCY || "4"),
    maxRetries: parseInt(process.env.QUEUE_MAX_RETRIES || "3"),
  },

  // Correlation
  correlation: {
    timeWindowMinutes: parseInt(process.env.CORRELATION_WINDOW || "15"),
    maxDurationHours: parseInt(process.env.CORRELATION_MAX_DURATION || "24"),
  },

  // Logging
  log: {
    level: process.env.LOG_LEVEL || "info",
    format: process.env.LOG_FORMAT || "json",
  },

  // Frontend
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:3001",

  // Bcrypt
  bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS || "12"),
};
```

### 4.3 PostgreSQL Production Config

```ini
# deploy/postgres/postgresql.conf

# Connection
max_connections = 100
listen_addresses = '*'

# Memory
shared_buffers = 2GB
effective_cache_size = 6GB
work_mem = 16MB
maintenance_work_mem = 512MB

# WAL
wal_level = replica
max_wal_senders = 3
wal_keep_size = 1GB
checkpoint_completion_target = 0.9

# Query Planner
random_page_cost = 1.1                # SSD-optimized
effective_io_concurrency = 200         # SSD-optimized

# Logging
log_min_duration_statement = 1000      # Log slow queries > 1s
log_checkpoints = on
log_connections = on
log_disconnections = on
log_line_prefix = '%t [%p]: user=%u,db=%d '
```

### 4.4 MongoDB Production Config

```yaml
# deploy/mongo/mongod.conf

storage:
  dbPath: /data/db
  wiredTiger:
    engineConfig:
      cacheSizeGB: 4
    collectionConfig:
      blockCompressor: snappy

net:
  port: 27017
  bindIp: 0.0.0.0

operationProfiling:
  slowOpThresholdMs: 500
  mode: slowOp

systemLog:
  destination: file
  path: /var/log/mongodb/mongod.log
  logAppend: true
```

### 4.5 Redis Production Config

```ini
# deploy/redis/redis.conf

# Persistence
appendonly yes
appendfsync everysec
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb

# Memory
maxmemory 2gb
maxmemory-policy allkeys-lru

# Network
bind 0.0.0.0
protected-mode no
tcp-keepalive 300

# Slow log
slowlog-log-slower-than 10000
slowlog-max-len 128
```

### 4.6 Makefile (Developer Commands)

```makefile
# Makefile

.PHONY: dev test prod stop clean logs

# Development
dev:
	docker compose -f docker-compose.dev.yml up --build

dev-d:
	docker compose -f docker-compose.dev.yml up --build -d

# Testing
test-up:
	docker compose -f docker-compose.test.yml up -d
	sleep 5

test-unit:
	cd backend && npm run test:unit

test-integration: test-up
	cd backend && npm run test:integration

test-e2e: test-up
	cd frontend && npm run test:e2e

test-ai:
	cd ai-engine && pytest tests/

test-all: test-up test-unit test-integration test-ai

test-down:
	docker compose -f docker-compose.test.yml down -v

# Production
prod:
	docker compose -f docker-compose.prod.yml up --build -d

prod-logs:
	docker compose -f docker-compose.prod.yml logs -f

# Maintenance
stop:
	docker compose -f docker-compose.dev.yml down
	docker compose -f docker-compose.test.yml down
	docker compose -f docker-compose.prod.yml down

clean: stop
	docker volume prune -f
	docker image prune -f

logs:
	docker compose -f docker-compose.dev.yml logs -f

# Database
db-migrate:
	cd backend && npm run migrate

db-seed:
	cd backend && npm run seed

db-backup:
	./deploy/backup/backup_postgres.sh
	./deploy/backup/backup_mongo.sh
```

---

## 5. Monitoring

### 5.1 Monitoring Architecture

```mermaid
graph TB
    subgraph MON_ARCH["Monitoring Architecture"]

        subgraph TARGETS["Metric Sources"]
            BE_MET["Backend<br/>/metrics endpoint<br/>(prom-client)"]
            AI_MET["AI Engine<br/>/metrics endpoint<br/>(prometheus-fastapi)"]
            PG_MET["PostgreSQL<br/>(postgres_exporter)"]
            MDB_MET["MongoDB<br/>(mongodb_exporter)"]
            RD_MET["Redis<br/>(redis_exporter)"]
            NG_MET["Nginx<br/>(stub_status)"]
            NODE_MET["Node Exporter<br/>(host metrics)"]
        end

        subgraph PROMETHEUS["Prometheus"]
            SCRAPE["Scrape targets<br/>every 15s"]
            TSDB["Time-series DB<br/>30-day retention"]
            RULES_MON["Alert rules<br/>(alerts.yml)"]
        end

        subgraph ALERTING["Alerting"]
            AM["Alertmanager"]
            EMAIL["Email<br/>(SMTP)"]
            WEBHOOK["Webhook<br/>(Slack / Teams)"]
        end

        subgraph VISUALIZATION["Visualization"]
            GRAF["Grafana Dashboards"]
            D1["SIEM Overview"]
            D2["Backend Metrics"]
            D3["AI Engine Metrics"]
            D4["Collector Metrics"]
            D5["Database Metrics"]
        end
    end

    BE_MET --> SCRAPE
    AI_MET --> SCRAPE
    PG_MET --> SCRAPE
    MDB_MET --> SCRAPE
    RD_MET --> SCRAPE
    NG_MET --> SCRAPE
    NODE_MET --> SCRAPE

    SCRAPE --> TSDB --> RULES_MON --> AM
    AM --> EMAIL
    AM --> WEBHOOK
    TSDB --> GRAF
    GRAF --> D1
    GRAF --> D2
    GRAF --> D3
    GRAF --> D4
    GRAF --> D5

    style PROMETHEUS fill:#e6522c,color:#fff
    style VISUALIZATION fill:#f39c12,color:#fff
```

### 5.2 Prometheus Scrape Configuration

> **Note:** Infrastructure exporters (`postgres-exporter`, `mongodb-exporter`, `redis-exporter`, `nginx-exporter`, `node-exporter`) are assumed to be deployed via a separate infrastructure monitoring stack or native agents, and are therefore not included in the core `docker-compose.prod.yml`.

```yaml
# deploy/prometheus/prometheus.yml

global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - "alerts.yml"

alerting:
  alertmanagers:
    - static_configs:
        - targets: ["alertmanager:9093"]

scrape_configs:
  - job_name: "backend"
    static_configs:
      - targets: ["backend:3000"]
    metrics_path: "/api/v1/metrics/prometheus"

  - job_name: "ai-engine"
    static_configs:
      - targets: ["ai-engine:8000"]
    metrics_path: "/api/v1/metrics/prometheus"

  - job_name: "postgres"
    static_configs:
      - targets: ["postgres-exporter:9187"]

  - job_name: "mongodb"
    static_configs:
      - targets: ["mongodb-exporter:9216"]

  - job_name: "redis"
    static_configs:
      - targets: ["redis-exporter:9121"]

  - job_name: "nginx"
    static_configs:
      - targets: ["nginx-exporter:9113"]

  - job_name: "node"
    static_configs:
      - targets: ["node-exporter:9100"]
```

### 5.3 Application Metrics (Backend)

| Metric | Type | Description |
|---|---|---|
| `siem_http_requests_total` | Counter | Total HTTP requests by method, path, status |
| `siem_http_request_duration_seconds` | Histogram | Request latency by endpoint |
| `siem_events_ingested_total` | Counter | Total events ingested |
| `siem_events_per_second` | Gauge | Current EPS |
| `siem_queue_depth` | Gauge | BullMQ waiting jobs |
| `siem_queue_active` | Gauge | BullMQ active jobs |
| `siem_queue_failed_total` | Counter | Total failed jobs |
| `siem_pipeline_duration_seconds` | Histogram | Pipeline processing time per batch |
| `siem_incidents_created_total` | Counter | Incidents created by severity |
| `siem_alerts_generated_total` | Counter | Alerts by type (rule/ai) |
| `siem_rule_evaluations_total` | Counter | Rule evaluations |
| `siem_rule_matches_total` | Counter | Rule matches |
| `siem_ai_requests_total` | Counter | Requests to AI Engine |
| `siem_ai_request_duration_seconds` | Histogram | AI Engine latency |
| `siem_ai_circuit_state` | Gauge | Circuit breaker state (0=closed, 1=open, 2=half-open) |
| `siem_websocket_connections` | Gauge | Active WebSocket connections |
| `siem_auth_logins_total` | Counter | Login attempts by result (success/fail) |

### 5.4 Application Metrics (AI Engine)

| Metric | Type | Description |
|---|---|---|
| `ai_predictions_total` | Counter | Total prediction requests |
| `ai_anomalies_detected_total` | Counter | Events flagged as anomalous |
| `ai_inference_duration_seconds` | Histogram | Model inference latency |
| `ai_shap_duration_seconds` | Histogram | SHAP explanation latency |
| `ai_batch_size` | Histogram | Events per inference request |
| `ai_model_version` | Info | Current model version |
| `ai_preprocessing_errors_total` | Counter | Feature preprocessing failures |

### 5.5 Alert Rules

```yaml
# deploy/prometheus/alerts.yml

groups:
  - name: siem_critical
    rules:
      - alert: HighQueueDepth
        expr: siem_queue_depth > 5000
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Processing queue backlog is {{ $value }} jobs"

      - alert: AIEngineDown
        expr: up{job="ai-engine"} == 0
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "AI Engine is unreachable"

      - alert: AICircuitOpen
        expr: siem_ai_circuit_state == 1
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "AI Engine circuit breaker is OPEN"

      - alert: HighErrorRate
        expr: rate(siem_http_requests_total{status=~"5.."}[5m]) / rate(siem_http_requests_total[5m]) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Backend error rate is {{ $value | humanizePercentage }}"

      - alert: HighLatency
        expr: histogram_quantile(0.99, rate(siem_http_request_duration_seconds_bucket[5m])) > 5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "P99 latency is {{ $value }}s"

      - alert: PostgreSQLDown
        expr: up{job="postgres"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "PostgreSQL is unreachable"

      - alert: MongoDBDown
        expr: up{job="mongodb"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "MongoDB is unreachable"

      - alert: RedisDown
        expr: up{job="redis"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Redis is unreachable"

      - alert: CollectorOffline
        expr: time() - siem_collector_last_heartbeat_seconds > 120
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "Collector {{ $labels.collector_id }} is offline"

      - alert: DiskSpaceLow
        expr: node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"} < 0.15
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Disk space below 15% on {{ $labels.instance }}"

      - alert: HighMemoryUsage
        expr: node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes < 0.10
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Available memory below 10% on {{ $labels.instance }}"
```

### 5.6 Grafana Dashboards

| Dashboard | Panels | Key Metrics |
|---|---|---|
| **SIEM Overview** | EPS gauge, queue depth gauge, incident count, collector status, AI status | Top-level operational health |
| **Backend Metrics** | Request rate, latency histogram, error rate, active connections, WebSocket count | Application performance |
| **AI Engine Metrics** | Inference latency, anomaly rate, batch size, SHAP duration, model version | ML pipeline health |
| **Collector Metrics** | Per-collector EPS, heartbeat age, files processed, error rate | Collection health |
| **Database Metrics** | PostgreSQL: connections, query rate, cache hit ratio, replication lag. MongoDB: operations, WiredTiger cache, connections. Redis: memory, hit rate, connected clients | Storage health |

### 5.7 Health Check Endpoints

| Service | Endpoint | Checks |
|---|---|---|
| Backend | `GET /api/v1/health` | PostgreSQL connected, MongoDB connected, Redis connected, queue running |
| AI Engine | `GET /api/v1/health` | Model loaded, inference functional |
| Frontend | `GET /` | Page renders (HTTP 200) |
| PostgreSQL | `pg_isready` | Accepting connections |
| MongoDB | `db.adminCommand('ping')` | Responsive |
| Redis | `redis-cli ping` | Responsive |

**Backend Health Response:**

```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 86423,
  "checks": {
    "postgres": { "status": "connected", "latencyMs": 2 },
    "mongodb": { "status": "connected", "latencyMs": 3 },
    "redis": { "status": "connected", "latencyMs": 1 },
    "queue": { "status": "running", "waiting": 45, "active": 4 },
    "aiEngine": { "status": "online", "modelVersion": "v20260718_120000" }
  }
}
```

---

## 6. Logging

### 6.1 Logging Architecture

```mermaid
graph TB
    subgraph LOG_ARCH["Logging Architecture"]

        subgraph APP_LOGS["Application Logs"]
            BE_LOG["Backend<br/>(Winston)"]
            AI_LOG["AI Engine<br/>(Python logging)"]
            FE_LOG["Frontend<br/>(next/logger)"]
            COL_LOG["Collector<br/>(spdlog)"]
        end

        subgraph FORMAT["Log Format"]
            JSON_F["JSON<br/>(production)"]
            PRETTY_F["Pretty-print<br/>(development)"]
        end

        subgraph OUTPUTS["Log Outputs"]
            STDOUT["stdout/stderr<br/>(Docker captures)"]
            FILE_OUT["Log files<br/>(optional, rotated)"]
            DOCKER_LOG["Docker log driver<br/>(json-file)"]
        end

        subgraph STORAGE_LOG["Log Storage"]
            LOCAL_LOG["Local files<br/>(30-day retention)"]
            ELK_FUTURE["ELK Stack<br/>(future: post-MVP)"]
        end
    end

    BE_LOG --> JSON_F --> STDOUT --> DOCKER_LOG --> LOCAL_LOG
    AI_LOG --> JSON_F
    COL_LOG --> JSON_F
    BE_LOG --> PRETTY_F

    style APP_LOGS fill:#3498db,color:#fff
```

### 6.2 Log Levels

| Level | Usage | Environment |
|---|---|---|
| `error` | Unrecoverable errors, exceptions, failed operations | All |
| `warn` | Degraded conditions, circuit breaker state changes, rate limits hit | All |
| `info` | Normal operations: startup, shutdown, batch processed, incident created | All |
| `http` | HTTP request/response (method, path, status, duration) | All (production: only slow/error) |
| `debug` | Detailed flow: rule evaluation results, feature values, cache hits | Development only |
| `trace` | Very verbose: full event payloads, full SHAP values | Development only |

### 6.3 Log Format — JSON (Production)

```json
{
  "timestamp": "2026-07-19T10:15:30.123Z",
  "level": "info",
  "service": "backend",
  "module": "pipeline.worker",
  "message": "Batch processed successfully",
  "data": {
    "batchId": "batch_20260719_101530",
    "eventCount": 100,
    "durationMs": 145,
    "ruleAlerts": 3,
    "aiAlerts": 1,
    "incidentsCreated": 1,
    "incidentsUpdated": 1
  },
  "traceId": "abc-123-def-456",
  "requestId": "req-789"
}
```

### 6.4 Winston Logger Configuration (Backend)

```typescript
// backend/src/shared/logger.ts

import winston from "winston";
import { config } from "../config";

const logger = winston.createLogger({
  level: config.log.level,
  defaultMeta: { service: "backend" },

  format: config.log.format === "json"
    ? winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      )
    : winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: "HH:mm:ss" }),
        winston.format.printf(({ timestamp, level, message, module, ...meta }) =>
          `${timestamp} [${level}] ${module || ""}: ${message} ${
            Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ""
          }`
        )
      ),

  transports: [
    new winston.transports.Console(),
  ],
});

// Add file transport in production
if (config.nodeEnv === "production") {
  logger.add(new winston.transports.File({
    filename: "/var/log/siem/backend-error.log",
    level: "error",
    maxsize: 50 * 1024 * 1024,  // 50 MB
    maxFiles: 10,
    tailable: true,
  }));

  logger.add(new winston.transports.File({
    filename: "/var/log/siem/backend-combined.log",
    maxsize: 100 * 1024 * 1024,  // 100 MB
    maxFiles: 10,
    tailable: true,
  }));
}

export { logger };
```

### 6.5 HTTP Request Logging

```typescript
// middleware/requestLogger.ts

import { logger } from "../shared/logger";

function requestLogger(req, res, next) {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const logData = {
      module: "http",
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: duration,
      ip: req.ip,
      userId: req.user?.id || "anonymous",
      userAgent: req.get("user-agent"),
      requestId: req.id,
    };

    if (res.statusCode >= 500) {
      logger.error("HTTP request failed", logData);
    } else if (res.statusCode >= 400) {
      logger.warn("HTTP client error", logData);
    } else if (duration > 1000) {
      logger.warn("Slow HTTP request", logData);
    } else {
      logger.http("HTTP request", logData);
    }
  });

  next();
}
```

### 6.6 Sensitive Data Filtering

Logs must **never** contain sensitive data:

| Data Type | Filtering Method |
|---|---|
| Passwords | Never logged. `password` field stripped from request body before logging |
| JWT tokens | Truncated to first 10 chars: `eyJhbGciOi...` |
| Database URLs | Connection string passwords masked: `postgresql://user:****@host/db` |
| HMAC secrets | Never logged |
| Event payloads (debug only) | Full payloads only at `debug` level, never at `info` or above |
| User PII | Logged by user ID only, never email or full name in request logs |

```typescript
// Sensitive field filter
const SENSITIVE_FIELDS = ["password", "token", "secret", "authorization", "cookie"];

function sanitizeLogData(data: Record<string, any>): Record<string, any> {
  const sanitized = { ...data };
  for (const key of Object.keys(sanitized)) {
    if (SENSITIVE_FIELDS.some(f => key.toLowerCase().includes(f))) {
      sanitized[key] = "****";
    }
  }
  return sanitized;
}
```

### 6.7 Log Rotation and Retention

| Environment | Method | Rotation | Retention |
|---|---|---|---|
| Development | Console only | N/A | N/A |
| Production (Docker) | Docker json-file driver | 50 MB max per file | 5 files per container |
| Production (files) | Winston file transport | 100 MB per file, 10 files | 30 days |

Docker log driver configuration:

```yaml
# In docker-compose.prod.yml, per service:
logging:
  driver: "json-file"
  options:
    max-size: "50m"
    max-file: "5"
```

### 6.8 Structured Log Examples

**Startup:**
```json
{ "timestamp": "...", "level": "info", "service": "backend", "module": "main", "message": "AI-SIEM Backend starting", "data": { "version": "1.0.0", "nodeEnv": "production", "port": 3000, "workers": 4 } }
```

**Incident created:**
```json
{ "timestamp": "...", "level": "info", "service": "backend", "module": "correlator", "message": "Incident created", "data": { "incidentId": "inc-0142", "title": "SSH Brute Force on web-server-01", "severity": "high", "riskScore": 78.5, "alertCount": 12, "source": "both" } }
```

**AI circuit breaker:**
```json
{ "timestamp": "...", "level": "warn", "service": "backend", "module": "ai.circuit-breaker", "message": "Circuit breaker opened", "data": { "consecutiveFailures": 5, "cooldownMs": 60000, "lastError": "ECONNREFUSED" } }
```

**Authentication failure:**
```json
{ "timestamp": "...", "level": "warn", "service": "backend", "module": "auth", "message": "Login failed", "data": { "username": "admin", "ip": "192.168.1.50", "reason": "invalid_password", "failedAttempts": 3 } }
```

---

## Deployment Checklist

| Category | Check | Required |
|---|---|---|
| **Pre-Deploy** | | |
| | All tests pass (unit, integration, E2E) | ✅ |
| | Docker images build successfully | ✅ |
| | `.env` file populated with production secrets | ✅ |
| | SSL certificates in `deploy/nginx/ssl/` | ✅ |
| | Database migrations ready | ✅ |
| | AI model artifacts in `ai-engine/models/` | ✅ |
| **Deploy** | | |
| | `docker compose -f docker-compose.prod.yml up -d` | ✅ |
| | All containers healthy (`docker compose ps`) | ✅ |
| | Database migrations run (`make db-migrate`) | ✅ |
| | Initial admin user seeded | ✅ |
| | Default rules imported | ✅ |
| **Post-Deploy** | | |
| | Nginx serves HTTPS on :443 | ✅ |
| | Frontend loads in browser | ✅ |
| | Login works with admin credentials | ✅ |
| | Prometheus scraping all targets | ✅ |
| | Grafana dashboards populated | ✅ |
| | Collector generating heartbeats | ✅ |
| | AI Engine health check passes | ✅ |
| | Backup cron job scheduled | ✅ |

---

> **This document is governed by [ADR-001](file:///d:/AI%20SIEM/docs/architecture/decisions/ADR-001-modular-monolith.md). All four processes (Collector, Backend, AI Engine, Frontend) are containerized with Docker and orchestrated by Docker Compose. Three environment profiles (dev/test/prod) provide progressively hardened configurations. Monitoring uses Prometheus + Grafana + Alertmanager. Logging uses structured JSON via Winston/Python logging with sensitive data filtering.**
>
> **Document Version**: 1.0
> **Last Updated**: 2026-07-19
