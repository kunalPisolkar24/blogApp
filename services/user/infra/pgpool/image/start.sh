#!/bin/bash
# Vendored verbatim from github.com/pgpool/pgpool2_on_k8s (the build source of
# the official pgpool/pgpool Docker image). Do not edit locally; re-vendor on
# upstream changes instead.

# Start Pgpool-II
echo "Starting Pgpool-II..."
${PGPOOL_INSTALL_DIR}/bin/pgpool -n \
    -f ${PGPOOL_INSTALL_DIR}/etc/pgpool.conf \
    -F ${PGPOOL_INSTALL_DIR}/etc/pcp.conf \
    -a ${PGPOOL_INSTALL_DIR}/etc/pool_hba.conf \
    -k ${PGPOOL_INSTALL_DIR}/etc/.pgpoolkey
