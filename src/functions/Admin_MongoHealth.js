// src/functions/Admin_MongoHealth.js
// CALBEAF-106 — GET /api/ops/mongo-health (NOT /admin/* — Azure-reserved route)
// SA-gated endpoint for CalOps M0 Health panel (CALOPS-49 consumer).
//
// Returns 6 blocks per Dash's contract:
//   dbStats, connections, opcounters (windowed), replication, perCollection, slowOps
//
// 10-second server-side cache. M0 has no Atlas API, so we instrument at app layer.

const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const { standardMiddleware } = require('../middleware');
const { firebaseAuth, unauthorizedResponse } = require('../middleware/firebaseAuth');

const CACHE_TTL_MS = 10 * 1000;
let cachedSnapshot = null; // { capturedAt, payload }

// Previous serverStatus snapshot for windowed opcounters rate computation
let prevStatus = null; // { ts, opcounters: {...} }

/**
 * Role check: caller must have SA (SystemAdmin) role
 */
function hasSA(user) {
    if (!user) return false;
    if (user.systemAdmin === true) return true;
    if (Array.isArray(user.roles) && user.roles.includes('SA')) return true;
    if (user.role === 'SA') return true;
    // Firebase custom claims: `roleNameCode: "SA"` or boolean flag
    if (user.roleNameCode === 'SA') return true;
    return false;
}

async function collectSnapshot(mongoClient) {
    const adminDb = mongoClient.db().admin();
    const db = mongoClient.db();

    const capturedAt = new Date().toISOString();

    // 1. dbStats
    const dbStatsRaw = await db.command({ dbStats: 1 });
    const dbStats = {
        dataSize: dbStatsRaw.dataSize || 0,
        storageSize: dbStatsRaw.storageSize || 0,
        indexSize: dbStatsRaw.indexSize || 0,
        objects: dbStatsRaw.objects || 0
    };

    // 2 & 3. serverStatus — connections + opcounters.
    // Atlas M0 free tier denies serverStatus to non-admin users — gracefully degrade.
    const notes = [];
    let connections = { current: 0, available: 0, totalCreated: 0 };
    let opcounters = {
        windowSec: 0,
        insertPerSec: 0,
        queryPerSec: 0,
        updatePerSec: 0,
        deletePerSec: 0,
        getmorePerSec: 0,
        commandPerSec: 0,
        totalPerSec: 0
    };
    try {
        const serverStatus = await adminDb.serverStatus();
        const connectionsRaw = serverStatus.connections || {};
        connections = {
            current: connectionsRaw.current || 0,
            available: connectionsRaw.available || 0,
            totalCreated: connectionsRaw.totalCreated || 0
        };

        // Windowed opcounters
        const opCountersRaw = serverStatus.opcounters || {};
        const nowTs = Date.now();
        if (prevStatus) {
            const windowSec = Math.max(1, Math.round((nowTs - prevStatus.ts) / 1000));
            const rate = (key) =>
                Math.max(0, ((opCountersRaw[key] || 0) - (prevStatus.opcounters[key] || 0)) / windowSec);
            opcounters = {
                windowSec,
                insertPerSec: rate('insert'),
                queryPerSec: rate('query'),
                updatePerSec: rate('update'),
                deletePerSec: rate('delete'),
                getmorePerSec: rate('getmore'),
                commandPerSec: rate('command'),
                totalPerSec: 0
            };
            opcounters.totalPerSec =
                opcounters.insertPerSec +
                opcounters.queryPerSec +
                opcounters.updatePerSec +
                opcounters.deletePerSec +
                opcounters.getmorePerSec +
                opcounters.commandPerSec;
        }
        prevStatus = { ts: nowTs, opcounters: { ...opCountersRaw } };
    } catch (e) {
        notes.push('serverStatus unavailable (Atlas M0 free tier or insufficient privileges) — connections + opcounters returned as zeros');
    }

    // 4. Replication — rs.status() if replica set, else primaryOptime null
    let replication = { primaryOptime: null, maxSecondaryLagSec: null };
    try {
        const rsStatus = await adminDb.command({ replSetGetStatus: 1 });
        if (rsStatus && Array.isArray(rsStatus.members)) {
            const primary = rsStatus.members.find(m => m.stateStr === 'PRIMARY');
            const secondaries = rsStatus.members.filter(m => m.stateStr === 'SECONDARY');
            const primaryTs =
                primary && primary.optimeDate
                    ? new Date(primary.optimeDate).getTime()
                    : null;
            replication.primaryOptime = primary && primary.optimeDate
                ? new Date(primary.optimeDate).toISOString()
                : null;
            let maxLag = 0;
            for (const s of secondaries) {
                if (s.optimeDate && primaryTs) {
                    const sTs = new Date(s.optimeDate).getTime();
                    const lagSec = Math.max(0, Math.round((primaryTs - sTs) / 1000));
                    if (lagSec > maxLag) maxLag = lagSec;
                }
            }
            replication.maxSecondaryLagSec = secondaries.length > 0 ? maxLag : null;
        }
    } catch (e) {
        // Not a replica set, or permission issue — report nulls
        replication = { primaryOptime: null, maxSecondaryLagSec: null };
    }

    // 5. perCollection — top 10 by size
    const collInfos = await db.listCollections({}, { nameOnly: true }).toArray();
    const perColl = [];
    for (const info of collInfos) {
        const name = info.name;
        if (name.startsWith('system.')) continue;
        try {
            const stats = await db.command({ collStats: name });
            perColl.push({
                name,
                sizeBytes: stats.size || 0,
                count: stats.count || 0,
                nindexes: stats.nindexes || 0
            });
        } catch (_) { /* skip */ }
    }
    perColl.sort((a, b) => b.sizeBytes - a.sizeBytes);
    const perCollection = perColl.slice(0, 10);

    // 6. slowOps — App Insights query.
    // For M0 free-tier without Atlas API, we rely on App Insights for latency percentiles.
    // Querying App Insights requires Application Insights API auth + Kusto query — implemented
    // as a best-effort remote call; when unavailable, return zeros with a note.
    // TODO: Wire to App Insights REST API with APPINSIGHTS_API_KEY when provisioned.
    const slowOps = {
        p50Ms: 0,
        p95Ms: 0,
        p99Ms: 0,
        countAbove200_5min: 0,
        countAbove200_1hr: 0,
        countAbove200_24hr: 0
    };
    notes.push('slowOps stubbed at zeros — App Insights query integration pending APPINSIGHTS_API_KEY provisioning');

    return {
        capturedAt,
        dbStats,
        connections,
        opcounters,
        replication,
        perCollection,
        slowOps,
        notes
    };
}

