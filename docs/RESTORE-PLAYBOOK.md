---
date: 2026-04-20
persona: fulton
type: operations
state: active
feature: ["backup", "restore", "mongodb"]
keywords: ["restore", "backup", "mongodb-backups", "azure-blob", "disaster-recovery"]
appid: global
audience: all
permanence: durable
git:
  repo: "calendar-be-af"
  branch: "PROD"
---

# MongoDB Restore Playbook

**Scope:** calendar-be-af · Azure Blob Storage backups (`mongodb-backups` container)  
**Tested against:** TangoTiempoTest (TEST environment)  
**Backup schedule:** Daily 3am EST via `Backup_MongoDB` Azure Function timer  
**Retention:** 7 daily · 4 weekly · 12 monthly · 3 yearly

---

## Prerequisites

```bash
# Confirm backup container is accessible
node scripts/list-azure-backups.js

# Confirm MongoDB connection
node -e "
const { MongoClient } = require('mongodb');
const s = require('./local.settings.json');
const uri = s.Values.MONGODB_URI_TEST; // or MONGODB_URI_PROD
const client = new MongoClient(uri);
client.connect().then(() => { console.log('Connected'); client.close(); });
"
```

---

## Part 1 — List Available Backups

```bash
node scripts/list-azure-backups.js
```

Output shows all blobs in `mongodb-backups` container sorted newest-first, with filename, timestamp, and size.

Filename format: `YYYY-MM-DDTHH-MM-SS_DatabaseName.json.gz`

---

## Part 2 — Download a Backup File

```bash
# Set these for your session
BACKUP_FILE="2026-04-20T23-36-26_TangoTiempoProd.json.gz"
LOCAL_PATH="/tmp/${BACKUP_FILE}"

node -e "
const { BlobServiceClient } = require('@azure/storage-blob');
const fs = require('fs');
const s = require('./local.settings.json');

const connStr = s.Values.AZURE_STORAGE_CONNECTION_STRING ||
  \`DefaultEndpointsProtocol=https;AccountName=\${s.Values.AZURE_STORAGE_ACCOUNT_NAME};AccountKey=\${s.Values.AZURE_STORAGE_ACCOUNT_KEY};EndpointSuffix=core.windows.net\`;

const client = BlobServiceClient.fromConnectionString(connStr)
  .getContainerClient('mongodb-backups')
  .getBlobClient('${BACKUP_FILE}');

client.downloadToFile('${LOCAL_PATH}').then(() => console.log('Downloaded to ${LOCAL_PATH}'));
"
```

---

## Part 3 — Decompress and Inspect

```bash
# Decompress
gunzip -c ${LOCAL_PATH} > /tmp/backup.json

# Check metadata (collections + counts)
node -e "
const data = require('/tmp/backup.json');
console.log('Database:', data._metadata.databaseName);
console.log('Exported:', data._metadata.exportedAt);
console.log('');
data._metadata.collections.forEach(c => console.log(\`  \${c.name}: \${c.count} docs\`));
"
```

---

## Restore Scenario A — Full Database

> **When to use:** Catastrophic data loss or corruption across all collections.  
> **Risk:** Overwrites ALL documents in every collection. Run against TEST first.

### Step 1 — Confirm target

```bash
# Always confirm which DB you are targeting before restore
node -e "
const s = require('./local.settings.json');
console.log('TEST URI DB:', s.Values.MONGODB_URI_TEST?.match(/\/([^/?]+)(\?|$)/)?.[1]);
console.log('PROD URI DB:', s.Values.MONGODB_URI_PROD?.match(/\/([^/?]+)(\?|$)/)?.[1]);
"
```

### Step 2 — Restore (TEST)

```bash
node -e "
const { MongoClient } = require('mongodb');
const fs = require('fs');
const s = require('./local.settings.json');

// CHANGE to MONGODB_URI_PROD only after TEST validated
const uri = s.Values.MONGODB_URI_TEST;
const data = JSON.parse(require('fs').readFileSync('/tmp/backup.json', 'utf8'));

(async () => {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();

  for (const [collName, docs] of Object.entries(data.collections)) {
    if (!docs.length) { console.log(\`Skipping \${collName} (empty)\`); continue; }

    const coll = db.collection(collName);

    // Drop and recreate (full restore)
    await coll.drop().catch(() => {}); // ignore if not exists
    const result = await coll.insertMany(docs);
    console.log(\`\${collName}: restored \${result.insertedCount} docs\`);
  }

  await client.close();
  console.log('Full restore complete.');
})();
"
```

### Step 3 — Verify

```bash
node -e "
const { MongoClient } = require('mongodb');
const s = require('./local.settings.json');
const uri = s.Values.MONGODB_URI_TEST;

(async () => {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const colls = ['events','organizers','Venues','users','categories','masteredlocations','roles'];
  for (const name of colls) {
    const count = await db.collection(name).countDocuments();
    console.log(\`\${name}: \${count}\`);
  }
  await client.close();
})();
"
```

---

## Restore Scenario B — Single Collection

> **When to use:** One collection corrupted or accidentally bulk-deleted.  
> **Risk:** Overwrites the target collection only. Safe for surgical recovery.

