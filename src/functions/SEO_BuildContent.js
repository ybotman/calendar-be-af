// src/functions/SEO_BuildContent.js
// CALBEAF-157 Phase 3+4 — SEO content build cron + manual triggers.
// CALBEAF-169 — Trickle pattern: state-tracked chunked builds replacing single-shot nightly.
//
// Timer: runs every 30 min between 00:00–06:00 UTC, processes batches of stale events.
// Manual: POST /api/ops/seo/build with mode={event,city,segment,trickle,all}
//
// State tracking: events.seoLastBuiltAt is stamped after successful R2 write.
// Trickle mode picks events with stale or missing seoLastBuiltAt.
//
// Kill switch: SEO_WRITES_ENABLED env var must be 'true' on PROD.
// TEST will skip writes (no flag set) but log the build normally.

'use strict';

const { app } = require('@azure/functions');
const { MongoClient, ObjectId } = require('mongodb');
const { rrulestr } = require('rrule');
const { renderSeoPage } = require('../utils/seoTemplates');
const { putHtml, SEO_WRITES_ENABLED } = require('../utils/r2Client');

// Niche config — add entries here when new niches onboard
const NICHES = [
    { appId: '1', slug: 'TT', displayName: 'TangoTiempo', domain: 'www.tangotiempo.com' },
];

// Category names that map to each SEO segment (CALBEAF-154 canonical names)
const SEGMENT_CATEGORIES = {
    milonga:      ['Milonga'],
    practica:     ['Practica'],
    travelworthy: ['Festival', 'Encuentro', 'Marathon'],
};

// RRULE expansion horizon: 6 weeks forward (matches Sitemap_GetUrls)
const RRULE_WEEKS = 6;
const RRULE_HORIZON_MS = RRULE_WEEKS * 7 * 24 * 60 * 60 * 1000;

// CALBEAF-169 trickle pattern config
const TRICKLE_BATCH_PER_SEGMENT = 25;       // ~100 events per invocation across 4 segments
const REBUILD_AFTER_HOURS       = 23;       // re-render an event ~once per 24h

