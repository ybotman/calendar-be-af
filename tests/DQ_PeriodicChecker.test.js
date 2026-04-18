// tests/DQ_PeriodicChecker.test.js
// CALBEAF-110 Phase 4 — Tier-2 periodic checker tests with mocked Mongo.

const { ObjectId } = require('mongodb');

jest.mock('@azure/functions', () => {
    const registered = {};
    return {
        app: {
            timer: (name, config) => { registered[name] = config; },
            __getRegistered: () => registered,
        }
    };
});

// MongoClient mock — controllable db via mockDbHolder
const mockDbHolder = { db: null, lastBulkOps: null, lastBulkResult: { matchedCount: 0, modifiedCount: 0 } };
jest.mock('mongodb', () => {
    const actual = jest.requireActual('mongodb');
    return {
        ...actual,
        MongoClient: jest.fn().mockImplementation(() => ({
            connect: jest.fn().mockResolvedValue(undefined),
            db: () => mockDbHolder.db,
            close: jest.fn().mockResolvedValue(undefined),
        }))
    };
});

process.env.MONGODB_URI_TEST = 'mongodb://test/db';

const { dqPeriodicCheckerHandler } = require('../src/functions/DQ_PeriodicChecker');

const CLASS_ID = new ObjectId();
const REGION_ID = new ObjectId();
const COUNTRY_ID = new ObjectId();
const VENUE_ID = new ObjectId();

function makeCollection(docs) {
    return {
        find: () => ({
            project: () => ({ toArray: async () => docs }),
            toArray: async () => docs,
            limit: () => ({ toArray: async () => docs }),
        }),
        findOne: async (query) => docs.find(d =>
            Object.entries(query || {}).every(([k, v]) => {
                if (v && v.toString && d[k] && d[k].toString) return d[k].toString() === v.toString();
                return d[k] === v;
            })) || null,
        countDocuments: async () => docs.length,
        bulkWrite: async (ops) => {
            mockDbHolder.lastBulkOps = ops;
            return { matchedCount: ops.length, modifiedCount: ops.length };
        },
    };
}

function makeMockDb({ events = [], categories = [], regions = [], countries = [], venues = [] } = {}) {
    const collections = {
        events: makeCollection(events),
        categories: makeCollection(categories),
        masteredregions: makeCollection(regions),
        masteredcountries: makeCollection(countries),
        venues: makeCollection(venues),
    };
    return { collection: name => collections[name] || makeCollection([]) };
}

const mockContext = () => ({ log: Object.assign(jest.fn(), { error: jest.fn(), warn: jest.fn() }) });

const standardLookups = {
    categories: [{ _id: CLASS_ID, appId: '1', categoryName: 'Class' }],
    regions: [{ _id: REGION_ID, masteredCountryId: COUNTRY_ID }],
    countries: [{ _id: COUNTRY_ID, countryName: 'United States' }],
    venues: [{ _id: VENUE_ID, geolocation: { type: 'Point', coordinates: [-71.1, 42.4] }, masteredCityName: 'Cambridge', timezone: 'America/New_York' }],
};

const candidateEvent = (overrides = {}) => ({
    _id: new ObjectId(),
    appId: '1',
    title: 'Beginner Tango Series',
    description: 'beginner series',
    categoryFirstId: CLASS_ID,
    masteredRegionId: REGION_ID,
    venueID: VENUE_ID,
    startDate: new Date('2026-04-20T19:00:00Z'),
    endDate: new Date('2026-04-20T20:30:00Z'),
    ownerOrganizerID: new ObjectId(),
    updatedAt: new Date(),
    enrichmentStatus: 'pending',
    forBeginners: null,
    beginnerFriendly: null,
    travelWorthy: null,
    masteredCountryId: null,
    ...overrides,
});

beforeEach(() => {
    mockDbHolder.lastBulkOps = null;
});

describe('DQ_PeriodicChecker', () => {
    test('no candidates → no bulkWrite, no errors', async () => {
        mockDbHolder.db = makeMockDb({ events: [], ...standardLookups });
        const ctx = mockContext();
        await dqPeriodicCheckerHandler({ isPastDue: false }, ctx);
        expect(mockDbHolder.lastBulkOps).toBeNull();
    });

    test('1 pending candidate → enriched and bulkWrite issued with enrichmentStatus=complete', async () => {
        const ev = candidateEvent();
        mockDbHolder.db = makeMockDb({ events: [ev], ...standardLookups });
        const ctx = mockContext();
        await dqPeriodicCheckerHandler({ isPastDue: false }, ctx);
        expect(mockDbHolder.lastBulkOps).not.toBeNull();
        expect(mockDbHolder.lastBulkOps.length).toBe(1);
        const op = mockDbHolder.lastBulkOps[0].updateOne;
        expect(op.update.$set.enrichmentStatus).toBe('complete');
        expect(op.update.$set.forBeginners).toBe(true);
        expect(op.update.$set.beginnerFriendly).toBe(true);
    });

    test('candidate missing required field → enrichmentStatus=failed, still updated', async () => {
        const ev = candidateEvent();
        delete ev.ownerOrganizerID;
        mockDbHolder.db = makeMockDb({ events: [ev], ...standardLookups });
        const ctx = mockContext();
        await dqPeriodicCheckerHandler({ isPastDue: false }, ctx);
        expect(mockDbHolder.lastBulkOps).not.toBeNull();
        const op = mockDbHolder.lastBulkOps[0].updateOne;
        expect(op.update.$set.enrichmentStatus).toBe('failed');
    });

    test('row already complete with all fields set → no update queued', async () => {
        const ev = candidateEvent({
            enrichmentStatus: 'complete',
            forBeginners: true,
            beginnerFriendly: true,
            travelWorthy: false,
            masteredCountryId: COUNTRY_ID,
            masteredCountryName: 'United States',
            venueGeolocation: { type: 'Point', coordinates: [-71.1, 42.4] },
            venueCityName: 'Cambridge',
            venueTimezone: 'America/New_York',
        });
        mockDbHolder.db = makeMockDb({ events: [ev], ...standardLookups });
        const ctx = mockContext();
        await dqPeriodicCheckerHandler({ isPastDue: false }, ctx);
        expect(mockDbHolder.lastBulkOps).toBeNull();
    });

    test('mixed batch — pending enriched, complete unchanged', async () => {
        const ev1 = candidateEvent();
        const ev2 = candidateEvent({
            enrichmentStatus: 'complete',
            forBeginners: true,
            beginnerFriendly: true,
            travelWorthy: false,
            masteredCountryId: COUNTRY_ID,
            masteredCountryName: 'United States',
            venueGeolocation: { type: 'Point', coordinates: [-71.1, 42.4] },
            venueCityName: 'Cambridge',
            venueTimezone: 'America/New_York',
        });
        mockDbHolder.db = makeMockDb({ events: [ev1, ev2], ...standardLookups });
        const ctx = mockContext();
        await dqPeriodicCheckerHandler({ isPastDue: false }, ctx);
        expect(mockDbHolder.lastBulkOps.length).toBe(1);  // only ev1 needs update
    });

    test('PROD URI guard refuses to run', async () => {
        const origUri = process.env.MONGODB_URI_TEST;
        process.env.MONGODB_URI_TEST = 'mongodb://prod-cluster/db';
        const ctx = mockContext();
        await dqPeriodicCheckerHandler({ isPastDue: false }, ctx);
        const logs = ctx.log.mock.calls.flat().join(' ');
        expect(logs).toMatch(/refusing PROD URI/);
        process.env.MONGODB_URI_TEST = origUri;
    });
});
