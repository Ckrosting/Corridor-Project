# Architecture

## Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15 (App Router), React 19, TypeScript | One deployable unit; server components keep data access on the server |
| Database | PostgreSQL 17 | Same engine locally and on Railway |
| Data access | Drizzle ORM + drizzle-kit | Typed schema, plain SQL migrations, no binary engine to ship |
| Map | Leaflet + `leaflet-geoman-free` | Geoman is maintained; `leaflet-draw` is not |
| Auth | Auth.js v5, credentials + bcrypt | Established, no external identity provider needed for five users |
| Background work | PostgreSQL job table + separate worker | No Redis to run or pay for |
| AI | `@anthropic-ai/sdk`, Claude Sonnet 5 | Server-side only |
| Styling | Tailwind v4 | — |
| Tests | Vitest against the real database | Geometry and history round-trips are the point; a mock cannot prove them |

---

## Processes

```
┌──────────────┐        ┌──────────────┐
│  web (Next)  │        │    worker    │
│  :3000       │        │  no HTTP     │
└──────┬───────┘        └──────┬───────┘
       │                       │
       │   FOR UPDATE SKIP LOCKED
       └───────────┬───────────┘
                   ▼
           ┌───────────────┐      ┌──────────────────┐
           │  PostgreSQL   │      │ object storage   │
           │  34 tables    │      │ (local │ S3)     │
           └───────────────┘      └──────────────────┘
```

The worker is separate so a multi-minute scan is unaffected by HTTP timeouts.
Both processes read the same `DATABASE_URL`. Multiple workers may run at once.

---

## Data model

`Market → Corridors → Properties → Parcels`, with the relationships that matter
modelled explicitly.

**A property belongs to many corridors.** `property_corridors` is a join table.
A property inside three overlapping corridors is *one* row in `properties` with
three join rows — its contacts, notes and call history exist once. Membership is
recomputed from geometry whenever a boundary or a property's coordinates change,
and a manually pinned link survives that recomputation.

**A property has many parcels, and geometry is optional.** A parcel ID can be
recorded long before anyone draws its outline, and a property can exist as a bare
map point. `needs_parcel_outline` is maintained automatically.

**Three independent status axes**, kept apart on purpose:

| Axis | Column | Meaning |
|---|---|---|
| Listing status | `properties.listing_status` | Is it for sale |
| Outreach status | `properties.outreach_status_id` → configurable table | How far along contact is |
| Transaction stage | `opportunities.stage_id` → configurable table | Progress on a real deal |

**Opportunities are separate records from properties.** One opportunity can span
several properties; one property can have several opportunities over the years
without any of them overwriting the others. `promoteToOpportunity()` is the only
function in the codebase that inserts into `opportunities`, and it requires a
reason.

**Unknown is never zero.** Every financial and physical column is nullable. NULL
means unknown and renders as `—`; a genuine zero is stored and displayed as zero.

**Reported and calculated cap rates never merge.** `cap_rate_reported` holds what
a broker claimed, with its source. The calculated rate is derived in the
application from NOI and a named price basis, so the two can disagree visibly.

---

## Geometry without PostGIS

Boundaries are validated GeoJSON in `jsonb`, with the bounding box denormalised
into four indexed `double precision` columns.

A containment query is two stages: the bbox index narrows candidates in SQL, then
exact ray-casting point-in-polygon runs in TypeScript (`src/lib/geo/polygon.ts`).

Why not PostGIS: it cannot be installed on the target machine without
administrator rights, and it adds friction on Railway. At this scale the
bbox-then-exact approach is fast, and the columns can later be replaced by a
`geography` column without changing the API surface.

Radius corridors and hand-drawn corridors are both *stored as polygons*, so
containment has exactly one code path. The radius parameters are retained so a
user can return to a clean circle.

All coordinates are stored in GeoJSON order — `[longitude, latitude]`. Leaflet
uses `[lat, lng]`. Every conversion goes through `src/lib/geo/convert.ts`; there
are no inline conversions, because that is the most common way to ship a map bug.

---

## Writes

Every write goes through a service in `src/lib/services/`. API routes validate
with a Zod schema from `src/lib/validation/schemas.ts`, then call the service.

