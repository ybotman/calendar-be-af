# Runbook: PROD → TEST Data Sync + Classification

**Owner:** Fulton (calendar-be-af)
**Last Updated:** 2026-04-17
**When to use:** Refreshing TEST with fresh PROD data (e.g., before QA cycles, after major PROD data changes, periodic refresh)

---

## Overview

This is a 3-step operational procedure:
1. Copy PROD MongoDB data to TEST (with backups)
2. Re-run event classification backfill (travelWorthy, country denormalization)
3. Re-run beginner keyword scan (beginnerFriendly, forBeginners)

Steps 2 and 3 are required because PROD events don't have the CALBEAF-109 classification fields yet (until PROD backfill is approved). Even after PROD backfill, step 3 (keyword scan) is not in the automated pipeline — it's an operational pass.

**Total time:** ~2 minutes for typical dataset sizes.

---

## Prerequisites

- Node.js installed
- Working directory: `calendar-be-af/`
- `local.settings.json` must contain:
  - `MONGODB_URI` — TEST database connection string (TangoTiempoTest)
  - `MONGODB_URI_PROD` — PROD database connection string (TangoTiempoProd)

---

## Step 1: PROD → TEST Sync

### Dry run (ALWAYS do this first)

```bash
node scripts/syncProdToTest.js --dry-run --include-events --events-future
```

Review output: check collection counts, confirm correct databases (TangoTiempoProd → TangoTiempoTest).

### Apply

```bash
# Dimensional + master data + future events
node scripts/syncProdToTest.js --include-events --events-future
```

**What happens:**
- Existing TEST collections renamed to `{name}_backup_{timestamp}` (not deleted)
- PROD data copied to fresh TEST collections
- 2dsphere geo indexes automatically recreated on masteredcities, venues, and events (added after 503 incident 2026-04-17)
- Collections synced: categories, masteredcities, masteredcountries, mastereddivisions, masteredregions, organizers, roles, venues, events

**Other options:**

```bash
# Dimensional data only (no events)
node scripts/syncProdToTest.js

# All events (historical + future)
node scripts/syncProdToTest.js --include-events --events-all

# Events + users
node scripts/syncProdToTest.js --include-transactional

# Date range
node scripts/syncProdToTest.js --include-events --events-from 2026-01-01 --events-to 2026-12-31
```

### Verify

```bash
curl -s "https://calendarbeaf-test.azurewebsites.net/api/events?appId=1&limit=1" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
console.log('Events on TEST:', d.pagination.total);
"
```

---

## Step 2: Classification Backfill (travelWorthy + country)

After syncing PROD data, events won't have classification fields. Run the backfill.

### Dry run

```bash
node scripts/backfill-classification.js --env=test
```

### Apply

```bash
node scripts/backfill-classification.js --env=test --apply --skip-indexes
```

Use `--skip-indexes` if indexes already exist from a prior run. Omit it on first-ever run to create the 3 required indexes.

**What it does:**
- Computes `travelWorthy` per rule: `(duration > 24h) AND (category NOT IN [Class, Milonga, Practica])`
- Defaults `beginnerFriendly` to `false` (keyword scan in step 3 overrides)
- Denormalizes `masteredCountryId` + `masteredCountryName` from region chain
- Sets override fields to `null`

---

## Step 3: Beginner Keyword Scan (beginnerFriendly + forBeginners)

This scans event titles and descriptions for beginner-related keywords and sets two flags:

- **beginnerFriendly** = event welcomes beginners
- **forBeginners** = event IS a beginner class

### Run

