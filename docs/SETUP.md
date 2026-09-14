# Local setup

## Your machine — what was checked

Verified on this machine on 2026-09-14:

| Requirement | Status |
|---|---|
| Node.js ≥ 20 | ✅ v24.17.0 |
| npm | ✅ 11.17.0 |
| git | ✅ 2.54.0 |
| Docker | ❌ not installed |
| WSL | ❌ not installed |
| System PostgreSQL | ❌ not installed |
| Windows administrator rights | ❌ **no** |

**The last four do not matter.** Without admin rights Docker Desktop cannot be
installed, so the project does not use it. PostgreSQL 17 runs from binaries that
npm places in `node_modules`, started as an ordinary user process on port 5433.
It is real PostgreSQL — the same engine used in production.

---

## First run

```bash
npm install
npm run setup
```

`npm run setup` will:

1. check Node and the PostgreSQL binaries (approving the npm install script if needed),
2. create `.env` from `.env.example` with a generated `AUTH_SECRET`,
3. start PostgreSQL,
4. apply migrations,
5. seed baseline configuration plus clearly-labelled sample data,
6. print the admin password **once**.

Then open two terminals:

```bash
npm run dev
```

```bash
npm run worker
```

and go to <http://localhost:3000>.

### Signing in

`npm run setup` enables `DEV_AUTH_BYPASS=true`, so the sign-in page shows a
one-click **Continue as …** button. This provider is computed as
`!isProduction && …`, so it is *absent from the provider list entirely* in a
production build — there is no environment variable that can switch it on there.

To use a real password instead, the seed prints one the first time it creates the
admin account. To choose your own:

```bash
SEED_ADMIN_EMAIL=you@hullpg.com SEED_ADMIN_PASSWORD='a-long-password' npm run db:seed
```

---

## Day-to-day

The database keeps running in the background between sessions. After a reboot:

```bash
npm run db:up      # start PostgreSQL
npm run dev
npm run worker
```

| Command | Purpose |
|---|---|
| `npm run db:status` | Is PostgreSQL running, and on what connection string |
| `npm run db:down` | Stop PostgreSQL |
| `npm run db:studio` | Drizzle Studio — browse the database in a GUI |
| `npm test` | Full test suite |

### The worker

The worker is a **separate process** and only matters for discovery scans.
Everything else works without it. It idles harmlessly when no API key is set.

---

## Where things live

| Path | Contents |
|---|---|
| `%LOCALAPPDATA%\hull-corridor\pgdata` | PostgreSQL data directory |
| `%LOCALAPPDATA%\hull-corridor\postgres.log` | PostgreSQL server log |
| `./storage/uploads` | Uploaded attachments (development only) |
| `./backups/<timestamp>/` | Output of `npm run backup` |
| `./drizzle/` | SQL migrations (committed) |

**The database deliberately lives outside the project folder.** This project sits
in a OneDrive-synced path, and OneDrive syncing a live PostgreSQL data directory
will corrupt it. Override with `PGLOCAL_DIR` if you need to.

---

## Changing the schema

```bash
# 1. edit files under src/db/schema/
npm run db:generate      # writes a new SQL migration into ./drizzle
npm run db:migrate       # applies it
```

Migrations are committed to git and applied in production by `npm run release`.
Never edit a migration that has already been applied anywhere.

---

## Optional configuration

Everything below is optional. The application is fully usable without any of it.

### Discovery (Claude)

```dotenv
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-5
AI_MONTHLY_BUDGET_USD=25
```

Without a key, discovery is disabled and says so; everything else is unaffected.
The key is read only on the server, never returned by an API response, never
logged, and never exposed through a `NEXT_PUBLIC_` variable.

### Satellite imagery

```dotenv
NEXT_PUBLIC_SATELLITE_PROVIDER=mapbox      # or maptiler, or esri
NEXT_PUBLIC_MAPBOX_TOKEN=pk....
```

Without this the map shows the OpenStreetMap street basemap and explains on-screen
why satellite is unavailable. Note that any token used for browser tile requests
is visible to anyone using the app — that is inherent to client-side tiles, so
scope and URL-restrict it at the provider.

### Geocoding

```dotenv
GEOCODER_PROVIDER=nominatim               # default, no key
NOMINATIM_CONTACT_EMAIL=you@hullpg.com    # requested by their usage policy
```

Nominatim is free but rate-limited to roughly one request per second and its
policy forbids bulk use — fine for the occasional address lookup, unsuitable for
geocoding a whole mall import. For volume, set `GEOCODER_PROVIDER` to `mapbox`,
`maptiler` or `google` with a `GEOCODER_API_KEY`. Address lookup failures are
never fatal: the map always allows placing a location by hand.

---

## Troubleshooting

**`npm run db:up` says the binaries are missing**

npm 11 requires approval before a package may run an install script:

```bash
npm approve-scripts @embedded-postgres/windows-x64
npm rebuild @embedded-postgres/windows-x64
```

**Port 5433 is already in use**

Something else is on that port, or a previous PostgreSQL is still running.
`npm run db:status` will tell you. To use a different port:

```bash
PGLOCAL_PORT=5455 npm run db:up
```

then update `DATABASE_URL` in `.env` to match.

**PostgreSQL will not start**

Read the tail of `%LOCALAPPDATA%\hull-corridor\postgres.log` — `db:up` prints the
path. The usual cause is an unclean shutdown; `npm run db:down` then `db:up`
normally clears it.

**Starting completely fresh**

```bash
CONFIRM_NUKE=yes npm run db:nuke   # permanently deletes ALL local data
npm run setup
```

**The app builds but `next dev` fails on TypeScript**

This project pins `typescript@^6`. TypeScript 7's native compiler removes the
JavaScript compiler API that Next.js 15 needs, and installing it produces a
confusing failure inside `next.config` loading. If `npx tsc --version` reports 7,
run `npm install --save-dev typescript@^6`.

**Everything is slow, or `node_modules` behaves oddly**

The project lives in a OneDrive folder. If OneDrive is actively syncing
`node_modules`, exclude it from sync (OneDrive → Settings → Choose folders), or
move the project outside the synced path. The database is already stored
elsewhere for this reason.
