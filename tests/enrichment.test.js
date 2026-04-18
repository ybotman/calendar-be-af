// tests/enrichment.test.js
// Unit tests for src/utils/enrichment.js — classifyBeginner only (pure-function path).
// Validates against canonical fixture: Collab/fixtures/beginner-class-gold-set.json (56 rows, v3 ruleset).
//
// runDataQualityPipeline (the orchestrator) is tested in a separate file with mocked Mongo.
// This file is for the rule logic only — no DB.

const path = require('path');
const fs = require('fs');

const { classifyBeginner } = require('../src/utils/enrichment');

// Load canonical fixture from Collab — DO NOT FORK (per fixture _meta.do_not_fork)
const FIXTURE_PATH = '/Users/tobybalsley/MyDocs/Collab/fixtures/beginner-class-gold-set.json';

describe('classifyBeginner — canonical fixture (Collab/fixtures/beginner-class-gold-set.json)', () => {
    let fixtures;
    let meta;

    beforeAll(() => {
        const raw = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
        fixtures = raw.fixtures;
        meta = raw._meta;
    });

    test('fixture loaded', () => {
        expect(fixtures).toBeDefined();
        expect(fixtures.length).toBeGreaterThan(0);
        expect(meta.spec_version).toMatch(/v3/);
    });

    // Per-row test — generates one test case per fixture row for granular failure reporting
    describe('each row classifies to expected output', () => {
        // Defer table generation until beforeAll runs
        const rows = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')).fixtures;
        for (const row of rows) {
            const label = `id=${row.id} [${(row.tags || []).join(',')}] "${row.title.substring(0, 60)}"`;
            test(label, () => {
                const got = classifyBeginner(row.title, row.description || '');
                expect({
                    forBeginners: got.forBeginners,
                    beginnerFriendly: got.beginnerFriendly,
                }).toEqual(row.expected);
            });
        }
    });

    // Bucket-level summary tests — useful for tracking overall ruleset health
    describe('bucket-level pass rates', () => {
        const rows = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')).fixtures;

        test('all forBeginners=true rows classified correctly', () => {
            const expectedTrue = rows.filter(r => r.expected.forBeginners === true);
            const failures = expectedTrue.filter(r => {
                const g = classifyBeginner(r.title, r.description || '');
                return g.forBeginners !== true;
            });
            if (failures.length > 0) {
                console.log('\nforBeginners=true failures:');
                failures.forEach(r => console.log(`  id=${r.id}: ${r.title}`));
            }
            expect(failures.length).toBe(0);
        });

        test('all beginnerFriendly-only rows classified correctly', () => {
            const expectedFriendlyOnly = rows.filter(r =>
                r.expected.forBeginners === false && r.expected.beginnerFriendly === true
            );
            const failures = expectedFriendlyOnly.filter(r => {
                const g = classifyBeginner(r.title, r.description || '');
                return g.forBeginners !== false || g.beginnerFriendly !== true;
            });
            if (failures.length > 0) {
                console.log('\nbeginnerFriendly-only failures:');
                failures.forEach(r => console.log(`  id=${r.id}: ${r.title}`));
            }
            expect(failures.length).toBe(0);
        });

        test('all both-false rows classified correctly', () => {
            const expectedBothFalse = rows.filter(r =>
                r.expected.forBeginners === false && r.expected.beginnerFriendly === false
            );
            const failures = expectedBothFalse.filter(r => {
                const g = classifyBeginner(r.title, r.description || '');
                return g.forBeginners !== false || g.beginnerFriendly !== false;
            });
            if (failures.length > 0) {
                console.log('\nboth-false failures:');
                failures.forEach(r => console.log(`  id=${r.id}: ${r.title}`));
            }
            expect(failures.length).toBe(0);
        });
    });

    // Superset invariant — must always hold regardless of input
    test('invariant: forBeginners=true implies beginnerFriendly=true', () => {
        const rows = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')).fixtures;
        for (const row of rows) {
            const g = classifyBeginner(row.title, row.description || '');
            if (g.forBeginners) {
                expect(g.beginnerFriendly).toBe(true);
            }
        }
    });
});
