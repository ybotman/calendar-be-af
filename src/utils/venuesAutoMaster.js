// src/utils/venuesAutoMaster.js
// CALBEAF-116: Shared Venues_AutoMaster helper.
// Per team-consensus doc CITY-COUNTRY-DATA-DISCIPLINE-REVIEW.md Q3.5.
//
// Single source of truth for venue city/country mastering logic. Called by:
//   1. Batch runner (scripts/venues-automaster-batch.js) — legacy backfill
//   2. Inline hooks (Venues.js POST/PUT, Venue_AdminAdd.js) — new venue writes
//
// The helper does RESOLUTION + CLASSIFICATION only. It does NOT persist.
// Callers decide when to write and can layer idempotency / logging around it.

const { ObjectId } = require('mongodb');

// Distance bucket thresholds (km). Changing these is a rule change — bump
// VENUES_AUTOMASTER_SPEC_VERSION and notify consumers per AIDI sync protocol.
const BUCKET_HIGH_MAX_KM = 50;
const BUCKET_MEDIUM_MAX_KM = 200;

// Version tag — bump on any rule change (threshold shift, new bucket, etc).
// Consumers log this at invocation for grep-detectable drift signal.
const VENUES_AUTOMASTER_SPEC_VERSION = '1.1.0';  // 1.1.0: CALBEAF-118 division-carries-country bypass for continent-regions | 1.0.0: initial

/**
 * Compares venue.city free-form text against nearest masteredcity name.
 * Returns true if the strings disagree (case-insensitive, substring-tolerant).
 * Borough/metro divergence (Berkeley vs San Francisco) IS flagged —
 * callers treat this as an audit signal, not a write-blocker.
 */
function textConflicts(venueText, nearestCityName) {
    if (!venueText || !nearestCityName) return false;
    const a = String(venueText).trim().toLowerCase();
    const b = String(nearestCityName).trim().toLowerCase();
    if (a === b) return false;
    if (a.includes(b) || b.includes(a)) return false;
    return true;
}

function classifyDistance(distanceKm) {
    if (distanceKm <= BUCKET_HIGH_MAX_KM) return 'AUTO_HIGH';
    if (distanceKm <= BUCKET_MEDIUM_MAX_KM) return 'AUTO_MEDIUM';
    return 'MANUAL';
}

function kmFromMeters(m) {
    return +(m / 1000).toFixed(3);
}

/**
 * Walks the city→division→region→country chain.
 * Returns null if cityId is falsy or the city doc can't be found.
 * Partial chains (division without region, etc.) return what resolves.
 *
 * CALBEAF-118 (A1 option d): division-carries-country bypass for continent-regions.
 * When a division has `masteredCountryId` set directly, use it as the country source
 * regardless of region's country link. Enables European hierarchy (Italy/Germany/etc.
 * as divisions under continent-level "Europe" region) to resolve real country without
 * schema change to region docs. No fallback: `division.masteredCountryId` is an
 * explicit reference to a real masteredcountries doc, not a substitution.
 */
async function chainFromCity(db, cityId) {
    if (!cityId) return null;
    const city = await db.collection('masteredcities').findOne({ _id: cityId });
    if (!city) return null;
    const out = {
        masteredCityId: city._id,
        masteredCityName: city.cityName || null,
    };
    if (city.masteredDivisionId) {
        const div = await db.collection('mastereddivisions').findOne({ _id: city.masteredDivisionId });
        if (div) {
            out.masteredDivisionId = div._id;
            out.masteredDivisionName = div.divisionName || null;
            if (div.masteredRegionId) {
                const reg = await db.collection('masteredregions').findOne({ _id: div.masteredRegionId });
                if (reg) {
                    out.masteredRegionId = reg._id;
                    out.masteredRegionName = reg.regionName || null;
                    if (reg.masteredCountryId) {
                        const cn = await db.collection('masteredcountries').findOne({ _id: reg.masteredCountryId });
                        if (cn) {
                            out.masteredCountryId = cn._id;
                            out.masteredCountryName = cn.countryName || null;
                        }
                    }
                }
            }
            // CALBEAF-118: division-carries-country bypass. Only fires when region→country
            // chain did not already yield a country (preserves US hierarchy behavior where
            // region carries country). Division-level country is authoritative for
            // European divisions whose region is continent-level.
            if (!out.masteredCountryId && div.masteredCountryId) {
                const cn = await db.collection('masteredcountries').findOne({ _id: div.masteredCountryId });
                if (cn) {
                    out.masteredCountryId = cn._id;
                    out.masteredCountryName = cn.countryName || null;
                }
            }
        }
    }
    return out;
}

/**
 * Finds the nearest masteredcity to a GeoJSON Point via $geoNear.
 * Returns { cityId, cityName, distanceKm } or null if corpus is empty.
 */
async function findNearestCity(db, geolocation) {
    const coords = geolocation?.coordinates;
    if (!Array.isArray(coords) || coords.length !== 2) return null;

    const pipeline = [
        {
            $geoNear: {
                near: { type: 'Point', coordinates: coords },
                distanceField: 'distance',
                spherical: true,
                maxDistance: 10_000_000, // 10,000 km cap — effectively unlimited
                key: 'location',
            },
        },
        { $limit: 1 },
        { $project: { cityName: 1, distance: 1 } },
    ];
    const [nearest] = await db.collection('masteredcities').aggregate(pipeline).toArray();
    if (!nearest) return null;

    return {
        cityId: nearest._id,
        cityName: nearest.cityName || null,
        distanceKm: kmFromMeters(nearest.distance),
    };
}

