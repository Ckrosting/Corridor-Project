# Known limitations

An honest account of what is not built, not verified, or deliberately constrained.

---

## Not verified against live services

These are implemented and unit/integration tested, but have **never made a real
call to the service in question**. That distinction matters.

| Area | Status |
|---|---|
| **Anthropic discovery scans** | No `ANTHROPIC_API_KEY` is configured on this machine, so no scan has ever run against the real API. The extraction schema, deduplication, suppression, geographic relevance, budget enforcement, job queue and review workflow are all tested with fabricated candidate data. The model id (`claude-sonnet-5`) and web search tool (`web_search_20260209`) were verified against current Anthropic documentation, **not** by making a call. Expect prompt tuning to be needed on first real use. |
| **S3 attachment storage** | The driver is written and the local driver is exercised. No real bucket has been connected. |
| **Geocoding** | Provider abstraction is written; no lookup has been performed against Nominatim, Mapbox, MapTiler or Google. |
| **Satellite basemaps** | No provider key is configured, so only the OpenStreetMap street basemap has actually rendered. The map says so on screen. |
| **Railway deployment** | Documented and prepared. Nothing deployed, nothing provisioned, no cost incurred. |
| **Production build under load** | `npm run build` succeeds and all routes compile. It has not been run under concurrent users. |

---

## Deliberately out of scope

Choices, not oversights.

- **County GIS integration and parcel-map uploads.** Explicitly excluded for this
  version. Drawn boundaries are approximate research outlines and are labelled as
  such everywhere they appear — they are not surveyed lines and not official tax
  parcel boundaries.
- **CoStar integration.** A CoStar Pro subscription does not grant API access,
  scraping permission, or automated access. Nothing in this application attempts
  it. Use manual entry, listing-URL submission, document upload, or CoStar's own
  supported exports through the CSV importer.
- **Automated outreach.** No email sending, no dialling, no sequences. The
  application records what a human did.
- **Recurring scans.** Every scan is started explicitly by a person. There is no
  scheduler and no recurring paid work, by design.
- **A generic workflow engine.** Custom fields are limited to text, number, date,
  checkbox and select. That covers the stated need without becoming a
  configuration product.
- **PostGIS.** See `ARCHITECTURE.md`. Reversible if the data outgrows the current
  approach.

---

## Incomplete

Working but unfinished. None of these blocks daily use.

| Gap | Detail |
|---|---|
| **XLSX import** | Only CSV is parsed. Excel's *Save As → CSV UTF-8* is a 10-second workaround, and the import screen says so. `exceljs` is already a dependency if this becomes worth finishing. |
| **Property and contact import** | Mall import is complete end to end. Property and contact **export** work; importing them reuses the same validated pipeline but has no dedicated screen yet. |
| **Editing a logged call** | Calls can be created and are never destroyed by status changes. Editing an existing call is defined in the validation schema but has no UI; this is intentional caution about rewriting history. |
| **Saved views** | The table exists and filters are URL-backed and shareable, but named saved views have no UI. |
| **Bulk actions** | No multi-select bulk edit or bulk archive. |
| **Corridor radius editing after creation** | A corridor can be redrawn freehand, and the original radius parameters are retained, but there is no slider to adjust the radius after creation. |
| **Map marker clustering** | Fine for hundreds of properties per corridor. Thousands in one viewport would want clustering. |

---

## Constraints worth knowing

**Nominatim is not suitable for bulk geocoding.** It is the no-key default and is
rate-limited to roughly one request per second; its usage policy forbids heavy
use. Fine for looking up an address; wrong for geocoding a 30-mall import.
Configure a commercial provider first. The importer therefore does *not*
auto-geocode — malls without coordinates are flagged for manual placement.

**Map provider tokens reach the browser.** Tile requests are made by the browser,
so any `NEXT_PUBLIC_*` tile token is visible to anyone using the app. That is
inherent to client-side tiles. Scope and URL-restrict them at the provider.
Server-side secrets — the Anthropic key, S3 credentials, the geocoding key, the
auth secret — never reach the browser, and there is a test asserting it.

**Optimistic concurrency is per-record, not per-field.** Two people editing
different fields of the same property still conflict; the second saver is told
clearly and nothing is lost, but they must reapply their change.

**Cost figures are estimates.** The Anthropic API does not return a price. Spend
is computed from admin-configurable rates and labelled as approximate throughout.
Token and search counts are the real values the API reported.

**"Newly discovered" is not "newly listed".** The first scan of a corridor
establishes an inventory; everything in it is new *to us*. A listing date is only
recorded when a source actually states one. A listing disappearing from search
results is not treated as evidence it sold.

**Discovery coverage is partial by nature.** It searches publicly accessible
sources. Paywalled, login-gated and blocked sources are reported as coverage
limitations rather than skipped silently, and the application never claims
complete market coverage.

---

## Scale

Comfortable at the intended size — around 30 markets, five users, tens of
thousands of properties. The places that would strain first:

1. **Map rendering** beyond a few thousand markers in one viewport (add clustering).
2. **Point-in-polygon in application code** if corridors reached six figures
   (the bbox index makes the current approach cheap; PostGIS would be the answer).
3. **The `audit_log` table**, which grows without bound and has no pruning policy yet.
