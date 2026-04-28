// src/functions/SEO_BuildContent.js
// CALBEAF-157 Phase 3+4 — Nightly SEO content build cron + preview endpoint.
//
// Timer: runs nightly at 3 AM UTC for each configured niche.
// For each segment × event, renders HTML via seoTemplates and writes to R2
// via r2Client (guarded by SEO_WRITES_ENABLED and R2 credentials).
//
// Kill switch: SEO_WRITES_ENABLED env var must be 'true' on PROD.
// TEST will skip writes (no flag set) but log the build normally.
//
// Segments: milonga, practica, travelworthy, beginner
// Sources: RO (organizer-set events), AI (isDiscovered events)

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
 */
function categoryFilter(objIds) {
    return {
        $or: [
            { categoryFirstId:  { $in: objIds } },
            { categorySecondId: { $in: objIds } },
            { categoryThirdId:  { $in: objIds } },
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
async function processSegment(db, niche, segment, catMap, context) {
    let rendered = 0, written = 0, skipped = 0, errors = 0;

    // Build query
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
    const query = {
        appId: niche.appId,
        isActive: true,
        $or: [
            { endDate: { $gte: now } },
            { recurrenceRule: { $exists: true, $ne: null } },
        ],
        ...segmentFilter,
    };

    const events = await db.collection('events')
        .find(query, { projection: {
            _id: 1, title: 1, description: 1, startDate: 1, endDate: 1,
            recurrenceRule: 1, eventImage: 1, source: 1, isDiscovered: 1,
            forBeginners: 1, venueName: 1, masteredCityName: 1, venueCityName: 1,
            masteredCountryName: 1, ownerOrganizerName: 1, organizerName: 1,
        }})
        .toArray();

    context.log(`SEO_BuildContent: segment=${segment} niche=${niche.slug} — ${events.length} events`);

    for (const event of events) {
        const source = event.isDiscovered ? 'AI' : 'RO';
        const occurrences = expandOccurrences(event);

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
    }

    return { rendered, written, skipped, errors };
}

// ─── main build handler ──────────────────────────────────────────────────────

async function seoContentBuildHandler(context) {
    const startTs = Date.now();
    context.log(`SEO_BuildContent: starting build — SEO_WRITES_ENABLED=${SEO_WRITES_ENABLED}`);

    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        context.log('SEO_BuildContent: MONGODB_URI not set — aborting');
        return;
    }

    const summary = [];

    for (const niche of NICHES) {
        let mongoClient;
        try {
            mongoClient = new MongoClient(mongoUri);
            await mongoClient.connect();
            const dbName = mongoUri.match(/\/([^/?]+)(\?|$)/)?.[1] || 'TangoTiempoProd';
            const db = mongoClient.db(dbName);

            const catMap = await loadCategoryMap(db, niche.appId);
            context.log(`SEO_BuildContent: niche=${niche.slug} appId=${niche.appId} — ${Object.keys(catMap).length} categories loaded`);

            const segments = ['milonga', 'practica', 'travelworthy', 'beginner'];
            for (const segment of segments) {
                const stats = await processSegment(db, niche, segment, catMap, context);
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
    context.log(`SEO_BuildContent: done in ${elapsed}s — ${JSON.stringify(summary)}`);
}

// ─── timer trigger (nightly 3 AM UTC) ───────────────────────────────────────

app.timer('SEO_BuildContent', {
    schedule: '0 0 3 * * *',
    handler: seoContentBuildHandler,
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
        context.log('SEO_BuildContent_Manual: manually triggered');
        await seoContentBuildHandler(context);
        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ triggered: true, timestamp: new Date().toISOString() }),
        };
    },
});
