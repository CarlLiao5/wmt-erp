#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

pnpm test
pnpm typecheck
pnpm lint
pnpm --filter @walmart-erp/testkit test:readonly-contract
pnpm audit --prod
pnpm --filter @walmart-erp/db exec drizzle-kit check
docker compose config --quiet
curl --fail --silent --show-error --max-time 5 http://localhost:3000/api/health >/dev/null
git diff --check
printf 'Task 13 code release gate passed.\n'
