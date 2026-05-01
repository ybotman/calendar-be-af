# CALBEAF-169 — SEO Build Trickle Pattern

**Owner:** Fulton (calendar-be-af)
**JIRA:** CALBEAF-169
**Status:** In progress (started 2026-05-01)
**Last updated:** 2026-05-01

> **This doc is a live runbook + checkpoint tracker.** Update each stage as work proceeds. Optimized for resuming after a session restart — Mission, Goals, Design, and Current Status are all here.

---

## Mission

T2 (per-event SEO HTML) is the durable PROD-served, BE-rendered, R2-stored content layer that powers TangoTiempo's organic search and AI-search visibility. Per the converged SEO strategy (`MasterCalendar/docs/SEO-STRATEGY.md`), R2 IS the canonical content store for per-event pages. **It currently has 0 files because the full-corpus build doesn't fit in any single Azure Functions invocation.**

This work makes T2 actually populate and stay fresh.

## Goals (success criteria)

1. **Initial PROD R2 corpus populated within ~3 days** of deploy
2. **Steady state: every event refreshed every ~24h** (so AI/users see current data)
3. **Operationally observable** — can know what's been built and when, per event
4. **Manually controllable** — can trigger one event, one city, or one segment for QA / debugging without affecting cron behavior
5. **Self-healing** — partial failures don't permanently miss events; idempotent retry-safe writes
6. **No breaking change to existing endpoints** — only additions to SEO_BuildContent.js + new event field

---

## Design

### State tracking (the resume marker)

Add **optional** field to events collection (raw write, no Mongoose schema change required):

```
seoLastBuiltAt: Date
```

Stamped after a successful R2 write of the event's primary HTML key. Events with null/missing or stale `seoLastBuiltAt` are eligible to render. Events younger than the threshold are skipped.

### Trickle cron (replaces nightly)

| Setting | Value |
|---------|-------|
| Old schedule | `0 0 3 * * *` (3 AM UTC, single shot — TIMES OUT on PROD) |
| **New schedule** | `0 */30 0-5 * * *` (every 30 min between 00:00–06:00 UTC) |
| Invocations per day | 12 |
| Batch per invocation | 100 events |
| Refresh threshold | 23h (events younger than this are skipped) |
| Daily throughput | ~1,200 events × ~3 occurrences each ≈ ~3,600 R2 writes/day |
| Initial corpus catch-up | ~3 days for 5,339 events |
| Steady-state refresh | every event re-rendered ~once per 24h |

### Manual HTTP trigger modes

`POST /api/ops/seo/build` with optional query params:

| Mode | Required params | Behavior |
|------|----------------|----------|
| `mode=event` | `eventId=X` | One event (with all RRULE occurrences). For QA / debugging. |
| `mode=city` | `citySlug=X` (or `masteredCityId=X`) | All events for one city. Boston ~3 min, smaller cities < 30s. |
| `mode=segment` | `segment=milonga\|practica\|travelworthy\|beginner` | One segment slice. |
| `mode=trickle` | (none) | Same logic as cron — useful manual top-up if cron is lagging. Skips events with fresh `seoLastBuiltAt`. |
| `mode=all` | (none, default for safety) | Full corpus. Will time out on PROD. Provided for emergencies / TEST. |

Default mode = `all` (preserves legacy behavior for any existing automation).

### Concurrency & timeouts

- Sequential per invocation (no parallelism within a single function call) — keeps memory bounded, easier to reason about
- Function timeout (`host.json`): set to 600s (10 min, the max on Consumption)
- Per-event timeout: not enforced — relies on R2 PUT being typically < 1s
- Errors logged per event, batch continues

### Idempotency & failure modes

