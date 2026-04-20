// src/functions/Events_BulkEnrich.js
// CALBEAF-110 Phase 2: Bulk-enrich endpoint
// Spec: Collab/architecture/bulk-enrich-endpoint-spec.md (v1.4)
//
// POST /api/events/bulk-enrich
// - Sync, ≤500 events per batch
// - Per-event status (enriched / needs_review / skipped_already_enriched)
// - 207-style partial-failure (HTTP 200 with mixed per-event statuses)
// - Does NOT persist to Mongo — caller (Porter for batches, Events_Create/Update
//   for inline) is responsible for writes. Pipeline reads only.
// - PROD STAY-OUT: this endpoint deploys DEVL → TEST only until Toby reauthorizes.

const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const { standardMiddleware } = require('../middleware');
const { firebaseAuth, unauthorizedResponse } = require('../middleware/firebaseAuth');
const { runDataQualityPipeline } = require('../utils/enrichment');

const BATCH_HARD_CEILING = 500;

async function eventsBulkEnrichHandler(request, context) {
    const startTime = Date.now();
    context.log('Events_BulkEnrich: Request received');

    // Auth — same as Events_Create
    const user = await firebaseAuth(request, context);
    if (!user) {
        return unauthorizedResponse();
    }
    context.log(`Events_BulkEnrich: Authenticated user ${user.uid}`);

    let mongoClient;
    let requestBody;

    try {
        requestBody = await request.json();
    } catch (err) {
        return jsonResponse(400, {
            success: false,
            error: 'Invalid JSON body',
            timestamp: new Date().toISOString()
        });
    }

    const { batchId, events, options = {} } = requestBody || {};

    // Validate request shape
    if (!Array.isArray(events)) {
        return jsonResponse(400, {
            success: false,
            error: 'events[] array is required',
            timestamp: new Date().toISOString()
        });
    }

    if (events.length === 0) {
        return jsonResponse(400, {
            success: false,
            error: 'events[] must not be empty',
            timestamp: new Date().toISOString()
        });
    }

    if (events.length > BATCH_HARD_CEILING) {
        return jsonResponse(413, {
            success: false,
            error: `Batch too large: ${events.length} events exceeds ceiling of ${BATCH_HARD_CEILING}`,
            timestamp: new Date().toISOString()
        });
    }

    if (!batchId || typeof batchId !== 'string') {
        return jsonResponse(400, {
            success: false,
            error: 'batchId (string) is required for observability correlation',
            timestamp: new Date().toISOString()
        });
    }

    const dryRun = Boolean(options.dryRun);
    const forceRecompute = Boolean(options.forceRecompute);

    context.log(`Events_BulkEnrich: batchId=${batchId} events=${events.length} dryRun=${dryRun} forceRecompute=${forceRecompute}`);

    try {
        // Mongo connection — pipeline needs read access for category/region/country/venue lookups
        const mongoUri = process.env.MONGODB_URI_TEST || process.env.MONGODB_URI;
        if (!mongoUri) {
            return jsonResponse(500, {
                success: false,
                error: 'MongoDB connection not configured',
                timestamp: new Date().toISOString()
            });
        }
        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();
        const db = mongoClient.db();

        const results = [];
        let enrichedCount = 0;
        let failedCount = 0;

        // Process each event independently — partial failure is per-event, not batch-wide
        for (let i = 0; i < events.length; i++) {
            const original = events[i];
            try {
                // Defensive copy so caller's payload isn't mutated unexpectedly
                const eventCopy = JSON.parse(JSON.stringify(original));
                const { event: enriched, report } = await runDataQualityPipeline(
                    eventCopy,
                    db,
                    {
                        appId: original.appId || requestBody.appId,
                        forceRecompute,
                    }
                );

                // Status = enriched when the pipeline completed successfully.
                // Required-field WARN entries in report.skipped are informational per spec §4
                // ("warn-only, never reject") — they do NOT flip status to needs_review.
                // needs_review is reserved for pipeline exceptions (caught below).
                enrichedCount++;
                results.push({
                    index: i,
                    status: 'enriched',
                    event: enriched,
                    report,
                });
            } catch (err) {
                failedCount++;
                results.push({
                    index: i,
                    status: 'needs_review',
                    event: original,
                    report: { actions: [], skipped: [{ field: 'pipeline', reason: `error: ${err.message}` }] },
                    error: `pipeline exception: ${err.message}`
                });
                context.log(`Events_BulkEnrich: event ${i} failed: ${err.message}`);
            }
        }

        const durationMs = Date.now() - startTime;
        context.log(`Events_BulkEnrich: batchId=${batchId} enriched=${enrichedCount} failed=${failedCount} durationMs=${durationMs}`);

        // Metrics — Application Insights custom event
        if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
            const appInsights = require('applicationinsights');
            const client = appInsights.defaultClient;
            if (client) {
                client.trackEvent({
                    name: 'bulk_enrich.batch_complete',
                    properties: {
                        batchId,
                        enrichedCount: String(enrichedCount),
                        failedCount: String(failedCount),
                        eventCount: String(events.length),
                        dryRun: String(dryRun),
                        forceRecompute: String(forceRecompute),
                    },
                    measurements: {
                        durationMs,
                        eventCount: events.length,
                        enrichedCount,
                        failedCount,
                    }
                });
            }
        }

        return jsonResponse(200, {
            batchId,
            enrichedCount,
            failedCount,
            durationMs,
            dryRun,
            events: results
        });
    } catch (err) {
        context.log(`Events_BulkEnrich: batch error: ${err.message}`);
        return jsonResponse(500, {
            success: false,
            error: `Internal error: ${err.message}`,
            batchId,
            timestamp: new Date().toISOString()
        });
    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

function jsonResponse(status, body) {
    return {
        status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    };
}

app.http('Events_BulkEnrich', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'events/bulk-enrich',
    handler: standardMiddleware(eventsBulkEnrichHandler)
});
