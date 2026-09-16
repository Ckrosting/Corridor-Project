# Hull Corridor — Implementation Checklist

Living document. `[x]` = built **and** verified, `[~]` = partial, `[ ]` = not started.

**Current state:** Phases 1–4 implemented. 99 tests passing, typecheck clean,
production build succeeds. Nothing deployed, no paid service provisioned.

---

## Environment facts (verified 2026-09-14)

Re-read these before changing anything infrastructural.

| Fact | Value |
|---|---|
| Node / npm | v24.17.0 / 11.17.0 |
| Docker / Docker Desktop | **Not installed, cannot be installed** — no admin rights, no WSL |
| System PostgreSQL | Not installed |
| Windows admin rights | **No** |
| Project location | OneDrive-synced folder |

Consequences:

- Local Postgres runs from the `embedded-postgres` npm binaries (`npm run db:up`),
  **not** Docker Compose. Real PostgreSQL 17.10, same engine as Railway.
- The data directory lives at `%LOCALAPPDATA%\hull-corridor\pgdata`, deliberately
  **outside** OneDrive — sync corrupts live database files.
- No `pg_dump`/`psql` ships with the embedded package, so backup/restore is a
  portable logical dump written in TypeScript.
- npm 11 gates install scripts; `allowScripts` in `package.json` records approvals.
- **TypeScript is pinned to `^6`.** TS 7's native compiler removes the JS compiler
  API that Next.js 15 requires; installing it breaks `next.config` loading with a
  confusing error.

---

## Phase 0 — Foundation

- [x] Git repository, TypeScript, Next.js 15, React 19
- [x] Local PostgreSQL 17.10 without Docker or admin rights
- [x] Drizzle ORM + drizzle-kit migrations
- [x] Full schema: 32 tables, 14 enums
- [x] `.env.example` with no secrets; `npm run setup` one-shot bootstrap
- [x] Vitest configured
- [x] Geometry library — 25 tests

## Phase 1 — Local foundation

- [x] Typed environment config with validation and safe status reporting
- [x] Auth.js v5 credentials + bcrypt, admin/member roles
- [x] Dev sign-in shortcut, structurally absent from production builds
- [x] Server-side authorization guards (`requireUser`, `requireAdmin`)
- [x] Optimistic concurrency (version tokens) + append-only audit log
- [x] Markets and mall anchors
- [x] Properties with every specified field; unknown never stored as zero
- [x] Parcels: multiple per property, optional geometry, drawn/edited in the
      market workspace, persistent edits
- [x] Shared contacts + owner entities kept separate
- [x] Activity timeline and fast call logging
- [x] Follow-up queues (overdue / today / upcoming / unscheduled)
- [x] Leaflet map: basemaps, draw/edit, filters, fit-to-bounds, preserved viewport
- [x] Market workspace, property detail, portfolio dashboard
- [x] Properties list, contacts list/detail, follow-ups screen
- [x] Seed: default statuses/stages + clearly-labelled sample data

## Phase 2 — Pipeline, configuration, imports, collaboration

- [x] Opportunities: explicit promotion only, reason + date + author captured
- [x] Pipeline board and table; removal and reopening with full history
- [x] Configurable statuses and stages, with enforced reassignment on archive
- [x] Custom fields (text/number/date/checkbox/select), rendered and editable
- [x] Tags
- [x] Storage abstraction (local ↔ S3) + authenticated attachment upload/download
- [x] Mall import template + CSV import: mapping, preview, validation, duplicates,
      row-level errors, explicit commit
- [x] CSV exports with stable IDs for reconciliation
- [x] Users administration
- [x] Concurrent-edit protection surfaced in the UI
- [~] Property/contact **import** — validation pipeline exists and export is
      complete, but there is no dedicated import screen yet
- [ ] XLSX import (CSV only; Excel "Save As → CSV" documented in the UI)
- [x] Attachment drag-and-drop control on the property screen

## Phase 3 — Discovery

Model and tool identifiers verified against **current Anthropic documentation**
during implementation: `claude-sonnet-5` is the current Sonnet-family model, and
`web_search_20260209` the current web search tool (the basic
`web_search_20250305` variant is selected automatically for older models).

- [x] Anthropic client; key server-side only; model configurable without code change
- [x] Structured, Zod-validated extraction with field-level sources
- [x] Two-phase design: research with search, then extraction with no tools
- [x] Prompt-injection defence — retrieved content delimited and treated as data
- [x] Market-scoped (and portfolio-wide "all") search with honest coverage reporting
- [x] Background worker: claim / heartbeat / retry / backoff / cancel / concurrency /
      graceful shutdown
- [x] Scan states: queued / running / completed / partial / cancelled / failed
- [x] Deduplication (normalised URL **and** address hash) + permanent suppression
- [x] Discovery inbox: review, correct, approve, link, reject, needs-research
- [x] Proposed-change review — never a silent overwrite
- [x] Manual "add listing URL" and "upload flyer/OM" through the same pipeline
- [x] Budget ceiling enforced at queue time **and** re-checked between markets
- [x] Recorded usage with clearly-labelled cost estimates

## Phase 4 — Production readiness

- [x] Health endpoint (`/api/health`), safe for unauthenticated use
- [x] Backup and restore covering **both** rows and attachments — round trip verified
- [x] Documented local → production migration path
- [x] Railway deployment documentation + `railway.json` / `railway.worker.json`
- [x] Production build verified
- [x] Known limitations documented honestly
- [ ] Rate limiting on expensive endpoints (scans are already bounded by budget,
      concurrency ceiling and the duplicate-scan guard)
- [ ] `audit_log` retention/pruning policy

---

## Test coverage

**99 tests passing.** Detail in [TEST_RESULTS.md](TEST_RESULTS.md).

- [x] Parcel geometry validation (25 unit tests)
- [x] Parcel persistence at the database level
- [x] Multiple parcels on one property, including a parcel ID with no geometry
- [x] Call history and follow-up persistence
- [x] Call history survives outreach status changes
- [x] Explicit opportunity promotion (reason, date, author)
- [x] Routine outreach stays out of the pipeline
- [x] Opportunity removal and reopening without losing history
- [x] Unknown stays NULL; a real zero is stored as zero
- [x] Import validation, row-level errors, duplicate detection, re-import safety
- [x] CSV round trip: negative coordinates survive, formula injection escaped
- [x] Repeated scans create no duplicates (same URL **and** cross-source address)
- [x] Rejected candidates never resurface; "needs research" stays in play
- [x] Reviewed data never overwritten by AI; call notes untouched
- [x] Name similarity alone never merges two properties
- [x] Missing coordinates yield 'unknown' and stay in review
- [x] API keys remain server-side
- [x] Access control: 401 vs 403, member-by-default, dev bypass impossible in production
- [x] Concurrent-edit protection

---

## If picking this up fresh

1. `npm install && npm run setup`
2. `npm run dev` and `npm run worker` in two terminals
3. Read [ARCHITECTURE.md](ARCHITECTURE.md) for why things are shaped as they are
4. Read [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) before assuming something is
   missing by accident

Highest-value next steps, in order:

1. **Load the real mall spreadsheet** through Settings → Import & export. That
   exercises the import path with real data and populates the markets.
2. **Add an `ANTHROPIC_API_KEY`** and run one discovery scan. Expect prompt
   tuning; the budget ceiling and per-scan search limit bound the cost of
   finding out.
3. **Finish the attachment upload control** on the property screen.
4. **Deploy to Railway** following [RAILWAY_DEPLOYMENT.md](RAILWAY_DEPLOYMENT.md).
