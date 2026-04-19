// tests/venuesAutoMaster.test.js
// CALBEAF-116 — unit tests for shared Venues_AutoMaster helper.
//
// Contract tested (Quinn condition: input→output, not helper internals):
//   - Invalid geolocation returns null (no-op)
//   - Valid geo within-corpus: AUTO_HIGH bucket + full chain fields
//   - Valid geo out-of-corpus: MANUAL bucket + flag-only fields
//   - textConflict audit fires on city-text vs nearest mismatch
//
// DB is mocked — tests stay hermetic, no Mongo required.

const { resolveMasteredCity, BUCKET_HIGH_MAX_KM, BUCKET_MEDIUM_MAX_KM } = require('../src/utils/venuesAutoMaster');

// ---------- Mock DB factory ----------
function makeMockDb({ nearest = null, city = null, division = null, region = null, country = null }) {
    const collections = {
        masteredcities: {
            aggregate: () => ({
                toArray: async () => nearest ? [nearest] : [],
            }),
            findOne: async () => city,
        },
        mastereddivisions: { findOne: async () => division },
        masteredregions: { findOne: async () => region },
        masteredcountries: { findOne: async () => country },
    };
    return {
        collection: (name) => collections[name],
    };
}

describe('resolveMasteredCity — contract tests', () => {
    test('invalid geolocation (missing coords) returns null — caller no-ops', async () => {
        const db = makeMockDb({});
        const result = await resolveMasteredCity({ db, geolocation: null });
        expect(result).toBeNull();
    });

    test('invalid geolocation (malformed coordinates) returns null', async () => {
        const db = makeMockDb({});
        const result = await resolveMasteredCity({
            db,
            geolocation: { type: 'Point', coordinates: [1] }, // too few
        });
        expect(result).toBeNull();
    });

    test('valid geo in-corpus (≤50km) — AUTO_HIGH bucket with full chain', async () => {
        const db = makeMockDb({
            nearest: { _id: 'city-oid', cityName: 'Boston', distance: 12_345 }, // 12.345km
            city: { _id: 'city-oid', cityName: 'Boston', masteredDivisionId: 'div-oid' },
            division: { _id: 'div-oid', divisionName: 'MA', masteredRegionId: 'reg-oid' },
            region: { _id: 'reg-oid', regionName: 'NE', masteredCountryId: 'cnt-oid' },
            country: { _id: 'cnt-oid', countryName: 'United States' },
        });
        const result = await resolveMasteredCity({
            db,
            geolocation: { type: 'Point', coordinates: [-71.06, 42.36] },
            cityText: 'Boston',
        });

        expect(result).not.toBeNull();
        expect(result.bucket).toBe('AUTO_HIGH');
        expect(result.fields.masteringStatus).toBe('mastered_by_automaster');
        expect(result.fields.masteredCityId).toBe('city-oid');
        expect(result.fields.masteredCityName).toBe('Boston');
        expect(result.fields.masteredDivisionId).toBe('div-oid');
        expect(result.fields.masteredRegionId).toBe('reg-oid');
        expect(result.fields.masteredCountryId).toBe('cnt-oid');
        expect(result.fields.masteringDistanceKm).toBeCloseTo(12.345, 2);
        expect(result.fields.masteringTextConflict).toBe(false);
        expect(result.log.reason).toMatch(/within_50km/);
    });

    test('valid geo at 50-200km — AUTO_MEDIUM bucket, country-only (no city write)', async () => {
        const db = makeMockDb({
            nearest: { _id: 'city-oid', cityName: 'NYC', distance: 120_000 }, // 120km
            city: { _id: 'city-oid', cityName: 'NYC', masteredDivisionId: 'div-oid' },
            division: { _id: 'div-oid', divisionName: 'NY', masteredRegionId: 'reg-oid' },
            region: { _id: 'reg-oid', regionName: 'East', masteredCountryId: 'cnt-oid' },
            country: { _id: 'cnt-oid', countryName: 'United States' },
        });
        const result = await resolveMasteredCity({
            db,
            geolocation: { type: 'Point', coordinates: [-73.9, 40.7] },
            cityText: null,
        });

        expect(result.bucket).toBe('AUTO_MEDIUM');
        expect(result.fields.masteringStatus).toBe('country_only_by_automaster');
        // Country-only: city/division/region MUST NOT be written (prevent /boston pollution)
        expect(result.fields.masteredCityId).toBeUndefined();
        expect(result.fields.masteredCityName).toBeUndefined();
        expect(result.fields.masteredDivisionId).toBeUndefined();
        expect(result.fields.masteredRegionId).toBeUndefined();
        // Country MUST be written
        expect(result.fields.masteredCountryId).toBe('cnt-oid');
        expect(result.fields.masteredCountryName).toBe('United States');
        expect(result.fields.masteringDistanceKm).toBeCloseTo(120, 1);
    });

    test('valid geo out-of-corpus (>200km) — MANUAL bucket, flag-only (no mastered* writes)', async () => {
        const db = makeMockDb({
            nearest: { _id: 'city-oid', cityName: 'Sacramento', distance: 372_775 }, // 372.775km — Slovenia→Sac
        });
        const result = await resolveMasteredCity({
            db,
            geolocation: { type: 'Point', coordinates: [15.65, 46.23] }, // Slovenia lat/lng
            cityText: 'Rogaska Slatina',
        });

        expect(result.bucket).toBe('MANUAL');
        expect(result.fields.masteringStatus).toBe('corpus-gap-review');
        expect(result.fields.masteringDistanceKm).toBeCloseTo(372.775, 2);
        // No mastered* fields written at MANUAL bucket
        expect(result.fields.masteredCityId).toBeUndefined();
        expect(result.fields.masteredCountryId).toBeUndefined();
        expect(result.log.reason).toMatch(/exceeds_200km_max/);
    });

    test('empty corpus — MANUAL with null distanceKm', async () => {
        const db = makeMockDb({ nearest: null });
        const result = await resolveMasteredCity({
            db,
            geolocation: { type: 'Point', coordinates: [0, 0] },
        });

        expect(result.bucket).toBe('MANUAL');
        expect(result.fields.masteringStatus).toBe('corpus-gap-review');
        expect(result.fields.masteringDistanceKm).toBeNull();
        expect(result.log.reason).toBe('no_mastered_city_in_corpus');
    });

    test('textConflict fires when cityText disagrees with nearest city name', async () => {
        const db = makeMockDb({
            nearest: { _id: 'city-oid', cityName: 'Philadelphia', distance: 13_055 },
            city: { _id: 'city-oid', cityName: 'Philadelphia' },
        });
        const result = await resolveMasteredCity({
            db,
            geolocation: { type: 'Point', coordinates: [-75.3, 40.0] },
            cityText: 'Ardmore', // suburb — borough/metro mismatch case
        });

        expect(result.bucket).toBe('AUTO_HIGH');
        expect(result.fields.masteringTextConflict).toBe(true);
    });

    test('no textConflict when cityText is substring of nearest (Berkeley vs Berkeley)', async () => {
        const db = makeMockDb({
            nearest: { _id: 'city-oid', cityName: 'San Francisco', distance: 17_837 },
            city: { _id: 'city-oid', cityName: 'San Francisco' },
        });
        // cityText "San Francisco" exactly — no conflict
        const result = await resolveMasteredCity({
            db,
            geolocation: { type: 'Point', coordinates: [-122.4, 37.8] },
            cityText: 'San Francisco',
        });
        expect(result.fields.masteringTextConflict).toBe(false);
    });

    test('no textConflict when cityText is null/empty', async () => {
        const db = makeMockDb({
            nearest: { _id: 'city-oid', cityName: 'Boston', distance: 5_000 },
            city: { _id: 'city-oid', cityName: 'Boston' },
        });
        const result = await resolveMasteredCity({ db, geolocation: { type: 'Point', coordinates: [-71, 42] }, cityText: null });
        expect(result.fields.masteringTextConflict).toBe(false);
    });
});
