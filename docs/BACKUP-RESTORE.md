# Backup & Restore Procedures

---

## CRITICAL: Restore Protection Notice

**There are NO restore API endpoints.** Restore is manual-only by design.

| Operation | API Exists | How It Works |
|-----------|------------|--------------|
| Backup | Yes | Automated daily Azure Functions |
| Restore | **NO** | Manual scripts, local execution only |

### Restore Requirements (Manual Process)

To perform any restore, you must have:

1. **Azure Storage access** — to download backup files
2. **MongoDB connection string** — database credentials
3. **Local execution environment** — Node.js on your machine
4. **Firebase service account** — for Firebase restores only

### Why No Restore API?

Restore operations are destructive and irreversible. Protections:

- No accidental API calls can trigger restore
- Requires deliberate local script execution
- Requires production credentials (not in code)
- Human must download, verify, and run manually

### If Restore Endpoints Are Ever Built

They MUST include:

- Admin-level authentication (not just function key)
- Required confirmation code parameter
- Required password/admin token
- Dry-run mode by default
- Full audit logging
- Two-step confirmation flow

---

## Overview

The calendar-be-af system includes automated daily backups for:
- **MongoDB** databases (TangoTiempo dev/test + TangoTiempoProd)
- **Firebase Auth** users

Backups are stored in Azure Blob Storage with tiered retention:
- 7 daily backups
- 4 weekly backups (1 per week)
- 12 monthly backups (1 per month)
- 3 yearly backups (1 per year)

---

## Backup Schedule

| Backup | Schedule | Container |
|--------|----------|-----------|
| MongoDB | Daily 3:00 AM EST (8:00 UTC) | `mongodb-backups` |
| Firebase Auth | Daily 3:15 AM EST (8:15 UTC) | `firebase-backups` |

---

## Azure Blob Storage Structure

```
mongodb-backups/
  ├── 2026-02-09T08-00-00_TangoTiempo.json.gz
  ├── 2026-02-09T08-00-00_TangoTiempoProd.json.gz
  ├── 2026-02-08T08-00-00_TangoTiempo.json.gz
  └── ...

firebase-backups/
  ├── 2026-02-09T08-15-00_FirebaseAuth.json.gz
  ├── 2026-02-08T08-15-00_FirebaseAuth.json.gz
  └── ...
```

---

## List Available Backups

### Via Azure Portal
1. Go to Azure Portal → Storage Accounts → your storage account
2. Navigate to Containers → `mongodb-backups` or `firebase-backups`
3. View all backup files with timestamps

### Via Azure CLI
```bash
# List MongoDB backups
az storage blob list \
  --container-name mongodb-backups \
  --account-name <storage-account> \
  --output table

# List Firebase backups
az storage blob list \
  --container-name firebase-backups \
  --account-name <storage-account> \
  --output table
```

### Via Admin API (requires function key)
```bash
# MongoDB backups
curl -X GET "https://calendarbeaf-prod.azurewebsites.net/api/admin/backup/mongodb/list?code=<function-key>"

# Firebase backups
curl -X GET "https://calendarbeaf-prod.azurewebsites.net/api/admin/backup/firebase/list?code=<function-key>"
```

---

## MongoDB Restore Procedures

### Download a Backup

```bash
# Download specific backup
az storage blob download \
  --container-name mongodb-backups \
  --name "2026-02-09T08-00-00_TangoTiempoProd.json.gz" \
  --file ./backup.json.gz \
  --account-name <storage-account>

# Decompress
gunzip backup.json.gz
```

### Restore Full Database

**WARNING: This will overwrite existing data!**

```javascript
// restore-mongodb-full.js
const { MongoClient } = require('mongodb');
const fs = require('fs');

const MONGODB_URI = process.env.MONGODB_URI;
const backupFile = process.argv[2]; // Path to backup.json

async function restoreFullDatabase() {
    const backup = JSON.parse(fs.readFileSync(backupFile, 'utf-8'));
    const client = new MongoClient(MONGODB_URI);

    try {
        await client.connect();
        const db = client.db();

        console.log(`Restoring from: ${backup._metadata.exportedAt}`);
        console.log(`Database: ${backup._metadata.databaseName}`);

        for (const [collectionName, documents] of Object.entries(backup.collections)) {
            if (documents.length === 0) continue;

            console.log(`Restoring ${collectionName}: ${documents.length} documents`);

            const collection = db.collection(collectionName);

            // Drop existing collection
            await collection.drop().catch(() => {}); // Ignore if doesn't exist

            // Insert all documents
            if (documents.length > 0) {
                await collection.insertMany(documents);
            }
        }

        console.log('Full restore complete!');
    } finally {
        await client.close();
    }
}

restoreFullDatabase().catch(console.error);
```

