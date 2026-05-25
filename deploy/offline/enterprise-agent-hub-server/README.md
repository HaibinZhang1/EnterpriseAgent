# Enterprise Agent Hub offline server deployment

This directory is a first-pass offline deployment skeleton for the M8 ops/deploy gate. It provides Docker Compose, configuration examples, operational scripts, backup/restore wrappers, and dry-run/static validation paths. It intentionally does **not** include fake image tar files; real air-gapped image export/import remains deferred until release images are produced.

## Layout

- `docker-compose.yml` — PostgreSQL plus Enterprise Agent Hub server runtime.
- `config/.env.example` — Compose variables and secrets template. Copy to `config/.env` before install.
- `config/server.env.example` — server environment template. Copy to `config/server.env` before install.
- `images/README.md` — expected location for real exported Docker image tar files.
- `scripts/load-images.sh` — loads real `images/*.tar` files; fails when none exist.
- `scripts/install.sh` — validates config, optionally loads images, and runs Compose.
- `scripts/backup.sh` / `scripts/restore.sh` — wrappers around repository-level backup/restore scripts.
- `scripts/healthcheck.sh` — local HTTP health check helper.
- `backups/` — default backup destination for the offline bundle.
- `manifests/` — reserved for release/package manifest files supplied by the release process.

## Dry-run validation

```sh
bash -n scripts/*.sh
scripts/install.sh --dry-run --skip-load-images
scripts/load-images.sh --dry-run   # expected to fail until real image tar files are supplied
scripts/backup.sh --dry-run
```

`restore.sh` dry-run requires an existing backup directory because it validates `manifest/SHA256SUMS` before any restore action:

```sh
scripts/restore.sh --dry-run --backup-dir backups/enterprise-agent-hub-YYYYMMDDTHHMMSSZ
```

## Backup behavior

The root `scripts/backup.sh` creates a timestamped backup containing PostgreSQL, storage, config, client update packages, package/install manifests, plugin packages, and an optional audit/settings/device/update CSV export (`INCLUDE_AUDIT_EXPORT`). It writes `manifest/SHA256SUMS` and prunes old backups using retention default `7`.

## Restore behavior

The root `scripts/restore.sh` validates `manifest/SHA256SUMS`, requires explicit `RESTORE` confirmation unless `--force` or `--dry-run` is used, restores PostgreSQL/storage/config, and runs Flyway/health/package existence checks where configured or available.

## Deferred release gates

- Real Docker image tar export/import and air-gapped smoke testing.
- Web Admin UI image inclusion.
- Production-like restore rehearsal against a disposable environment with real application data.
