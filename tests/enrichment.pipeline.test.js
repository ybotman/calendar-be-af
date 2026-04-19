// tests/enrichment.pipeline.test.js
// Integration tests for runDataQualityPipeline (the orchestrator).
// Mongo is mocked — these test the wiring (niche guard, category gate,
// override semantics, classifier integration, travelWorthy compute,
// country denorm, venue resolution, DQ warn-only checks).

const { ObjectId } = require('mongodb');
const { runDataQualityPipeline } = require('../src/utils/enrichment');

// ============================================
// Mock helpers — minimal Mongo-like surface
// ============================================

function makeMockDb({ categories = [], regions = [], countries = [], venues = [] } = {}) {
    const collections = {
        categories: makeCollection(categories),
        masteredregions: makeCollection(regions),
        masteredcountries: makeCollection(countries),
        venues: makeCollection(venues),
    };
    return { collection: name => collections[name] || makeCollection([]) };
}

function makeCollection(docs) {
    return {
        find(query) {
            const matches = docs.filter(d => matchesQuery(d, query || {}));
            return {
                project: () => ({ toArray: async () => matches }),
                toArray: async () => matches,
            };
        },
        findOne: async (query, opts) => {
            return docs.find(d => matchesQuery(d, query || {})) || null;
        },
    };
}

function matchesQuery(doc, query) {
    return Object.entries(query).every(([k, v]) => {
        if (v && v.constructor && v.constructor.name === 'ObjectId') {
            return doc[k] && doc[k].toString() === v.toString();
        }
        return doc[k] === v;
    });
}

// Standard fixture data — Tango categories + region/country/venue
const CLASS_ID = new ObjectId();
const WORKSHOP_ID = new ObjectId();
const PRACTICA_ID = new ObjectId();
const MILONGA_ID = new ObjectId();
const FESTIVAL_ID = new ObjectId();
const REGION_ID = new ObjectId();
const COUNTRY_ID = new ObjectId();
const VENUE_ID = new ObjectId();

const STANDARD_CATEGORIES = [
    { _id: CLASS_ID, appId: '1', categoryName: 'Class' },
    { _id: WORKSHOP_ID, appId: '1', categoryName: 'Workshop' },
    { _id: PRACTICA_ID, appId: '1', categoryName: 'Practica' },
    { _id: MILONGA_ID, appId: '1', categoryName: 'Milonga' },
    { _id: FESTIVAL_ID, appId: '1', categoryName: 'Festival' },
];
const STANDARD_REGIONS = [
    { _id: REGION_ID, masteredCountryId: COUNTRY_ID },
];
const STANDARD_COUNTRIES = [
    { _id: COUNTRY_ID, countryName: 'United States' },
];
const STANDARD_VENUES = [
    { _id: VENUE_ID, name: 'Mango Studio', geolocation: { type: 'Point', coordinates: [-71.1, 42.4] }, masteredCityName: 'Cambridge', timezone: 'America/New_York' },
];

const standardDb = () => makeMockDb({
    categories: STANDARD_CATEGORIES,
    regions: STANDARD_REGIONS,
    countries: STANDARD_COUNTRIES,
    venues: STANDARD_VENUES,
});

const baseEvent = (overrides = {}) => ({
    _id: new ObjectId(),
    appId: '1',
    title: 'Beginner Tango Series',
    description: 'A 6-week beginner tango series.',
    categoryFirstId: CLASS_ID,
    masteredRegionId: REGION_ID,
    venueID: VENUE_ID,
    startDate: new Date('2026-04-20T19:00:00Z'),
    endDate: new Date('2026-04-20T20:30:00Z'),
    ownerOrganizerID: new ObjectId(),
    ...overrides,
});

// ============================================
// Reset module cache between tests — eventClassification.js caches per cold start
// ============================================
beforeEach(() => {
    jest.resetModules();
});

