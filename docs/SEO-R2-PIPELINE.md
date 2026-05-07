# SEO + R2 Pipeline — calendar-be-af

**Companion to:** `MasterCalendar/docs/SEO-STRATEGY.md`
**Owner:** Fulton (calendar-be-af)
**Last updated:** 2026-04-30
**Status:** Living document — reflects the BE side of the SEO architecture

---

## Scope

Documents the BE-triggered SEO content pipeline:
- Per-event static page generation → Cloudflare R2
- City/state landing page data API → Vercel ISR (T1 stays on Vercel per converged plan)
- Sitemap URL generation
- Niche-aware credential model
- Kill switch + failure modes

Does NOT cover:
- FE rendering or Next.js routes (Sarah owns)
- Cloudflare Worker apex routing (deferred — see strategy doc P7)
- Admin UI for paid features (Dash owns)

---

## Components

| Component | File | Purpose |
|-----------|------|---------|
| Nightly cron + manual trigger + preview | `src/functions/SEO_BuildContent.js` | Renders per-event HTML and writes to R2 |
| HTML templates per segment × source | `src/utils/seoTemplates.js` | 4 segments × 2 sources = 8 active templates |
| R2 writer wrapper | `src/utils/r2Client.js` | S3-compatible (AWS SDK v3), niche-aware, kill switch |
| Sitemap URL generator | `src/functions/Sitemap_GetUrls.js` | RRULE-expanded URL list, FE composes sitemap.xml |
| City/state geo summary | `src/functions/SEO_GeoSummary.js` | Cities + parents (states/countries) for `generateStaticParams` |
| City page data | `src/functions/SEO_CityPage.js` | Rich per-city data — categories, organizers, featured, nearby |

---

## Schedule

**Nightly cron:** `0 0 3 * * *` (3:00 AM UTC) — one timer trigger, iterates all configured niches sequentially.

**Manual triggers:**
- `POST /api/ops/seo/build` — full re-render (admin function key required)
- `GET /api/ops/seo/preview?eventId=X&segment=Y&source=Z` — render single page without writing to R2

---

## Niche Model

Per-niche config in `SEO_BuildContent.js` `NICHES` array:

```js
{ appId: '1', slug: 'TT', displayName: 'TangoTiempo', domain: 'www.tangotiempo.com' }
```

**Per-niche env vars (slug-suffixed):**
- `R2_BUCKET_<SLUG>` — bucket name (e.g. `R2_BUCKET_TT`)
- `R2_ACCESS_KEY_ID_<SLUG>`
- `R2_SECRET_ACCESS_KEY_<SLUG>`

**Shared env vars:**
- `R2_ENDPOINT` — `https://<account_id>.r2.cloudflarestorage.com`
- `SEO_WRITES_ENABLED` — must be exactly `'true'` for any R2 write to occur

When HJ onboards (appId=2): add a NICHES entry with `slug: 'HJ'` and configure `R2_BUCKET_HJ`, etc. No code change required beyond the array.

---

## Kill Switch

`SEO_WRITES_ENABLED` env var:
- **PROD:** must be `'true'` for the cron to write to R2
- **TEST:** intentionally not set — cron runs to exercise code paths but skips puts
- **DEV:** never set

Behavior when disabled: build runs normally (renders HTML, logs results), `r2Client.putHtml` returns without writing. Useful for verifying the pipeline without touching production storage.

**Limitation worth refactoring before P6:** kill switch checks per-write, not per-build. With kill switch off, cron still does all the read + render work then discards. Wasteful at scale; refactor to short-circuit at the build level.

---

## Coverage (as of 2026-04-30)

**Segments × Sources:**

| Segment | RO (organizer-set) | AI (isDiscovered) |
|---------|:------------------:|:-----------------:|
| Milonga | ✅ | ✅ |
| Practica | ✅ | ✅ |
| Travel-Worthy (Festival/Marathon/Encuentro) | ✅ | ✅ |
| Beginner-Friendly | ✅ | ✅ |
| Class | ❌ deferred | ❌ deferred |
| Workshop | ❌ deferred | ❌ deferred |

**8 active templates × all qualifying TT events** = current R2 corpus.

