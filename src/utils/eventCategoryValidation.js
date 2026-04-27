// src/utils/eventCategoryValidation.js
// CALBEAF-154 — canonical category-duration rules.
//
// Buckets:
//   SHORT — Milonga, Practica, Class       (15 min ≤ d < 24h)
//   LONG  — Festival, Encuentro, Marathon  (24h ≤ d ≤ 168h)
//   FLEX  — Workshop, Other                (15 min ≤ d ≤ 168h)
//
// Universal hard cap: any event ≤ 168 hours (7 days).
// Mix rule: SHORT and LONG cannot combine in a single event's category slots.
// FLEX can combine with either SHORT or LONG (it has no SHORT/LONG identity).
//
// DayWorkshop deprecated: workshops are bucketed by duration, not label.
//
// BE-side enforcement is deferred — this file defines the rule; Events_Create /
// Events_Update will wire to it once FE (Sarah's eventCategoryValidation.js)
// is updated to match, to avoid race conditions.

'use strict';

const SHORT_CATEGORIES = ['Milonga', 'Practica', 'Class'];
const LONG_CATEGORIES = ['Festival', 'Encuentro', 'Marathon'];
const FLEX_CATEGORIES = ['Workshop', 'Other'];

const SHORT_MIN_MINUTES = 15;
const SHORT_MAX_HOURS = 24;     // exclusive
const LONG_MIN_HOURS = 24;
const HARD_MAX_HOURS = 168;     // 7 days, applies to all

/**
 * Classify a categoryName into SHORT / LONG / FLEX / UNKNOWN.
 * UNKNOWN covers neutral categories (Trip, Performance, Unknown) that have no
 * duration rules of their own.
 */
function classifyCategory(categoryName) {
    if (!categoryName) return 'UNKNOWN';
    if (SHORT_CATEGORIES.includes(categoryName)) return 'SHORT';
    if (LONG_CATEGORIES.includes(categoryName)) return 'LONG';
    if (FLEX_CATEGORIES.includes(categoryName)) return 'FLEX';
    return 'UNKNOWN';
}

/**
 * Validate an event's category slots against duration rules.
 * Caller passes resolved category NAMES (not ObjectIds) for first/second/third
 * plus the computed durationHours and durationMinutes.
 *
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateCategoryDuration({ categoryFirst, categorySecond, categoryThird, durationHours, durationMinutes }) {
    const errors = [];
    const cats = [categoryFirst, categorySecond, categoryThird].filter(Boolean);

    // Hard cap on any event
    if (durationHours > HARD_MAX_HOURS) {
        const days = Math.round(durationHours / 24);
        errors.push(`Events cannot exceed 7 days. Current: ${days} days (${Math.round(durationHours)} hours).`);
    }

    // Per-category bucket validation
    for (const cat of cats) {
        const bucket = classifyCategory(cat);
        if (bucket === 'SHORT') {
            if (durationMinutes < SHORT_MIN_MINUTES) {
                errors.push(`${cat} must be at least 15 minutes. Current: ${Math.round(durationMinutes)} minutes.`);
            }
            if (durationHours >= SHORT_MAX_HOURS) {
                errors.push(`${cat} must be less than 24 hours. Current: ${Math.round(durationHours)} hours.`);
            }
        } else if (bucket === 'LONG') {
            if (durationHours < LONG_MIN_HOURS) {
                errors.push(`${cat} must be 24 hours or longer. Current: ${Math.round(durationHours)} hours.`);
            }
        } else if (bucket === 'FLEX') {
            // Workshop / Other: 15 min ≤ d ≤ 168h. Hard cap above covers upper bound.
            if (durationMinutes < SHORT_MIN_MINUTES) {
                errors.push(`${cat} must be at least 15 minutes. Current: ${Math.round(durationMinutes)} minutes.`);
            }
        }
        // UNKNOWN: no duration rules.
    }

    // Mix rule: SHORT + LONG cannot combine. FLEX is mix-compatible with either.
    const buckets = new Set(cats.map(classifyCategory));
    if (buckets.has('SHORT') && buckets.has('LONG')) {
        errors.push('SHORT (Milonga/Practica/Class) and LONG (Festival/Encuentro/Marathon) categories cannot be combined in a single event.');
    }

    return { valid: errors.length === 0, errors };
}

module.exports = {
    SHORT_CATEGORIES,
    LONG_CATEGORIES,
    FLEX_CATEGORIES,
    SHORT_MIN_MINUTES,
    SHORT_MAX_HOURS,
    LONG_MIN_HOURS,
    HARD_MAX_HOURS,
    classifyCategory,
    validateCategoryDuration,
};
