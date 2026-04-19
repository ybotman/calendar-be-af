// src/utils/enrichment.js
// Enrichment + data quality pipeline — single function called from
// CRUD inline (Sarah path), bulk-enrich endpoint (Porter batch path),
// Tier-2 periodic checker (degraded-mode safety net), and one-shot backfill.
//
// Renamed from dataQuality.js per Quinn lean: scope includes classification,
// denorm, venue resolution, and DQ warnings (broader than just DQ).
//
// Status: NOT WIRED IN. Awaiting AIDI governance sign-off + JIRA ticket.
// Spec: Collab/architecture/bulk-enrich-endpoint-spec.md (v1.2, Quinn+Porter approved)
// Source rules: Collab/architecture/beginner-class-classification-spec.md (v3, locked)
// Fixture: Collab/fixtures/beginner-class-gold-set.json

const { ObjectId } = require('mongodb');
const { resolveCountry, computeTravelWorthy, applyOverride, loadCategoryCache } = require('./eventClassification');

// Semantic-rule version for the pipeline. Bumped on any rule change (classifier
// threshold, country derivation chain, DQ warning scope, etc.). Pairs with
// SERIES_DETECTION_SPEC_VERSION from series-detection package — lets operators
// grep logs + artifact metadata to detect drift between tool runs.
const ENRICHMENT_SPEC_VERSION = '1.2.0';  // 1.2.0: event.masteredCityId denorm from venue-chain (CALBEAF-117) | 1.1.0: country venue-chain fallback (CALBEAF-113)

const TANGO_APP_IDS = new Set(['1']);
// Categories where the forBeginners classifier can return TRUE. All other categories
// force forBeginners=false via category gate. (Toby 2026-04-18 rule refinement:
// Festival/Marathon/Encuentro joined Practica/Milonga/etc. as forBeginners=false hard-gate.)
const BEGINNER_ELIGIBLE_CATEGORIES = new Set(['Class', 'Workshop', 'DayWorkshop']);

// ============================================
// classifyBeginner — pure text inference
// ============================================
// Per spec v3 Stage 0–3. Pure function: same input → same output.
// Pre-processing (HTML strip, emoji strip, etc.) is the CALLER's job.

// Stage ordering per fixture _meta (CRITICAL):
//   0 = title explicit-negative
//   1 = title explicit-positive (forBeginners)  ← runs BEFORE friendly-only
//   2 = title mixed/friendly-only
//   3 = description fallback
//   4 = superset rule

const TITLE_NEG = [
    /\bnot\s+new\s+to\s+tango\b/i,
    /\bbeyond\s+beginners?\b/i,
    /\bpre[- ]?(int|intermediate|adv)/i,
    /\bint\/adv\b/i,
    /\b(ladies|leaders|followers)\s+technique\b/i,
    // Numbered Level 2+ negatives — abbreviations included (Lv, Lvl, Level)
    /\b(?:level|lvl|lv)\s+([2-9]|[1-9]\d+)\b/i,
];

// Specific positive patterns (run first, no exclusions)
const TITLE_POS_SPECIFIC = [
    /\b(absolute|total|ongoing|advanced)\s+beginners?\b/i,
    /\bintro(?:ductory|duction)?\b.*\btango\b/i,
    /\bnewcomers?\b/i,
    /\bnew\s+to\s+(?:argentine\s+)?tango\b/i,
    /\bfirst\s+steps?\b/i,
    /\bfrom\s+scratch\b/i,
    /\btango\s+1\b(?!\s*[\.\d])/i,
    /\b(?:level|lvl|lv)\s+1\b(?!\s*[\.\d])/i,  // includes Lv 1 / Lvl 1 abbreviations
    /\btango\s+100[sm]?\b/i,
    /\bnivel\s+(uno|1|b[áa]sico)\b/i,
    // Foreign-language (prophylactic)
    /\bprincipiantes?\b/i,
    /\biniciantes?\b/i,
    /\bprincipianti\b/i,
    /\bb[áa]sico\b/i,
    /\bcorso\s+base\b/i,
    /\biniziazione\b/i,
    /\belementare\b/i,
];

