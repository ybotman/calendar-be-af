// src/lib/organizerShortNameRules.js
// CALBEAF-107 — Organizer shortName validator
// Per ORGANIZER-SHORTNAME-DESIGN.md §1.2 + Toby ruling 2026-04-14 18:33
//
// Charset LOCKED (Toby + Fulton edge-case calls, aligned with AIDI + Sarah):
//   - Length 3–12
//   - First 3 chars MUST be A-Z letters
//   - Chars 4+ may be A-Z, 0-9, or hyphen
//   - Must end alphanumeric (no trailing hyphen)
//   - No consecutive hyphens
//   - No spaces, no underscore, no unicode
//   - Case-insensitive via UPPERCASE normalization
//   - reserved: ['CHANGE']
//
// appId=1 only configured. Hard pass-through for any other appId.

const SHORTNAME_RULES = {
    '1': {
        minLength: 3,
        maxLength: 12,
        pattern: /^[A-Z]{3}(?:-?[A-Z0-9])*$/,
        reserved: ['CHANGE']
    }
    // NO other appIds configured. appId=2 (HJ), etc. receive NO rules entry.
};

function getShortNameRules(appId) {
    return SHORTNAME_RULES[String(appId)] || null;
}

function validateShortName(shortName, appId) {
    const rules = getShortNameRules(appId);
    if (!rules) return { valid: true };

    const normalized = String(shortName || '').toUpperCase();

    if (normalized.length < rules.minLength) {
        return {
            valid: false,
            reason: 'invalid-length',
            message: `shortName must be at least ${rules.minLength} characters`,
            normalized
        };
    }
    if (normalized.length > rules.maxLength) {
        return {
            valid: false,
            reason: 'invalid-length',
            message: `shortName exceeds maxLength of ${rules.maxLength}`,
            normalized
        };
    }
    if (!rules.pattern.test(normalized)) {
        return {
            valid: false,
            reason: 'invalid-pattern',
            message: `shortName contains invalid characters or format (first 3 must be letters, rest letters/digits/hyphen, no consecutive or trailing hyphens)`,
            normalized
        };
    }
    if (rules.reserved.includes(normalized)) {
        return {
            valid: false,
            reason: 'reserved',
            message: `shortName '${normalized}' is reserved`,
            normalized
        };
    }

    return { valid: true, normalized };
}

module.exports = { getShortNameRules, validateShortName, SHORTNAME_RULES };
