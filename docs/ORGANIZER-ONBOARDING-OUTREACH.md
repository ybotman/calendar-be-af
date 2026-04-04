# Organizer Onboarding — Outreach Flow (CALBEAF-95)

**Last updated**: 2026-04-04  
**Decided by**: Ybotman  
**Cross-team alignment doc**: `/workspace/docs/ORGANIZER-ONBOARDING-ALIGNMENT-2026-04-04.md`

---

## Overview

Outreach-arrived organizers are discovered organizers who receive a personalized invitation link (via Facebook DM or other campaign channel) and self-onboard through TangoTiempo.

**Pipeline**: AIDI generates token → link sent via FB → organizer clicks → Sarah's form resolves token + pre-fills → Firebase auth → form submission → backend tracking

---

## Confirmed Organizer Defaults (trust-first model)

When Sarah creates an organizer document via the outreach apply form, the following values MUST be set explicitly in the POST payload:

| Field | Value | Reason |
|-------|-------|--------|
| `isEnabled` | `true` | Auto-approved — trust-first model |
| `isVisible` | `true` | Publicly visible from day one; removed on bad behavior |
| `wantRender` | `true` | Google/SEO rendering active immediately |

**Backend behavior**: These fields are stored as received. The backend default for `wantRender` is `false` — Sarah must send `wantRender: true` explicitly. The backend default for `isVisible` is already `true`. The backend default for `isEnabled` is `false` — Sarah must send it explicitly.

---

## Backend Endpoints (calendar-be-af)

### POST /api/outreach/generate-link
- **Auth**: `x-api-key` (service-to-service — AIDI calls this)
- **Purpose**: Create an opaque token for one discovered organizer; returns full invitation URL
- **Link format**: `https://tangotiempo.com/organizers/apply?ref=outreach&orgToken=<token>`
- **Storage**: `outreach_tokens` collection (TTL-indexed, auto-expires)
- **Note**: One call per organizer — no bulk endpoint

### GET /api/outreach/resolve-token?token=
- **Auth**: None (token is the auth)
- **Purpose**: Validate token, return pre-fill data for the apply form
- **Caller**: Sarah's frontend on page load
- **Logs**: `link_clicked` event to `outreach_tracking`

### POST /api/outreach/track
- **Auth**: None
- **Purpose**: Log funnel events
- **Valid events**: `link_clicked`, `auth_completed`, `form_opened`, `application_submitted`, `onboarding_complete`
- **Key body fields**: `token` (required), `event` (required), `firebaseUserId` (optional), `organizerId` (optional — MongoDB `_id`, preferred for organizer updates)
- **Side effects**:
  - `application_submitted` → marks token `status: 'used'`; sets `organizer.onboardingStatus = 'applied'`, `onboardingSource = 'outreach'`
  - `onboarding_complete` → sets `organizer.onboardingStatus = 'active'`
- **Sequencing**: Sarah must create the organizer doc FIRST, then call `/track` with `organizerId`

### GET /api/outreach/status
- **Auth**: `x-api-key`
- **Purpose**: Campaign funnel metrics (AIDI/Dash)
- **Returns**: `{ campaignId, funnel: { links_generated, links_clicked, ... }, tokens: [...] }`

---

## Firebase Auth

- Standard Firebase Bearer token auth via `src/middleware/firebaseAuth.js`
- Validates ID token → extracts `uid`
- **Facebook native Firebase auth**: deferred to later sprint
- **Interim fallback**: Email/Password auth added to outreach apply gate (Sarah's frontend change)

---

## MongoDB Collections

| Collection | Purpose |
|------------|---------|
| `outreach_tokens` | One doc per generated link; TTL auto-expire; tracks status (active/used/expired) |
| `outreach_tracking` | Funnel event log; one doc per event per token |

---

## Known Gaps / Future Work

- No bulk-generate endpoint (per-call for now; revisit at campaign scale)
- No deduplication enforcement — AIDI must track which orgs have been issued tokens
- Token→organizer link is not established at token creation time; only linked post-submission via `organizerId`/`firebaseUserId`
- 261/299 venues missing `venueTimezone` (separate ticket; not blocking outreach)
- `expandRecurringEvent.js` hardcoded `|| 'America/New_York'` fallback to be removed after Porter timezone fix confirmed