// Mixed-level / friendly-only patterns — exclude the plain-beginner catch-all
// when these appear (caught later in §2 friendly-only fallback if no positive).
const TITLE_MIXED_PATTERNS = [
    /\bbeginners?\s*(&|and|\/|\+)\s*(intermediate|advanced|improvers?)\b/i,
    /\bbeginners?\s*\+/i,
    /\bbeginner\s*&\s*beyond\b/i,
    // "Beginner's Mind" Zen idiom — not a beginner class
    /\bbeginner['\u2019]?s?\s+mind\b/i,
];

// Friendly-only signals (run after positive)
const TITLE_FRIENDLY_ONLY = [
    /\ball\s*[- ]?levels?\b/i,
    /\bopen\s*[- ]?levels?\b/i,
    /\bmixed\s*[- ]?levels?\b/i,
    /\bbeginners?\s*(&|and|\/|\+)\s*(intermediate|advanced|improvers?)\b/i,
    /\bbeginners?\s*\+/i,
    /\bbeginner\s*&\s*beyond\b/i,
    /\bbeginner['\u2019]?s?\s+mind\b/i,
    /\bopen\s+house\b/i,
];

const DESC_FOR_BEG = [
    /\bdesigned\s+for\s+beginners?\b/i,
    /\bfor\s+(?:total|absolute)\s+beginners?\b/i,
    /\babsolute\s+beginners?\b/i,
    /\bno\s+(?:prior\s+)?experience\s+(?:needed|required|necessary)\b/i,
    /\bnever\s+danced\s+(?:before|tango)?\b/i,
    /\bfrom\s+scratch\b/i,
    /\bbrand[- ]new\s+(?:dancers?|students?)\b/i,
    /\bfirst\s+steps?\b/i,
];

const DESC_FRIENDLY_ONLY = [
    /\bbeginners?\s+(?:are\s+)?welcomed?\b/i,
    /\ball\s*levels?\s+(?:are\s+)?welcomed?\b/i,
    /\bbasic\s+level\b/i,  // "fundamentals at a basic level" → welcoming, not beginner-only
];

function normalizeText(s) {
    return (s || '')
        .replace(/<[^>]+>/g, ' ')
        // HTML entities common in scraped sources
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
}

// matchesFriendlyOnlyStrict — for category-gated events (Practica/Milonga/Festival/etc.),
// only explicit friendly-only signals count. Does NOT return true for positive-beginner
// signals; those need the eligible-category classifier path.
function matchesFriendlyOnlyStrict(title, description) {
    const t = normalizeText(title);
    const d = normalizeText(description).toLowerCase();
    if (TITLE_FRIENDLY_ONLY.some(r => r.test(t))) return true;
    if (DESC_FRIENDLY_ONLY.some(r => r.test(d))) return true;
    return false;
}

function classifyBeginner(title, description) {
    const t = normalizeText(title);
    const d = normalizeText(description).toLowerCase();
    const tl = t.toLowerCase();

    // §1a — Title explicit negatives → both false, stop
    if (TITLE_NEG.some(r => r.test(t))) {
        return { forBeginners: false, beginnerFriendly: false };
    }
    const hasIntermediateAlone = /\bintermediate\b/i.test(t) && !/\bbeginner/i.test(tl);
    const hasAdvancedAlone     = /\badvanced\b/i.test(t)     && !/\badvanced\s+beginner/i.test(tl) && !/\bbeginner/i.test(tl);
    const hasIntensiveAlone    = /\bintensive\b/i.test(t)    && !/\bbeginner/i.test(tl);
    if (hasIntermediateAlone || hasAdvancedAlone || hasIntensiveAlone) {
        return { forBeginners: false, beginnerFriendly: false };
    }

    // §1b — Title explicit positives (specific rules + plain-beginner with mixed-pattern exclusion)
    if (TITLE_POS_SPECIFIC.some(r => r.test(t))) {
        return { forBeginners: true, beginnerFriendly: true };
    }
    // Plain `\bbeginner\b` catch-all — fires only when no mixed-pattern excludes it
    if (/\bbeginners?\b/i.test(t) && !TITLE_MIXED_PATTERNS.some(r => r.test(t))) {
        return { forBeginners: true, beginnerFriendly: true };
    }

    // §1c — Title mixed-level / friendly-only
    if (TITLE_FRIENDLY_ONLY.some(r => r.test(t))) {
        return { forBeginners: false, beginnerFriendly: true };
    }

    // §2a — Description fallback for forBeginners
    if (DESC_FOR_BEG.some(r => r.test(d))) {
        return { forBeginners: true, beginnerFriendly: true };
    }

    // §2b — Description fallback for friendly only
    if (DESC_FRIENDLY_ONLY.some(r => r.test(d))) {
        return { forBeginners: false, beginnerFriendly: true };
    }

    // §5 — Default
    return { forBeginners: false, beginnerFriendly: false };
}

// ============================================
// runDataQualityPipeline — composable orchestrator
// ============================================
// Single function called from Tier 1 (CRUD), Tier 2 (periodic checker),
// Tier 3 (backfill). Each check fills missing fields and reports actions.

async function runDataQualityPipeline(eventDoc, db, options = {}) {
    const {
        appId = eventDoc.appId,
        eligibleBeginnerCategories = BEGINNER_ELIGIBLE_CATEGORIES,
        forceRecompute = false,
    } = options;

    const report = {
        eventId: eventDoc._id,
        appId,
        actions: [],
        skipped: [],
    };

    // Niche guard — classifier rules are Tango-tuned. Other niches: skip text classification only.
    const classifierEligible = TANGO_APP_IDS.has(appId);

    // Option A preserve-gate (Toby 2026-04-18): always recompute; `*Override` fields
    // protect organizer intent via Stage 5. Preserves nothing else — actual-field
    // preservation was over-protective and created stale-value bugs (e.g. Practilonga
    // Caminito superset violation from earlier runs).

    // --- City denorm onto event (CALBEAF-117) ---
    // When event.masteredCityId is null AND event.venueID resolves to a mastered venue,
    // denormalize venue.masteredCityId + masteredcity.cityName onto the event. This lets
    // the country chain below run naturally through Priority 3 (masteredCityId path) and
    // prevents a second --force-recompute after CALBEAF-114 venue-mastering completes.
    //
    // Governance (AIDI v1.2.0 ruling):
    //   1. Preserve-gate: event.masteredCityId already set → preserve (never overwrite).
    //   2. Consistency: masteredCityId + masteredCityName both from same masteredcity doc.
    //   3. Name-conflict guard: if event.masteredCityName is populated AND differs from
    //      derivedCityName, route to REVIEW — write NEITHER ID nor name. Flag with
    //      masteringStatus: "name-conflict-review". Human adjudicates per-row (may be
    //      a CALBEAF-115 corpus-gap case where orphan name is more accurate than chain).
    if (!eventDoc.masteredCityId && eventDoc.venueID) {
        try {
            const venue = await db.collection('venues').findOne(
                { _id: typeof eventDoc.venueID === 'string' ? new ObjectId(eventDoc.venueID) : eventDoc.venueID },
                { projection: { masteredCityId: 1 } }
            );
            if (venue && venue.masteredCityId) {
                const city = await db.collection('masteredcities').findOne(
                    { _id: venue.masteredCityId },
                    { projection: { cityName: 1 } }
                );
                if (city) {
                    // Name-conflict guard (AIDI 2026-04-19 14:27Z)
                    if (eventDoc.masteredCityName && eventDoc.masteredCityName !== city.cityName) {
                        eventDoc.masteringStatus = 'name-conflict-review';
                        report.skipped.push({
                            field: 'masteredCityId',
                            reason: `name-conflict: existing="${eventDoc.masteredCityName}" vs derived="${city.cityName}" (flagged for human review)`,
                        });
                    } else {
                        eventDoc.masteredCityId = venue.masteredCityId;
                        eventDoc.masteredCityName = city.cityName;
                        report.actions.push({ field: 'masteredCityId', source: 'venue-denorm', value: venue.masteredCityId });
                    }
                }
            }
        } catch (err) {
            report.skipped.push({ field: 'masteredCityId', reason: `venue lookup error: ${err.message}` });
        }
    } else if (eventDoc.masteredCityId) {
        report.skipped.push({ field: 'masteredCityId', reason: 'already set (preserve-gate)' });
    }

    // --- Country denorm — 5-priority derivation chain (CALBEAF-113 Layer 2) ---
    // Chain:
    //   1. masteredCountryId already set on event → preserve (never overwrite correct data)
    //   2. masteredRegionId set → region → country chain (existing, standard case)
    //   3. masteredCityId set → city → division → region → country chain
    //   4. venueID set → venue.masteredCityId → city → ... → country chain (99% fallback for discovered events)
    //   5. None → null (no source data)
    //
    // This only RAISES coverage — a correctly-set country at priority 1 is always preserved.
    // New fallback (priority 4) addresses the 83% of discovered events that have venueID
    // but no masteredRegionId, per Toby FTP-then-FTData directive 2026-04-19 00:18Z.
    if (eventDoc.masteredCountryId) {
        // Priority 1: already set, preserve
        report.skipped.push({ field: 'masteredCountryId', reason: 'already set' });
    } else if (eventDoc.masteredRegionId) {
        // Priority 2: derive from region
        const { masteredCountryId, masteredCountryName } = await resolveCountry(db, eventDoc.masteredRegionId);
        eventDoc.masteredCountryId = masteredCountryId;
        eventDoc.masteredCountryName = masteredCountryName;
        report.actions.push({ field: 'masteredCountryId', source: 'region-chain', value: masteredCountryId });
    } else {
        // Priority 3/4: try city chain or venue chain
        const chainResult = await resolveCountryViaChain(db, eventDoc);
        if (chainResult.masteredCountryId) {
            eventDoc.masteredCountryId = chainResult.masteredCountryId;
            eventDoc.masteredCountryName = chainResult.masteredCountryName;
            report.actions.push({ field: 'masteredCountryId', source: chainResult.source, value: chainResult.masteredCountryId });
        } else {
            // Priority 5: preserve existing (shouldn't exist since we're in the !masteredCountryId branch)
            if (eventDoc.masteredCountryId === undefined) eventDoc.masteredCountryId = null;
            if (eventDoc.masteredCountryName === undefined) eventDoc.masteredCountryName = null;
            report.skipped.push({ field: 'masteredCountryId', reason: `no derivation source (${chainResult.reason})` });
        }
    }

    // --- travelWorthy (always recompute; override wins) ---
    {
        const { excludedIds } = await loadCategoryCache(db, appId);
        const computed = computeTravelWorthy({
            startDate: eventDoc.startDate,
            endDate: eventDoc.endDate,
            categoryFirstId: eventDoc.categoryFirstId,
            excludedIds,
        });
        eventDoc.travelWorthy = applyOverride(computed, eventDoc.travelWorthyOverride);
        report.actions.push({ field: 'travelWorthy', source: 'computed', value: eventDoc.travelWorthy });
    }

    // --- Beginner classification (Toby 2026-04-18 rule refinement + Option A) ---
    const categoryName = await resolveCategoryName(db, eventDoc.categoryFirstId, appId);
    const categoryAllowed = categoryName && eligibleBeginnerCategories.has(categoryName);

    if (!classifierEligible) {
        report.skipped.push({ field: 'forBeginners/beginnerFriendly', reason: `appId=${appId} outside Tango niche` });
    } else if (!categoryAllowed) {
        // Ineligible category: forBeg hard-false; friendly via strict-threshold (own-text
        // explicit friendly-only signals only — NOT the positive-beginner path or superset).
        // "not beginner even if there is a class beforehand; milonga has to be clear-clear-clear
        // on its own text" — Toby 2026-04-18.
        const strictFriendly = matchesFriendlyOnlyStrict(eventDoc.title, eventDoc.description);
        const finalForBeg = applyOverride(false, eventDoc.forBeginnersOverride);
        const finalFriendly = applyOverride(strictFriendly, eventDoc.beginnerFriendlyOverride);
        if (eventDoc.forBeginners !== finalForBeg) {
            eventDoc.forBeginners = finalForBeg;
            report.actions.push({ field: 'forBeginners', source: 'category-gate', value: finalForBeg, reason: `category=${categoryName}` });
        }
        if (eventDoc.beginnerFriendly !== finalFriendly) {
            eventDoc.beginnerFriendly = finalFriendly;
            report.actions.push({ field: 'beginnerFriendly', source: 'strict-friendly', value: finalFriendly, reason: `category=${categoryName}` });
        }
    } else {
        // Eligible (Class / Workshop / DayWorkshop): full classifier, always recompute
        const computed = classifyBeginner(eventDoc.title, eventDoc.description);
        const finalForBeg = applyOverride(computed.forBeginners, eventDoc.forBeginnersOverride);
        const finalFriendly = applyOverride(computed.beginnerFriendly || finalForBeg, eventDoc.beginnerFriendlyOverride);
        if (eventDoc.forBeginners !== finalForBeg) {
            eventDoc.forBeginners = finalForBeg;
            report.actions.push({ field: 'forBeginners', source: 'classifier', value: finalForBeg });
        }
        if (eventDoc.beginnerFriendly !== finalFriendly) {
            eventDoc.beginnerFriendly = finalFriendly;
            report.actions.push({ field: 'beginnerFriendly', source: 'classifier', value: finalFriendly });
        }
    }

    // --- Venue resolution (venueID → venueGeolocation, venueCityName, venueTimezone) ---
    if (eventDoc.venueID && (forceRecompute || !eventDoc.venueGeolocation || !eventDoc.venueCityName || !eventDoc.venueTimezone)) {
        try {
            const venue = await db.collection('venues').findOne(
                { _id: typeof eventDoc.venueID === 'string' ? new ObjectId(eventDoc.venueID) : eventDoc.venueID },
                { projection: { geolocation: 1, masteredCityName: 1, timezone: 1, name: 1 } }
            );
            if (venue) {
                if (!eventDoc.venueGeolocation && venue.geolocation) {
                    eventDoc.venueGeolocation = venue.geolocation;
                    report.actions.push({ field: 'venueGeolocation', source: 'venue-lookup', value: 'set' });
                }
                if (!eventDoc.venueCityName && venue.masteredCityName) {
                    eventDoc.venueCityName = venue.masteredCityName;
                    report.actions.push({ field: 'venueCityName', source: 'venue-lookup', value: venue.masteredCityName });
                }
                if (!eventDoc.venueTimezone && venue.timezone) {
                    eventDoc.venueTimezone = venue.timezone;
                    report.actions.push({ field: 'venueTimezone', source: 'venue-lookup', value: venue.timezone });
                }
            } else {
                report.skipped.push({ field: 'venueResolution', reason: 'venueID not found in venues collection' });
            }
        } catch (err) {
            report.skipped.push({ field: 'venueResolution', reason: `error: ${err.message}` });
        }
    } else if (!eventDoc.venueID) {
        // Diagnostic: include the observed value + its type so callers can distinguish
        // legitimate no-match (per AIDI never-guess-venue) from payload bugs (empty string,
        // serialization mismatch, typo'd key like venueId).
        const valStr = eventDoc.venueID === undefined ? 'undefined'
            : eventDoc.venueID === null ? 'null'
            : eventDoc.venueID === '' ? 'empty-string'
            : `value=${JSON.stringify(eventDoc.venueID)}`;
        const alsoCheckedKey = eventDoc.venueId !== undefined ? ' (NOTE: eventDoc.venueId IS set — key-case mismatch? expected venueID)' : '';
        report.skipped.push({ field: 'venueResolution', reason: `no venueID (${valStr})${alsoCheckedKey}` });
    }

    // --- Date sanity (warn-only, never reject) ---
    if (eventDoc.startDate && eventDoc.endDate) {
        const start = new Date(eventDoc.startDate);
        const end = new Date(eventDoc.endDate);
        if (end < start) {
            report.skipped.push({ field: 'dateSanity', reason: 'WARN: endDate < startDate' });
        } else {
            const durationDays = (end - start) / (1000 * 60 * 60 * 24);
            if (durationDays > 7) {
                report.skipped.push({ field: 'dateSanity', reason: `WARN: duration ${durationDays.toFixed(1)} days > 7d` });
            }
        }
    }

    // --- Required field presence (warn-only) ---
    const required = ['appId', 'title', 'ownerOrganizerID', 'startDate', 'endDate'];
    for (const f of required) {
        if (!eventDoc[f]) {
            report.skipped.push({ field: f, reason: `WARN: missing required field` });
        }
    }

    // --- Initialize override fields if missing (idempotent) ---
    for (const f of ['travelWorthyOverride', 'beginnerFriendlyOverride', 'forBeginnersOverride']) {
        if (eventDoc[f] === undefined) {
            eventDoc[f] = null;
        }
    }

    // --- enrichmentStatus — pipeline ran to completion ---
    // AIDI blocker 3 (2026-04-18): status wasn't being set by pipeline, so backfill saw
    // 0 status changes. Now the pipeline explicitly marks 'complete' at successful end.
    // Callers (Events_BulkEnrich.js) catch pipeline exceptions and set 'failed' externally.
    eventDoc.enrichmentStatus = 'complete';

    return { event: eventDoc, report };
}

async function resolveCategoryName(db, categoryFirstId, appId) {
    if (!categoryFirstId) return null;
    const { idToName } = await loadCategoryCache(db, appId);
    return idToName.get(categoryFirstId.toString()) || null;
}

/**
 * Country-derivation fallback chain (CALBEAF-113 Layer 2).
 * Tries to resolve masteredCountryId/Name when the event has no masteredRegionId.
 * Priority:
 *   3. eventDoc.masteredCityId → city.masteredDivisionId → division.masteredRegionId → region.masteredCountryId
 *   4. eventDoc.venueID → venue.masteredCityId → same chain as #3
 *
 * Returns { masteredCountryId, masteredCountryName, source, reason }.
 * source: 'city-chain' | 'venue-chain' | null
 * reason: present when no country could be derived.
 */
async function resolveCountryViaChain(db, eventDoc) {
    // Priority 3: event has masteredCityId
    if (eventDoc.masteredCityId) {
        const result = await chainFromCity(db, eventDoc.masteredCityId);
        if (result.masteredCountryId) return { ...result, source: 'city-chain' };
    }

    // Priority 4: event has venueID
    if (eventDoc.venueID) {
        try {
            const venueObjId = typeof eventDoc.venueID === 'string' ? new ObjectId(eventDoc.venueID) : eventDoc.venueID;
            const venue = await db.collection('venues').findOne(
                { _id: venueObjId },
                { projection: { masteredCityId: 1 } }
            );
            if (venue && venue.masteredCityId) {
                const result = await chainFromCity(db, venue.masteredCityId);
                if (result.masteredCountryId) return { ...result, source: 'venue-chain' };
                return { masteredCountryId: null, masteredCountryName: null, source: null, reason: 'venue->city resolved but city chain broken' };
            }
            return { masteredCountryId: null, masteredCountryName: null, source: null, reason: venue ? 'venue has no masteredCityId' : 'venueID not found in venues' };
        } catch (err) {
            return { masteredCountryId: null, masteredCountryName: null, source: null, reason: `venue lookup error: ${err.message}` };
        }
    }

    return { masteredCountryId: null, masteredCountryName: null, source: null, reason: 'no masteredCityId and no venueID' };
}

async function chainFromCity(db, cityId) {
    const cityObjId = typeof cityId === 'string' ? new ObjectId(cityId) : cityId;
    const city = await db.collection('masteredcities').findOne({ _id: cityObjId }, { projection: { masteredDivisionId: 1 } });
    if (!city || !city.masteredDivisionId) return { masteredCountryId: null, masteredCountryName: null };
    const division = await db.collection('mastereddivisions').findOne({ _id: city.masteredDivisionId }, { projection: { masteredRegionId: 1 } });
    if (!division || !division.masteredRegionId) return { masteredCountryId: null, masteredCountryName: null };
    return await resolveCountry(db, division.masteredRegionId);
}

module.exports = {
    classifyBeginner,
    matchesFriendlyOnlyStrict,
    runDataQualityPipeline,
    resolveCountryViaChain,
    normalizeText,
    TANGO_APP_IDS,
    BEGINNER_ELIGIBLE_CATEGORIES,
    ENRICHMENT_SPEC_VERSION,
    // Re-export for tests
    TITLE_NEG, TITLE_FRIENDLY_ONLY, TITLE_POS_SPECIFIC, TITLE_MIXED_PATTERNS, DESC_FOR_BEG, DESC_FRIENDLY_ONLY,
};
