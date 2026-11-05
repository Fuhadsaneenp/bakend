# Extra Hours Productivity Bonus

This isolated module is for eligible **Medbiomate employees**. Their original job and employer creation records on **Medbiomate, Trikonet and Mediyox** are all supported. Existing tracker views, salary records, attendance, payroll and statutory overtime logic are unchanged. Approved amounts are a discretionary incentive ledger; they are not automatically posted to payroll or paid.

## Setup

1. Apply the additive migration `20261105093000_productivity_incentive` using the protected deployment environment and `node scripts/install-productivity-incentive.mjs`. It creates only `IncentivePolicy`, `IncentiveCredit`, and `IncentiveAudit`. Generate the Prisma client for the release.
2. Open Work Track → Data Entry → **Extra Hours Bonus**. HR Admin and Super Admin accounts with Medbiomate company access can administer the module. Medbiomate employees can see only their own amounts and activity.
3. Save an effective policy. Defaults: jobs 2 minutes, employers 7 minutes; bands 17:30–18:00 10%, 18:00–18:30 15%, 18:30–19:30 20%, 19:30–24:00 25%, Asia/Kolkata.
4. Configure the monthly-hours divisor, salary basis (basic or basic plus allowances), eligible employees/departments, approval requirement, and optional monthly budget. Eligibility defaults to nobody and the divisor defaults to unset. No salary divisor is assumed and no policy is created automatically.
5. Sync activities. Records without actual `createdAt` are excluded; sync receipt, publication, and edit timestamps are never substituted. Existing WordPress installations can use the companion sync plugin's source post creation timestamp field. The deployed Mediyox plugin 1.3.6 was checked and already supplies this field; no website plugin was downgraded or replaced. Native website integrations also support it.
6. Verify the actual work interval per activity, with an evidence note. Verification requires complete attendance punches, completion by the source creation time, and no overlap with another credited activity. Do not enter an assumed interval based only on when an upload completed.
7. Review and approve credits. If approval is disabled in an effective policy, verification is still required; automatic approval remains subject to the monthly budget. Rejections can be reopened with an audit reason.

## Calculation

Standard productivity minutes = jobs × job minutes + employers × employer minutes.

The credited standard minutes are distributed proportionally over the **verified actual work interval**, including any portion before 17:30. Only the overlap with incentive bands earns a bonus. Thus a job worked 17:25–17:35 earns one bonus-eligible credited minute from its two standard minutes. A job worked 17:50–18:10 allocates one minute at 10% and one at 15%; it does not allocate both minutes at the upload-time bracket.

Hourly rate = configured eligible monthly salary basis ÷ monthly-hours divisor, using salary history effective on the activity date. The rate and policy are frozen in the credit snapshot. A missing applicable salary or divisor leaves the estimate pending. Incentive = sum of band credited minutes ÷ 60 × hourly rate × band percentage. Round once per credit to integer paise.

Actual extra time is the recorded attendance punch span after 17:30, clipped to the local day; incomplete checkouts show unavailable. This is attendance evidence, not proof of continuous work or statutory overtime. Break duration is not inferred. No statutory overtime calculation or legal rule is implemented by these productivity credits.

## Integrity and history

- One credit per website, record type and original post ID, with a database unique key. Repeated sheet views and webhook deliveries cannot earn additional credits.
- Canonical URL aliases and identical title/employer/location duplicates within a website are conservatively excluded. Posts on separate websites have distinct source identities. An administrator should inspect duplicate exclusions rather than create another record to bypass them.
- Edits preserve original creator and creation timestamp. Changes to either identity invalidate an existing credit; edits never become a new job credit.
- Unpublished/rejected/invalid or removed sources revoke approved incentive amounts and retain the full before/after audit. This changes discretionary incentive totals only, not previously issued payroll.
- Source acknowledgements schedule a debounced reconciliation in production. Opening/refreshing the incentive view also reconciles the selected month. No source counts are accepted from the browser.
- Effective policies are immutable. More than one version can be created for the same effective date; the newest version applies to newly calculated credits. Existing snapshots remain frozen until an administrator explicitly recalculates a month with a reason. Recalculation may revoke approvals and requires a fresh review.
- Work verification and approvals carry revision checks. A per-company database row lock serializes reconciliation, verification and approval, including across multiple web workers. Monthly budget checks include every approved company credit, regardless of the dashboard employee filter.
- Audit records contain previous and replacement calculations, rates, policy snapshots, amounts, identities, reasons and actors. The UI shows the latest 100 events; the database retains the complete history.

## API

Authenticated employee reads: `GET /api/productivity-incentive/report?month=YYYY-MM&day=YYYY-MM-DD&employeeId=...` and `POST /api/productivity-incentive/sync` with `{month}`. Employees cannot read another employee's report.

HR Admin/Super Admin writes: `POST /policies`, `POST /credits/:id/verify`, `POST /credits/:id/review` (APPROVE, REJECT, REOPEN), and `/sync` with `{month,recalculate:true,reason}`. All routes are under `/api/productivity-incentive`, and company scope is resolved from the authenticated account rather than supplied financial values.

No existing business tables are altered by installation. Application rollback can retain the three new tables for recovery.
