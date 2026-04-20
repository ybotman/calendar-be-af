// tests/Events_BulkEnrich.test.js
// CALBEAF-110 Phase 2 — endpoint stub tests with mocked Mongo and auth.

const { ObjectId } = require('mongodb');

// Mock @azure/functions BEFORE requiring the handler
jest.mock('@azure/functions', () => {
    const registered = {};
    return {
        app: {
            http: (name, config) => {
                registered[name] = config;
            },
            __getRegistered: () => registered,
        }
    };
});

// Mock middleware — pass-through, no-op
jest.mock('../src/middleware', () => ({
    standardMiddleware: (handler) => handler,
}));

// Mock firebaseAuth — controllable per test via the auth holder
const authHolder = { user: { uid: 'test-user-123', email: 'test@example.com' } };
jest.mock('../src/middleware/firebaseAuth', () => ({
    firebaseAuth: jest.fn(() => Promise.resolve(authHolder.user)),
    unauthorizedResponse: () => ({
        status: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Unauthorized' })
    }),
}));

// Mock MongoClient — return controllable mock db
const mockDbHolder = { db: null };
jest.mock('mongodb', () => {
    const actualMongo = jest.requireActual('mongodb');
    return {
        ...actualMongo,
        MongoClient: jest.fn().mockImplementation(() => ({
            connect: jest.fn().mockResolvedValue(undefined),
            db: () => mockDbHolder.db,
            close: jest.fn().mockResolvedValue(undefined),
        }))
    };
});

// Set MONGODB_URI to satisfy the env check
process.env.MONGODB_URI_TEST = 'mongodb://test/db';

// Now require the handler — registers via mocked app.http
require('../src/functions/Events_BulkEnrich');
const { app } = require('@azure/functions');
const handler = app.__getRegistered().Events_BulkEnrich.handler;

// ============================================
// Mock Mongo db helpers (re-using shape from enrichment.pipeline.test.js)
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
        find: () => ({
            project: () => ({ toArray: async () => docs }),
            toArray: async () => docs,
        }),
        findOne: async (query) => {
            return docs.find(d => Object.entries(query || {}).every(([k, v]) => {
                if (v && v.toString && d[k] && d[k].toString) return d[k].toString() === v.toString();
                return d[k] === v;
            })) || null;
        },
    };
}

const CLASS_ID = new ObjectId();
const REGION_ID = new ObjectId();
const COUNTRY_ID = new ObjectId();
const VENUE_ID = new ObjectId();

const standardMockDb = () => makeMockDb({
    categories: [{ _id: CLASS_ID, appId: '1', categoryName: 'Class' }],
    regions: [{ _id: REGION_ID, masteredCountryId: COUNTRY_ID }],
    countries: [{ _id: COUNTRY_ID, countryName: 'United States' }],
    venues: [{ _id: VENUE_ID, name: 'Studio', geolocation: { type: 'Point', coordinates: [-71.1, 42.4] }, masteredCityName: 'Cambridge', timezone: 'America/New_York' }],
});

const mockContext = () => ({ log: Object.assign(jest.fn(), { error: jest.fn(), warn: jest.fn() }) });

const mockRequest = (body) => ({
    json: async () => body,
});

const baseEvent = (overrides = {}) => ({
    _id: new ObjectId().toString(),
    appId: '1',
    title: 'Beginner Tango Series',
    description: 'A 6-week beginner tango series.',
    categoryFirstId: CLASS_ID.toString(),
    masteredRegionId: REGION_ID.toString(),
    venueID: VENUE_ID.toString(),
    startDate: new Date('2026-04-20T19:00:00Z').toISOString(),
    endDate: new Date('2026-04-20T20:30:00Z').toISOString(),
    ownerOrganizerID: new ObjectId().toString(),
    ...overrides,
});

beforeEach(() => {
    mockDbHolder.db = standardMockDb();
    authHolder.user = { uid: 'test-user-123', email: 'test@example.com' };
});

// ============================================
// Tests
// ============================================

