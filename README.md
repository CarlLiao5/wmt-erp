# Walmart ERP

Monorepo for the Walmart ERP services. Requires Node.js 20+, pnpm 11+, and Docker Compose.

```sh
cp .env.example .env
pnpm install
docker compose up -d
pnpm test
pnpm typecheck
```

Applications live under `apps/`; shared packages live under `packages/`. The `WMT API/` directory is intentionally outside this workspace.