describe('runDataQualityPipeline — niche guard', () => {
    test('skips classification for non-Tango appId', async () => {
        const { runDataQualityPipeline } = require('../src/utils/enrichment');
        const event = baseEvent({ appId: '7' });  // appId 7 = OpeningBlitz (Chess)
        const db = makeMockDb({ categories: [], regions: STANDARD_REGIONS, countries: STANDARD_COUNTRIES, venues: STANDARD_VENUES });
        const { event: enriched, report } = await runDataQualityPipeline(event, db, { appId: '7' });

        // Beginner classification skipped
        expect(report.skipped.find(s => s.field === 'forBeginners/beginnerFriendly')).toBeDefined();
        expect(report.skipped.find(s => s.field === 'forBeginners/beginnerFriendly').reason).toMatch(/outside Tango niche/);
        // forBeginners/friendly should not be set by classifier
        expect(enriched.forBeginners).toBeUndefined();
    });

    test('runs classifier for appId=1 (TangoTiempo)', async () => {
        const { runDataQualityPipeline } = require('../src/utils/enrichment');
        const event = baseEvent();
        const db = standardDb();
        const { event: enriched } = await runDataQualityPipeline(event, db);
        expect(enriched.forBeginners).toBe(true);  // "Beginner Tango Series" → positive
        expect(enriched.beginnerFriendly).toBe(true);  // superset
    });
});

describe('runDataQualityPipeline — category gate', () => {
    test('Class category → classifier runs', async () => {
        const { runDataQualityPipeline } = require('../src/utils/enrichment');
        const { event } = await runDataQualityPipeline(baseEvent(), standardDb());
        expect(event.forBeginners).toBe(true);
    });

    test('Workshop category → classifier runs', async () => {
        const { runDataQualityPipeline } = require('../src/utils/enrichment');
        const { event } = await runDataQualityPipeline(baseEvent({ categoryFirstId: WORKSHOP_ID }), standardDb());
        expect(event.forBeginners).toBe(true);
    });

    test('Festival category → forBeg hard-false (Toby 2026-04-18 rule: Festival ineligible)', async () => {
        // Even "Free Beginner Tango Festival" returns forBeg=false under new rule.
        // friendly can still be true if an explicit friendly-only pattern matches (e.g. "All Levels")
        // but a plain "Beginner" title is not a friendly-only signal → friendly=false here.
        const { runDataQualityPipeline } = require('../src/utils/enrichment');
        const { event } = await runDataQualityPipeline(
            baseEvent({ categoryFirstId: FESTIVAL_ID, title: 'Free Beginner Tango Festival' }),
            standardDb()
        );
        expect(event.forBeginners).toBe(false);  // category gate
        expect(event.beginnerFriendly).toBe(false);  // strict-threshold: "Beginner" alone isn't friendly-only
    });

    test('Festival with explicit All-Levels in title → friendly=true (strict threshold hit)', async () => {
        const { runDataQualityPipeline } = require('../src/utils/enrichment');
        const { event } = await runDataQualityPipeline(
            baseEvent({ categoryFirstId: FESTIVAL_ID, title: 'Boston Tango Festival — All Levels Welcome' }),
            standardDb()
        );
        expect(event.forBeginners).toBe(false);
        expect(event.beginnerFriendly).toBe(true);  // "All Levels" is §1b friendly-only signal
    });

    test('Practica category → forced false (category gate)', async () => {
        const { runDataQualityPipeline } = require('../src/utils/enrichment');
        const event = baseEvent({ categoryFirstId: PRACTICA_ID, title: 'Beginner Practica' });  // tries to be beginner
        const { event: enriched, report } = await runDataQualityPipeline(event, standardDb());
        expect(enriched.forBeginners).toBe(false);
        expect(enriched.beginnerFriendly).toBe(false);
        // Should record a category-gate action
        const gateAction = report.actions.find(a => a.source === 'category-gate');
        expect(gateAction).toBeDefined();
    });

    test('Milonga category → forced false', async () => {
        const { runDataQualityPipeline } = require('../src/utils/enrichment');
        const event = baseEvent({ categoryFirstId: MILONGA_ID, title: 'Beginner Friendly Milonga' });
        const { event: enriched } = await runDataQualityPipeline(event, standardDb());
        expect(enriched.forBeginners).toBe(false);
        expect(enriched.beginnerFriendly).toBe(false);
    });
});