async function mongoHealthHandler(request, context) {
    try {
        // SA auth required
        const user = await firebaseAuth(request, context);
        if (!user) {
            return unauthorizedResponse('Firebase authentication required');
        }
        if (!hasSA(user)) {
            return {
                status: 403,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Forbidden',
                    message: 'SystemAdmin (SA) role required',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // 10-second cache
        const now = Date.now();
        if (cachedSnapshot && (now - cachedSnapshot.capturedAtMs) < CACHE_TTL_MS) {
            return {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Cache': 'hit'
                },
                body: JSON.stringify(cachedSnapshot.payload)
            };
        }

        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) throw new Error('MongoDB connection string not configured');
        const mongoClient = new MongoClient(mongoUri, {
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 5000
        });

        try {
            await mongoClient.connect();
            const payload = await collectSnapshot(mongoClient);
            cachedSnapshot = { capturedAtMs: now, payload };

            return {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Cache': 'miss'
                },
                body: JSON.stringify(payload)
            };
        } finally {
            await mongoClient.close();
        }

    } catch (err) {
        context.log(`Admin_MongoHealth error: ${err.message}`);
        return {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: 'ServerError',
                message: 'mongo-health snapshot failed',
                detail: err.message,
                timestamp: new Date().toISOString()
            })
        };
    }
}

// Route uses 'ops/' prefix — Azure Functions reserves 'admin/*' for host management
// endpoints (same fix pattern as backup routes per retrospective 2026-02).
app.http('Admin_MongoHealth', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'ops/mongo-health',
    handler: standardMiddleware(mongoHealthHandler)
});
