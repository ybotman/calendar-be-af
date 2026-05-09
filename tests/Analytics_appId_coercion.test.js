// tests/Analytics_appId_coercion.test.js
// CALBEAF-184 — Analytics endpoints must coerce query-string appId to STRING
// (not parseInt to number) so the Mongo filter matches the string-typed appId
// values stored in MapCenterHistory / UserLoginAnalytics2 / VisitorTrackingHistory2.
//
// Pre-fix bug: query.appId = parseInt('1', 10) = 1 (number) → never matches DB
// docs with appId: '1' (string). MapCenterHistory PROD empirical 2026-05-09:
// 1881 docs with appId='1' string; find({appId:1}) → 0; find({appId:'1'}) → 1881.
//
// Toby-confirmed standing rule: appId is always 1-99 string-managed across all
// collections. String(value) is the canonical coercion.

jest.mock('@azure/functions', () => {
    const registered = {};
    return {
        app: {
            http: (name, config) => { registered[name] = config; },
            __getRegistered: () => registered,
        }
    };
});

jest.mock('../src/middleware', () => ({
    standardMiddleware: (handler) => handler,
}));

const dbHolder = { capturedQuery: null };

jest.mock('mongodb', () => {
    const actualMongo = jest.requireActual('mongodb');
    return {
        ...actualMongo,
        MongoClient: jest.fn().mockImplementation(() => ({
            connect: jest.fn().mockResolvedValue(undefined),
            db: () => ({
                collection: () => ({
                    find: (q) => {
                        dbHolder.capturedQuery = q;
                        return {
                            sort: () => ({
                                skip: () => ({
                                    limit: () => ({ toArray: async () => [] })
                                })
                            })
                        };
                    },
                    countDocuments: async (q) => {
                        dbHolder.capturedQuery = q;
                        return 0;
                    },
                })
            }),
            close: jest.fn().mockResolvedValue(undefined),
        }))
    };
});

process.env.MONGODB_URI = 'mongodb://test/db';

require('../src/functions/Analytics_MapCenterHistory');
require('../src/functions/Analytics_LoginHistory');
require('../src/functions/Analytics_VisitorHistory');
const { app } = require('@azure/functions');

const handlers = {
    map: app.__getRegistered().Analytics_MapCenterHistory.handler,
    login: app.__getRegistered().Analytics_LoginHistory.handler,
    visitor: app.__getRegistered().Analytics_VisitorHistory.handler,
};

const mockContext = () => ({
    log: Object.assign(jest.fn(), { error: jest.fn(), warn: jest.fn() }),
    error: jest.fn(),
});

const mockGetRequest = (queryObj) => ({
    method: 'GET',
    url: 'https://test.local/api/x?' + new URLSearchParams(queryObj).toString(),
});

beforeEach(() => {
    dbHolder.capturedQuery = null;
});

describe.each([
    ['MapCenterHistory', () => handlers.map],
    ['LoginHistory', () => handlers.login],
    ['VisitorHistory', () => handlers.visitor],
])('Analytics_%s — CALBEAF-184 appId String() coercion', (name, getHandler) => {
    test('appId="1" coerces to string "1" in query (not number 1)', async () => {
        await getHandler()(mockGetRequest({ appId: '1' }), mockContext());
        expect(dbHolder.capturedQuery.appId).toBe('1');
        expect(typeof dbHolder.capturedQuery.appId).toBe('string');
    });

    test('appId="99" (test-partition value) coerces to string "99"', async () => {
        await getHandler()(mockGetRequest({ appId: '99' }), mockContext());
        expect(dbHolder.capturedQuery.appId).toBe('99');
        expect(typeof dbHolder.capturedQuery.appId).toBe('string');
    });

    test('appId omitted → no appId filter applied', async () => {
        await getHandler()(mockGetRequest({}), mockContext());
        expect(dbHolder.capturedQuery.appId).toBeUndefined();
    });

    test('appId="" empty → no appId filter (falsy skip)', async () => {
        await getHandler()(mockGetRequest({ appId: '' }), mockContext());
        expect(dbHolder.capturedQuery.appId).toBeUndefined();
    });
});