describe('runDataQualityPipeline — override semantics', () => {
    test('forBeginnersOverride=true wins over computed false', async () => {
        const { runDataQualityPipeline } = require('../src/utils/enrichment');
        // Title would compute false (no beginner signal)
        const event = baseEvent({ title: 'Tango Class', description: '' , forBeginnersOverride: true });
        const { event: enriched } = await runDataQualityPipeline(event, standardDb());
        expect(enriched.forBeginners).toBe(true);  // override wins
    });

    test('forBeginnersOverride=false wins over computed true', async () => {
        const { runDataQualityPipeline } = require('../src/utils/enrichment');
        const event = baseEvent({ title: 'Beginner Series', forBeginnersOverride: false });
        const { event: enriched } = await runDataQualityPipeline(event, standardDb());
        expect(enriched.forBeginners).toBe(false);  // override wins
    });

    test('null override → computed value used', async () => {
        const { runDataQualityPipeline } = require('../src/utils/enrichment');
        const event = baseEvent({ forBeginnersOverride: null });
        const { event: enriched } = await runDataQualityPipeline(event, standardDb());
        expect(enriched.forBeginners).toBe(true);  // computed wins
    });

    test('initializes override fields to null when missing', async () => {
        const { runDataQualityPipeline } = require('../src/utils/enrichment');
        const event = baseEvent();
        delete event.forBeginnersOverride;
        delete event.beginnerFriendlyOverride;
        delete event.travelWorthyOverride;
        const { event: enriched } = await runDataQualityPipeline(event, standardDb());
        expect(enriched.forBeginnersOverride).toBeNull();
        expect(enriched.beginnerFriendlyOverride).toBeNull();
        expect(enriched.travelWorthyOverride).toBeNull();
    });
});

describe('runDataQualityPipeline — travelWorthy', () => {
    test('class event under 24h → travelWorthy=false', async () => {
        const { runDataQualityPipeline } = require('../src/utils/enrichment');
        const { event } = await runDataQualityPipeline(baseEvent(), standardDb());
        expect(event.travelWorthy).toBe(false);  // 1.5h Class
    });

    test('Festival > 24h with non-excluded category → travelWorthy=true', async () => {
        const { runDataQualityPipeline } = require('../src/utils/enrichment');
        const event = baseEvent({
            categoryFirstId: FESTIVAL_ID,
            startDate: new Date('2026-04-20T00:00:00Z'),
            endDate: new Date('2026-04-23T00:00:00Z'),  // 3 days
        });
        const { event: enriched } = await runDataQualityPipeline(event, standardDb());
        expect(enriched.travelWorthy).toBe(true);
    });
});

