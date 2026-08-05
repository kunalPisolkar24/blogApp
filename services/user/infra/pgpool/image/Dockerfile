# =============================================================================
# topos-pgpool — Pgpool-II built from source (PostgreSQL 18 compatible)
# =============================================================================
# The official pgpool/pgpool Docker Hub images stopped at 4.0.23 (2023), which
# predates PostgreSQL 18 support (added in Pgpool-II 4.7). We build 4.7.x from
# the official source tarball, following the recipe used by the official image
# (github.com/pgpool/pgpool2_on_k8s), and ship its entrypoint/start scripts so
# runtime behavior (pool_passwd from *_USERNAME/*_PASSWORD env vars, /config
# bind mount, pcp.conf generation) matches the official image exactly.

FROM alpine:3.22

ARG PGPOOL_VER=4.7.2

ENV PGPOOL_INSTALL_DIR=/opt/pgpool-II \
    PGPOOL_CONF_VOLUME=/config

# Postgres user (uid 70), same as the official image.
RUN addgroup -g 70 -S postgres \
 && adduser -u 70 -S -D -G postgres -H -h /var/lib/pgsql -s /bin/sh postgres \
 && mkdir -p /var/lib/pgsql \
 && chown -R postgres:postgres /var/lib/pgsql

# Build Pgpool-II from the official source tarball.
# postgresql/postgresql-dev stay at runtime: psql (failover.sh, healthchecks)
# and libpq (used by Pgpool-II) are needed while it runs.
RUN apk add --no-cache \
        bash \
        postgresql \
        postgresql-dev \
        openssl \
        sed \
 && apk add --no-cache --virtual .build-deps \
        bison \
        flex \
        gcc \
        g++ \
        linux-headers \
        make \
        openssl-dev \
        wget \
 && wget -q -O /tmp/pgpool.tar.gz \
        "https://www.pgpool.net/source/pgpool-II-${PGPOOL_VER}.tar.gz" \
 && mkdir -p /tmp/pgpool \
 && tar -zxf /tmp/pgpool.tar.gz -C /tmp/pgpool --strip-components 1 \
 && cd /tmp/pgpool \
 && ./configure --prefix="${PGPOOL_INSTALL_DIR}" --with-openssl \
 && make -j "$(nproc)" \
 && make install \
 && apk del .build-deps \
 && rm -rf /tmp/pgpool /tmp/pgpool.tar.gz \
 && mkdir -p /var/run/pgpool /var/run/postgresql \
 && chown -R postgres:postgres /var/run/pgpool /var/run/postgresql \
        "${PGPOOL_INSTALL_DIR}" \
 && "${PGPOOL_INSTALL_DIR}/bin/pgpool" -v

# Official image entrypoint/start scripts (vendored from pgpool2_on_k8s).
COPY entrypoint.sh start.sh "${PGPOOL_INSTALL_DIR}/bin/"
RUN chown postgres:postgres "${PGPOOL_INSTALL_DIR}/bin/entrypoint.sh" \
        "${PGPOOL_INSTALL_DIR}/bin/start.sh" \
 && chmod 755 "${PGPOOL_INSTALL_DIR}/bin/entrypoint.sh" \
        "${PGPOOL_INSTALL_DIR}/bin/start.sh"

USER postgres

EXPOSE 5432

ENTRYPOINT ["/opt/pgpool-II/bin/entrypoint.sh"]
CMD ["/opt/pgpool-II/bin/start.sh"]