```bash
# Set collection name
COLLECTION="Venues"   # options: events, organizers, Venues, users, categories, masteredlocations, roles

node -e "
const { MongoClient } = require('mongodb');
const s = require('./local.settings.json');
const uri = s.Values.MONGODB_URI_TEST;   // swap to MONGODB_URI_PROD for PROD
const data = JSON.parse(require('fs').readFileSync('/tmp/backup.json', 'utf8'));
const collName = '${COLLECTION}';
const docs = data.collections[collName];

if (!docs) { console.error('Collection not found in backup:', collName); process.exit(1); }

(async () => {
  const client = new MongoClient(uri);
  await client.connect();
  const coll = client.db().collection(collName);

  await coll.drop().catch(() => {});
  const result = await coll.insertMany(docs);
  console.log(\`\${collName}: restored \${result.insertedCount} docs\`);

  await client.close();
})();
"
```

**Verify:**

```bash
node -e "
const { MongoClient } = require('mongodb');
const s = require('./local.settings.json');
const uri = s.Values.MONGODB_URI_TEST;
(async () => {
  const client = new MongoClient(uri);
  await client.connect();
  const count = await client.db().collection('${COLLECTION}').countDocuments();
  console.log('${COLLECTION} count:', count);
  await client.close();
})();
"
```

---

## Restore Scenario C — Single Document (Event)

> **When to use:** One event accidentally deleted or corrupted. The most common recovery case.  
> **Risk:** Inserts or overwrites one document. Minimal blast radius.

### Find the document in the backup

```bash
# Search by event name (partial match)
node -e "
const data = JSON.parse(require('fs').readFileSync('/tmp/backup.json', 'utf8'));
const events = data.collections['events'] || [];
const term = 'Milonga';   // ← change to event name or partial name

const matches = events.filter(e =>
  (e.title || e.name || '').toLowerCase().includes(term.toLowerCase())
);
console.log(\`Found \${matches.length} match(es):\`);
matches.forEach(e => console.log(\`  _id:\${e._id} | \${e.title||e.name} | \${e.startDate}\`));
"

# Or search by _id directly
node -e "
const data = JSON.parse(require('fs').readFileSync('/tmp/backup.json', 'utf8'));
const events = data.collections['events'] || [];
const id = '69cdc1c6224a58a12d878ed2';   // ← replace with target _id

const doc = events.find(e => String(e._id) === id || String(e._id?.\$oid) === id);
console.log(doc ? JSON.stringify(doc, null, 2) : 'Not found');
"
```

### Restore the single document

```bash
EVENT_ID="69cdc1c6224a58a12d878ed2"   # ← replace

node -e "
const { MongoClient, ObjectId } = require('mongodb');
const s = require('./local.settings.json');
const uri = s.Values.MONGODB_URI_TEST;   // swap to MONGODB_URI_PROD for PROD
const data = JSON.parse(require('fs').readFileSync('/tmp/backup.json', 'utf8'));
const events = data.collections['events'] || [];
const id = '${EVENT_ID}';

const doc = events.find(e => String(e._id) === id || String(e._id?.\$oid) === id);
if (!doc) { console.error('Event not found in backup'); process.exit(1); }

// Convert _id string back to ObjectId if needed
if (doc._id?.\$oid) doc._id = new ObjectId(doc._id.\$oid);

(async () => {
  const client = new MongoClient(uri);
  await client.connect();
  const coll = client.db().collection('events');

  // Upsert: restores whether doc was deleted or just corrupted
  const result = await coll.replaceOne({ _id: doc._id }, doc, { upsert: true });
  console.log('Matched:', result.matchedCount, '| Modified:', result.modifiedCount, '| Upserted:', result.upsertedCount);

  await client.close();
})();
"
```

### Verify the restored event

```bash
node -e "
const { MongoClient, ObjectId } = require('mongodb');
const s = require('./local.settings.json');
const uri = s.Values.MONGODB_URI_TEST;
(async () => {
  const client = new MongoClient(uri);
  await client.connect();
  const doc = await client.db().collection('events').findOne({ _id: new ObjectId('${EVENT_ID}') });
  console.log(doc ? JSON.stringify(doc, null, 2) : 'NOT FOUND');
  await client.close();
})();
"
```

---

## PROD Restore Protocol

**PROD restores require explicit Toby authorization.** Before running any restore against PROD:

1. Announce in hub: `send to: ["broadcast"], body: "PROD restore in progress — [scenario] — [collection/id]"`
2. Swap `MONGODB_URI_TEST` → `MONGODB_URI_PROD` in the script
3. Run against TEST first and confirm output matches expectations
4. Get Toby's verbal "go"
5. Run against PROD
6. Post completion notice to hub

---

## Manual Backup Trigger

If you need a fresh backup before a risky operation:

```bash
FUNC_KEY=$(az functionapp keys list --name CalendarBEAF-PROD --resource-group CalendarBEAF --query "functionKeys.default" -o tsv)
curl -s -X POST "https://calendarbeaf-prod.azurewebsites.net/api/ops/backup/mongodb?code=${FUNC_KEY}"
```

Returns JSON with backup sizes and any errors.

---

## Tested Scenarios (2026-04-20)

| Scenario | Tested | Environment | Result |
|----------|--------|-------------|--------|
| List backups | ✅ | Local | Both TEST + PROD blobs listed |
| Manual trigger | ✅ | PROD Azure Function | TEST: 6,019 docs · PROD: 6,019 docs · 0 errors |
| Full DB restore | ⬜ | TEST (pending) | — |
| Single collection | ⬜ | TEST (pending) | — |
| Single event | ⬜ | TEST (pending) | — |

Update this table as tests are completed.
