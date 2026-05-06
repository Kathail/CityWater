# Runbooks

Operational procedures for FlowOps in production. Each runbook is named for
the moment you'll reach for it.

---

## Daily backup

**Schedule:** every day at 02:30 UTC. Retention: 30 daily snapshots.

**Mechanism:** `infra/backup.sh` runs `pg_dump --format=custom --compress=6`
against the production database, encrypts the dump with `age` (recipient key
in `BACKUP_AGE_RECIPIENT`), and uploads to the configured S3 bucket
(`BACKUP_BUCKET`) under the key `daily/YYYY-MM-DD.dump.age`. After upload it
purges objects older than 30 days under that prefix.

**Required env (server side):**
- `DATABASE_URL` — same as the running app
- `BACKUP_BUCKET` — S3 bucket name (B2 or R2 work via the env-driven
  endpoint; `BACKUP_S3_ENDPOINT` is optional)
- `BACKUP_S3_REGION` — defaults to `auto`
- `BACKUP_AGE_RECIPIENT` — public age key; matched private key lives only
  on the operator's laptop or in a sealed-secret vault
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` — bucket credentials

**Verifying a snapshot ran:**
```sh
aws s3 ls s3://$BACKUP_BUCKET/daily/ --endpoint-url $BACKUP_S3_ENDPOINT \
  | tail -3
```
You should see today's date. If not, check the systemd timer logs
(`journalctl -u flowops-backup.service --since today`) for the most recent
exit code; non-zero means the dump or upload failed.

**Drift alarm:** the production deployment also writes a heartbeat to
`s3://$BACKUP_BUCKET/last-success.txt` after each successful run. The
external uptime monitor pages on-call when that timestamp is older than
36 hours.

---

## Restore from backup

Use this when the primary database is corrupted, deleted, or you need a
non-destructive verification of the last snapshot.

```sh
# 1. Pick a snapshot.
aws s3 ls s3://$BACKUP_BUCKET/daily/ --endpoint-url $BACKUP_S3_ENDPOINT
SNAP=2026-05-05.dump.age

# 2. Pull + decrypt.
aws s3 cp s3://$BACKUP_BUCKET/daily/$SNAP /tmp/$SNAP \
  --endpoint-url $BACKUP_S3_ENDPOINT
age --decrypt -i /path/to/your-private-key.txt /tmp/$SNAP > /tmp/restore.dump

# 3. Restore into a *new* database, never overwrite the live one.
createdb flowops_restore
pg_restore --no-owner --dbname=flowops_restore --jobs=4 /tmp/restore.dump

# 4. Sanity check.
psql flowops_restore -c "SELECT count(*) FROM tenant;"
psql flowops_restore -c "SELECT max(created_at) FROM audit_log;"

# 5. Promote (only if the live DB is genuinely lost):
#    a. Stop the app: `systemctl stop flowops-backend`
#    b. Rename databases: live → corrupt, restore → live
#    c. Start the app, verify /healthz
```

**Tested restore frequency:** quarterly. The runbook is exercised end-to-end
into a scratch database during the same maintenance window as the SSL cert
rotation, and the restore-time elapsed is recorded in
`docs/incident-log.md` (private repo).

---

## Rotate the database password

```sh
# 1. Pick a new password and rotate it on the Postgres side.
psql -h $PG_HOST -U postgres -c "ALTER USER flowops WITH PASSWORD '<new>';"

# 2. Update the deploy secret (Railway / your platform of choice).
# 3. Trigger a rolling restart so workers pick up the new DATABASE_URL.
# 4. Verify by tailing the app logs for "request" events on /healthz.
```

There is intentionally no zero-downtime path here for v1 — passwords rotate
during a planned maintenance window. v2 introduces dual-key support via
pgbouncer.

---

## Audit log retention cleanup

Enforce the 7-year retention policy from SPEC §8.

```sh
# As an admin user on the tenant being cleaned up:
curl -X POST \
  -b cookies.txt \
  -H "X-CSRFToken: $(awk '/XSRF-TOKEN/{print $7}' cookies.txt)" \
  "https://flowops.example.com/api/v1/admin/audit-log/cleanup?older_than_days=2555"
```

The endpoint refuses windows shorter than 30 days. The deletion itself is
recorded as an `audit_retention_cleanup` event (entity_type=AuditLog,
entity_id="*"), so the *fact* that a cleanup ran remains discoverable even
after the records it deleted are gone.

In production this fires on the first of each month via a Railway scheduled
job invoking the same endpoint.

---

## Rate limit tripped a legitimate user

Default policy from SPEC §8 NFRs:

| Endpoint                       | Limit            |
|--------------------------------|------------------|
| `POST /api/v1/auth/login`      | 10 per minute    |
| `POST /api/v1/auth/register-tenant` | 5 per minute |
| `POST /api/v1/invitations/accept`   | 20 per minute |

When a user reports a 429 they didn't deserve:

1. Confirm the timestamp in their report. The `X-Request-ID` they paste
   should appear in the structured logs.
2. If it's a NAT'd office hitting the limit collectively, raise the
   ceiling for that endpoint by setting
   `RATE_LIMIT_LOGIN="30 per minute"` (or similar) and rolling restart.
3. If the limiter storage is Redis (`REDIS_URL` set), you can purge a
   specific IP's counter with
   `redis-cli DEL "LIMITER/login/<their-ip>"`.

If the same user is hitting the limit repeatedly, it's almost always a
client-side retry loop — check the frontend network panel before raising
the limit.

---

## Email driver flip (stdout → Resend)

v1 ships with `EMAIL_PROVIDER=stdout`, which logs the invitation accept URL
instead of sending email. To turn on real email delivery:

```sh
# 1. Provision a Resend project, create an API key.
# 2. Set on the deploy:
RESEND_API_KEY="rs_xxx"
EMAIL_PROVIDER="resend"
EMAIL_FROM="FlowOps <noreply@your-domain.com>"

# 3. Restart. From the next invitation create, the recipient should receive
#    mail and the server log should contain a single "email[resend]" line
#    per send.
```

Outage on Resend's side falls back to logged URLs only when manually
configured — the live driver does NOT silently fall back, because that
would mask deliverability failures. Check `app.services.email` ERROR-level
logs after a Resend incident.

---

## On-call quick reference

- `/healthz` — liveness; should be 200 within 50ms
- `X-Request-ID` header — quote in any incident report
- Structured logs include `request_id`, `method`, `path`, `status`,
  `remote`, plus the originating tenant/user when authenticated
- Audit log: `SELECT * FROM audit_log WHERE entity_id = $1 ORDER BY occurred_at DESC LIMIT 50;`
