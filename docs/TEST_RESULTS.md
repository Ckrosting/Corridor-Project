# Test results

Last run: **2026-09-14** · `npm test`

```
Test Files  5 passed (5)
     Tests  99 passed (99)
  Duration  7.73s
```

Plus `npx tsc --noEmit` → clean, and `npm run build` → compiled successfully.

Integration tests run against the **real local PostgreSQL**, not a mock. The
point of most of them is that geometry, history and pipeline rules survive an
actual round trip through Postgres, which an in-memory fake cannot demonstrate.

---

## Coverage against the brief's required list

| Required verification | Status | Where |
|---|---|---|
| Parcel and corridor persistence | ✅ | `persistence.test.ts` |
| Multiple parcels on one property | ✅ | `persistence.test.ts` |
| One property in overlapping corridors without duplication | ✅ | `persistence.test.ts` |
| Call history and follow-up persistence | ✅ | `persistence.test.ts` |
| Explicit opportunity promotion | ✅ | `persistence.test.ts` |
| Routine outreach staying out of the transaction pipeline | ✅ | `persistence.test.ts` |
| Import validation and duplicate handling | ✅ | `import-export.test.ts` |
| Repeated scans not creating duplicate records | ✅ | `discovery.test.ts` |
| Reviewed data not being overwritten by AI | ✅ | `discovery.test.ts` |
| API keys remaining server-side | ✅ | `discovery.test.ts` |
| Access control and concurrent edit protection | ✅ | `access-control.test.ts`, `persistence.test.ts` |

---

## By file

### `geometry.test.ts` — 25 tests

Validation, normalisation and maths for corridor and parcel geometry.

- Rejects rings with too few points, degenerate rings enclosing no area, and
  out-of-range coordinates.
- **Closes open rings** rather than rejecting them — Leaflet and Geoman commonly
  emit open rings, so rejecting them would break drawing.
- Normalises winding (outer ring counter-clockwise, holes clockwise).
- Point-in-polygon including holes and MultiPolygon membership.
- Acreage against a known-size square; holes subtract.
- Haversine distance checked against a real-world pair (Augusta → Atlanta ≈ 230 km).
- `circleToPolygon` produces a closed ring whose every vertex is the requested
  distance from the centre.
- **`classifyRelevance` returns `unknown` when coordinates are missing** and
  `edge` near a boundary — never a silent verdict.
- Leaflet `[lat,lng]` ↔ GeoJSON `[lng,lat]` round trip.

### `persistence.test.ts` — 26 tests

Database-level behaviour of the core product rules.

**Corridors** — a radius boundary is stored as a polygon with populated bbox
columns; a hand-drawn boundary survives reload with its ring closed and the
radius parameters retained; invalid geometry is rejected and leaves the previous
boundary untouched.

**Parcels** — drawn geometry persists with acreage derived from the shape; an
edit enlarges the stored polygon and bumps the version; **three parcels on one
property, one of them a parcel ID with no geometry yet**; `needsParcelOutline`
clears once a boundary exists.

**Overlapping corridors** — a property at a point inside three corridors produces
**one** property row and three membership rows, and is absent from a fourth
corridor that does not contain it. Moving a boundary recomputes membership *but
preserves a manually pinned link*. Moving a property out of a boundary detaches it.

**Calls and follow-ups** — a call persists outcome, seller motivation, pricing
expectation, timing and author. **Two status changes leave both original calls and
their notes intact**, and append two `status_change` entries rather than replacing
anything. Follow-up dates persist and can be cleared. Overdue/today/upcoming
bucketing works, and the "no follow-up scheduled" queue is restricted to actively
pursued statuses.

**Pipeline** — a full outreach sequence including an "interested in selling"
outcome creates **zero** opportunities. Promotion records reason, date and author,
links the property as primary, and adds a timeline entry. A second active
promotion for the same property is refused. Removal and reopening preserve
history. The property record is untouched by promotion.

**Concurrency** — two saves against the same loaded version: the first wins, the
second is refused with a `ConflictError` naming the current version, and the first
user's value is what remains. Parcels are protected the same way.

**Unknown vs zero** — unspecified financial and physical fields stay `NULL`; a
genuine `0` is stored as `0` and remains distinguishable.

### `import-export.test.ts` — 22 tests

**CSV encoding** — quoting of commas, quotes and newlines; `null` renders empty
while `0` renders `0`; formula injection (`=cmd|calc`, `@SUM`) is escaped **while
a real negative longitude `-82.0812` is left intact**, so an export can be
re-imported.

**Parsing** — round trip through encode/parse; CRLF, LF and BOM handling; header
spelling normalisation.