Run:
```bash
node restore-mongodb-full.js ./backup.json
```

### Restore Single Collection

```javascript
// restore-mongodb-collection.js
const { MongoClient } = require('mongodb');
const fs = require('fs');

const MONGODB_URI = process.env.MONGODB_URI;
const backupFile = process.argv[2];
const collectionName = process.argv[3];

async function restoreCollection() {
    const backup = JSON.parse(fs.readFileSync(backupFile, 'utf-8'));
    const client = new MongoClient(MONGODB_URI);

    try {
        await client.connect();
        const db = client.db();

        const documents = backup.collections[collectionName];
        if (!documents) {
            console.error(`Collection '${collectionName}' not found in backup`);
            process.exit(1);
        }

        console.log(`Restoring ${collectionName}: ${documents.length} documents`);

        const collection = db.collection(collectionName);

        // Option A: Drop and replace
        await collection.drop().catch(() => {});
        if (documents.length > 0) {
            await collection.insertMany(documents);
        }

        // Option B: Merge (upsert) - uncomment if preferred
        // for (const doc of documents) {
        //     await collection.replaceOne({ _id: doc._id }, doc, { upsert: true });
        // }

        console.log('Collection restore complete!');
    } finally {
        await client.close();
    }
}

restoreCollection().catch(console.error);
```

Run:
```bash
node restore-mongodb-collection.js ./backup.json events
node restore-mongodb-collection.js ./backup.json organizers
```

### Restore Single Document

```javascript
// restore-mongodb-document.js
const { MongoClient, ObjectId } = require('mongodb');
const fs = require('fs');

const MONGODB_URI = process.env.MONGODB_URI;
const backupFile = process.argv[2];
const collectionName = process.argv[3];
const documentId = process.argv[4];

async function restoreDocument() {
    const backup = JSON.parse(fs.readFileSync(backupFile, 'utf-8'));
    const client = new MongoClient(MONGODB_URI);

    try {
        await client.connect();
        const db = client.db();

        const documents = backup.collections[collectionName];
        const doc = documents.find(d =>
            d._id === documentId ||
            d._id?.$oid === documentId ||
            String(d._id) === documentId
        );

        if (!doc) {
            console.error(`Document '${documentId}' not found in ${collectionName}`);
            process.exit(1);
        }

        console.log(`Restoring document ${documentId} to ${collectionName}`);

        const collection = db.collection(collectionName);
        await collection.replaceOne(
            { _id: new ObjectId(documentId) },
            doc,
            { upsert: true }
        );

        console.log('Document restore complete!');
    } finally {
        await client.close();
    }
}

restoreDocument().catch(console.error);
```

Run:
```bash
node restore-mongodb-document.js ./backup.json events 6751f57e2e74d97609e7dca0
```

---

## Firebase Auth Restore Procedures

### Download a Backup

```bash
az storage blob download \
  --container-name firebase-backups \
  --name "2026-02-09T08-15-00_FirebaseAuth.json.gz" \
  --file ./firebase-backup.json.gz \
  --account-name <storage-account>

gunzip firebase-backup.json.gz
```

### Restore All Users

**NOTE: Password hashes are NOT included in backups. Users will need to reset passwords or use social login.**

