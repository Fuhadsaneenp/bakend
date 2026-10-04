# Existing STEMS MCP audit and upgrade

The original four tools are preserved. The upgrade adds employee-ID lookup, date-aware 360 reporting, source-specific tools, department/company summaries, metric rankings, comparisons, and query plans. OAuth and backend permission checks remain in place. No UI rewrite or parallel database was created.

## Corrected failures

- OAuth form origin: permit the server origin and retain same-origin referrer policy so browser form POSTs do not send a null origin.
- Passenger routing: call the reachable HTTPS API instead of an unavailable localhost port.
- Shared data-entry sheets: explicit employee ID or dated personal-sheet suffix can identify a visible employee across company contexts. Name-only matches require matching company and a unique full name.
- Exact local date ranges replace month-only answers for daily questions. Monthly attendance endpoints are called once for each covered month.
- Date-range task reports retain old unfinished backlog and status events; pending status remains current rather than fabricated historical state.
- Measured absence, denied sources, zero attributed rows, and unavailable telemetry have separate meanings.

## Sources

Employee Master, monthly attendance, WorkCard/status history/comments/rework, persisted data-entry and WordPress activity sheets, goals, KRAs, and leave/WFH requests are queried through existing authenticated APIs. Visibility is resolved from the existing employee listing before employee-specific requests. Cross-company goals/KRAs are withheld rather than overriding the token company.

## Honest limits

The audited Prisma schema has no Project or measured WorkSession entity. Client association is not a project. Publication/edit timestamps and task status changes are evidence of activity, not exact work start/end, active, idle, or break duration. Existing task points are returned with their scope; no composite score is invented. Current-status workload cannot reconstruct a historical task assignment snapshot.

The MCP cannot guarantee a model will choose the correct tool every time. Tool descriptions, schemas and query plans guide selection. Follow-ups use explicit employee/date context supplied by the client; no shared conversation state is stored across users.

No new aggregation tables, broad cache, or production schema migration was introduced without a measured bottleneck and a valid source definition. Dynamic reads avoid stale working status. Payload detail lists are bounded while totals remain computed over returned sources. Existing API sheets/cards are still bulk sources; very large histories need paginated backend endpoints before claiming database-scale optimization.

## Validation

20 automated tests, including 100 realistic question variants exercising the planner (not 100 live model-selection evaluations), duplicate names, denied employees, India midnight/week/month boundaries, multi-month source requests, old pending work, cross-company explicit attribution, OAuth PKCE/CSRF/audience/single-use/rotation. Backend TypeScript build verified.

ChatGPT catalog refreshed and live search_employee + get_employee_360 verified for Rishana on 2026-10-04: 26 rows / 26 reported jobs; first recorded publication/edit 10:01:36 IST. Counts may change as new work arrives.

## Observability

Structured server events contain tool, execution duration, status and sanitized error. Credentials and raw HR payloads are not logged. Source-quality fields expose unavailable paths for debugging. Access to hosting logs remains through existing restricted SSH; no public debug endpoint.
