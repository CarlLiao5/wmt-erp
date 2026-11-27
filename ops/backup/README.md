# Database backup and restore

Backups are compressed `mysqldump` files encrypted to an `age` recipient. Install `age` on the backup host. Provide `MYSQL_PASSWORD` through the environment or a secret manager. The database password is never passed as a command argument or printed. Store the matching age identity separately from the backup destination.

## Backup

```bash
export MYSQL_PASSWORD='...'
ops/backup/backup.sh --output-dir /var/backups/walmart-erp --age-recipient age1... --host 127.0.0.1 --database walmart_erp
```

The output directory is mandatory. Restrict it to the backup operator (`chmod 700`), copy completed files to encrypted access-controlled storage, and periodically test a restore.

The optional Compose runner can be started with `docker compose -f docker-compose.yml -f ops/docker/backup-compose.yml --profile backup run --rm mysql-backup`. Set `MYSQL_PASSWORD`, `BACKUP_AGE_RECIPIENT`, and `BACKUP_OUTPUT_DIR` in the invoking environment first.

## Restore

Restore is destructive and requires an explicit host, database, and `--yes`. Production-looking host/database names are rejected by the script; production recovery requires the reviewed incident procedure.

```bash
export MYSQL_PASSWORD='...'
ops/backup/restore.sh --input /var/backups/walmart-erp/walmart_erp_20261015T000000Z.sql.gz.age --identity /secure/backup-identity.txt --host 127.0.0.1 --database walmart_erp_restore --yes
```

After restore, run migrations, verify row counts and tenant isolation, then start API and Worker only after checks pass. Never restore an untrusted dump into a shared or production database.
