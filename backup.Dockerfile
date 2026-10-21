FROM postgres:16-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    age \
    rclone \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

ENV TZ=Asia/Kolkata

WORKDIR /scripts

COPY scripts/backup.sh /scripts/backup.sh
COPY scripts/prune-backups.sh /scripts/prune-backups.sh
COPY scripts/restore.sh /scripts/restore.sh

RUN chmod +x /scripts/*.sh

ENTRYPOINT ["/scripts/backup.sh"]