**Mall import** — column mapping guessed from varied spellings (`Mall Name`,
`Market`, `Lat`, `Lon`). Row-level errors (missing name, non-numeric coordinate,
out-of-range coordinate, one coordinate without the other) **do not discard the
valid rows**. Missing coordinates are a *warning*, not an error — the mall imports
flagged for map placement.

**Duplicates** — same mall twice in one file is flagged against the earlier row;
re-importing the same file finds the existing record and **skips by default**, so
the data is not doubled; choosing "update" explicitly applies the new values; the
same batch cannot be committed twice.

### `discovery.test.ts` — 20 tests

**URL normalisation** — tracking parameters, fragments, `www.`, trailing slashes
and query ordering all collapse; meaningful parameters are kept; `javascript:` and
malformed input return null.

**Address normalisation** — `Parkway`/`Pkwy`, `North`/`N`, `Street`/`St` collapse;
equivalent addresses hash identically; too-little information returns null rather
than a hash that would match everything.

**Matching** — identical address or shared parcel ID is an *exact* match;
proximity alone is only a *suggestion*; **name similarity alone never matches**.

**Repeated scans** — the same listing seen twice bumps `timesSeen` instead of
creating a second row. The same property found at **two different URLs** is caught
by the address hash. A rejected candidate is permanently suppressed and never
resurfaces; "needs more research" is deliberately *not* suppressed.

> This suite caught a real bug during development: the duplicate lookup matched on
> normalised URL **or** address hash rather than either, so the same property on
> two different sites was staged twice — precisely the case it existed to prevent.

**Geographic relevance** — a candidate with no coordinates is `unknown` and stays
in the review queue; a far-away candidate is marked `needs_research` rather than
imported as if it were inside.

**No overwriting** — a scan finding a human-entered property leaves the property's
name, price, notes, **call history and version completely untouched**, and stages
the differences as proposals. A verified non-empty field is not proposed for
replacement; a genuinely empty field is; an evidenced price move is.

**Approval** — creates a property carrying provenance (sources, evidence excerpt,
"needs verification" list) into its research notes, then suppresses the candidate
so an imported listing cannot reappear. Double approval is refused.

**Secrets** — the AI status surface and the config status surface contain no key
material; no `NEXT_PUBLIC_` variable names a secret; queueing a scan without a key
fails with a clear configuration error rather than an obscure one.

### `access-control.test.ts` — 6 tests

Guards exercised directly with a mocked session, so the real decision function is
tested rather than a URL pattern.

- Unauthenticated → `401`.
- Authenticated member accepted, with the denormalised author label populated.
- Member calling an admin-only guard → **`403`, not `401`** (authenticated but not
  permitted).
- Admin accepted.
- A session missing its role defaults to **member**, never admin.
- The development sign-in shortcut is structurally impossible in production:
  `devAuthBypass` is computed as `!isProd && …`, and the provider is only added to
  the list when that flag is true.

---

## Verified manually

Things a test suite is the wrong tool for.

| Check | Result |
|---|---|
| Every screen renders with real data | ✅ Dashboard, markets list/detail, corridor workspace, property list/detail, pipeline board and table, follow-ups, contacts, discovery inbox, all settings screens |
| Leaflet map | ✅ Renders with OSM tiles and attribution; corridor ring, parcel polygons, property markers and mall anchor visible; fits to the corridor on first open |
| Satellite absent | ✅ Map states on screen why satellite is unavailable rather than failing silently |
| Unauthenticated access | ✅ API routes `401`, pages `307` to sign-in, `/api/health` public by design |
| Production build | ✅ `npm run build` compiles; all 40 routes build |
| Worker process | ✅ Starts, connects, reports discovery disabled without a key, idles cleanly |
| Health endpoint | ✅ `200` with `"database":"ok"`, presence flags only, no secret values |
| `npm run setup` from scratch | ✅ Completes with no warnings and prints next steps |
| Backup → restore round trip | ✅ 914 rows into a scratch database; corridor GeoJSON, bbox columns, numeric precision, NULL-vs-zero, timestamps and many-to-many links all compared **identical** |
| Test suite leaves no residue | ✅ Verified zero leftover rows after a full run |

---

## Not verified

Stated plainly, because "tested" and "works against the real service" are
different claims. Full detail in [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

- **No discovery scan has ever called the Anthropic API.** No key is configured.
  All discovery logic is tested with fabricated candidate data. The model id and
  web search tool version were confirmed against current Anthropic documentation,
  not by making a call.
- **No S3 bucket has been connected.** Only the local storage driver has run.
- **No geocoding request has been made** to any provider.
- **Nothing has been deployed to Railway** and no paid service provisioned.
- **No load testing.**
