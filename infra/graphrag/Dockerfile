# Capy-POS shared GraphRAG store (issue #55 / #56).
# pgvector + Apache AGE in one Postgres 16 image so both pillars
# (vector similarity + graph traversal) ship from day one — no rebuild for Phase 2.
FROM pgvector/pgvector:pg16

ARG AGE_REF=PG16

# Compile Apache AGE from source against PG16, then strip the build toolchain
# to keep the runtime image lean. pgvector is already present in the base image.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        build-essential git ca-certificates flex bison \
        postgresql-server-dev-16 libreadline-dev zlib1g-dev; \
    git clone --depth 1 --branch "${AGE_REF}" https://github.com/apache/age.git /tmp/age; \
    cd /tmp/age; \
    make PG_CONFIG=/usr/bin/pg_config; \
    make PG_CONFIG=/usr/bin/pg_config install; \
    cd /; rm -rf /tmp/age; \
    apt-get purge -y --auto-remove \
        build-essential git flex bison \
        postgresql-server-dev-16 libreadline-dev zlib1g-dev; \
    rm -rf /var/lib/apt/lists/*

# Migrations are mounted at runtime (see docker-compose) and applied by hand /
# by the ingestion tooling; the image only guarantees the extensions are installable.
