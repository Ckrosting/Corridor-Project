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

- [x] Environment config module with typed validation and status reporting
- [x] Auth: Auth.js v5 credentials, bcrypt, admin/member roles
- [x] Dev-only sign-in shortcut, hard-disabled when `NODE_ENV=production`
- [x] Server-side authorization helpers (`requireUser`, `requireAdmin`)
- [x] Optimistic-concurrency helper (version tokens) + audit log writer
- [x] Corridors: radius seed, custom draw, persistent boundaries
- [x] Properties service with all specified fields
- [x] Parcels: multiple per property, optional geometry, persistent edits
- [x] Corridor membership: many-to-many, recomputed on geometry change
- [x] Activity timeline / call logging (service + UI)
- [x] Follow-up queues (overdue / today / upcoming / none scheduled) — service
- [x] Leaflet map: basemaps, draw/edit tools, fit-to-bounds, preserved viewport
- [x] Corridor workspace screen (map + table + side panel + filters)
- [x] Portfolio dashboard
- [x] Seed data: default statuses/stages + clearly-labelled sample records
- [x] Markets + mall anchors CRUD screens (list, create, market map workspace)
- [x] Property detail screen (full view, inline editor, conflict handling)
- [x] Properties list screen with URL-backed filters
- [x] Follow-ups screen (overdue / today / upcoming / unscheduled)
- [x] Shared contacts screens (list + detail with cross-property call history)

## Phase 2 — Pipeline, config, imports, collaboration

- [x] Opportunities: explicit promotion only, reason + date captured
- [x] Transaction pipeline (table + board), removal/reopen with history
- [x] Custom fields (text/number/date/checkbox/select) — rendered and editable
- [x] Mall import service: column mapping, validation, duplicate detection, explicit commit
- [x] CSV export with stable IDs + mall import template
- [x] Concurrent-edit protection surfaced in the UI (conflict banner, no silent overwrite)
- [ ] Import UI screen (service and tests done; screen pending)
- [ ] XLSX import (CSV done)
- [ ] Configurable statuses/stages admin UI, with safe reassignment
- [ ] Tags management UI
- [ ] Attachments upload UI (storage abstraction done)
- [ ] Users admin screen

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

**67 tests passing** (`npm test`) across `tests/geometry.test.ts` and `tests/persistence.test.ts`.

- [x] Corridor and parcel geometry validation/persistence — unit level (25 tests)
- [x] Parcel and corridor persistence — database level
- [x] Multiple parcels on one property (including a parcel ID with no geometry yet)
- [x] One property in overlapping corridors without duplication
- [x] Call history and follow-up persistence
- [x] Call history survives outreach status changes
- [x] Explicit opportunity promotion (reason, date, author recorded)
- [x] Routine outreach stays out of the pipeline
- [x] Opportunity removal and reopening without losing history
- [x] Unknown values stay NULL; a real zero is stored as zero
- [x] Access control helpers and concurrent-edit protection (version conflicts)
- [x] Import validation and duplicate handling (row errors, in-file and existing duplicates, re-import does not double data, explicit update)
- [x] CSV round-trip: negative coordinates survive, formula injection escaped
- [ ] Repeated scans do not create duplicates
- [ ] Reviewed data not overwritten by AI
- [ ] API keys remain server-side (assertion test)