describe('Events_BulkEnrich endpoint', () => {
    test('rejects missing batchId', async () => {
        const res = await handler(mockRequest({ events: [baseEvent()] }), mockContext());
        expect(res.status).toBe(400);
        expect(JSON.parse(res.body).error).toMatch(/batchId/);
    });

    test('rejects missing events array', async () => {
        const res = await handler(mockRequest({ batchId: 'b1' }), mockContext());
        expect(res.status).toBe(400);
        expect(JSON.parse(res.body).error).toMatch(/events\[\]/);
    });

    test('rejects empty events array', async () => {
        const res = await handler(mockRequest({ batchId: 'b1', events: [] }), mockContext());
        expect(res.status).toBe(400);
        expect(JSON.parse(res.body).error).toMatch(/empty/);
    });

    test('rejects oversized batch (>500) with 413', async () => {
        const events = Array.from({ length: 501 }, () => baseEvent());
        const res = await handler(mockRequest({ batchId: 'b1', events }), mockContext());
        expect(res.status).toBe(413);
        expect(JSON.parse(res.body).error).toMatch(/Batch too large/);
    });

    test('rejects unauthorized', async () => {
        authHolder.user = null;
        const res = await handler(mockRequest({ batchId: 'b1', events: [baseEvent()] }), mockContext());
        expect(res.status).toBe(401);
    });

    test('happy path — single event enriched', async () => {
        const res = await handler(
            mockRequest({ batchId: 'b1', events: [baseEvent()] }),
            mockContext()
        );
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.batchId).toBe('b1');
        expect(body.enrichedCount).toBe(1);
        expect(body.failedCount).toBe(0);
        expect(body.events).toHaveLength(1);
        expect(body.events[0].status).toBe('enriched');
        expect(body.events[0].event.forBeginners).toBe(true);
        expect(body.events[0].event.beginnerFriendly).toBe(true);
        expect(body.events[0].report.actions.length).toBeGreaterThan(0);
    });

    test('required-field WARN does NOT flip status (spec §4 warn-only, Quinn 2026-04-18 bugfix)', async () => {
        // Per spec §4 + Quinn's investigation of Porter's danceus 100%-needs_review issue:
        // missing required-field entries in report.skipped are informational WARNs.
        // They do NOT trigger needs_review. needs_review is reserved for pipeline exceptions.
        const validEvent = baseEvent();
        const warnEvent = baseEvent();
        delete warnEvent.ownerOrganizerID;  // emits WARN in report.skipped, but status stays enriched

        const res = await handler(
            mockRequest({ batchId: 'b2', events: [validEvent, warnEvent] }),
            mockContext()
        );
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.enrichedCount).toBe(2);  // both enriched — WARN doesn't demote
        expect(body.failedCount).toBe(0);
        expect(body.events[0].status).toBe('enriched');
        expect(body.events[1].status).toBe('enriched');
        // But the WARN is still surfaced in report.skipped for observability
        const warnEntries = body.events[1].report.skipped.filter(s => (s.reason || '').startsWith('WARN: missing required field'));
        expect(warnEntries.length).toBeGreaterThan(0);
    });

    test('dryRun option echoes back', async () => {
        const res = await handler(
            mockRequest({ batchId: 'b3', events: [baseEvent()], options: { dryRun: true } }),
            mockContext()
        );
        const body = JSON.parse(res.body);
        expect(body.dryRun).toBe(true);
    });

    test('Option A always-recompute — pre-existing false values get refreshed from rules (Toby 2026-04-18)', async () => {
        // Pre-D behavior: preserve-gate kept pre-existing false values.
        // Option A: always recompute; override fields (forBeginnersOverride) protect
        // organizer intent. Without an override, stale values are refreshed.
        const event = baseEvent({ forBeginners: false, beginnerFriendly: false });

        const res = await handler(
            mockRequest({ batchId: 'b4', events: [event] }),
            mockContext()
        );
        // Title "Beginner Tango Series" + no override → classifier hits positive → forBeg=true
        expect(JSON.parse(res.body).events[0].event.forBeginners).toBe(true);
    });

    test('forBeginnersOverride=false beats pre-existing true under Option A (organizer intent)', async () => {
        const event = baseEvent({ forBeginners: true, beginnerFriendly: true, forBeginnersOverride: false });
        const res = await handler(
            mockRequest({ batchId: 'b4b', events: [event] }),
            mockContext()
        );
        // Override wins even when rule says true
        expect(JSON.parse(res.body).events[0].event.forBeginners).toBe(false);
    });

    test('response includes batchId echo for observability', async () => {
        const res = await handler(
            mockRequest({ batchId: 'porter-20260418-031200-7a3b', events: [baseEvent()] }),
            mockContext()
        );
        const body = JSON.parse(res.body);
        expect(body.batchId).toBe('porter-20260418-031200-7a3b');
    });

    test('response includes durationMs', async () => {
        const res = await handler(
            mockRequest({ batchId: 'b6', events: [baseEvent()] }),
            mockContext()
        );
        const body = JSON.parse(res.body);
        expect(typeof body.durationMs).toBe('number');
        expect(body.durationMs).toBeGreaterThanOrEqual(0);
    });

    test('per-event response includes original index for caller correlation', async () => {
        const events = [baseEvent({ title: 'Beginner A' }), baseEvent({ title: 'Beginner B' }), baseEvent({ title: 'Beginner C' })];
        const res = await handler(mockRequest({ batchId: 'b7', events }), mockContext());
        const body = JSON.parse(res.body);
        expect(body.events.map(e => e.index)).toEqual([0, 1, 2]);
    });
});
