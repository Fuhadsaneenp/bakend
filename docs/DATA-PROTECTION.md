# Source and data protection

Frontend and backend releases are committed separately to the stems and bakend GitHub repositories. Deploy only from the committed release source. The frontend build runs scripts/verify-release-features.mjs to check restored job integrations and URL collection controls.

Job data is stored outside release directories in hbuilds/config/job-monitoring.sqlite. Install scripts/backup-job-monitoring.sh in hbuilds/config; server.js loads an hourly backup scheduler. SQLite online backups are checked for integrity and retained for 30 days. Backups run while a backend worker is alive and remain on the same server.

Keep environment files, credentials, databases, generated builds and source backup copies out of Git. Preserve the previous release symlink target for rollback. Never rebuild from an older last-source directory without reconciling it with GitHub.