| Scenario | Behavior |
|----------|----------|
| R2 PUT fails for one event | Logged, error counter++, batch continues. `seoLastBuiltAt` NOT stamped. Event picked up next trickle. |
| Cron invocation hits timeout mid-batch | Whatever was written has `seoLastBuiltAt` stamped. Next trickle resumes from oldest stale events. |
| Same event rendered twice | Idempotent — R2 PUT overwrites the same key. No duplicates. |
| Event deleted in MongoDB | R2 file becomes orphaned (separate cleanup job out of scope). |
| RRULE parse error | Per-event errors counter, no `seoLastBuiltAt` stamp, retried next trickle. |
| `SEO_WRITES_ENABLED=false` | All writes skipped silently, `seoLastBuiltAt` NOT stamped. |

---

## Implementation Stages

### Stage 1 — Code changes ✅ COMPLETE 2026-05-01

- [x] Template URL bug fix: `/events/` → `/event/` in `seoTemplates.js` (singular, matches TT FE route)
- [x] Add `mode` param parsing to manual HTTP trigger handler in `SEO_BuildContent.js`
- [x] Add `TRICKLE_BATCH_PER_SEGMENT` constant (25 → ~100/invocation across 4 segments) and `REBUILD_AFTER_HOURS` constant (23)
- [x] Modify `processSegment` to accept `opts={mode, eventId, masteredCityId, segment}` and apply filter:
  - `mode='event'` → `_id: ObjectId(eventId)` filter
  - `mode='city'` → `masteredCityId: ObjectId(cityId)` filter
  - `mode='trickle'` → `$or: [{seoLastBuiltAt: { $lt: horizon }}, {seoLastBuiltAt: { $exists: false }}]` + sort + limit BATCH_SIZE
  - `mode='segment'` → skip non-matching segment iterations
  - `mode='all'` → no extra filter (legacy)
- [x] After successful R2 write of primary key, stamp `seoLastBuiltAt: now` on event doc (only if writtenForThisEvent > 0)
- [x] Main handler resolves `citySlug` → `masteredCityId` once per niche before iterating segments
- [x] Handler returns `{ mode, niches: summary, elapsed }` for HTTP visibility
- [x] Update timer trigger to call handler with `{ mode: 'trickle' }`
- [x] Update `host.json` `functionTimeout` to `00:10:00`
- [x] Update cron schedule from `0 0 3 * * *` to `0 */30 0-5 * * *`
- [x] Bump `package.json` version to `v1.31.1`
- [x] Syntax check passes on SEO_BuildContent.js and seoTemplates.js

### Stage 2 — TEST deploy + smoke

- [ ] `git commit` + push to TEST
- [ ] Wait for CI deploy to complete
- [ ] Verify: `POST /api/ops/seo/build?mode=event&eventId=<known-test-event>` returns 200, R2 receives 1 file (or skip if SEO_WRITES_ENABLED not set on TEST)
- [ ] Verify response shape: `{ mode, niche, segments: [...], duration, ... }`

### Stage 3 — PROD deploy (DEPLOY-PROD authorized)

- [ ] Create PR TEST → PROD
- [ ] Toby merges
- [ ] CI deploys
- [ ] Smoke regression against pre-deploy baseline (use baseline from Phase 1)

### Stage 4 — PROD validation (the actual goal)

- [ ] **Step 4.1:** `POST /api/ops/seo/build?mode=event&eventId=685331b5a1e3cfb6f8bbadca` (Milonga TRANOCHANDO, Boston)
  - Expected: ~1-3 R2 files written (depending on RRULE), HTTP 200 in < 5s
  - Verify: `curl seo.tangotiempo.com/milonga/RO/685331b5a1e3cfb6f8bbadca.html` → 200
  - Verify: event doc shows `seoLastBuiltAt` set
- [ ] **Step 4.2:** `POST /api/ops/seo/build?mode=city&citySlug=boston`
  - Expected: ~240 events × ~3 occurrences = ~720 R2 files, ~3-4 min runtime (probably hits 230s gateway but function continues to write)
  - Verify a sample: 5 random Boston events have R2 pages
  - Verify a sample: 5 events have `seoLastBuiltAt` set
