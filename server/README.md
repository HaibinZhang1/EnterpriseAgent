# Enterprise Agent Hub Server (M2 Auth/Org Foundation)

This directory contains the Spring Boot 3 / Java 21 backend through M2: the M1 foundation plus account, organization, session, password, login throttling, and role/scope permission basics.

## Implemented scope

Foundation:

- `GET /api/health`
- `ApiResponse` / `ApiError` envelope with `requestId`
- `X-Request-ID` filter with MDC logging
- stable error handling and base audit logging
- PostgreSQL Flyway migrations `V1__foundation.sql`, `V2__auth_org_foundation.sql`, and `V3__idempotency_records.sql`

M2 auth and organization APIs:

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/change-password`
- `POST /api/auth/reset-password/complete`
- `POST /api/auth/refresh` returns `refresh_not_supported` in M2
- `GET /api/admin/users`
- `POST /api/admin/users`
- `GET /api/admin/users/{id}`
- `PATCH /api/admin/users/{id}`
- `POST /api/admin/users/{id}/freeze`
- `POST /api/admin/users/{id}/unfreeze`
- `POST /api/admin/users/{id}/reset-password`
- `DELETE /api/admin/users/{id}`
- `GET /api/admin/departments/tree`
- `POST /api/admin/departments`
- `GET /api/admin/departments/{id}`
- `PATCH /api/admin/departments/{id}`
- `POST /api/admin/departments/{id}/disable`
- `POST /api/admin/departments/{id}/enable`
- `DELETE /api/admin/departments/{id}`

Security notes:

- Passwords are stored with BCrypt hashes only.
- Session and reset tokens are returned once; the database stores only token hashes.
- Desktop and admin-web session TTLs are configurable separately.
- Admin-web sessions extend idle expiry on authenticated activity up to the absolute session expiry.
- Login failures are recorded and throttle/lock by phone and source IP.
- Admin organization writes require `Idempotency-Key` and replay successful duplicate requests without repeating side effects.
- `/api/admin/**` requires `DEPARTMENT_ADMIN` or `SYSTEM_ADMIN`.
- User freeze/delete, role/department changes, password changes, password resets, and department disable revoke affected sessions.
- Production does not auto-create a real administrator; the `test` profile seeds only a test root department and test admin.

Not implemented yet:

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
| `EAH_DESKTOP_SESSION_TTL` | `30d` | desktop session TTL |
| `EAH_ADMIN_SESSION_TTL` | `8h` | admin-web absolute session TTL |
| `EAH_ADMIN_IDLE_TTL` | `30m` | admin-web idle TTL |
| `EAH_LOGIN_FAILURE_WINDOW` | `15m` | login failure counting window |
| `EAH_MAX_LOGIN_FAILURES` | `5` | failures before lock/throttle |
| `EAH_LOGIN_LOCK_DURATION` | `15m` | account lock duration |
| `EAH_RESET_TOKEN_TTL` | `1h` | admin reset token TTL |

Do not commit real passwords, tokens, API keys, or production secrets.

## Test

Tests use the `test` profile and a PostgreSQL database. Create a local test database before running the full suite with local Maven:

```sh
createuser eah_test --login --pwprompt
createdb enterprise_agent_hub_test --owner=eah_test
mvn -f server/pom.xml test
```

Default test connection values are:

| Variable | Default |
|---|---|
| `EAH_TEST_DB_HOST` | `localhost` |
| `EAH_TEST_DB_PORT` | `5432` |
| `EAH_TEST_DB_NAME` | `enterprise_agent_hub_test` |
| `EAH_TEST_DB_USERNAME` | `eah_test` |
| `EAH_TEST_DB_PASSWORD` | `eah_test_password` |

If local Java/Maven is unavailable, use Docker against the compose PostgreSQL container:

```sh
docker compose up -d postgres
mkdir -p .m2-docker
docker run --rm --network enterparseagent_default \
  -v "$PWD":/workspace \
  -v "$PWD/.m2-docker":/root/.m2 \
  -w /workspace \
  -e EAH_TEST_DB_HOST=postgres \
  -e EAH_TEST_DB_PORT=5432 \
  -e EAH_TEST_DB_NAME=enterprise_agent_hub \
  -e EAH_TEST_DB_USERNAME=eah \
  -e EAH_TEST_DB_PASSWORD=change_me \
  public.ecr.aws/docker/library/maven:3.9.9-eclipse-temurin-21 \
  mvn -q -f server/pom.xml test
```

The test profile seeds:

- root department ID `00000000-0000-0000-0000-000000000001`
- test admin phone `13800000000`
- test admin password `Admin#123456`

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
