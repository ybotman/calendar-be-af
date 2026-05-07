// tests/Events_Get_includeAiGenerated.test.js
// CALBEAF-183 (UC-0018 / TIEMPO-364 mirror) — includeAiGenerated must also exclude
// isDiscovered=true events. Pre-fix: only excluded isAiGenerated=true; discovered
// events (which don't set isAiGenerated) leaked through. Post-fix: extends to
// isDiscovered when caller hasn't explicitly set the `discovered` filter.

const { ObjectId } = require('mongodb');

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

jest.mock('../src/middleware/firebaseAuth', () => ({
    firebaseAuth: jest.fn(() => Promise.resolve({ uid: 'test-user' })),
    unauthorizedResponse: () => ({ status: 401, headers: {}, body: '{}' }),
}));

jest.mock('../src/lib/firebase-admin', () => ({
    getFirebaseAdmin: () => { throw new Error('mocked: no admin SDK in tests'); },
}));

const mockDbHolder = { capturedFilter: null, capturedCountFilter: null };
jest.mock('mongodb', () => {
    const actualMongo = jest.requireActual('mongodb');
    return {
        ...actualMongo,
        MongoClient: jest.fn().mockImplementation(() => ({
            connect: jest.fn().mockResolvedValue(undefined),
            db: () => ({
                collection: () => ({
                    find: (filter) => {
                        mockDbHolder.capturedFilter = filter;
                        return {
                            sort: () => ({
                                skip: () => ({
                                    limit: () => ({
                                        toArray: async () => []
                                    })
                                })
                            })
                        };
                    },
                    countDocuments: async (filter) => {
                        mockDbHolder.capturedCountFilter = filter;
                        return 0;
                    },
                })
            }),
            close: jest.fn().mockResolvedValue(undefined),
        }))
    };
});

process.env.MONGODB_URI = 'mongodb://test/db';

require('../src/functions/Events');
const { app } = require('@azure/functions');
const handler = app.__getRegistered().Events_Get.handler;

const mockContext = () => ({ log: Object.assign(jest.fn(), { error: jest.fn(), warn: jest.fn() }) });

const mockGetRequest = (queryObj) => ({
    query: {
        get: (key) => (queryObj[key] !== undefined ? queryObj[key] : null),
    },
});

// Helper: extract the baseFilter portion regardless of whether it was wrapped in $and
function extractBaseFilter(capturedFilter) {
    if (!capturedFilter) return null;
    // No-andConditions shape: { ...baseFilter, $or: dateConditions }
    // With-andConditions shape: { $and: [{ ...baseFilter, $or: dateConditions }, ...] }
    if (capturedFilter.$and && Array.isArray(capturedFilter.$and)) {
        return capturedFilter.$and[0];
    }
    return capturedFilter;
}

const baseQuery = {
    appId: '1',
    start: '2026-01-01',
    end: '2026-12-31',
};

beforeEach(() => {
    mockDbHolder.capturedFilter = null;
    mockDbHolder.capturedCountFilter = null;
});

describe('Events_Get — CALBEAF-183 includeAiGenerated extends to isDiscovered', () => {
    test('includeAiGenerated=false (or omitted) excludes BOTH isAiGenerated and isDiscovered', async () => {
        await handler(mockGetRequest({ ...baseQuery, includeAiGenerated: 'false' }), mockContext());
        const filter = extractBaseFilter(mockDbHolder.capturedFilter);
        expect(filter.isAiGenerated).toEqual({ $ne: true });
        expect(filter.isDiscovered).toEqual({ $ne: true });
    });

    test('includeAiGenerated omitted (default) also excludes both', async () => {
        await handler(mockGetRequest({ ...baseQuery }), mockContext());
        const filter = extractBaseFilter(mockDbHolder.capturedFilter);
        expect(filter.isAiGenerated).toEqual({ $ne: true });
        expect(filter.isDiscovered).toEqual({ $ne: true });
    });

    test('includeAiGenerated=true does NOT add isDiscovered exclusion', async () => {
        await handler(mockGetRequest({ ...baseQuery, includeAiGenerated: 'true' }), mockContext());
        const filter = extractBaseFilter(mockDbHolder.capturedFilter);
        expect(filter.isAiGenerated).toBeUndefined();
        expect(filter.isDiscovered).toBeUndefined();
    });

    test('discovered=true overrides includeAiGenerated=false (caller explicit wins)', async () => {
        await handler(mockGetRequest({ ...baseQuery, includeAiGenerated: 'false', discovered: 'true' }), mockContext());
        const filter = extractBaseFilter(mockDbHolder.capturedFilter);
        expect(filter.isAiGenerated).toEqual({ $ne: true });
        // Caller explicitly opted into discovered events; the includeAiGenerated branch must NOT overwrite
        expect(filter.isDiscovered).toBe(true);
    });

    test('discovered=false preserved (existing behavior)', async () => {
        await handler(mockGetRequest({ ...baseQuery, discovered: 'false' }), mockContext());
        const filter = extractBaseFilter(mockDbHolder.capturedFilter);
        // discovered=false sets isDiscovered=false at line 286 BEFORE the includeAiGenerated branch
        // Then includeAiGenerated default (not 'true') would normally set isDiscovered={$ne:true}
        // But our guard `if (!discovered)` skips overwriting when discovered is set
        expect(filter.isDiscovered).toBe(false);
        expect(filter.isAiGenerated).toEqual({ $ne: true });
    });

    test('countDocuments uses the same filter shape', async () => {
        await handler(mockGetRequest({ ...baseQuery, includeAiGenerated: 'false' }), mockContext());
        const cf = extractBaseFilter(mockDbHolder.capturedCountFilter);
        expect(cf.isAiGenerated).toEqual({ $ne: true });
        expect(cf.isDiscovered).toEqual({ $ne: true });
    });
});
