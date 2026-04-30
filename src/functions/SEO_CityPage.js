// src/functions/SEO_CityPage.js
// Domain: SEO — Rich city page data for /tango/[state]/[city] landing pages
// Returns 6-month event summary, category breakdown, organizer list, top events,
// and adaptive CTA mode based on organizer count (< 7 = recruit organizers, ≥ 7 = recruit users).
//
// CALBEAF-160: City/state SEO landing pages — organizer + user acquisition.
const { app } = require('@azure/functions');
const { MongoClient, ObjectId } = require('mongodb');
const { standardMiddleware } = require('../middleware');

const ORGANIZER_ACQUISITION_THRESHOLD = 7; // below this → organizer-recruitment mode
const WINDOW_DAYS = 180;                    // 6-month event horizon

// Human-readable category labels for SEO copy
const CATEGORY_LABELS = {
    Milonga:   'Milongas',
    Practica:  'Practicas',
    Class:     'Classes',
    Classes:   'Classes',
    Festival:  'Festivals',
    Marathon:  'Marathons',
    Encuentro: 'Encuentros',
    Workshop:  'Workshops',
};

const CLASSIFIER_LABELS = {
    travelWorthy: 'Travel-Worthy Tango Events',
    forBeginners: 'Beginner-Friendly Events'
};

// CTA copy blocks — used directly by Sarah's page templates
const CTA = {
    organizerAcquisition: {
        headline: 'Is your tango community missing from this page?',
        body: 'If you\'re a tango organizer — it\'s FREE. Apply here and get your events listed.',
        applyLabel: 'Apply as an Organizer — Free',
        applyPath: '/organizers/apply',
    },
    userAcquisition: {
        headline: 'Find tango near you',
        body: 'Share this site with your tango buddies — free calendar, no ads.',
        loginLabel: 'Create a free account',
        loginPath: '/auth/signup',
        shareMessage: 'Share with your tango buddies',
    }
};

