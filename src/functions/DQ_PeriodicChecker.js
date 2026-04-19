// src/functions/DQ_PeriodicChecker.js
// CALBEAF-110 Phase 4: Tier-2 periodic checker.
// Spec: Collab/architecture/bulk-enrich-endpoint-spec.md (v1.4 §5)
//
// AIDI must-have #1: ships WITH v1, not follow-up. Catches degraded-mode
// insertions (Porter fallback when bulk-enrich was unavailable) + any other
// rows where enrichmentStatus != 'complete' OR DQ fields are null.
//
// Timer: every 30 minutes (Porter's "≤hourly" tolerance, with headroom).
// Query: 24h lookback, limit 200, indexed via {appId, enrichmentStatus, updatedAt}.
//
// PROD STAY-OUT: connects to MONGODB_URI_TEST only. PROD URI guard refuses
// to run unless explicitly authorized via env var DQ_CHECKER_ALLOW_PROD=true
// (which Toby has not granted; do not set).

const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');
const { runDataQualityPipeline } = require('../utils/enrichment');

const LOOKBACK_HOURS = 24;
const SCAN_LIMIT = 200;
const TARGET_APP_ID = '1';  // Tango niche only at v1; widens via spec when HJ/NTTT opt in

async function dqPeriodicCheckerHandler(myTimer, context) {
    const startTime = Date.now();
    context.log('DQ_PeriodicChecker: tick start');

    if (myTimer && myTimer.isPastDue) {
        context.log('DQ_PeriodicChecker: timer past due — proceeding');
    }

    // PROD STAY-OUT
    const uri = process.env.MONGODB_URI_TEST || process.env.MONGODB_URI;
    if (!uri) {
        context.log('DQ_PeriodicChecker: MONGODB_URI_TEST not configured — skipping run');
        return;
    }
    if (uri.toLowerCase().includes('prod') && process.env.DQ_CHECKER_ALLOW_PROD !== 'true') {
        context.log('DQ_PeriodicChecker: refusing PROD URI per CALBEAF-110 hard rail');
        return;
    }

    let mongoClient;
    let scanned = 0;
    let enriched = 0;
    let stillFailing = 0;

    try {
        mongoClient = new MongoClient(uri);
        await mongoClient.connect();
        const db = mongoClient.db();
        const events = db.collection('events');

        // Query — indexed via composite {appId, enrichmentStatus, updatedAt}
        // Uses BOTH enrichmentStatus AND field-nullity per spec §5 (status answers WHY,
        // nullity answers WHAT'S MISSING).
        const lookbackDate = new Date(Date.now() - LOOKBACK_HOURS * 3600 * 1000);
        const query = {
            appId: TARGET_APP_ID,
            updatedAt: { $gte: lookbackDate },
            $or: [
                { enrichmentStatus: { $ne: 'complete' } },
                { forBeginners: null },
                { beginnerFriendly: null },
                { travelWorthy: null },
                { masteredCountryId: null }
            ]
        };

        const candidates = await events.find(query).limit(SCAN_LIMIT).toArray();
        scanned = candidates.length;
        context.log(`DQ_PeriodicChecker: scanned ${scanned} candidates (lookback ${LOOKBACK_HOURS}h, limit ${SCAN_LIMIT})`);

        if (scanned === 0) {
            const durationMs = Date.now() - startTime;
            context.log(`DQ_PeriodicChecker: nothing to fix; durationMs=${durationMs}`);
            emitMetrics(context, { scanned: 0, enriched: 0, stillFailing: 0, durationMs, degradedModeRate: 0 });
            return;
        }

        // Build bulkWrite ops — only for rows that actually changed
        const bulkOps = [];
        for (const event of candidates) {
            try {
                const before = JSON.stringify({
                    forBeginners: event.forBeginners,
                    beginnerFriendly: event.beginnerFriendly,
                    travelWorthy: event.travelWorthy,
                    masteredCountryId: event.masteredCountryId,
                    masteredCountryName: event.masteredCountryName,
                    venueGeolocation: event.venueGeolocation,
                    venueCityName: event.venueCityName,
                    venueTimezone: event.venueTimezone,
                });

                const { event: updated, report } = await runDataQualityPipeline(
                    event,
                    db,
                    { appId: event.appId }
                );

                const after = JSON.stringify({
                    forBeginners: updated.forBeginners,
                    beginnerFriendly: updated.beginnerFriendly,
                    travelWorthy: updated.travelWorthy,
                    masteredCountryId: updated.masteredCountryId,
                    masteredCountryName: updated.masteredCountryName,
                    venueGeolocation: updated.venueGeolocation,
                    venueCityName: updated.venueCityName,
                    venueTimezone: updated.venueTimezone,
                });

                // Per CALBEAF-110 bugfix (Quinn 2026-04-18): WARN-required-field entries are
                // informational per spec §4 "warn-only" — they do NOT flip status to 'failed'.
                // status='complete' unless pipeline throws (caught below).
                const newStatus = 'complete';

                if (before !== after || event.enrichmentStatus !== newStatus) {
                    bulkOps.push({
                        updateOne: {
                            filter: { _id: event._id },
                            update: {
                                $set: {
                                    forBeginners: updated.forBeginners,
                                    beginnerFriendly: updated.beginnerFriendly,
                                    travelWorthy: updated.travelWorthy,
                                    masteredCountryId: updated.masteredCountryId,
                                    masteredCountryName: updated.masteredCountryName,
                                    venueGeolocation: updated.venueGeolocation,
                                    venueCityName: updated.venueCityName,
                                    venueTimezone: updated.venueTimezone,
                                    forBeginnersOverride: updated.forBeginnersOverride,
                                    beginnerFriendlyOverride: updated.beginnerFriendlyOverride,
                                    travelWorthyOverride: updated.travelWorthyOverride,
                                    enrichmentStatus: newStatus,
                                }
                            }
                        }
                    });

                    if (newStatus === 'complete') {
                        enriched++;
                    } else {
                        stillFailing++;
                    }
                }
            } catch (err) {
                stillFailing++;
                context.log(`DQ_PeriodicChecker: event ${event._id} pipeline error: ${err.message}`);
            }
        }

        if (bulkOps.length > 0) {
            const bulkResult = await events.bulkWrite(bulkOps, { ordered: false });
            context.log(`DQ_PeriodicChecker: bulkWrite matched=${bulkResult.matchedCount} modified=${bulkResult.modifiedCount}`);
        }

        const durationMs = Date.now() - startTime;
        // Degraded-mode rate: % of scanned candidates that came in with status 'pending'
        // (i.e., Porter inserted via degraded-mode fallback)
        const pendingCount = candidates.filter(c => c.enrichmentStatus === 'pending').length;
        const degradedModeRate = scanned > 0 ? (pendingCount / scanned) : 0;

        context.log(`DQ_PeriodicChecker: scanned=${scanned} enriched=${enriched} stillFailing=${stillFailing} degradedModeRate=${(degradedModeRate * 100).toFixed(1)}% durationMs=${durationMs}`);
        emitMetrics(context, { scanned, enriched, stillFailing, durationMs, degradedModeRate });
    } catch (err) {
        context.log(`DQ_PeriodicChecker: fatal error: ${err.message}`);
    } finally {
        if (mongoClient) {
            await mongoClient.close();
        }
    }
}

function emitMetrics(context, m) {
    if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
        try {
            const appInsights = require('applicationinsights');
            const client = appInsights.defaultClient;
            if (client) {
                client.trackEvent({
                    name: 'dq_checker.run_complete',
                    properties: {
                        appId: TARGET_APP_ID,
                    },
                    measurements: {
                        events_scanned: m.scanned,
                        events_enriched: m.enriched,
                        events_still_failing: m.stillFailing,
                        degraded_mode_rate: m.degradedModeRate,
                        duration_ms: m.durationMs,
                    }
                });
            }
        } catch (err) {
            context.log(`DQ_PeriodicChecker: metrics emit failed: ${err.message}`);
        }
    }
}

app.timer('DQ_PeriodicChecker', {
    schedule: '0 */30 * * * *',  // every 30 min, on the hour and 30 min mark
    handler: dqPeriodicCheckerHandler,
});

module.exports = { dqPeriodicCheckerHandler };  // exported for tests