URL pattern: `seo.tangotiempo.com/[segment]/[source]/[eventId].html`

Routing: Cloudflare DNS direct → R2 bucket (no Worker fronting yet).

---

## RRULE Expansion

Recurring events are expanded **6 weeks forward** for per-occurrence URLs:
- `RRULE_EXPANSION_WEEKS = 6` in `SEO_BuildContent.js` and `Sitemap_GetUrls.js`
- Honors `excludedDates[]` and `instanceOverrides[].canceled`
- Returns `[]` on parse error or no in-window occurrences

**Key file:** `expandRruleOccurrences(event, expansionUntil, context)` — duplicated across `Sitemap_GetUrls.js`, `SEO_BuildContent.js`, and `SEO_CityPage.js`. Worth centralizing in a shared util when next refactoring.

City-page (CALBEAF-166) added the same expansion to surface recurring events whose `startDate` anchors before `now` — without it, weekly classes/practicas were silently invisible to city landing pages.

---

## Failure Modes

| Failure | Behavior | Mitigation |
|---------|----------|------------|
| R2 put fails (network / auth) | Logs error, cron continues to next event | No retry; stale R2 data possible. P3b adds on-demand re-run. |
| RRULE parse error | Function returns `[]`, event is rendered without occurrences | Log surfaces eventId for triage |
| Missing R2 env var for a niche | `r2Client` returns null; cron skips that niche silently | Ops-side: monitor logs for "skipped niche" |
| `SEO_WRITES_ENABLED !== 'true'` | All puts no-op; renders still execute | Intentional — TEST/preview behavior |
| Cron timeout (Azure default 5min) | Partial run, no rollback | Future: chunk by niche or by date range; monitor duration |

---

## City/State API (T1 data, not R2)

T1 stays on Next.js ISR per converged strategy (P6 explicitly skipped).

`GET /api/seo/geo-summary` and `GET /api/seo/city-page` serve aggregated data for FE generateStaticParams + per-page render. Data is cached by Vercel ISR (1 hr). No R2 involvement.

**City-page cost characteristics:**
- 2 main aggregations (events by category, organizers by event count)
- 1 secondary find for recurring events (post-aggregation in JS for RRULE expansion)
- 1 $geoNear for nearby cities
- ~500ms per call typical, scales linearly with city event volume

---

## Webhook (P3a, in design — CALBEAF-161)

On event mutation (Events_Create / Events_Update / Events_Delete), BE will fire:

```
POST tangotiempo.com/api/revalidate?path=/tango/{parentSlug}/{citySlug}
```

so Next.js ISR refreshes within seconds instead of waiting for the 1-hour stale window. Path computation uses geo-summary's `parentSlug` field (state for US, country for international).

**v1 design:** every mutation fires; Vercel revalidate is idempotent.
**v2 (only if needed):** per-path coalesce in a `needs-revalidate` collection drained by 1-min timer.
**Porter bulk-load handling:** either `bulkOp: true` flag on writes (BE skips fire) or 30s coalesce window.

---

## Key Decisions Log

- **2026-04-29** Per-event R2 pipeline shipped under CALBEAF-157/158/159
- **2026-04-30** P6 (T1 → R2) explicitly skipped — Vercel ISR handles 100s of cities fine; React-rich city pages can't cleanly emit static HTML
- **2026-04-30** P7 (Cloudflare Worker apex routing) deferred with explicit gate — canary subdomain → A/B Worker → cutover; never apex Worker without 2-4 weeks of canary data
- **2026-04-30** CALBEAF-166 added RRULE expansion to city-page so recurring-anchored events become visible (Boston ULTIMATE Tango 14 weekly series, etc.)

---

## Cross-References

- Strategy: `MasterCalendar/docs/SEO-STRATEGY.md`
- Date contract: see CLAUDE.md "MasterCalendar date contract" section
- Function naming: `docs/FUNCTION-NAMING-STANDARD.md`
- Branching/deploy: `MasterCalendar/docs/GIT-BRANCHING-STRATEGY.md`, `MasterCalendar/docs/PROD-DEPLOY-PROTECTION.md`
