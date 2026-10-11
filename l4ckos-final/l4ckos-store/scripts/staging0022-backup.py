"""Fixed-target read-only export. Default is dry-run; --export requires separate authorization.
No dump is stored remotely. Credentials remain inside the MySQL service.
"""
import argparse
import datetime
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import threading

PROJECT = "2bb90c8e-eb65-43ee-826b-f93750f0499c"
ENVIRONMENT = "15545eee-bc02-4b70-afc4-19a5db9e6f46"
MYSQL_SERVICE = "bcda5d78-4a0d-4682-8659-8316847addb7"
RAILWAY = "/home/yan/.railway/bin/railway"


def command(server_uuid, deployment):
    for value in (server_uuid, deployment):
        if not re.fullmatch(r"[a-f0-9-]{36}", value):
            raise ValueError("IDENTITY_REQUIRED")
    # sh receives only validated UUIDs and fixed IDs. No password in arguments.
    shell = f'''set -eu
test "$RAILWAY_PROJECT_ID" = "{PROJECT}"
test "$RAILWAY_ENVIRONMENT_ID" = "{ENVIRONMENT}"
test "$RAILWAY_SERVICE_ID" = "{MYSQL_SERVICE}"
test "$RAILWAY_DEPLOYMENT_ID" = "{deployment}"
command -v mysql >/dev/null
command -v mysqldump >/dev/null
case "$(mysqldump --version)" in *8.4.*) ;; *) exit 1 ;; esac
export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
identity="$(mysql --protocol=SOCKET --user=root --database=l4ckos_staging --batch --skip-column-names --execute="SELECT CONCAT(DATABASE(),'|',@@server_uuid,'|',SUBSTRING_INDEX(VERSION(),'.',2))")"
test "$identity" = "l4ckos_staging|{server_uuid}|8.4"
privileges="$(mysql --protocol=SOCKET --user=root --database=l4ckos_staging --batch --skip-column-names --execute="SELECT CONCAT(Select_priv,Show_view_priv,Trigger_priv,Event_priv) FROM mysql.user WHERE CONCAT(User,'@',Host)=CURRENT_USER()")"
test "$privileges" = "YYYY"
routine="$(mysql --protocol=SOCKET --user=root --database=l4ckos_staging --batch --skip-column-names --execute="SELECT COUNT(*) FROM mysql.global_grants WHERE CONCAT(User,'@',Host)=CURRENT_USER() AND Priv='SHOW_ROUTINE'")"
test "$routine" = "1"
tables="$(mysql --protocol=SOCKET --user=root --database=l4ckos_staging --batch --skip-column-names --execute="SELECT CONCAT(COUNT(*),'|',SUM(ENGINE='InnoDB' AND TABLE_TYPE='BASE TABLE')) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()")"
test "$tables" = "30|30"
pending="$(mysql --protocol=SOCKET --user=root --database=l4ckos_staging --batch --skip-column-names --execute="SELECT COUNT(*) FROM _l4ckos_schema_executions WHERE state<>'COMPLETED'")"
test "$pending" = "0"
applied="$(mysql --protocol=SOCKET --user=root --database=l4ckos_staging --batch --skip-column-names --execute="SELECT COUNT(*) FROM _l4ckos_schema_migrations WHERE name='0022_preorder_manufacturing_schedule'")"
test "$applied" = "0"
exec mysqldump --protocol=SOCKET --user=root --single-transaction --quick --skip-lock-tables --routines --events --triggers --hex-blob --set-gtid-purged=OFF --no-tablespaces --skip-add-locks --skip-disable-keys --order-by-primary --complete-insert --skip-extended-insert --tz-utc --default-character-set=utf8mb4 --skip-comments --column-statistics=0 l4ckos_staging
'''
    return [RAILWAY, "ssh", "--project", PROJECT, "--environment", ENVIRONMENT,
            "--service", MYSQL_SERVICE, "--", "sh", "-c", shell]


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", required=True)
    parser.add_argument("--server-uuid", required=True)
    parser.add_argument("--mysql-deployment", required=True)
    parser.add_argument("--estimated-bytes", type=int, required=True)
    parser.add_argument("--export", action="store_true")
    args = parser.parse_args()
    repo = Path(subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip()).resolve()
    branch = subprocess.check_output(["git", "branch", "--show-current"], text=True).strip()
    directory = Path(args.directory).resolve()
    if branch != "feat/preorder-batch" or directory == repo or repo in directory.parents or not directory.is_dir() or directory.stat().st_mode & 0o077 or args.estimated_bytes <= 0:
        raise ValueError("PRIVATE_DIRECTORY_OR_BRANCH_REQUIRED")
    needed = max(256 * 1024 * 1024, args.estimated_bytes * 20)
    if shutil.disk_usage(directory).free < needed:
        raise ValueError("BACKUP_SPACE_REQUIRED")
    argv = command(args.server_uuid, args.mysql_deployment)
    if not args.export:
        print(json.dumps({"mode": "DRY_RUN", "remoteExecuted": False, "project": PROJECT,
                          "environment": ENVIRONMENT, "service": MYSQL_SERVICE, "minimumFreeBytes": needed}))
        return
    created = datetime.datetime.now(datetime.timezone.utc).isoformat()
    partial = directory / "backup.sql.gz.partial"
    final = directory / "backup.sql.gz"
    if final.exists():
        raise ValueError("BACKUP_ALREADY_EXISTS")
    # Fresh private cwd prevents an inherited provider link. No implicit env config.
    with open(directory / "export.stderr.private", "xb") as errors, open(partial, "xb") as raw:
        child = subprocess.Popen(argv, cwd=directory, stdout=subprocess.PIPE, stderr=errors)
        deadline = threading.Timer(120, child.terminate)
        deadline.start()
        try:
            with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as zipped:
                for chunk in iter(lambda: child.stdout.read(65536), b""):
                    zipped.write(chunk)
            if child.wait(timeout=120) != 0:
                raise ValueError("BACKUP_EXPORT_FAILED_PARTIAL_PRESERVED")
        finally:
            deadline.cancel()
            if child.poll() is None:
                child.terminate()
    # Read to EOF to verify gzip CRC/trailer, without printing or writing SQL.
    uncompressed = 0
    with gzip.open(partial, "rb") as content:
        for chunk in iter(lambda: content.read(65536), b""):
            uncompressed += len(chunk)
    if uncompressed == 0:
        raise ValueError("EMPTY_EXPORT")
    partial.rename(final)
    checksum = hashlib.sha256(final.read_bytes()).hexdigest()
    result = {"version": 1, "createdAt": created, "completedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "artifactSha256": checksum, "bytes": final.stat().st_size, "uncompressedBytes": uncompressed,
              "database": "l4ckos_staging", "serverUuid": args.server_uuid, "mysqlDeployment": args.mysql_deployment}
    with open(directory / "export.json", "x") as manifest:
        json.dump(result, manifest)
    with open(directory / "SHA256SUMS", "x") as sums:
        sums.write(checksum + "  backup.sql.gz\n")
    print(json.dumps({"status": "EXPORTED_NOT_YET_RESTORE_VERIFIED", "bytes": result["bytes"], "sha256": checksum}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Never relay raw subprocess stderr, environment or connection strings.
        print(json.dumps({"status": "STOPPED", "code": "BACKUP_PREPARATION_OR_EXPORT_FAILED"}), file=sys.stderr)
        sys.exit(1)
