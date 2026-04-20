---
date: 2026-04-20
persona: fulton
type: rollout
state: active
feature: ["venues-automaster", "data-quality-gate", "city-country-discipline"]
keywords: ["calbeaf-118", "calbeaf-116", "prod-deploy", "corpus", "backfill"]
appid: global-be
app: "[[APP-Global-CalendarBEAF]]"
audience: all
permanence: milestone
tags: [type/rollout, type/promotion, app/global]
git:
  repo: "calendar-be-af"
  branch: "TEST"
  commit: "16dd2a46"
---
# PROD Runbook — calendar-be-af v1.28.1

**Gate:** Toby explicit G1 auth required before ANY step.  
**Scope:** Backend only. TT 2.0 frontend is a separate cut (Initiative B).  
**PROD branch:** `PROD` · Azure app: `calendarbeaf-prod`  
**TEST state:** v1.28.1 · 126/126 tests pass · PROD-replayable via artifact timestamps

---

## Overview — Four Phases

```
1. DATA UPLIFT    → Load dimensional corpus into PROD Mongo (masteredXXX)
2. CODE DEPLOY    → Push v1.28.1 to Azure Functions PROD
3. DATA BACKFILL  → Retroactively enrich existing PROD venues + events
4. ONGOING        → Inline enrichment on all future creates/updates (automatic)
```

**Order matters:** Uplift before Code, Code before Backfill, Backfill before declaring done.

---

## Phase 1 — Data Uplift (masteredXXX collections)

**What:** Populate PROD MongoDB with the dimensional corpus built on TEST.  
**Risk:** LOW — additive only, no overwrites, no user-facing impact.  
**Duration:** ~2 min.

### What goes in

| Script | Contents |
|--------|----------|
| `scripts/corpus-expansion-2026-04-20.js` | 8 countries, 11 regions, 11 divisions, 12 cities (Vienna, Athens, Oslo, Budapest, Dublin, Copenhagen, Amsterdam, Brussels, Belgrade, Bucharest, Zurich, Adelaide, Hobart) |
| `scripts/corpus-expansion-2026-04-20b.js` | 5 countries (TH/CZ/UA/LT/LB), 6 divisions incl. SG fix, 9 cities (Bangkok, Prague, Kyiv, Canberra, Darwin, Cairns, Vilnius, Beirut, Singapore-rewire) |

### Commands

```bash
# Dry-run both (verify against PROD — should be all INSERTs, no SKIPs)
node scripts/corpus-expansion-2026-04-20.js --env=prod
node scripts/corpus-expansion-2026-04-20b.js --env=prod

# Apply (Toby auth)
node scripts/corpus-expansion-2026-04-20.js --env=prod --apply
node scripts/corpus-expansion-2026-04-20b.js --env=prod --apply
```

> **Note:** Scripts currently read `MONGODB_URI_TEST`. Before running against PROD, verify they
> accept `--env=prod` OR temporarily point `MONGODB_URI_PROD` at the PROD cluster URI.
> Check `local.settings.json` for `MONGODB_URI_PROD`.

### Verify

```bash
node -e "
const { MongoClient } = require('mongodb');
const uri = require('./local.settings.json').Values.MONGODB_URI_PROD;
(async () => {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const countries = await db.collection('masteredcountries').countDocuments();
  const cities = await db.collection('masteredcities').countDocuments();
  const divisions = await db.collection('mastereddivisions').countDocuments();
  console.log('countries:', countries, '| cities:', cities, '| divisions:', divisions);
  await client.close();
})();
"
# Expected: countries ~33+ | cities ~40+ | divisions ~30+
```

---

## Phase 2 — Code Deploy

**What:** Merge TEST → PROD branch, deploy v1.28.1 to `calendarbeaf-prod` Azure Functions.  
**Risk:** MEDIUM — touches live endpoints (Events_Create, Events_Update, Venues).  
**Duration:** ~10 min (includes zip build + upload).  
**Rollback:** Azure slot-swap to previous deployment (~2 min).

### What's in v1.28.1

| Component | What it does |
|-----------|-------------|
| `venuesAutoMaster.js` (shared helper) | City/country resolution from geolocation — used by all writers |
| `Venues.js` POST hook | Auto-master on venue create |
| `Venues.js` PUT hook | Auto-master on venue update, null-clear stale mastered fields |
| `Venue_AdminAdd.js` hook | Auto-master on admin venue add |
| `Events_BulkEnrich.js` | D-arch bulk enrichment endpoint |
| `DQ_PeriodicChecker.js` | Timer function — Tier-2 periodic re-check |
| `Events_Create.js` / `Events_Update.js` | Phase 6 inline classification wire-in |
| `enrichment.js` | Europe chain-fix (division-bypass in chainFromCity) |

### Commands

```bash
# Step 1: Merge TEST → PROD (requires DEPLOY-PROD confirmation)
git checkout PROD
git merge --no-ff TEST -m "Merge TEST→PROD: v1.28.1 (CALBEAF-116+118 Venues_AutoMaster + Europe chain-fix + PUT hook)"
git push origin PROD

# Step 2: Build deploy zip (node_modules MUST be included — func CLI won't work)
npm ci --production
zip -r /tmp/deploy-v1.28.1.zip . \
  -x "*.git*" -x ".github/*" -x "test/*" -x "docs/*" -x "scripts/*" \
  -x "*.md" -x ".claude/*" -x ".mcp.json"

# Step 3: Deploy via az CLI
az functionapp deployment source config-zip \
  --name calendarbeaf-prod \
  --resource-group <RG-NAME> \
  --src /tmp/deploy-v1.28.1.zip

# Step 4: Verify functions loaded
az functionapp function list --name calendarbeaf-prod --resource-group <RG-NAME> \
  | jq '.[].name' | sort
# Expected: Events, Events_BulkEnrich, DQ_PeriodicChecker, Venues, Venue_AdminAdd, etc.
```

