# Hull Corridor — Implementation Checklist

Living document. Update as work lands. `[x]` = built **and** verified, `[~]` = partially
done, `[ ]` = not started.

---

## Environment facts (verified 2026-09-14)

These constrain the architecture and are worth re-reading before changing infrastructure.

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
- The Postgres data directory lives at `%LOCALAPPDATA%\hull-corridor\pgdata`,
  deliberately **outside** OneDrive — OneDrive sync corrupts live database files.
- No `pg_dump`/`psql` binaries ship with the embedded package, so backup/restore is
  implemented as a portable logical dump in TypeScript instead.
- npm 11 gates install scripts. `allowScripts` in `package.json` records the
  approvals; a fresh clone may need `npm approve-scripts --allow-scripts-pending`.

---

## Phase 0 — Foundation

- [x] Git repository initialised
- [x] `package.json`, TypeScript, Next.js 15, React 19 configured
- [x] Local PostgreSQL 17.10 without Docker or admin (`db:up`/`db:down`/`db:status`/`db:nuke`)
- [x] Drizzle ORM + drizzle-kit migrations wired
- [x] Full schema: 33 tables, 16 enums, initial migration applied
- [x] `.env.example` with no secrets; `.env` generated locally
- [x] Vitest configured and running
- [x] Geometry library (validate / bbox / point-in-polygon / area / circle / relevance) — **25 tests passing**

## Phase 1 — Local foundation

- [ ] Environment config module with typed validation and status reporting
- [ ] Auth: Auth.js v5 credentials, bcrypt, admin/member roles
- [ ] Dev-only sign-in shortcut, hard-disabled when `NODE_ENV=production`
- [ ] Server-side authorization helpers (`requireUser`, `requireAdmin`)
- [ ] Optimistic-concurrency helper (version tokens) + audit log writer
- [ ] Markets + mall anchors CRUD
- [ ] Corridors: radius seed, custom draw, persistent boundaries
- [ ] Properties CRUD with all specified fields
- [ ] Parcels: multiple per property, optional geometry, persistent edits
- [ ] Corridor membership: many-to-many, recomputed on geometry change
- [ ] Shared contacts + owner entities
- [ ] Activity timeline / call logging
- [ ] Follow-up views (overdue / today / upcoming / none scheduled)
- [ ] Leaflet map: basemaps, draw/edit tools, filters, fit-to-bounds
- [ ] Corridor workspace screen (map + table + side panel)
- [ ] Property detail screen
- [ ] Portfolio dashboard
- [ ] Seed data: default statuses/stages + clearly-labelled sample records

## Phase 2 — Pipeline, config, imports, collaboration

- [ ] Opportunities: explicit promotion only, reason + date captured
- [ ] Transaction pipeline (table + board), removal/reopen with history
- [ ] Configurable outreach statuses and transaction stages, with safe reassignment
- [ ] Custom fields (text/number/date/checkbox/select)
- [ ] Tags management
- [ ] Attachments with storage abstraction (local ↔ S3)
- [ ] Mall import template + CSV/XLSX import (map → preview → validate → confirm)
- [ ] Property/contact import and export with stable IDs
- [ ] Users admin screen
- [ ] Concurrent-edit protection surfaced in the UI

## Phase 3 — Discovery

- [ ] Anthropic client, server-only key, configurable model
- [ ] Structured + validated extraction schema
- [ ] Corridor-scoped web search with coverage reporting
- [ ] Background worker (claim / heartbeat / retry / cancel / concurrency)
- [ ] Scan states: queued / running / completed / partial / cancelled / failed
- [ ] Deduplication + suppression of already-reviewed candidates
- [ ] Discovery inbox: review, correct, approve, link, reject, needs-research
- [ ] Proposed-change review for existing properties (never silent overwrite)
- [ ] Manual "Add listing URL" and "Upload flyer/OM" through the same pipeline
- [ ] Budget ceiling, per-scan limits, recorded usage

## Phase 4 — Production hardening

- [ ] Health endpoint
- [ ] Rate limiting on expensive endpoints
- [ ] Backup/restore tooling (database + attachments)
- [ ] Railway deployment documentation
- [ ] Local → production data migration path
- [ ] Known limitations documented

---

## Test coverage targets (from the brief)

- [x] Corridor and parcel geometry validation/persistence — unit level
- [ ] Parcel and corridor persistence — database level
- [ ] Multiple parcels on one property
- [ ] One property in overlapping corridors without duplication
- [ ] Call history and follow-up persistence
- [ ] Explicit opportunity promotion
- [ ] Routine outreach stays out of the pipeline
- [ ] Import validation and duplicate handling
- [ ] Repeated scans do not create duplicates
- [ ] Reviewed data not overwritten by AI
- [ ] API keys remain server-side
- [ ] Access control and concurrent-edit protection
