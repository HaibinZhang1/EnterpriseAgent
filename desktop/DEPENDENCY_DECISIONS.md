# M6 Desktop Dependency Decisions

Date: 2026-05-08
Scope: M6 desktop backend foundation only.

## Decisions

- Package manager: `npm`, because the repository has no existing JS package-manager standard and the local runtime already provides Node/npm.
- Electron: `electron@42.0.0`, the current npm package result checked before package creation, to satisfy the required Electron desktop shell.
- Renderer/build: `vite@8.0.11`, `react@19.2.6`, `react-dom@19.2.6`, and `typescript@6.0.3` for a minimal React + TypeScript renderer without adding unneeded UI tooling.
- Unit/integration tests: `vitest@4.1.5`, plus TypeScript type packages for Node/React/sql.js.
- SQLite: `sql.js@1.14.1`, a WASM SQLite engine, chosen over native SQLite bindings for M6 to avoid Electron native rebuild friction while still exercising a real SQLite database and migration path.
- IPC validation: no new schema library for M6; use small local validators to keep dependency scope minimal.
- Secure Store: no keychain dependency for M6; implement a `SecureStore` interface, a memory test provider, and a safeStorage-compatible file provider boundary.
- Lint: no ESLint dependency for M6; use a small repository-local lint script that verifies no TODO placeholders and no obvious forbidden renderer/preload leaks.

## Rejected alternatives

- `better-sqlite3` / `sqlite3`: rejected for M6 because native Electron rebuild and Windows binary concerns are higher risk than needed for the foundation slice.
- `keytar`: rejected for M6 because Electron `safeStorage` is an acceptable provider boundary and avoids adding another native dependency.
- `zod`: rejected for M6 because the IPC DTO set is small and local validators satisfy the testable contract with less dependency surface.
- Full ESLint stack: rejected for M6 because the repository does not yet have JS lint standards and a focused local lint script is enough for this foundation.

## Follow-up

M7 may revisit SQLite and secure storage providers if real local execution throughput or OS integration requirements exceed the M6 foundation needs.