### Smoke test

```bash
# Hit a live endpoint (adjust base URL)
curl -s "https://calendarbeaf-prod.azurewebsites.net/api/Events?appId=1&limit=1" | jq '.length'
# Expected: 1 (returns data, not 404 or 500)
```

---

## Phase 3 — Data Backfill

**What:** Retroactively enrich all existing PROD venues and events with mastered fields.  
**Risk:** MEDIUM-HIGH — writes to every venue and every event on PROD.  
**Duration:** ~5-20 min depending on PROD collection sizes.  
**Protocol:** Dry-run → Toby review → explicit `--apply` auth for EACH script separately.

### Step 3a — Venue mastering

```bash
# Dry-run (always first)
node scripts/venues-automaster-batch.js --env=prod --dry-run

# Review artifact: Collab/reviews/venues-automaster-dryrun-{timestamp}.json
# Check: AUTO_HIGH count, AUTO_MEDIUM count, MANUAL count
# PROD should be similar profile to TEST (85% city / 91% country target)

# Apply (Toby auth)
node scripts/venues-automaster-batch.js --env=prod --apply --track-a-cleared
```

**Expected PROD outcome:** ~85% masteredCityId · ~91% masteredCountryId (matching TEST profile).

### Step 3b — Event enrichment backfill

```bash
# Dry-run
node scripts/runDataQualityBackfill.js --env=prod --dry-run

# Review: total events, enrichmentStatus distribution, forBeginners/beginnerFriendly counts

# Apply (Toby auth — separate explicit authorization from 3a)
node scripts/runDataQualityBackfill.js --env=prod --apply --appId=1
node scripts/runDataQualityBackfill.js --env=prod --apply --appId=2
```

**Expected PROD outcome:** ~88% event masteredCityId · ~89% masteredCountryId (matching TEST profile).

### Verify backfill

```bash
node -e "
const { MongoClient } = require('mongodb');
const uri = require('./local.settings.json').Values.MONGODB_URI_PROD;
(async () => {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const vTotal = await db.collection('venues').countDocuments();
  const vCity  = await db.collection('venues').countDocuments({ masteredCityId: { \$exists:true, \$ne:null } });
  const eTotal = await db.collection('events').countDocuments();
  const eCity  = await db.collection('events').countDocuments({ masteredCityId: { \$exists:true, \$ne:null } });
  console.log('Venues: ' + vCity + '/' + vTotal + ' (' + (vCity/vTotal*100).toFixed(1) + '% city)');
  console.log('Events: ' + eCity + '/' + eTotal + ' (' + (eCity/eTotal*100).toFixed(1) + '% city)');
  await client.close();
})();
"
```

---

## Phase 4 — Ongoing (Automatic After Phase 2)

No manual action required. The new code handles everything inline.

| Trigger | Handler | What happens |
|---------|---------|-------------|
| `POST /api/Venues` | `Venues.js` POST hook | New venue auto-mastered on create |
| `PUT /api/Venues/:id` | `Venues.js` PUT hook | Updated venue re-mastered, stale fields null-cleared |
| `POST /api/Events` | Phase 6 inline | New event classified (forBeginners, beginnerFriendly, travelWorthy, enrichmentStatus=complete) |
| `PUT /api/Events/:id` | Phase 6 inline | Updated event re-classified |
| Timer (DQ_PeriodicChecker) | Tier-2 cron | Periodically re-checks events with enrichmentStatus=pending/failed |
| `POST /api/Events_BulkEnrich` | BulkEnrich endpoint | Manual or Porter-triggered batch re-enrichment |

**Monitoring:** Application Insights `bulk_enrich.*` + `dq_checker.*` metrics. Degraded-mode rate target < 1%.

---

## Rollback Plan

| Phase | Rollback | Time |
|-------|---------|------|
| Phase 1 (Uplift) | Drop inserted dimensional docs by insertedId batch | ~5 min |
| Phase 2 (Code) | Azure slot-swap to previous deployment | ~2 min |
| Phase 3a (Venue backfill) | Re-run with `--revert` OR restore from pre-backfill snapshot | ~10 min |
| Phase 3b (Event backfill) | Field-level: drop `enrichmentStatus`/`forBeginners`/`beginnerFriendly` where `masteringAppliedAt > cutoff` | ~5 min script |

---

## Gate Summary

| Gate | Who | What |
|------|-----|------|
| **G1** | Toby | Authorize entire sequence — lifts PROD hard rail |
| **G1a** | Toby | Explicit "apply" on Phase 1 corpus scripts |
| **G1b** | Toby | Explicit "apply" on Phase 2 merge + deploy |
| **G1c** | Toby | Explicit "apply" on Phase 3a venue backfill (after dry-run review) |
| **G1d** | Toby | Explicit "apply" on Phase 3b event backfill (after dry-run review) |

Each gate is separate. Toby reviews the dry-run artifact before each `--apply`.

---

## Open Items Before G1

- [ ] Confirm `MONGODB_URI_PROD` is set in `local.settings.json` (or ENV)
- [ ] Confirm Azure resource group name for `calendarbeaf-prod`
- [ ] Confirm corpus scripts accept `--env=prod` flag (currently hardcoded to TEST URI — may need a quick patch)
- [ ] CALBEAF-119 (A2 — Estonia + ~20 missing countries): not blocking this PROD cut, but needed before CALBEAF-128 European corpus additions land on PROD

---

*Fulton — 2026-04-20. PROD stay-out until Toby G1.*
