# Enterprise Agent Hub Server (M1 Foundation)

This directory contains the M1 backend foundation only: Spring Boot 3, Java 21, PostgreSQL, Flyway, Docker Compose, unified API responses, request ID propagation, base error handling, base audit logging, and health checks.

## Scope

Implemented in M1:

- `GET /api/health`
- `ApiResponse` / `ApiError` envelope with `requestId`
- `X-Request-ID` filter with MDC logging
- stable foundation error handling (`validation_failed`, `internal_error`, etc.)
- PostgreSQL Flyway migration for `audit_logs`, `settings`, `settings_history`
- base `AuditService` with sensitive-field redaction
- tests for context, request ID, errors, health, audit writes, and migration shape

Not implemented in M1:

- login, users, sessions, departments, or permissions
- extension catalog, publishing, review, package upload/download, search, statistics
- Electron desktop client or Web admin frontend
- Redis, message queues, Elasticsearch, or microservices

## Requirements

- Java 21
- Maven 3.9+ (or run Maven through Docker)
- PostgreSQL 16 for local runtime
- Docker + Docker Compose for containerized startup

## Environment variables

See root `.env.example`.

| Variable | Default | Purpose |
|---|---|---|
| `SERVER_PORT` | `8080` | HTTP port |
| `EAH_DB_HOST` | `localhost` | PostgreSQL host |
| `EAH_DB_PORT` | `5432` | PostgreSQL port |
| `EAH_DB_NAME` | `enterprise_agent_hub` | PostgreSQL database |
| `EAH_DB_USERNAME` | `eah` | PostgreSQL user |
| `EAH_DB_PASSWORD` | `change_me` | PostgreSQL password for local/dev only |
| `EAH_REQUEST_ID_HEADER` | `X-Request-ID` | request ID header name |

Do not commit real passwords, tokens, API keys, or production secrets.

## Test

Tests use the `test` profile and a PostgreSQL database. Create a local test database before running the full suite:

```sh
createuser eah_test --login --pwprompt
createdb enterprise_agent_hub_test --owner=eah_test
```

Default test connection values are:

| Variable | Default |
|---|---|
| `EAH_TEST_DB_HOST` | `localhost` |
| `EAH_TEST_DB_PORT` | `5432` |
| `EAH_TEST_DB_NAME` | `enterprise_agent_hub_test` |
| `EAH_TEST_DB_USERNAME` | `eah_test` |
| `EAH_TEST_DB_PASSWORD` | `eah_test_password` |

Run tests with local Java 21 and Maven 3.9+:

```sh
mvn -f server/pom.xml test
```

## Package

```sh
mvn -f server/pom.xml -DskipTests package
```

The JAR is generated as:

```text
server/target/enterprise-agent-hub-server.jar
```

## Docker Compose startup

```sh
docker compose up --build
```

Then verify:

```sh
curl -fsS http://localhost:8080/api/health
curl -fsS http://localhost:8080/actuator/health
```

Stop and remove containers:

```sh
docker compose down
```

Remove the local PostgreSQL named volume only when you intentionally want to delete local data:

```sh
docker compose down -v
```
