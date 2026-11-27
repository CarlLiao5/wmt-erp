# Security operating rules

## Access and data scope

- API sessions determine `tenantId` server-side. Every read is tenant and store scoped; clients cannot choose another tenant.
- Walmart business traffic is read-only. The connector permits `GET` for business endpoints; token acquisition is the only authentication request.
- Keep production credentials in the runtime secret store. Do not commit `.env.runtime`, credentials, access tokens, cookies, or raw secret payloads.

## Secrets

Rotate `COOKIE_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`, Walmart client credentials, database credentials, and Redis credentials through the secret manager. Restart API and Worker after rotation, then verify `/api/health` and a non-mutating sync health request. Logs redact keys containing `secret`, `token`, `password`, `authorization`, `cookie`, and credential fields.

## Incident response

1. Disable the affected store credential and preserve the request ID, sync job ID, and timestamp.
2. Check `GET /api/operations/sync-health` as an administrator and inspect failed/stale resources.
3. Replay only a failed job after confirming the tenant and store; replay is local queue work and does not issue a Walmart write.
4. Rotate exposed credentials, capture an encrypted backup, and document the timeline before restoring service.
