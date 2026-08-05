#!/bin/sh
# =============================================================================
# Pgpool-II failover command for the user service Postgres tripod
# =============================================================================
# Runs INSIDE the pool container (as the postgres user) when a backend node
# fails. Pgpool-II passes 4 arguments (see pgpool.conf failover_command):
#   $1 = %d  id of the failed node
#   $2 = %h  hostname of the failed node
#   $3 = %H  hostname of the new "main" node chosen by Pgpool-II
#   $4 = %P  id of the OLD PRIMARY node
#
# Only a primary failure needs a promotion. When a standby fails, the failed
# node id differs from the old primary id, so we do nothing.
#
# Promotion picks the standby with the most recent WAL (largest
# pg_last_wal_receive_lsn) and promotes it with pg_promote(). It connects to
# backends directly — never through the pool — as the postgres superuser,
# using $POSTGRES_PASSWORD from the container environment.
# =============================================================================

set -u

failed_node_id=$1
failed_host=$2
main_host=$3
old_primary_id=$4

backends="user-postgres-primary user-postgres-replica-1 user-postgres-replica-2"

if [ "$failed_node_id" != "$old_primary_id" ]; then
    echo "failover.sh: standby node $failed_node_id ($failed_host) failed; nothing to promote"
    exit 0
fi

echo "failover.sh: primary $failed_node_id ($failed_host) failed; choosing a new primary"

promote() {
    echo "failover.sh: promoting $1"
    PGPASSWORD="$POSTGRES_PASSWORD" psql -w -h "$1" -U postgres -d postgres \
        -v ON_ERROR_STOP=1 -tAc "SELECT pg_promote(true, 300)"
}

# Prefer the standby with the most recent WAL.
best_host=""
best_lsn="0/0"
for host in $backends; do
    [ "$host" = "$failed_host" ] && continue
    lsn=$(PGPASSWORD="$POSTGRES_PASSWORD" psql -w -h "$host" -U postgres -d postgres \
        -tAc "SELECT pg_last_wal_receive_lsn()" 2>/dev/null) || continue
    [ -z "$lsn" ] && continue
    newer=$(PGPASSWORD="$POSTGRES_PASSWORD" psql -w -h "$host" -U postgres -d postgres \
        -tAc "SELECT pg_wal_lsn_diff('$lsn'::pg_lsn, '$best_lsn'::pg_lsn) > 0" 2>/dev/null) || continue
    if [ "$newer" = "t" ]; then
        best_host=$host
        best_lsn=$lsn
    fi
done

if [ -n "$best_host" ]; then
    promote "$best_host"
    exit $?
fi

# No reachable standby; fall back to the "main" node Pgpool-II picked.
if [ -n "$main_host" ] && [ "$main_host" != "$failed_host" ]; then
    promote "$main_host"
    exit $?
fi

echo "failover.sh: no candidate to promote; leaving failover to manual intervention"
exit 1