/**
 * Main entry point. Resolves + classifies a venue's mastered city from geolocation.
 *
 * Input:
 *   db           — MongoDB db handle
 *   geolocation  — GeoJSON Point { type: 'Point', coordinates: [lng, lat] }
 *   cityText     — optional free-form venue.city for text-conflict audit
 *
 * Returns:
 *   {
 *     bucket: 'AUTO_HIGH' | 'AUTO_MEDIUM' | 'MANUAL',
 *     fields: { ... fields to $set on the venue, per-bucket rules },
 *     log: { distanceKm, nearestCityId, nearestCityName, masteringTextConflict, reason },
 *   }
 *
 * Or null if geolocation is invalid. Callers treat null as "no-op — do nothing."
 *
 * Per-bucket field rules (the write contract — constant across batch and inline):
 *   AUTO_HIGH   (≤50km):  full chain + mastering* audit + masteringStatus='mastered_by_automaster'
 *   AUTO_MEDIUM (50-200): country-only + mastering* audit + masteringStatus='country_only_by_automaster'
 *   MANUAL      (>200km): flag-only — masteringDistanceKm (may be null) + masteringStatus='corpus-gap-review'
 *
 * Callers apply `masteringAppliedAt: new Date()` separately (so batch can stamp
 * a single run time across all writes; inline hook stamps per-request).
 */
async function resolveMasteredCity({ db, geolocation, cityText = null }) {
    const coords = geolocation?.coordinates;
    if (!Array.isArray(coords) || coords.length !== 2) return null;

    const nearest = await findNearestCity(db, geolocation);

    // Corpus empty or geo outside reasonable bounds — MANUAL flag only
    if (!nearest) {
        return {
            bucket: 'MANUAL',
            fields: {
                masteringStatus: 'corpus-gap-review',
                masteringDistanceKm: null,
            },
            log: {
                distanceKm: null,
                nearestCityId: null,
                nearestCityName: null,
                masteringTextConflict: false,
                reason: 'no_mastered_city_in_corpus',
            },
        };
    }

    const bucket = classifyDistance(nearest.distanceKm);
    const conflict = textConflicts(cityText, nearest.cityName);

    if (bucket === 'MANUAL') {
        return {
            bucket,
            fields: {
                masteringStatus: 'corpus-gap-review',
                masteringDistanceKm: nearest.distanceKm,
            },
            log: {
                distanceKm: nearest.distanceKm,
                nearestCityId: nearest.cityId,
                nearestCityName: nearest.cityName,
                masteringTextConflict: conflict,
                reason: `distance_${nearest.distanceKm}km_exceeds_${BUCKET_MEDIUM_MAX_KM}km_max`,
            },
        };
    }

    const chain = await chainFromCity(db, nearest.cityId);
    if (!chain) {
        // Shouldn't happen — nearest came from masteredcities. Defensive fallback to MANUAL.
        return {
            bucket: 'MANUAL',
            fields: {
                masteringStatus: 'corpus-gap-review',
                masteringDistanceKm: nearest.distanceKm,
            },
            log: {
                distanceKm: nearest.distanceKm,
                nearestCityId: nearest.cityId,
                nearestCityName: nearest.cityName,
                masteringTextConflict: conflict,
                reason: 'nearest_city_chain_lookup_failed',
            },
        };
    }

    if (bucket === 'AUTO_HIGH') {
        const fields = {
            masteredCityId: chain.masteredCityId,
            masteredCityName: chain.masteredCityName,
            masteringDistanceKm: nearest.distanceKm,
            masteringTextConflict: conflict,
            masteringStatus: 'mastered_by_automaster',
        };
        if (chain.masteredDivisionId) {
            fields.masteredDivisionId = chain.masteredDivisionId;
            fields.masteredDivisionName = chain.masteredDivisionName;
        }
        if (chain.masteredRegionId) {
            fields.masteredRegionId = chain.masteredRegionId;
            fields.masteredRegionName = chain.masteredRegionName;
        }
        if (chain.masteredCountryId) {
            fields.masteredCountryId = chain.masteredCountryId;
            fields.masteredCountryName = chain.masteredCountryName;
        }
        return {
            bucket,
            fields,
            log: {
                distanceKm: nearest.distanceKm,
                nearestCityId: nearest.cityId,
                nearestCityName: nearest.cityName,
                masteringTextConflict: conflict,
                reason: `within_${BUCKET_HIGH_MAX_KM}km_auto_high`,
            },
        };
    }

    // AUTO_MEDIUM — country-only (skip city/division/region to prevent
    // /boston-route pollution + admin-hierarchy misalignment at 50-200km).
    const fields = {
        masteringDistanceKm: nearest.distanceKm,
        masteringTextConflict: conflict,
        masteringStatus: 'country_only_by_automaster',
    };
    if (chain.masteredCountryId) {
        fields.masteredCountryId = chain.masteredCountryId;
        fields.masteredCountryName = chain.masteredCountryName;
    }
    return {
        bucket,
        fields,
        log: {
            distanceKm: nearest.distanceKm,
            nearestCityId: nearest.cityId,
            nearestCityName: nearest.cityName,
            masteringTextConflict: conflict,
            reason: `distance_${nearest.distanceKm}km_country_only`,
        },
    };
}

module.exports = {
    resolveMasteredCity,
    // Exported for batch + test use; treat as internals for inline hook.
    findNearestCity,
    chainFromCity,
    classifyDistance,
    textConflicts,
    kmFromMeters,
    // Constants (read-only)
    BUCKET_HIGH_MAX_KM,
    BUCKET_MEDIUM_MAX_KM,
    VENUES_AUTOMASTER_SPEC_VERSION,
};