// Slugify (matches SEO_CityPage / SEO_GeoSummary — needed for citySlug resolution)
function toSlug(name) {
    if (!name) return '';
    return name
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Load a name→ObjectId map for the categories collection filtered by appId.
 * Returns { Milonga: ObjectId, Practica: ObjectId, ... }
 */
async function loadCategoryMap(db, appId) {
    const cats = await db.collection('categories')
        .find({ appId: String(appId) }, { projection: { _id: 1, categoryName: 1 } })
        .toArray();
    const map = {};
    for (const c of cats) {
        if (c.categoryName) map[c.categoryName] = c._id;
    }
    return map;
}

/**
 * Build a MongoDB $or filter matching any of the 3 category slots for the
 * given list of category ObjectIds.
 *
 * NOTE: events store categoryFirstId/SecondId/ThirdId as STRINGS (verified
 * 2026-05-01). The $in must include both string and ObjectId forms to be
 * resilient to mixed-type data — ObjectId form preserves correctness if any
 * future writes use Mongoose-cast types.
 */
function categoryFilter(objIds) {
    const stringIds = objIds.map(id => id.toString());
    const dualIds = [...stringIds, ...objIds];
    return {
        $or: [
            { categoryFirstId:  { $in: dualIds } },
            { categorySecondId: { $in: dualIds } },
            { categoryThirdId:  { $in: dualIds } },
        ],
    };
}

/**
 * Expand an event's RRULE into occurrence Dates within the 6-week horizon.
 * Returns [null] for non-recurring events (single occurrence, no specific date).
 */
function expandOccurrences(event) {
    if (!event.recurrenceRule) return [null];
    try {
        const rule = rrulestr(event.recurrenceRule);
        const now = new Date();
        const horizon = new Date(now.getTime() + RRULE_HORIZON_MS);
        const dates = rule.between(now, horizon, true);
        return dates.length > 0 ? dates : [null];
    } catch {
        return [null];
    }
}

/**
 * Process one segment for one niche.
 * Returns { rendered, written, skipped, errors }.
 */
async function processSegment(db, niche, segment, catMap, context, opts = {}) {
    const { mode = 'all', eventId, masteredCityId, segment: targetSegment } = opts;

    // Mode='segment' filter — skip non-matching segments
    if (mode === 'segment' && targetSegment && targetSegment !== segment) {
        return { rendered: 0, written: 0, skipped: 0, errors: 0 };
    }

    let rendered = 0, written = 0, skipped = 0, errors = 0;

    // Build segment category filter
    let segmentFilter = {};
    if (segment === 'beginner') {
        segmentFilter = { forBeginners: true };
    } else {
        const catNames = SEGMENT_CATEGORIES[segment] || [];
        const objIds = catNames.map((n) => catMap[n]).filter(Boolean);
        if (objIds.length === 0) {
            context.log(`SEO_BuildContent: no category IDs found for segment=${segment} niche=${niche.slug} — skipping`);
            return { rendered, written, skipped, errors };
        }
        segmentFilter = categoryFilter(objIds);
    }

    const now = new Date();
    // NOTE: segmentFilter has its own $or (category match across 3 slots).
    // Spreading it would OVERWRITE the time-window $or — combine both via $and
    // so each $or applies independently. Also: events store empty string ''
    // for recurrenceRule on non-recurring events, so $nin: [null, ''] is needed.
    const andClauses = [
        { $or: [
            { endDate: { $gte: now } },
            { recurrenceRule: { $exists: true, $nin: [null, ''] } },
        ]},
        segmentFilter,
    ];

    const baseQuery = {
        appId: niche.appId,
        isActive: true,
        $and: andClauses,
    };

    // Mode-specific filters
    if (mode === 'event' && eventId) {
        try { baseQuery._id = new ObjectId(eventId); }
        catch { context.log(`SEO_BuildContent: invalid eventId ${eventId}`); return { rendered, written, skipped, errors }; }
    }
    if ((mode === 'city' || mode === 'trickle' || mode === 'event') && masteredCityId) {
        try { baseQuery.masteredCityId = new ObjectId(masteredCityId); }
        catch { context.log(`SEO_BuildContent: invalid masteredCityId ${masteredCityId}`); return { rendered, written, skipped, errors }; }
    }

    // Trickle mode — only events with stale seoLastBuiltAt (or never built)
    let cursor;
    if (mode === 'trickle') {
        const horizon = new Date(Date.now() - REBUILD_AFTER_HOURS * 3600 * 1000);
        andClauses.push({ $or: [
            { seoLastBuiltAt: { $exists: false } },
            { seoLastBuiltAt: { $lt: horizon } }
        ]});
        cursor = db.collection('events')
            .find(baseQuery, { projection: {
                _id: 1, title: 1, description: 1, startDate: 1, endDate: 1,
                recurrenceRule: 1, eventImage: 1, source: 1, isDiscovered: 1,
                forBeginners: 1, venueName: 1, masteredCityName: 1, venueCityName: 1,
                masteredCountryName: 1, ownerOrganizerName: 1, organizerName: 1,
                seoLastBuiltAt: 1,
            }})
            .sort({ seoLastBuiltAt: 1 })   // oldest / never-built first
            .limit(TRICKLE_BATCH_PER_SEGMENT);
    } else {
        cursor = db.collection('events')
            .find(baseQuery, { projection: {
                _id: 1, title: 1, description: 1, startDate: 1, endDate: 1,
                recurrenceRule: 1, eventImage: 1, source: 1, isDiscovered: 1,
                forBeginners: 1, venueName: 1, masteredCityName: 1, venueCityName: 1,
                masteredCountryName: 1, ownerOrganizerName: 1, organizerName: 1,
                seoLastBuiltAt: 1,
            }});
    }

    const events = await cursor.toArray();
    context.log(`SEO_BuildContent: mode=${mode} segment=${segment} niche=${niche.slug} — ${events.length} events`);

    for (const event of events) {
        const source = event.isDiscovered ? 'AI' : 'RO';
        const occurrences = expandOccurrences(event);
        let writtenForThisEvent = 0;

        for (const occurrenceDate of occurrences) {
            try {
                const html = renderSeoPage(event, { segment, source, occurrenceDate, niche });
                rendered++;

                const occIso = occurrenceDate
                    ? (occurrenceDate instanceof Date ? occurrenceDate : new Date(occurrenceDate))
                        .toISOString().slice(0, 10)
                    : null;
                const key = occIso
                    ? `${segment}/${source}/${event._id}-${occIso}.html`
                    : `${segment}/${source}/${event._id}.html`;

                const result = await putHtml(niche.slug, key, html);
                if (result.written) {
                    written++;
                    writtenForThisEvent++;
                } else {
                    skipped++;
                    if (skipped <= 1) {
                        // Log once per segment so we know the skip reason
                        context.log(`SEO_BuildContent: write skipped — ${result.reason}`);
                    }
                }
            } catch (err) {
                errors++;
                context.log(`SEO_BuildContent ERROR event=${event._id} segment=${segment}: ${err.message}`);
            }
        }

        // CALBEAF-169: stamp seoLastBuiltAt only after at least one successful write
        // so trickle mode picks this event up next cycle if all writes failed.
        if (writtenForThisEvent > 0) {
            try {
                await db.collection('events').updateOne(
                    { _id: event._id },
                    { $set: { seoLastBuiltAt: new Date() } }
                );
            } catch (err) {
                context.log(`SEO_BuildContent: failed to stamp seoLastBuiltAt for ${event._id}: ${err.message}`);
            }
        }
    }

    return { rendered, written, skipped, errors };
}

// ─── main build handler ──────────────────────────────────────────────────────

async function seoContentBuildHandler(context, opts = {}) {
    const startTs = Date.now();
    const mode = opts.mode || 'all';
    context.log(`SEO_BuildContent: starting build mode=${mode} — SEO_WRITES_ENABLED=${SEO_WRITES_ENABLED}`);

    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        context.log('SEO_BuildContent: MONGODB_URI not set — aborting');
        return { mode, niches: [], elapsed: 0, error: 'MONGODB_URI not set' };
    }

    const summary = [];

    for (const niche of NICHES) {
        let mongoClient;
        try {
            mongoClient = new MongoClient(mongoUri);
            await mongoClient.connect();
            const dbName = mongoUri.match(/\/([^/?]+)(\?|$)/)?.[1] || 'TangoTiempoProd';
            const db = mongoClient.db(dbName);

            // Resolve citySlug → masteredCityId once per niche if needed
            const resolvedOpts = { ...opts };
            if ((mode === 'city' || mode === 'event') && opts.citySlug && !opts.masteredCityId) {
                const cities = await db.collection('masteredcities')
                    .find({ appId: niche.appId }, { projection: { cityName: 1 } })
                    .toArray();
                const match = cities.find(c => toSlug(c.cityName) === opts.citySlug);
                if (match) {
                    resolvedOpts.masteredCityId = match._id.toString();
                    context.log(`SEO_BuildContent: resolved citySlug=${opts.citySlug} → ${match.cityName} (${match._id})`);
                } else {
                    context.log(`SEO_BuildContent: citySlug=${opts.citySlug} not found in niche=${niche.slug} — skipping`);
                    continue;
                }
            }

            const catMap = await loadCategoryMap(db, niche.appId);
            context.log(`SEO_BuildContent: niche=${niche.slug} appId=${niche.appId} — ${Object.keys(catMap).length} categories loaded`);

            const segments = ['milonga', 'practica', 'travelworthy', 'beginner'];
            for (const segment of segments) {
                const stats = await processSegment(db, niche, segment, catMap, context, resolvedOpts);
                summary.push({ niche: niche.slug, segment, ...stats });
                context.log(`SEO_BuildContent: ${niche.slug}/${segment} — rendered=${stats.rendered} written=${stats.written} skipped=${stats.skipped} errors=${stats.errors}`);
            }
        } catch (err) {
            context.log(`SEO_BuildContent: niche=${niche.slug} fatal error — ${err.message}`);
            summary.push({ niche: niche.slug, fatalError: err.message });
        } finally {
            if (mongoClient) await mongoClient.close().catch(() => {});
        }
    }

    const elapsed = Math.round((Date.now() - startTs) / 1000);
    context.log(`SEO_BuildContent: done mode=${mode} in ${elapsed}s — ${JSON.stringify(summary)}`);
    return { mode, niches: summary, elapsed };
}