function toSlug(name) {
    if (!name) return '';
    return name
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * GET /api/seo/city-page
 *
 * Query Parameters:
 * - appId (required): 1=TangoTiempo, 2=HarmonyJunction
 * - regionSlug (required): e.g. "massachusetts"
 * - citySlug (required): e.g. "boston"
 *
 * Response:
 * {
 *   city: { cityId, cityName, citySlug, regionId, regionName, regionSlug, lat, lng },
 *   mode: "organizer-acquisition" | "user-acquisition",
 *   summary: { futureEventCount, travelWorthyCount, forBeginnersCount, organizerCount, windowDays },
 *   categories: [{ name, label, count }],  // sorted by count desc
 *   topOrganizers: [{ organizerId, name, shortName }],  // up to 10
 *   topEvents: {
 *     travelWorthy: [{ eventId, name, startDate }],   // up to 3
 *     forBeginners: [{ eventId, name, startDate }]    // up to 3
 *   },
 *   cta: { ... },           // adaptive CTA block based on mode
 *   mapCenterUrl: string,   // deep-link to TT app centered on this city
 *   classifierLabels: { travelWorthy, forBeginners }
 * }
 */
async function seoCityPageHandler(request, context) {
    const appId = request.query.get('appId');
    // Accept parentSlug (new) or regionSlug/countrySlug (legacy aliases)
    const regionSlug = request.query.get('parentSlug') ||
                       request.query.get('regionSlug') ||
                       request.query.get('countrySlug');
    const citySlug = request.query.get('citySlug');

    if (!appId || !regionSlug || !citySlug) {
        return {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'appId, parentSlug (or regionSlug), and citySlug are required' })
        };
    }

    let mongoClient;
    try {
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) throw new Error('MongoDB connection string not configured');

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();
        const db = mongoClient.db();

        // --- 1. Resolve city from masteredcities by citySlug + parent disambiguation ---
        // parentSlug accepts EITHER state slug (US, e.g. "massachusetts") OR country slug
        // (e.g. "united-states"). Multiple matches are disambiguated by event count.
        // Critical for Portland (OR vs ME) — without this, the first masteredcity wins silently.
        const candidates = await db.collection('masteredcities')
            .find({ appId },
                { projection: { cityName: 1, masteredRegionId: 1, location: 1,
                                stateName: 1, stateCode: 1, countryCode: 1 } })
            .toArray();

        // Country lookup for non-US parent slug matching
        const countries = await db.collection('masteredcountries')
            .find({ appId }, { projection: { countryName: 1, countryCode: 1 } })
            .toArray();
        const countryNameByCode = new Map(
            countries.map(c => [c.countryCode || '', c.countryName])
        );

        // Filter candidates by citySlug, then by parentSlug matching either state or country
        const slugMatches = candidates.filter(c => toSlug(c.cityName) === citySlug);
        const parentMatches = slugMatches.filter(c => {
            const isUS = c.countryCode === 'US';
            const stateSlugForCity   = c.stateName ? toSlug(c.stateName) : null;
            const countryName        = countryNameByCode.get(c.countryCode || '');
            const countrySlugForCity = countryName ? toSlug(countryName) : null;
            // Match against either parent type — supports both /tango/[state]/[city] and /tango/[country]/[city]
            return (isUS && stateSlugForCity === regionSlug) || countrySlugForCity === regionSlug;
        });

        if (parentMatches.length === 0) {
            return { status: 404, headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'City not found in that parent (state/country)' }) };
        }

        // Disambiguate when multiple candidates (e.g. Portland under "united-states" matches both OR and ME)
        // by selecting the one with the most upcoming events.
        let cityDoc = parentMatches[0];
        if (parentMatches.length > 1) {
            const nowForCount = new Date();
            const counts = await Promise.all(parentMatches.map(c =>
                db.collection('events').countDocuments({
                    appId, masteredCityId: c._id,
                    startDate: { $gte: nowForCount }
                })
            ));
            const winnerIdx = counts.reduce((bestIdx, n, i) => n > counts[bestIdx] ? i : bestIdx, 0);
            cityDoc = parentMatches[winnerIdx];
            context.log(`SEO_CityPage: ${parentMatches.length} candidates for ${regionSlug}/${citySlug}, picked ${cityDoc.cityName} (${counts[winnerIdx]} events)`);
        }

        // Look up region doc for response shape (legacy regionName field)
        const regionDoc = cityDoc.masteredRegionId
            ? await db.collection('masteredregions').findOne(
                { _id: new ObjectId(cityDoc.masteredRegionId.toString()) },
                { projection: { regionName: 1 } }
              )
            : null;

        const cityId = cityDoc._id;
        const lat = cityDoc.location?.coordinates?.[1] ?? null;
        const lng = cityDoc.location?.coordinates?.[0] ?? null;

        // --- 2. Aggregate events — 6-month window, grouped by category ---
        const now = new Date();
        const horizon = new Date(now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);

        const [eventAgg, travelWorthyTop, forBeginnersTop] = await Promise.all([
            // Category + classifier counts
            db.collection('events').aggregate([
                {
                    $match: {
                        appId,
                        masteredCityId: cityId,
                        startDate: { $gte: now, $lte: horizon }
                    }
                },
                {
                    $group: {
                        _id: '$categoryFirst',
                        count:             { $sum: 1 },
                        travelWorthyCount: { $sum: { $cond: ['$travelWorthy', 1, 0] } },
                        forBeginnersCount: { $sum: { $cond: ['$forBeginners', 1, 0] } }
                    }
                }
            ]).toArray(),

            // Top 3 travelWorthy events by title (for AI extractability)
            db.collection('events').find(
                { appId, masteredCityId: cityId, travelWorthy: true, startDate: { $gte: now, $lte: horizon } },
                { projection: { title: 1, startDate: 1 } }
            ).sort({ startDate: 1 }).limit(3).toArray(),

            // Top 3 forBeginners events
            db.collection('events').find(
                { appId, masteredCityId: cityId, forBeginners: true, startDate: { $gte: now, $lte: horizon } },
                { projection: { title: 1, startDate: 1 } }
            ).sort({ startDate: 1 }).limit(3).toArray()
        ]);

        // Featured events (paid promoted) — limit 6, future events only, sorted by start
        const featuredTop = await db.collection('events').find(
            { appId, masteredCityId: cityId, isFeatured: true, startDate: { $gte: now } },
            { projection: { title: 1, startDate: 1, locationName: 1, categoryFirst: 1, featuredImage: 1 } }
        ).sort({ startDate: 1 }).limit(6).toArray();

        // Summarize counts across all categories
        let futureEventCount = 0, travelWorthyCount = 0, forBeginnersCount = 0;
        const categoryMap = {};
        for (const row of eventAgg) {
            futureEventCount  += row.count;
            travelWorthyCount += row.travelWorthyCount;
            forBeginnersCount += row.forBeginnersCount;
            if (row._id) categoryMap[row._id] = row.count;
        }

        // Build sorted category list — include travelWorthy + forBeginners as classifier rows
        const categoriesRaw = Object.entries(categoryMap)
            .map(([name, count]) => ({
                name,
                label: CATEGORY_LABELS[name] || (name + 's'),
                count
            }))
            .sort((a, b) => b.count - a.count);

        const classifierRows = [];
        if (travelWorthyCount > 0) classifierRows.push({ name: 'travelWorthy', label: CLASSIFIER_LABELS.travelWorthy, count: travelWorthyCount });
        if (forBeginnersCount > 0) classifierRows.push({ name: 'forBeginners', label: CLASSIFIER_LABELS.forBeginners, count: forBeginnersCount });

        const categories = [...categoriesRaw, ...classifierRows];

        // --- 3. Organizers for this city (via events, sorted by eventCount desc) ---
        // Organizer docs don't reliably have masteredCityId — go through events instead.
        // isDiscovered: false — organizer-posted events only (AI events have no real organizer).
        const orgEventAgg = await db.collection('events').aggregate([
            {
                $match: {
                    appId, masteredCityId: cityId,
                    startDate: { $gte: now, $lte: horizon },
                    isDiscovered: { $ne: true },
                    ownerOrganizerID: { $exists: true, $ne: null }
                }
            },
            { $group: { _id: '$ownerOrganizerID', eventCount: { $sum: 1 } } },
            { $sort: { eventCount: -1 } },
            { $limit: 10 }
        ]).toArray();

        const orgObjectIds = orgEventAgg
            .map(a => { try { return new ObjectId(a._id.toString()); } catch { return null; } })
            .filter(Boolean);

        const organizerDocs = orgObjectIds.length > 0
            ? await db.collection('organizers').find(
                // wantRender filter: skip organizers who haven't opted into FE rendering —
                // their /organizers/{shortName} pages can't render and city-page links would 404.
                { _id: { $in: orgObjectIds }, isVisible: { $ne: false }, wantRender: { $ne: false } },
                { projection: { organizerName: 1, shortName: 1, images: { $slice: 1 } } }
              ).toArray()
            : [];

        const orgDocMap = new Map(organizerDocs.map(o => [o._id.toString(), o]));

        // Build topOrganizers by joining the event-side aggregation with the renderable
        // organizer docs. Drop entries with no matching doc (filtered out by wantRender).
        const topOrganizers = orgEventAgg
            .map(a => {
                const org = orgDocMap.get(a._id.toString());
                if (!org) return null;
                return {
                    organizerId: a._id.toString(),
                    name:        org.organizerName || org.shortName || '',
                    shortName:   org.shortName || '',
                    eventCount:  a.eventCount,
                    imageUrl:    org.images?.[0]?.originalUrl || null
                };
            })
            .filter(o => o && o.name);

        // organizerCount reflects the renderable list (drives both display + mode)
        const organizerCount = topOrganizers.length;

        // --- 4. Adaptive mode ---
        const mode = organizerCount < ORGANIZER_ACQUISITION_THRESHOLD
            ? 'organizer-acquisition'
            : 'user-acquisition';

        // --- 5. MapCenter deep-link ---
        // (numbering: 4=mode, 5=mapCenter, 6=nearbyCities)
        // Sarah confirmed: no URL param support yet — stub as /calendar.
        // Will upgrade to ?lat=&lng=&zoom= when TIEMPO-451 lands.
        const mapCenterUrl = '/calendar';

        // --- 6. Nearby cities — top 3 by proximity using stored coordinates ---
        let nearbyCities = [];
        if (lat !== null && lng !== null) {
            const NEARBY_MILES = 150;
            const NEARBY_METERS = NEARBY_MILES * 1609.34;
            const nearbyDocs = await db.collection('masteredcities').aggregate([
                {
                    $geoNear: {
                        near: { type: 'Point', coordinates: [lng, lat] },
                        distanceField: 'distanceMeters',
                        maxDistance: NEARBY_METERS,
                        spherical: true,
                        query: { appId, _id: { $ne: cityId } }
                    }
                },
                { $limit: 3 },
                { $project: { cityName: 1, masteredRegionId: 1, distanceMeters: 1 } }
            ]).toArray();

            nearbyCities = nearbyDocs.map(n => ({
                cityId:   n._id.toString(),
                cityName: n.cityName,
                citySlug: toSlug(n.cityName),
                distanceMiles: Math.round(n.distanceMeters / 1609.34)
            }));
        }

        context.log(`SEO_CityPage: ${citySlug}/${regionSlug} mode=${mode} events=${futureEventCount} organizers=${organizerCount}`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                city: {
                    cityId:     cityId.toString(),
                    cityName:   cityDoc.cityName,
                    citySlug,
                    regionId:   regionDoc ? regionDoc._id.toString() : null,
                    regionName: regionDoc?.regionName || null,
                    regionSlug,
                    lat,
                    lng
                },
                mode,
                summary: {
                    futureEventCount,
                    travelWorthyCount,
                    forBeginnersCount,
                    organizerCount,
                    windowDays: WINDOW_DAYS
                },
                categories,
                topOrganizers,
                topEvents: {
                    featured: featuredTop.map(e => ({
                        eventId:       e._id.toString(),
                        name:          e.title || '',
                        startDate:     e.startDate,
                        venueName:     e.locationName || null,
                        categoryFirst: e.categoryFirst || null,
                        featuredImage: e.featuredImage || null,
                        url:           `/calendar?event=${e._id.toString()}`
                    })),
                    travelWorthy: travelWorthyTop.map(e => ({
                        eventId:   e._id.toString(),
                        name:      e.title || '',
                        startDate: e.startDate
                    })),
                    forBeginners: forBeginnersTop.map(e => ({
                        eventId:   e._id.toString(),
                        name:      e.title || '',
                        startDate: e.startDate
                    }))
                },
                cta: mode === 'organizer-acquisition' ? CTA.organizerAcquisition : CTA.userAcquisition,
                mapCenterUrl,
                nearbyCities,
                classifierLabels: CLASSIFIER_LABELS
            })
        };
    } catch (err) {
        context.log.error('SEO_CityPage error:', err);
        return {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Internal server error' })
        };
    } finally {
        if (mongoClient) await mongoClient.close();
    }
}

app.http('SEO_CityPage', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'seo/city-page',
    handler: standardMiddleware(seoCityPageHandler)
});