```bash
node -e "
const { MongoClient } = require('mongodb');
const settings = require('./local.settings.json');
const uri = settings.Values.MONGODB_URI;

const FRIENDLY_PATTERNS = [
    /beginners?\s*welcome/i,
    /no\s*experience\s*(needed|necessary|required)/i,
    /open\s*to\s*all\s*levels?/i,
    /all\s*levels?\s*welcome/i,
    /beginner\s*friendly/i,
    /first\s*time\s*(dancers?|welcome)/i,
    /never\s*danced/i,
    /new\s*to\s*tango/i
];

const FOR_BEGINNERS_PATTERNS = [
    /beginner\s*class/i,
    /beginner\s*workshop/i,
    /intro\s*to\s*tango/i,
    /introduction\s*to\s*tango/i,
    /fundamentals/i,
    /level\s*1\b/i,
    /absolute\s*beginners?/i,
    /beginner.?intermediate/i,
    /\bbeg\b.*\bint\b/i
];

function matchesAny(text, patterns) {
    if (!text) return false;
    return patterns.some(p => p.test(text));
}

(async () => {
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db();
    const events = db.collection('events');
    const allEvents = await events.find({ appId: '1' }).project({ _id: 1, title: 1, description: 1 }).toArray();

    let friendlyIds = [], forBegIds = [], bothIds = [];
    for (const e of allEvents) {
        const text = (e.title || '') + ' ' + (e.description || '');
        const isFriendly = matchesAny(text, FRIENDLY_PATTERNS);
        const isForBeg = matchesAny(text, FOR_BEGINNERS_PATTERNS);
        if (isFriendly && isForBeg) bothIds.push(e._id);
        else if (isFriendly) friendlyIds.push(e._id);
        else if (isForBeg) forBegIds.push(e._id);
    }

    if (friendlyIds.length > 0) await events.updateMany({ _id: { \\\$in: friendlyIds } }, { \\\$set: { beginnerFriendly: true } });
    if (forBegIds.length > 0) await events.updateMany({ _id: { \\\$in: forBegIds } }, { \\\$set: { forBeginners: true } });
    if (bothIds.length > 0) await events.updateMany({ _id: { \\\$in: bothIds } }, { \\\$set: { beginnerFriendly: true, forBeginners: true } });

    const bfTrue = await events.countDocuments({ appId: '1', beginnerFriendly: true });
    const fbTrue = await events.countDocuments({ appId: '1', forBeginners: true });
    console.log('Scanned:', allEvents.length);
    console.log('beginnerFriendly=true:', bfTrue);
    console.log('forBeginners=true:', fbTrue);
    await client.close();
})();
"
```

**Keyword split (Toby directive 2026-04-17):**

| beginnerFriendly (welcomes beginners) | forBeginners (IS a beginner class) | NOT used (separate concept) |
|---|---|---|
| beginners welcome | beginner class | no partner needed |
| no experience needed | beginner workshop | no partner necessary |
| open to all levels | intro to tango | no partner required |
| all levels welcome | fundamentals | |
| beginner friendly | level 1 | |
| first time dancers | absolute beginners | |
| never danced | beginner/intermediate | |
| new to tango | | |

---

## Step 4: Verify

```bash
# Check travelWorthy filter
curl -s "https://calendarbeaf-test.azurewebsites.net/api/events?appId=1&travelWorthy=true&limit=3" | \
  node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); \
  console.log('travelWorthy=true:', d.pagination.total); \
  d.events.slice(0,3).forEach(e => console.log(' ', e.title, '|', e.travelWorthy));"

# Check beginnerFriendly filter
curl -s "https://calendarbeaf-test.azurewebsites.net/api/events?appId=1&beginnerFriendly=true&limit=3" | \
  node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); \
  console.log('beginnerFriendly=true:', d.pagination.total);"

# Check forBeginners filter
curl -s "https://calendarbeaf-test.azurewebsites.net/api/events?appId=1&forBeginners=true&limit=3" | \
  node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); \
  console.log('forBeginners=true:', d.pagination.total);"
```

---

## Cleanup (optional)

Backup collections accumulate over time. To clean up old backups:

```bash
# List backup collections in TEST
node -e "
const { MongoClient } = require('mongodb');
const s = require('./local.settings.json');
(async () => {
    const c = new MongoClient(s.Values.MONGODB_URI);
    await c.connect();
    const cols = await c.db().listCollections().toArray();
    cols.filter(c => c.name.includes('_backup_')).forEach(c => console.log(c.name));
    await c.close();
})();
"

# Drop a specific backup (manual, one at a time)
# mongosh "MONGODB_URI" --eval "db.events_backup_2026-04-17T03-46-11-353Z.drop()"
```

---

## Notes

- This procedure does NOT push code — it only syncs MongoDB data
- TEST Azure Functions deployment is separate (GitHub Actions auto-deploys on push to TEST branch)
- PROD backfill of classification fields is a separate decision requiring Toby approval
- The keyword scan (step 3) is an operational pass, not automated in the API — new events get classification on create/update but NOT keyword scanning (that's organizer-set via checkbox)