// ─── timer trigger (CALBEAF-169 trickle: every 30 min during 00:00–06:00 UTC) ─

app.timer('SEO_BuildContent', {
    schedule: '0 */30 0-5 * * *',
    handler: async (myTimer, context) => {
        await seoContentBuildHandler(context, { mode: 'trickle' });
    },
});

// ─── HTTP preview endpoint ───────────────────────────────────────────────────
// GET /api/admin/seo/preview?eventId={id}&segment={...}&source={...}&appId={...}&occurrenceDate={YYYY-MM-DD}
// Returns rendered HTML for live copy iteration without running the full cron.

app.http('SEO_Preview', {
    methods: ['GET'],
    authLevel: 'function',
    route: 'ops/seo/preview',
    handler: async (request, context) => {
        const eventId    = request.query.get('eventId');
        const segment    = request.query.get('segment') || 'milonga';
        const source     = request.query.get('source') || 'RO';
        const appId      = request.query.get('appId') || '1';
        const occStr     = request.query.get('occurrenceDate');

        if (!eventId) {
            return { status: 400, headers: { 'Content-Type': 'text/plain' }, body: 'eventId required' };
        }

        let eventObjId;
        try { eventObjId = new ObjectId(eventId); }
        catch { return { status: 400, headers: { 'Content-Type': 'text/plain' }, body: 'invalid eventId' }; }

        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) return { status: 500, headers: { 'Content-Type': 'text/plain' }, body: 'MONGODB_URI not configured' };

        let mongoClient;
        try {
            mongoClient = new MongoClient(mongoUri);
            await mongoClient.connect();
            const dbName = mongoUri.match(/\/([^/?]+)(\?|$)/)?.[1] || 'TangoTiempoProd';
            const db = mongoClient.db(dbName);

            const event = await db.collection('events').findOne(
                { _id: eventObjId, appId: String(appId) },
                { projection: {
                    _id: 1, title: 1, description: 1, startDate: 1, endDate: 1,
                    recurrenceRule: 1, eventImage: 1, source: 1, isDiscovered: 1,
                    forBeginners: 1, venueName: 1, masteredCityName: 1, venueCityName: 1,
                    masteredCountryName: 1, ownerOrganizerName: 1, organizerName: 1,
                }}
            );

            if (!event) {
                return { status: 404, headers: { 'Content-Type': 'text/plain' }, body: `Event ${eventId} not found for appId ${appId}` };
            }

            const niche = NICHES.find((n) => n.appId === String(appId));
            if (!niche) {
                return { status: 400, headers: { 'Content-Type': 'text/plain' }, body: `Unsupported appId ${appId}` };
            }

            const occurrenceDate = occStr ? new Date(occStr) : null;
            const html = renderSeoPage(event, { segment, source, occurrenceDate, niche });

            return {
                status: 200,
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
                body: html,
            };
        } catch (err) {
            context.log(`SEO_Preview error: ${err.message}`);
            return { status: 500, headers: { 'Content-Type': 'text/plain' }, body: err.message };
        } finally {
            if (mongoClient) await mongoClient.close().catch(() => {});
        }
    },
});

// ─── HTTP manual trigger (admin use — runs same logic as timer) ───────────────
// POST /api/admin/seo/build
// Returns JSON summary of what was rendered/written.

app.http('SEO_BuildContent_Manual', {
    methods: ['POST'],
    authLevel: 'function',
    route: 'ops/seo/build',
    handler: async (request, context) => {
        const opts = {
            mode:            request.query.get('mode') || 'all',
            eventId:         request.query.get('eventId') || undefined,
            citySlug:        request.query.get('citySlug') || undefined,
            masteredCityId:  request.query.get('masteredCityId') || undefined,
            segment:         request.query.get('segment') || undefined,
        };
        context.log(`SEO_BuildContent_Manual: triggered with opts=${JSON.stringify(opts)}`);
        const result = await seoContentBuildHandler(context, opts);
        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                triggered: true,
                timestamp: new Date().toISOString(),
                ...result
            }),
        };
    },
});