```javascript
// restore-firebase-all.js
const admin = require('firebase-admin');
const fs = require('fs');

// Initialize with service account
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const backupFile = process.argv[2];

async function restoreAllUsers() {
    const backup = JSON.parse(fs.readFileSync(backupFile, 'utf-8'));
    const auth = admin.auth();

    console.log(`Restoring ${backup.users.length} users from ${backup._metadata.exportedAt}`);

    let created = 0, updated = 0, errors = 0;

    for (const user of backup.users) {
        try {
            // Check if user exists
            try {
                await auth.getUser(user.uid);
                // User exists - update
                await auth.updateUser(user.uid, {
                    email: user.email,
                    emailVerified: user.emailVerified,
                    displayName: user.displayName,
                    photoURL: user.photoURL,
                    phoneNumber: user.phoneNumber,
                    disabled: user.disabled
                });
                if (user.customClaims && Object.keys(user.customClaims).length > 0) {
                    await auth.setCustomUserClaims(user.uid, user.customClaims);
                }
                updated++;
            } catch (e) {
                if (e.code === 'auth/user-not-found') {
                    // Create user (without password - they'll need to reset)
                    await auth.createUser({
                        uid: user.uid,
                        email: user.email,
                        emailVerified: user.emailVerified,
                        displayName: user.displayName,
                        photoURL: user.photoURL,
                        phoneNumber: user.phoneNumber,
                        disabled: user.disabled
                    });
                    if (user.customClaims && Object.keys(user.customClaims).length > 0) {
                        await auth.setCustomUserClaims(user.uid, user.customClaims);
                    }
                    created++;
                } else {
                    throw e;
                }
            }
        } catch (error) {
            console.error(`Error restoring ${user.email}: ${error.message}`);
            errors++;
        }
    }

    console.log(`Restore complete: ${created} created, ${updated} updated, ${errors} errors`);
}

restoreAllUsers().catch(console.error);
```

### Restore Single User

```javascript
// restore-firebase-user.js
const admin = require('firebase-admin');
const fs = require('fs');

const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const backupFile = process.argv[2];
const userIdOrEmail = process.argv[3];

async function restoreSingleUser() {
    const backup = JSON.parse(fs.readFileSync(backupFile, 'utf-8'));
    const auth = admin.auth();

    const user = backup.users.find(u =>
        u.uid === userIdOrEmail || u.email === userIdOrEmail
    );

    if (!user) {
        console.error(`User '${userIdOrEmail}' not found in backup`);
        process.exit(1);
    }

    console.log(`Restoring user: ${user.email} (${user.uid})`);

    try {
        await auth.updateUser(user.uid, {
            email: user.email,
            emailVerified: user.emailVerified,
            displayName: user.displayName,
            photoURL: user.photoURL,
            disabled: user.disabled
        });

        if (user.customClaims && Object.keys(user.customClaims).length > 0) {
            await auth.setCustomUserClaims(user.uid, user.customClaims);
        }

        console.log('User restored successfully!');
    } catch (error) {
        if (error.code === 'auth/user-not-found') {
            await auth.createUser({
                uid: user.uid,
                email: user.email,
                emailVerified: user.emailVerified,
                displayName: user.displayName,
                photoURL: user.photoURL,
                disabled: user.disabled
            });

            if (user.customClaims && Object.keys(user.customClaims).length > 0) {
                await auth.setCustomUserClaims(user.uid, user.customClaims);
            }

            console.log('User created from backup!');
        } else {
            throw error;
        }
    }
}

restoreSingleUser().catch(console.error);
```

Run:
```bash
node restore-firebase-user.js ./firebase-backup.json user@example.com
# or
node restore-firebase-user.js ./firebase-backup.json <firebase-uid>
```

---

## Manual Backup Trigger

To run a backup immediately (outside the schedule):

```bash
# MongoDB backup
curl -X POST "https://calendarbeaf-prod.azurewebsites.net/api/admin/backup/mongodb?code=<function-key>"

# Firebase backup
curl -X POST "https://calendarbeaf-prod.azurewebsites.net/api/admin/backup/firebase?code=<function-key>"
```

---

## Environment Variables Required

```bash
# Azure Storage (required for both)
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...

# MongoDB backup
MONGODB_URI=mongodb+srv://...           # Dev/test database
MONGODB_URI_PROD=mongodb+srv://...      # Production database
BACKUP_CONTAINER_NAME=mongodb-backups   # Optional, default shown

# Firebase backup
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}  # Stringified JSON
FIREBASE_BACKUP_CONTAINER_NAME=firebase-backups               # Optional
```

---

## Monitoring & Alerts

Backups log to Azure Application Insights. Set up alerts for:
- Backup function failures
- Missing daily backups (check blob count)
- Storage quota warnings

---

## Related Tickets

- CALBEAF-75: MongoDB backup implementation
- CALBEAF-77: Firebase Auth backup implementation
