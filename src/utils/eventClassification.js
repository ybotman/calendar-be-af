// src/utils/eventClassification.js
// CALBEAF-109: Event classification utilities
// Computes travelWorthy and resolves country denormalization for events.
//
// Field naming: camelCase to match existing event schema (isActive, isFeatured, etc.)
// Design doc uses snake_case notation but DB fields follow project convention.

const { ObjectId } = require('mongodb');

// ============================================
// CATEGORY CACHE — excluded categories for travelWorthy
// ============================================

// Categories that NEVER qualify as travelWorthy regardless of duration.
// Cached per cold start to avoid DB lookup on every create/update.
const EXCLUDED_CATEGORY_NAMES = ['Class', 'Milonga', 'Practica'];

let _excludedCategoryIds = null;
let _categoryIdToName = null;

/**
 * Load and cache the excluded category ObjectIds + full ID→name map.
 * Called once per cold start; subsequent calls return cached values.
 *
 * @param {import('mongodb').Db} db - MongoDB database handle
 * @param {string} appId - Application ID (e.g. '1' for TangoTiempo)
 * @returns {Promise<{ excludedIds: Set<string>, idToName: Map<string, string> }>}
 */
async function loadCategoryCache(db, appId) {
    if (_excludedCategoryIds && _categoryIdToName) {
        return { excludedIds: _excludedCategoryIds, idToName: _categoryIdToName };
    }

    const categories = await db.collection('categories')
        .find({ appId })
        .project({ _id: 1, categoryName: 1 })
        .toArray();

    _categoryIdToName = new Map();
    _excludedCategoryIds = new Set();

    for (const cat of categories) {
        const id = cat._id.toString();
        _categoryIdToName.set(id, cat.categoryName);
        if (EXCLUDED_CATEGORY_NAMES.includes(cat.categoryName)) {
            _excludedCategoryIds.add(id);
        }
    }

    return { excludedIds: _excludedCategoryIds, idToName: _categoryIdToName };
}

// ============================================
// TRAVEL WORTHY COMPUTATION
// ============================================

/**
 * Compute travelWorthy for an event.
 *
 * Rule (Toby decision 2026-04-16):
 *   travelWorthy = (duration > 24 hours) AND (category NOT IN [Class, Milonga, Practica])
 *
 * @param {object} params
 * @param {Date} params.startDate - Event start
 * @param {Date} params.endDate - Event end
 * @param {string|ObjectId|null} params.categoryFirstId - Primary category ObjectId
 * @param {Set<string>} params.excludedIds - Cached excluded category ID strings
 * @returns {boolean}
 */
function computeTravelWorthy({ startDate, endDate, categoryFirstId, excludedIds }) {
    if (!startDate || !endDate) return false;

    const durationHours = (new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60);
    if (durationHours <= 24) return false;

    if (!categoryFirstId) return true; // No category = not excluded

    const catId = categoryFirstId.toString();
    return !excludedIds.has(catId);
}

/**
 * Apply override logic for classification booleans.
 * If override is non-null, use override. Otherwise use computed value.
 *
 * @param {boolean} computedValue - The rule-computed value
 * @param {boolean|null|undefined} overrideValue - Organizer override (null = no override)
 * @returns {boolean}
 */
function applyOverride(computedValue, overrideValue) {
    if (overrideValue !== null && overrideValue !== undefined) {
        return Boolean(overrideValue);
    }
    return computedValue;
}

// ============================================
// COUNTRY DENORMALIZATION
// ============================================

/**
 * Resolve masteredCountryId + masteredCountryName from event's masteredRegionId.
 * Chain: event.masteredRegionId → regions.masteredCountryId → masteredcountries.countryName
 *
 * @param {import('mongodb').Db} db
 * @param {string|ObjectId|null} masteredRegionId
 * @returns {Promise<{ masteredCountryId: ObjectId|null, masteredCountryName: string|null }>}
 */
async function resolveCountry(db, masteredRegionId) {
    if (!masteredRegionId) {
        return { masteredCountryId: null, masteredCountryName: null };
    }

    const regionObjId = typeof masteredRegionId === 'string'
        ? new ObjectId(masteredRegionId)
        : masteredRegionId;

    const region = await db.collection('masteredregions').findOne(
        { _id: regionObjId },
        { projection: { masteredCountryId: 1 } }
    );

    if (!region || !region.masteredCountryId) {
        return { masteredCountryId: null, masteredCountryName: null };
    }

    const country = await db.collection('masteredcountries').findOne(
        { _id: region.masteredCountryId },
        { projection: { countryName: 1 } }
    );

    if (!country) {
        return { masteredCountryId: region.masteredCountryId, masteredCountryName: null };
    }

    return {
        masteredCountryId: region.masteredCountryId,
        masteredCountryName: country.countryName
    };
}

// ============================================
// COMBINED: Classify + enrich an event document
// ============================================

/**
 * Apply all CALBEAF-109 classification and enrichment to an event document.
 * Call this in Events_Create and Events_Update after building the event doc.
 *
 * Mutates the event object in place and returns it.
 *
 * @param {import('mongodb').Db} db
 * @param {object} eventDoc - The event document (will be mutated)
 * @param {string} appId - Application ID
 * @returns {Promise<object>} The mutated event document
 */
async function classifyAndEnrichEvent(db, eventDoc, appId) {
    const { excludedIds } = await loadCategoryCache(db, appId);

    // Compute travelWorthy
    const computedTravelWorthy = computeTravelWorthy({
        startDate: eventDoc.startDate,
        endDate: eventDoc.endDate,
        categoryFirstId: eventDoc.categoryFirstId,
        excludedIds
    });
    eventDoc.travelWorthy = applyOverride(
        computedTravelWorthy,
        eventDoc.travelWorthyOverride
    );

    // beginnerFriendly: passthrough from request body (organizer-set)
    // If not provided, default to false
    if (eventDoc.beginnerFriendly === undefined) {
        eventDoc.beginnerFriendly = false;
    }
    eventDoc.beginnerFriendly = applyOverride(
        eventDoc.beginnerFriendly,
        eventDoc.beginnerFriendlyOverride
    );

    // Initialize override fields if not present
    if (eventDoc.travelWorthyOverride === undefined) {
        eventDoc.travelWorthyOverride = null;
    }
    if (eventDoc.beginnerFriendlyOverride === undefined) {
        eventDoc.beginnerFriendlyOverride = null;
    }

    // Denormalize country from region chain
    if (eventDoc.masteredRegionId) {
        const { masteredCountryId, masteredCountryName } = await resolveCountry(db, eventDoc.masteredRegionId);
        eventDoc.masteredCountryId = masteredCountryId;
        eventDoc.masteredCountryName = masteredCountryName;
    } else if (eventDoc.masteredCountryId === undefined) {
        eventDoc.masteredCountryId = null;
        eventDoc.masteredCountryName = null;
    }

    return eventDoc;
}

module.exports = {
    loadCategoryCache,
    computeTravelWorthy,
    applyOverride,
    resolveCountry,
    classifyAndEnrichEvent,
    EXCLUDED_CATEGORY_NAMES
};