- [ ] **Step 4.3:** Wait for first cron at 00:00 UTC, watch logs
  - Expected: ~100 events processed, ~90s runtime
  - Verify counter via Application Insights query
- [ ] **Step 4.4:** Day 2 — verify cumulative progress
  - `db.events.countDocuments({seoLastBuiltAt: { $exists: true }})` should be growing
- [ ] **Step 4.5:** Day 3-4 — verify full corpus
  - Most/all eligible events have `seoLastBuiltAt`

### Stage 5 — Observability + alarms (post-launch)

- [ ] Add Application Insights query: cron success rate, batch sizes, error rates
- [ ] Alert if 24h passes with 0 successful writes (cron broken)
- [ ] (deferred) Cleanup job for orphaned R2 files

---

## Current Status (UPDATE THIS AS YOU WORK)

**Date:** 2026-05-01

**Where we are:**
- ✅ Workplan doc created
- ✅ CALBEAF-169 JIRA ticket cut
- ✅ **Stage 1 — Code changes COMPLETE** (template URL fix, mode/scope, state tracking, trickle cron, citySlug resolution, host.json timeout, version bump v1.31.1)
- ⏳ Stage 2 — TEST deploy (next)
- ⏳ Stage 3 — PROD deploy
- ⏳ Stage 4 — PROD validation (4.1 → 4.5)

**Next concrete action:**
Stage 2 — `git commit` + `git push origin TEST`, wait for CI deploy, smoke-test on TEST.

**Authorization status:**
- DEPLOY-PROD: granted by Toby earlier this session for v1.31.0 (Phase 1 already shipped). For this v1.31.1, need fresh DEPLOY-PROD before merging the TEST → PROD PR.
- SEO_WRITES_ENABLED on PROD: `true` (verified)
- All R2 env vars on PROD: ✅ verified

**Blockers:** none currently.

---

## Resume Instructions (for restart / new session)

If picking this up fresh:

1. **Read this doc top to bottom**
2. **Check git state:** `git log --oneline -5` to see what's committed; `git status` for uncommitted work
3. **Check JIRA CALBEAF-169** for any comments
4. **Find current stage** in "Current Status" above
5. **Continue from "Next concrete action"**
6. **Update this doc** as you progress — preserves continuity for the NEXT restart

Key files:
- `src/functions/SEO_BuildContent.js` — main logic (cron + manual handlers)
- `src/utils/seoTemplates.js` — template engine (URL bug already fixed here)
- `src/utils/r2Client.js` — R2 wrapper (unchanged, but verify env var read)
- `host.json` — function timeout config (may need update to 10 min)

Key endpoints once shipped:
- `POST /api/ops/seo/build?mode=event&eventId=X&code=<key>` — single event
- `POST /api/ops/seo/build?mode=city&citySlug=X&code=<key>` — single city
- `POST /api/ops/seo/build?mode=trickle&code=<key>` — manual cron-equivalent
- Timer trigger fires automatically every 30 min during 00:00-06:00 UTC

Sample event ID for Stage 4.1 smoke: `685331b5a1e3cfb6f8bbadca` (Boston Milonga TRANOCHANDO)

---

## Decisions Log

- 2026-05-01 18:30Z — Toby authorized full chunked-build implementation. "We will have to restart I suspect" — workplan doc structure designed for restart resilience.
- 2026-05-01 18:35Z — Selected per-event state tracking via `seoLastBuiltAt` field on event doc (vs separate `seo_build_state` collection). Simpler, no migration needed, atomic with the write.
- 2026-05-01 18:35Z — Default manual mode is `all` (legacy behavior preserved). Cron switches to `trickle`.
- 2026-05-01 18:36Z — Cron schedule changed from `0 0 3 * * *` (1×/day) to `0 */30 0-5 * * *` (12×/day). Off-peak window only, doesn't compete with backup crons.
