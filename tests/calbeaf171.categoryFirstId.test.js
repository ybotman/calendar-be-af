// CALBEAF-171 — BE defense-in-depth validator
// Verifies validateCategoryFirstIdPresence rejects the bug shape (missing/empty
// categoryFirstId on create) and protects against silent clearing on update.

const { validateCategoryFirstIdPresence } = require('../src/utils/eventCategoryValidation');

describe('CALBEAF-171 — validateCategoryFirstIdPresence', () => {
    describe('mode: create', () => {
        test('rejects when categoryFirstId is missing', () => {
            const r = validateCategoryFirstIdPresence({ title: 'x' }, 'create');
            expect(r.valid).toBe(false);
            expect(r.error).toMatch(/categoryFirstId is required/i);
        });

        test('rejects when categoryFirstId is null', () => {
            const r = validateCategoryFirstIdPresence({ categoryFirstId: null }, 'create');
            expect(r.valid).toBe(false);
        });

        test('rejects when categoryFirstId is empty string', () => {
            const r = validateCategoryFirstIdPresence({ categoryFirstId: '' }, 'create');
            expect(r.valid).toBe(false);
        });

        test('rejects when categoryFirstId is whitespace-only string', () => {
            const r = validateCategoryFirstIdPresence({ categoryFirstId: '   ' }, 'create');
            expect(r.valid).toBe(false);
        });

        test('accepts when categoryFirstId is a non-empty string (ObjectId-like)', () => {
            const r = validateCategoryFirstIdPresence({ categoryFirstId: '6751f57e2e74d97609e7dca0' }, 'create');
            expect(r.valid).toBe(true);
        });

        test('accepts when categoryFirstId is a non-string truthy value (already-converted ObjectId)', () => {
            // After convertIdFields(), the field may be an ObjectId instance, not a string
            const r = validateCategoryFirstIdPresence({ categoryFirstId: { toString: () => '6751f57e2e74d97609e7dca0' } }, 'create');
            expect(r.valid).toBe(true);
        });

        test('rejects on null body', () => {
            const r = validateCategoryFirstIdPresence(null, 'create');
            expect(r.valid).toBe(false);
        });
    });

    describe('mode: update (partial)', () => {
        test('accepts when categoryFirstId is absent from body (no-op partial update)', () => {
            const r = validateCategoryFirstIdPresence({ title: 'changed' }, 'update');
            expect(r.valid).toBe(true);
        });

        test('rejects when caller explicitly sets categoryFirstId to null', () => {
            const r = validateCategoryFirstIdPresence({ categoryFirstId: null }, 'update');
            expect(r.valid).toBe(false);
            expect(r.error).toMatch(/cannot be cleared/i);
        });

        test('rejects when caller explicitly sets categoryFirstId to empty string', () => {
            const r = validateCategoryFirstIdPresence({ categoryFirstId: '' }, 'update');
            expect(r.valid).toBe(false);
        });

        test('rejects when caller sets categoryFirstId to whitespace-only', () => {
            const r = validateCategoryFirstIdPresence({ categoryFirstId: '   ' }, 'update');
            expect(r.valid).toBe(false);
        });

        test('accepts when caller updates categoryFirstId to a valid value', () => {
            const r = validateCategoryFirstIdPresence({ categoryFirstId: '6751f57e2e74d97609e7dca0' }, 'update');
            expect(r.valid).toBe(true);
        });
    });
});
