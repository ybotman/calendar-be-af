// tests/UserLogins_Create.test.js
// CALBEAF-83 — email-lane dedup regression test for userLoginsCreateHandler.
// Reproduces UC-0013 scenario: same email + different firebaseUserId must rotate
// the existing record, NOT create a duplicate.

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
    firebaseAuth: jest.fn(() => Promise.resolve({ uid: 'test-user', email: 'test@example.com' })),
    unauthorizedResponse: () => ({ status: 401, headers: {}, body: '{}' }),
}));

// Throw from firebase-admin so the create flow falls back to body-provided firebaseUserInfo
jest.mock('../src/lib/firebase-admin', () => ({
    getFirebaseAdmin: () => { throw new Error('mocked: no admin SDK in tests'); },
}));

jest.mock('../src/lib/syncFirebaseClaims', () => ({
    syncAdminClaim: jest.fn(() => Promise.resolve()),
}));

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

process.env.MONGODB_URI = 'mongodb://test/db';

require('../src/functions/UserLogins');
const { app } = require('@azure/functions');
const handler = app.__getRegistered().UserLogins_Create.handler;

function getNested(doc, path) {
    return path.split('.').reduce((cur, p) => (cur == null ? cur : cur[p]), doc);
}

function matches(doc, query) {
    return Object.entries(query || {}).every(([k, v]) => {
        const actual = k.includes('.') ? getNested(doc, k) : doc[k];
        if (v && typeof v.toString === 'function' && actual && typeof actual.toString === 'function' && actual !== v) {
            return actual.toString() === v.toString();
        }
        return actual === v;
    });
}

function makeStatefulCollection(initial = []) {
    const docs = initial.map(d => ({ ...d }));
    return {
        findOne: async (query) => docs.find(d => matches(d, query)) || null,
        insertOne: async (doc) => {
            const _id = new ObjectId();
            docs.push({ ...doc, _id });
            return { insertedId: _id };
        },
        updateOne: async (filter, update) => {
            const target = docs.find(d => matches(d, filter));
            if (!target) return { matchedCount: 0, modifiedCount: 0 };
            if (update.$set) Object.assign(target, update.$set);
            if (update.$addToSet) {
                for (const [k, v] of Object.entries(update.$addToSet)) {
                    target[k] = target[k] || [];
                    if (!target[k].some(x => (x?.toString?.() ?? x) === (v?.toString?.() ?? v))) {
                        target[k].push(v);
                    }
                }
            }
            return { matchedCount: 1, modifiedCount: 1 };
        },
        __docs: () => docs,
    };
}

const mockContext = () => ({ log: Object.assign(jest.fn(), { error: jest.fn(), warn: jest.fn() }) });
const mockRequest = (body) => ({ json: async () => body });

describe('UserLogins_Create — CALBEAF-83 email-lane dedup', () => {
    let userLoginsCol;
    let rolesCol;

    beforeEach(() => {
        userLoginsCol = makeStatefulCollection();
        rolesCol = makeStatefulCollection([
            { _id: new ObjectId(), roleName: 'NamedUser', appId: '1' },
            { _id: new ObjectId(), roleName: 'NamedUser', appId: '99' },
        ]);
        mockDbHolder.db = {
            collection: (name) => {
                if (name === 'userlogins') return userLoginsCol;
                if (name === 'roles') return rolesCol;
                return makeStatefulCollection();
            }
        };
    });

    test('UC-0013 regression: same email + new firebaseUserId rotates the record, no duplicate', async () => {
        const email = 'e2e-CALBEAF83@example.com';

        // First POST: uid-A creates the record
        const res1 = await handler(mockRequest({
            firebaseUserId: 'uid-A',
            appId: '99',
            firebaseUserInfo: { email }
        }), mockContext());
        expect(res1.status).toBe(201);
        expect(userLoginsCol.__docs().length).toBe(1);

        // Second POST: uid-B (same email) — pre-fix this would create a duplicate;
        // post-fix it must rotate firebaseUserId on the existing record.
        const res2 = await handler(mockRequest({
            firebaseUserId: 'uid-B',
            appId: '99',
            firebaseUserInfo: { email }
        }), mockContext());

        expect(res2.status).toBe(200);
        expect(userLoginsCol.__docs().length).toBe(1);

        const finalDoc = userLoginsCol.__docs()[0];
        expect(finalDoc.firebaseUserId).toBe('uid-B');
        expect(finalDoc.alternateFirebaseUserIds).toEqual(['uid-A']);
        expect(getNested(finalDoc, 'firebaseUserInfo.email')).toBe(email);

        const body = JSON.parse(res2.body);
        expect(body.success).toBe(true);
        expect(body.message).toMatch(/firebaseUserId rotated/i);
    });

    test('multi-tenant isolation: same email at different appIds does NOT collide', async () => {
        const email = 'e2e-CALBEAF83-multitenant@example.com';

        const res1 = await handler(mockRequest({
            firebaseUserId: 'uid-A',
            appId: '1',
            firebaseUserInfo: { email }
        }), mockContext());
        expect(res1.status).toBe(201);

        const res2 = await handler(mockRequest({
            firebaseUserId: 'uid-B',
            appId: '99',
            firebaseUserInfo: { email }
        }), mockContext());
        expect(res2.status).toBe(201);

        expect(userLoginsCol.__docs().length).toBe(2);
        expect(userLoginsCol.__docs().find(d => d.appId === '1').firebaseUserId).toBe('uid-A');
        expect(userLoginsCol.__docs().find(d => d.appId === '99').firebaseUserId).toBe('uid-B');
    });

    test('same firebaseUserId at same appId still returns 409 (existing behavior preserved)', async () => {
        const email = 'e2e-CALBEAF83-conflict@example.com';

        await handler(mockRequest({
            firebaseUserId: 'uid-X',
            appId: '99',
            firebaseUserInfo: { email }
        }), mockContext());

        const res = await handler(mockRequest({
            firebaseUserId: 'uid-X',
            appId: '99',
            firebaseUserInfo: { email }
        }), mockContext());
        expect(res.status).toBe(409);
        expect(userLoginsCol.__docs().length).toBe(1);
    });

    test('no email in body falls through to create (legacy compatibility)', async () => {
        const res = await handler(mockRequest({
            firebaseUserId: 'uid-no-email',
            appId: '99'
        }), mockContext());
        expect(res.status).toBe(201);
        expect(userLoginsCol.__docs().length).toBe(1);
    });
});
