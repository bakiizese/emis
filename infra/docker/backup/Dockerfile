# The backup tool: nightly encrypted database dumps, copied off the server, with a restore that is tested
# every time. Built on the same PostgreSQL version as the database so pg_dump and the server always match.
FROM postgres:18-alpine

# age: encryption to a public key, so the server can make backups but never read them back.
# rclone: copies to almost any offsite storage (S3-compatible, SFTP, Backblaze, Google Drive, ...).
RUN apk add --no-cache age rclone bash tzdata \
    && mkdir -p /backups/status /scratch \
    && chown -R postgres:postgres /backups /scratch \
    # gosu only serves the database server's own start-up script, which this image never runs.
    && rm -f /usr/local/bin/gosu

COPY --chmod=0755 lib.sh backup.sh offsite.sh restore.sh health.sh entrypoint.sh /usr/local/lib/emis/

USER postgres
WORKDIR /backups
ENTRYPOINT ["/usr/local/lib/emis/entrypoint.sh"]
CMD ["backup-loop"]
HEALTHCHECK --interval=5m --timeout=30s --start-period=10m --retries=1 \
  CMD ["/usr/local/lib/emis/health.sh"]