**Optimistic concurrency.** Editable tables carry a `version` integer. Updates
match on `(id, version)` and bump it in a single atomic statement. Zero rows
matched means someone else saved first, so the write is rejected with a
`ConflictError` naming the current version — the UI shows the conflict rather
than letting one person's work quietly replace another's.

**Audit trail.** `audit_log` records entity, action, field-level diff, author and
timestamp. The author's *name* is denormalised onto activity and audit rows so
history survives a user being removed.

**Append, don't overwrite.** Changing outreach status appends a `status_change`
entry to the timeline; it never touches existing call records.

---

## Discovery

Two phases, deliberately separate calls:

1. **Research** — web search tool, produces prose with citations.
2. **Extract** — no tools attached, `output_config.format` with a Zod schema.

They are split because structured outputs cannot be combined with the citations
that search results carry — and because it means nothing reaches the database
until it has passed a schema in which every field is nullable, so the model says
"I don't know" by omission rather than by inventing a value.

Retrieved content is wrapped in explicit delimiters and governed by standing
rules that outrank anything a page says. Pages and uploaded documents are source
material, never instructions.

**Nothing becomes a property automatically.** Candidates are staged in
`discovery_results`. For a candidate matching an existing property, the diff is
stored as *proposed changes* — a human-verified field is never proposed for
replacement, only genuinely empty fields and evidenced price movements are, and
call notes are never touched.

**Deduplication uses two independent keys**: a normalised URL (tracking
parameters stripped, ordering canonicalised) and a hash of the normalised address
plus locality. Both are checked, so the same property on two different sites is
caught. Names are never used as a match key — "Riverbend Plaza" and "Riverbend
Plaza II" are different buildings. Proximity alone is a *suggestion* for a human,
never an automatic merge.

`discovery_suppressions` permanently records what a human already decided, so a
rejected or imported listing does not reappear as new on every subsequent scan.

---

## Jobs

```sql
select id from jobs
where (status = 'queued' and run_at <= now())
   or (status = 'running' and heartbeat_at < now() - interval '…')
order by priority desc, run_at asc
for update skip locked
limit 1
```

Two workers polling simultaneously cannot claim the same row and neither blocks
the other. Running jobs heartbeat every 30 seconds; one that goes silent is
reclaimed and retried rather than being stuck forever. Failures retry with
exponential backoff up to `max_attempts`, then record the error visibly.
Cancellation is cooperative — checked between corridors, so partial results are
kept. A partial unique index on `dedupe_key` allows only one queued-or-running
job per key, so double-clicking cannot start two scans.

---

## Security

- Authorization is enforced in route handlers and services, not middleware.
  Middleware only sees a path; these helpers run where data access happens.
- The Anthropic key, S3 credentials, geocoding key and auth secret are read only
  on the server, never returned by an API response, never logged, and never named
  with a `NEXT_PUBLIC_` prefix. A test asserts this.
- Uploads are checked for declared type, extension agreement, magic numbers and
  size, against an allowlist. Storage keys are server-generated and opaque, so a
  user-supplied filename cannot influence where a file lands.
- Downloads go through an authenticated route with
  `Content-Disposition: attachment` and `nosniff`, so an uploaded SVG or HTML file
  cannot execute in the application's origin.
- The development sign-in shortcut is computed as `!isProduction && …`, so it is
  absent from the provider list in a production build. No environment variable
  can enable it there.
- CSV exports escape values that begin with a formula character — while
  deliberately leaving real negative numbers alone, so coordinates survive a
  round trip.

---

## Layout

```
src/
├── app/
│   ├── (app)/              authenticated screens
│   ├── api/                route handlers
│   └── signin/
├── components/
│   ├── map/                Leaflet (client-only)
│   ├── workspace/          corridor/market workspaces, call logger, panels
│   └── ui/                 primitives
├── db/schema/              34 tables across 8 files
├── lib/
│   ├── ai/                 client, prompts, extraction schema, research
│   ├── geo/                types, polygon maths, Leaflet conversion, geocoding
│   ├── services/           all business logic
│   ├── storage/            local + S3 drivers
│   └── validation/         Zod schemas
worker/                     background worker process
scripts/                    setup, migrate, seed, backup, restore, pg control
tests/                      93 tests
```
