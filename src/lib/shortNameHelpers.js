// src/lib/shortNameHelpers.js
// CALBEAF-107 — Shared helpers for organizer shortName enforcement
// Per ORGANIZER-SHORTNAME-DESIGN.md §1.4 + §1.1.6

const { validateShortName } = require('./organizerShortNameRules');

/**
 * Build a structured ValidationError (HTTP 400) response per §1.4.1
 */
function validationErrorResponse({ field, value, reason, message, code = 'VALIDATION_SHORTNAME' }) {
    return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            success: false,
            error: 'ValidationError',
            code,
            field,
            value: value !== undefined ? value : null,
            reason,
            message,
            timestamp: new Date().toISOString()
        })
    };
}

/**
 * Build a structured DuplicateError (HTTP 409) response per §1.4.2
 * `suggestions` always present as stable key — currently always [].
 */
function duplicateShortNameResponse(normalizedShortName) {
    return {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            success: false,
            error: 'DuplicateError',
            code: 'DUPLICATE_SHORTNAME',
            field: 'shortName',
            value: normalizedShortName,
            message: `shortName '${normalizedShortName}' already exists`,
            suggestions: [],
            timestamp: new Date().toISOString()
        })
    };
}

/**
 * Run §1.2 validator and translate failure into a 400 response.
 * Returns { ok: true, normalized } on pass, { ok: false, response } on fail.
 */
function validateOrFail(shortName, appId) {
    const result = validateShortName(shortName, appId);
    if (result.valid) {
        return { ok: true, normalized: result.normalized || shortName };
    }
    return {
        ok: false,
        response: validationErrorResponse({
            field: 'shortName',
            value: shortName,
            reason: result.reason,
            message: result.message
        })
    };
}

/**
 * Fire-and-forget backfeed notification to AIDI per §1.1.6.
 * - 2-second timeout, no retry.
 * - Gated by AIDI_WEBHOOK_URL env var (skip if unset).
 * - Only fires for appId=1.
 * - Never throws; caller MUST NOT await in a way that blocks response >2s.
 *
 * @param {object} params
 * @param {object} params.context - Azure Functions context (for logging)
 * @param {string} params.orgId - Stringified ObjectId
 * @param {string|null} params.orgToken - Outreach token (null if admin-created)
 * @param {string} params.shortName - Normalized shortName
 * @param {string|number} params.appId - Application ID
 */
async function backfeedAidi({ context, orgId, orgToken, shortName, appId }) {
    try {
        if (String(appId) !== '1') {
            return; // Scope guard per §1.1.6
        }

        const webhookUrl = process.env.AIDI_WEBHOOK_URL;
        if (!webhookUrl) {
            context.log('[BACKFEED AIDI] AIDI_WEBHOOK_URL not configured, skipping');
            return;
        }

        const token = process.env.AIDI_WEBHOOK_TOKEN || '';
        const payload = {
            event: 'organizer.shortname.upserted',
            orgId,
            orgToken: orgToken || null,
            shortName,
            appId: String(appId),
            timestamp: new Date().toISOString()
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);

        try {
            const resp = await fetch(webhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Webhook-Token': token
                },
                body: JSON.stringify(payload),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (!resp.ok) {
                context.log(`[BACKFEED AIDI] non-2xx response for orgId=${orgId} status=${resp.status}`);
            } else {
                context.log(`[BACKFEED AIDI] ok for orgId=${orgId} shortName=${shortName}`);
            }
        } catch (err) {
            clearTimeout(timeoutId);
            const reason = err.name === 'AbortError' ? 'timeout' : err.message;
            context.log(`[BACKFEED AIDI] failed for orgId=${orgId} reason=${reason}`);
        }
    } catch (outer) {
        // Belt-and-braces: never throw from backfeed
        try { context.log(`[BACKFEED AIDI] unexpected error: ${outer.message}`); } catch (_) { /* noop */ }
    }
}

module.exports = {
    validationErrorResponse,
    duplicateShortNameResponse,
    validateOrFail,
    backfeedAidi
};