describe('runDataQualityPipeline — country denorm', () => {
    test('null masteredCountryId → derives from masteredRegionId chain', async () => {
        const { runDataQualityPipeline } = require('../src/utils/enrichment');
        const event = baseEvent({ masteredCountryId: null, masteredCountryName: null });
        const { event: enriched, report } = await runDataQualityPipeline(event, standardDb());
        expect(enriched.masteredCountryId.toString()).toBe(COUNTRY_ID.toString());
        expect(enriched.masteredCountryName).toBe('United States');
        expect(report.actions.find(a => a.field === 'masteredCountryId')).toBeDefined();
    });

    test('already-set masteredCountryId → preserved (priority 1, CALBEAF-113)', async () => {
        // CALBEAF-113 5-priority chain: priority 1 (already-set country) preserves.
        // Pipeline never overwrites correctly-set country data.
        const { runDataQualityPipeline } = require('../src/utils/enrichment');
        const customCountryId = new ObjectId();
        const event = baseEvent({ masteredCountryId: customCountryId, masteredCountryName: 'Custom' });
        const { event: enriched, report } = await runDataQualityPipeline(event, standardDb());
        expect(enriched.masteredCountryId.toString()).toBe(customCountryId.toString());
        expect(enriched.masteredCountryName).toBe('Custom');
        expect(report.skipped.find(s => s.field === 'masteredCountryId' && s.reason === 'already set')).toBeDefined();
    });

    test('no region + no derivation source → skipped with chain-failure reason (CALBEAF-113)', async () => {
        // With CALBEAF-113 5-priority chain, when no region AND venue chain can't resolve,
        // the skipped reason describes why chain failed (not just "no masteredRegionId").
        const { runDataQualityPipeline } = require('../src/utils/enrichment');
        const event = baseEvent({ masteredRegionId: null, masteredCountryId: null });
        // Venue exists in standardDb but has no masteredCityId → chain fails at that level
        const { report } = await runDataQualityPipeline(event, standardDb());
        const entry = report.skipped.find(s => s.field === 'masteredCountryId');
        expect(entry).toBeDefined();
        expect(entry.reason).toMatch(/no derivation source/);
    });

    test('CALBEAF-113 Priority 4 venue-chain fallback → country resolved from venue.masteredCityId', async () => {
        const { runDataQualityPipeline } = require('../src/utils/enrichment');
        // Build a db mock where the venue has masteredCityId → city has masteredDivisionId → division has masteredRegionId → region has masteredCountryId
        const CITY_ID = new ObjectId();
        const DIV_ID = new ObjectId();
        const venueDocs = [{ _id: VENUE_ID, masteredCityId: CITY_ID, geolocation: { type: 'Point', coordinates: [-71.1, 42.4] }, masteredCityName: 'Cambridge', timezone: 'America/New_York' }];
        const cityDocs = [{ _id: CITY_ID, masteredDivisionId: DIV_ID }];
        const divDocs = [{ _id: DIV_ID, masteredRegionId: REGION_ID }];
        const regionDocs = [{ _id: REGION_ID, masteredCountryId: COUNTRY_ID }];
        const countryDocs = [{ _id: COUNTRY_ID, countryName: 'United States' }];
        const chainDb = makeMockDb({
            categories: STANDARD_CATEGORIES,
            regions: regionDocs,
            countries: countryDocs,
            venues: venueDocs,
        });
        // Add masteredcities + mastereddivisions to db mock (not in original factory)
        const originalCollection = chainDb.collection;
        chainDb.collection = (name) => {
            if (name === 'masteredcities') return { find: () => ({ toArray: async () => cityDocs, project: () => ({ toArray: async () => cityDocs }) }), findOne: async (q) => cityDocs.find(d => d._id.toString() === q._id.toString()) || null };
            if (name === 'mastereddivisions') return { find: () => ({ toArray: async () => divDocs }), findOne: async (q) => divDocs.find(d => d._id.toString() === q._id.toString()) || null };
            return originalCollection(name);
        };
        const event = baseEvent({ masteredRegionId: null, masteredCountryId: null, masteredCityId: null });
        // venueID is present (from baseEvent); venue has masteredCityId → chain resolves
        const { event: enriched, report } = await runDataQualityPipeline(event, chainDb);
        expect(enriched.masteredCountryId).toBeDefined();
        expect(enriched.masteredCountryId.toString()).toBe(COUNTRY_ID.toString());
        expect(enriched.masteredCountryName).toBe('United States');
        expect(report.actions.find(a => a.field === 'masteredCountryId' && a.source === 'venue-chain')).toBeDefined();
    });

    test('no masteredRegionId but existing country — preserved, not nulled (AIDI blocker 2)', async () => {
        const { runDataQualityPipeline } = require('../src/utils/enrichment');
        const preservedId = new ObjectId();
        const event = baseEvent({
            masteredRegionId: null,
            masteredCountryId: preservedId,
            masteredCountryName: 'PreservedCountry'
        });
        const { event: enriched } = await runDataQualityPipeline(event, standardDb());
        // Preserved — don't destroy valid upstream data when we can't recompute
        expect(enriched.masteredCountryId.toString()).toBe(preservedId.toString());
        expect(enriched.masteredCountryName).toBe('PreservedCountry');
    });
});

