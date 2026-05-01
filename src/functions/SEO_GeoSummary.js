// src/functions/SEO_GeoSummary.js
// Domain: SEO — City geo summary for generateStaticParams and city page content
// Returns cities + parent groups with future event counts, category breakdowns, and
// travelWorthy/forBeginners counts. Pre-filtered by thin-content thresholds.
//
// URL hierarchy:
//   US cities:          /tango/[state]/[city]   (e.g. /tango/massachusetts/boston)
//   International:      /tango/[country]/[city] (e.g. /tango/australia/sydney)
//
// parentSlug on each city indicates which to use — Sarah's generateStaticParams reads it directly.
//
// CALBEAF-160: City SEO landing pages.
const { app } = require('@azure/functions');
const { MongoClient, ObjectId } = require('mongodb');
const { standardMiddleware } = require('../middleware');

const CITY_MIN_EVENTS  = 3;
const PARENT_MIN_CITIES = 2; // min qualifying cities for a parent (state/country) index page

const CLASSIFIER_LABELS = {
    travelWorthy: 'Travel-Worthy Tango Events',
    forBeginners: 'Beginner-Friendly Events'
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
 * GET /api/seo/geo-summary
 *
 * Query Parameters:
 * - appId (required): 1=TangoTiempo, 2=HarmonyJunction
 * - cityMin (optional): city min event threshold (default: 3)
 * - parentMin (optional): parent min qualifying city threshold (default: 2)
 * - parentSlug (optional): filter to one parent — state slug for US, country slug for intl
 * - citySlug (optional): filter to one city — use with parentSlug
 *
 * Response:
 * {
 *   cities: [{
 *     cityId, cityName, citySlug,
 *     parentSlug,    // state slug (US) or country slug (intl) — use for URL
 *     parentName,    // "Massachusetts" or "Australia"
 *     parentType,    // "state" | "country"
 *     countryCode,   // "US", "AU", etc.
 *     stateName,     // null for non-US
 *     stateCode,     // "MA", null for non-US
 *     countryName, countrySlug,
 *     futureEventCount, travelWorthyCount, forBeginnersCount,
 *     categories: [{ name, count }]
 *   }],
 *   parents: [{
 *     parentSlug, parentName, parentType, countryCode,
 *     qualifyingCityCount, futureEventCount, travelWorthyCount, forBeginnersCount
 *   }],
 *   classifierLabels, thresholds
 * }
 */
async function seoGeoSummaryHandler(request, context) {
    const appId = request.query.get('appId');
    if (!appId) {
        return { status: 400, headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'appId is required' }) };
    }

    const cityMin   = Math.max(1, parseInt(request.query.get('cityMin')    || String(CITY_MIN_EVENTS)));
    const parentMin = Math.max(1, parseInt(request.query.get('parentMin')  || String(PARENT_MIN_CITIES)));
    // Accept both countrySlug (new) and regionSlug (legacy alias)
    const filterParentSlug = request.query.get('parentSlug') ||
                             request.query.get('countrySlug') ||
                             request.query.get('regionSlug') || null;
    const filterCitySlug   = request.query.get('citySlug') || null;

    let mongoClient;
    try {
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) throw new Error('MongoDB connection string not configured');

        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();
        const db = mongoClient.db();
        const now = new Date();

        // Two-stage group: (cityId + category) → cityId rollup
        const cityAgg = await db.collection('events').aggregate([
            {
                $match: {
                    appId,
                    startDate: { $gte: now },
                    masteredCityId:   { $exists: true, $ne: null },
                    masteredCityName: { $exists: true, $ne: null }
                }
            },
            {
                $group: {
                    _id: { cityId: '$masteredCityId', category: '$categoryFirst' },
                    cityName:    { $first: '$masteredCityName' },
                    countryId:   { $first: '$masteredCountryId' },
                    countryName: { $first: '$masteredCountryName' },
                    count:             { $sum: 1 },
                    travelWorthyCount: { $sum: { $cond: ['$travelWorthy', 1, 0] } },
                    forBeginnersCount: { $sum: { $cond: ['$forBeginners', 1, 0] } }
                }
            },
            {
                $group: {
                    _id: '$_id.cityId',
                    cityName:    { $first: '$cityName' },
                    countryId:   { $first: '$countryId' },
                    countryName: { $first: '$countryName' },
                    futureEventCount:  { $sum: '$count' },
                    travelWorthyCount: { $sum: '$travelWorthyCount' },
                    forBeginnersCount: { $sum: '$forBeginnersCount' },
                    categories:        { $push: { name: '$_id.category', count: '$count' } }
                }
            },
            { $match: { futureEventCount: { $gte: cityMin } } },
            { $sort: { futureEventCount: -1 } }
        ]).toArray();

        // Fetch stateName/stateCode/countryCode from masteredcities for all qualifying cities
        const cityIds = cityAgg
            .map(c => c._id)
            .filter(id => id != null);

        const cityDocs = await db.collection('masteredcities').find(
            { _id: { $in: cityIds } },
            { projection: { stateName: 1, stateCode: 1, countryCode: 1 } }
        ).toArray();
        const cityMeta = new Map(cityDocs.map(d => [d._id.toString(), d]));

        // Country lookup — fallback when event-doc masteredCountryName isn't denormalized
        // (affects 13 international cities on PROD: Berlin, Milan, Naples, etc.)
        const countries = await db.collection('masteredcountries')
            .find({ appId }, { projection: { countryName: 1, countryCode: 1 } })
            .toArray();
        const countryNameByCode = new Map(
            countries.map(c => [c.countryCode || '', c.countryName])
        );

        // Build city list — determine parentSlug (state for US, country for intl)
        // Country fallback chain: event countryName → masteredcountries lookup by code
        let cities = cityAgg.map(c => {
            const id = c._id ? c._id.toString() : null;
            const meta = id ? (cityMeta.get(id) || {}) : {};
            const countryCode  = meta.countryCode || null;
            const stateName    = meta.stateName || null;
            const stateCode    = meta.stateCode || null;
            const countryName  = c.countryName || countryNameByCode.get(countryCode) || null;
            const countrySlug  = toSlug(countryName);
            const isUS         = countryCode === 'US';
            const parentName   = isUS && stateName ? stateName : countryName;
            const parentSlug   = toSlug(parentName);
            const parentType   = isUS && stateName ? 'state' : 'country';

            return {
                cityId:    id,
                cityName:  c.cityName,
                citySlug:  toSlug(c.cityName),
                parentSlug,
                parentName,
                parentType,
                countryCode,
                stateName,
                stateCode,
                countryName,
                countrySlug,
                futureEventCount:  c.futureEventCount,
                travelWorthyCount: c.travelWorthyCount,
                forBeginnersCount: c.forBeginnersCount,
                categories: (c.categories || [])
                    .filter(cat => cat.name)
                    .sort((a, b) => b.count - a.count)
            };
        }).filter(c => c.cityId && c.parentSlug);
        // Defensive: drop any city with empty parentSlug — these would produce
        // /tango//{city} URLs that break Vercel's Next.js generateStaticParams.

        if (filterParentSlug) cities = cities.filter(c => c.parentSlug === filterParentSlug);
        if (filterCitySlug)   cities = cities.filter(c => c.citySlug   === filterCitySlug);

        // Derive parent groups (states for US, countries for intl)
        const parentMap = new Map();
        for (const city of cities) {
            const key = city.parentSlug;
            if (!key) continue;
            if (!parentMap.has(key)) {
                parentMap.set(key, {
                    parentSlug:  city.parentSlug,
                    parentName:  city.parentName,
                    parentType:  city.parentType,
                    countryCode: city.countryCode,
                    qualifyingCityCount: 0,
                    futureEventCount:    0,
                    travelWorthyCount:   0,
                    forBeginnersCount:   0
                });
            }
            const p = parentMap.get(key);
            p.qualifyingCityCount  += 1;
            p.futureEventCount     += city.futureEventCount;
            p.travelWorthyCount    += city.travelWorthyCount;
            p.forBeginnersCount    += city.forBeginnersCount;
        }

        const parents = Array.from(parentMap.values())
            .filter(p => filterParentSlug || p.qualifyingCityCount >= parentMin)
            .sort((a, b) => b.futureEventCount - a.futureEventCount);

        context.log(`SEO_GeoSummary: appId=${appId} → ${cities.length} cities, ${parents.length} parents`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cities, parents, classifierLabels: CLASSIFIER_LABELS,
                thresholds: { cityMinEvents: cityMin, parentMinCities: parentMin }
            })
        };
    } catch (err) {
        context.log.error('SEO_GeoSummary error:', err);
        return { status: 500, headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Internal server error' }) };
    } finally {
        if (mongoClient) await mongoClient.close();
    }
}

app.http('SEO_GeoSummary', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'seo/geo-summary',
    handler: standardMiddleware(seoGeoSummaryHandler)
});
