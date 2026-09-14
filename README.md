# Hull Corridor

Corridor property research, cold-calling, and acquisition pipeline for Hull Property Group.

Organises property research geographically: **Market → Corridors → Properties → Parcels**,
with equal support for listed and off-market properties.

---

## Quick start

Everything below runs on Windows with **no administrator rights, no Docker, and no
WSL**. PostgreSQL runs from binaries npm installs into the project.

```bash
npm install
npm run setup
```

`npm run setup` starts PostgreSQL, applies migrations, seeds baseline configuration
and sample data, and prints the admin password. Then, in two terminals:

```bash
npm run dev
```

```bash
npm run worker
```

Open <http://localhost:3000>.

Full details, prerequisites and troubleshooting: **[docs/SETUP.md](docs/SETUP.md)**.

---

## What it does

| Area | Summary |
|---|---|
| **Map workspace** | Leaflet map as the primary surface. Radius or hand-drawn corridor boundaries, parcel polygons, filters, and a synchronised property table. Map position and filters survive navigation. |
| **Cold calling** | Owner and broker details one click from the map, copy-to-clipboard, fast call logging with outcome, motivation, pricing, timing and follow-up in a few clicks. |
| **Three separate statuses** | *Listing status* (is it for sale), *outreach status* (how far along contact is), and *transaction stage* (is there a real deal) are deliberately distinct. |
| **Explicit pipeline** | A property enters the transaction pipeline only when someone chooses **Promote to Opportunity** and gives a reason. Calls and follow-ups never do it automatically. |
| **Discovery** | Claude-powered search for properties offered for sale in a corridor, staged in a review inbox. Nothing becomes a property record without human approval. |
| **Imports/exports** | Mall import template, CSV import with column mapping, preview, validation and duplicate detection. Exports carry stable IDs for reconciliation. |

---

## Key design decisions

Each of these was a deliberate choice; the reasoning is recorded so it can be
revisited rather than rediscovered.

**Local PostgreSQL without Docker.** The target machine has no administrator
rights and no WSL, so Docker Desktop cannot be installed. `npm run db:up` runs a
real PostgreSQL 17 server from the `embedded-postgres` npm binaries as a normal
user process. The application only ever reads `DATABASE_URL`, so switching to
Docker, a system install, or Railway Postgres is a one-line configuration change.
The data directory deliberately lives outside the OneDrive-synced project folder,
because OneDrive will corrupt a live database directory.

**No PostGIS.** Geometry is validated GeoJSON in `jsonb` with denormalised,
indexed bounding-box columns; viewport queries use the bbox index and exact
point-in-polygon runs in TypeScript. This avoids a dependency that is impractical
to install locally here and adds friction on Railway. At this data scale it is
comfortably fast, and the columns can be replaced with a `geography` column later
without changing the API surface.

**No Redis.** Background scans use a PostgreSQL `jobs` table claimed with
`FOR UPDATE SKIP LOCKED`. One fewer service locally and one fewer to pay for in
production.

**Two-phase AI extraction.** Discovery researches with the web search tool, then
converts that output to schema-validated JSON in a *separate* call with no tools
attached. Structured outputs cannot be combined with the citations that search
results carry, and the split means nothing reaches the database until it has
passed a Zod schema.

**Unknown is never zero.** Every financial and physical field is nullable. A
blank asking price stays `NULL` and renders as `—`; a genuine zero is stored as
zero and is distinguishable from it.

---

## Commands

| Command | What it does |
|---|---|
| `npm run setup` | One-shot: database up, migrate, seed, print credentials |
| `npm run dev` | Next.js development server on :3000 |
| `npm run worker` | Background worker (scans). Runs as a separate process |
| `npm run db:up` / `db:down` / `db:status` | Local PostgreSQL control |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:generate` | Generate a migration after a schema change |
| `npm run db:seed` / `db:seed:demo` | Baseline config / plus sample data |
| `npm test` | Full test suite (93 tests) |
| `npm run typecheck` | TypeScript, no emit |
| `npm run build` / `npm start` | Production build and serve |
| `npm run backup` / `npm run restore -- --in <dir>` | Database rows **and** attachments |

---

## Documentation

| Document | Contents |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | Prerequisites, first run, troubleshooting |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack, data model, how the pieces fit |
| [docs/IMPLEMENTATION_CHECKLIST.md](docs/IMPLEMENTATION_CHECKLIST.md) | What is built, what is not, test coverage |
| [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md) | What has been verified, and how |
| [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) | Honest list of gaps and constraints |
| [docs/BACKUP_RESTORE.md](docs/BACKUP_RESTORE.md) | Backup, restore, and disaster recovery |
| [docs/RAILWAY_DEPLOYMENT.md](docs/RAILWAY_DEPLOYMENT.md) | Deploying, and moving local data to production |

---

## Status

Phases 1–4 are implemented. The application runs locally with persistent data and
a full test suite. **Nothing has been deployed and no paid service has been
provisioned** — Railway deployment is documented and prepared, not executed.

Discovery requires an `ANTHROPIC_API_KEY`, which is not set. Every other feature
works without it, and the code paths are covered by tests that run without
spending anything. See [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) for
exactly what has and has not been exercised against live services.
