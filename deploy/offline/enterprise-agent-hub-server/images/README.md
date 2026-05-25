# Offline image bundle placeholder

Place real exported image tar files in this directory before running `scripts/load-images.sh`.

Expected first production bundle contents are environment-specific, for example:

- `postgres*.tar`
- `enterprise-agent-hub-server*.tar`
- optional web-admin image tar when the Web Admin UI is included in a later gate

No fake `.tar` artifacts are committed here. The real air-gapped image export/import gate remains deferred until release images are built and exported.