describe('runDataQualityPipeline — venue resolution', () => {
    test('venueID provided → resolves geolocation, city, timezone', async () => {
        const { runDataQualityPipeline } = require('../src/utils/enrichment');
        const event = baseEvent();
        delete event.venueGeolocation;
        delete event.venueCityName;
        delete event.venueTimezone;
        const { event: enriched, report } = await runDataQualityPipeline(event, standardDb());
        expect(enriched.venueGeolocation).toBeDefined();
        expect(enriched.venueCityName).toBe('Cambridge');
        expect(enriched.venueTimezone).toBe('America/New_York');
        expect(report.actions.find(a => a.field === 'venueTimezone')).toBeDefined();
    });

    test('no venueID → skipped with diagnostic value', async () => {
        const { runDataQualityPipeline } = require('../src/utils/enrichment');
        const event = baseEvent({ venueID: null });
        const { report } = await runDataQualityPipeline(event, standardDb());
        const entry = report.skipped.find(s => s.field === 'venueResolution' && s.reason.startsWith('no venueID'));
        expect(entry).toBeDefined();
        expect(entry.reason).toContain('null');  // diagnostic — shows observed value
    });

    test('key-case typo (venueId vs venueID) → diagnostic note in skipped reason', async () => {
        const { runDataQualityPipeline } = require('../src/utils/enrichment');
        const event = baseEvent({ venueID: null });
        event.venueId = new ObjectId().toString();  // typo: lowercase-d
        const { report } = await runDataQualityPipeline(event, standardDb());
        const entry = report.skipped.find(s => s.field === 'venueResolution');
        expect(entry.reason).toMatch(/key-case mismatch/);
    });

    test('venueID does not match → skipped with reason', async () => {
        const { runDataQualityPipeline } = require('../src/utils/enrichment');
        const event = baseEvent({ venueID: new ObjectId() });  // bogus id
        delete event.venueGeolocation;
        const { report } = await runDataQualityPipeline(event, standardDb());
        expect(report.skipped.find(s => s.field === 'venueResolution' && s.reason.includes('not found'))).toBeDefined();
    });
});

describe('runDataQualityPipeline — DQ warn-only checks', () => {
    test('endDate < startDate → warn (not reject)', async () => {
        const { runDataQualityPipeline } = require('../src/utils/enrichment');
        const event = baseEvent({
            startDate: new Date('2026-04-20T20:00:00Z'),
            endDate: new Date('2026-04-20T19:00:00Z'),  // before start
        });
        const { event: enriched, report } = await runDataQualityPipeline(event, standardDb());
        expect(enriched.title).toBe('Beginner Tango Series');  // pipeline did not reject
        expect(report.skipped.find(s => s.field === 'dateSanity' && s.reason.includes('endDate < startDate'))).toBeDefined();
    });

    test('duration > 7d → warn', async () => {
        const { runDataQualityPipeline } = require('../src/utils/enrichment');
        const event = baseEvent({
            startDate: new Date('2026-04-20T00:00:00Z'),
            endDate: new Date('2026-05-05T00:00:00Z'),  // 15d
        });
        const { report } = await runDataQualityPipeline(event, standardDb());
        expect(report.skipped.find(s => s.field === 'dateSanity' && s.reason.includes('> 7d'))).toBeDefined();
    });

    test('missing required field → warn', async () => {
        const { runDataQualityPipeline } = require('../src/utils/enrichment');
        const event = baseEvent();
        delete event.ownerOrganizerID;
        const { report } = await runDataQualityPipeline(event, standardDb());
        expect(report.skipped.find(s => s.field === 'ownerOrganizerID' && s.reason.includes('missing required field'))).toBeDefined();
    });
});

describe('runDataQualityPipeline — report shape', () => {
    test('returns { event, report } with actions and skipped arrays', async () => {
        const { runDataQualityPipeline } = require('../src/utils/enrichment');
        const result = await runDataQualityPipeline(baseEvent(), standardDb());
        expect(result.event).toBeDefined();
        expect(result.report).toBeDefined();
        expect(Array.isArray(result.report.actions)).toBe(true);
        expect(Array.isArray(result.report.skipped)).toBe(true);
        expect(result.report.eventId).toBeDefined();
        expect(result.report.appId).toBe('1');
    });
});
