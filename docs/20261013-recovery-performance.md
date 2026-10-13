# Local recovery, data protection and performance

Restored frontend and current backend modules into this workspace. Release source is maintained in separate frontend and backend GitHub repositories. The October 13 release reconciles recent production changes with current GitHub main, preserving employee exit history and verified reporting.

Deployment guard: scripts/verify-release-features.mjs, invoked by frontend prebuild, checks MBM/TKT, portal checks, sources, unqualified jobs and URL collection controls.

Production job data remains in shared hbuilds/config/job-monitoring.sqlite. SQLite online backup passed integrity_check. Startup and hourly in-process backup scheduler deployed, retains 30 days, skips duplicate backups within 50 minutes. Backups stop if all backend workers are stopped; these are same-host backups, not disaster recovery guarantees.

Performance findings: public page/health TTFB approximately 0.35–0.38 seconds. Original work-track JS was 1,422,445 bytes; job/portal/HR screens now dynamically imported, main bundle approximately 1.2 MB. Background job refresh skips active requests and serializes updates. Deployed faster-job-workspace-20261013, rollback target saved in logs/pre-faster-jobs-20261013.txt.

AI direct records previously omitted job-monitoring data. Added Data Entry answer source with company and department access checks, including the existing shared collection mapping. Current totals are explicitly labeled and never presented as daily output or KPI. MySQL collation problem avoided by department-name filtering after a company-scoped employee read.

Cross-company AI scope correction: Super Admin operational context now reads all authorized companies, matching existing employee directory permissions. Verified 23 active employees including six active Medbiomate HF codes. Data Entry directory includes HF001–HF007 and labels HF001 TERMINATED, without enabling its disabled login. Non-Super Admin scopes remain constrained.
