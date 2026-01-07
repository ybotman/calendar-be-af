# CALBEAF-66: TangoVoice GPT OAuth & CRUD Integration

## Overview

Enable TangoVoice GPT to perform authenticated CRUD operations on events, venues, and user data via OAuth 2.0 integration with Firebase Auth.

## Problem Statement

Currently:
- TangoVoice GPT can only READ events (anonymous GET)
- Users cannot create/update/delete events via voice
- No way to link ChatGPT user identity to TangoTiempo account
- Events CRUD in calendar-be-af needs auth middleware (migrating from calendar-be)

## Solution Architecture

### OAuth Flow for GPT Actions

```
┌─────────────────┐                    ┌──────────────────────┐                    ┌──────────────┐
│  TangoVoice GPT │                    │   calendar-be-af     │                    │   Firebase   │
│   (ChatGPT)     │                    │  Azure Functions     │                    │     Auth     │
└─────────────────┘                    └──────────────────────┘                    └──────────────┘
       │                                        │                                         │
       │ 1. GET /api/auth/authorize             │                                         │
       │    ?client_id=xxx&redirect_uri=...     │                                         │
       │───────────────────────────────────────>│                                         │
       │                                        │                                         │
       │ 2. 302 Redirect to /api/auth/login     │                                         │
       │<───────────────────────────────────────│                                         │
       │                                        │                                         │
       │ 3. User sees Firebase Sign-in page     │                                         │
       │────────────────────────────────────────────────────────────────────────────────>│
       │                                        │                                         │
       │ 4. User signs in with Google           │                                         │
       │<────────────────────────────────────────────────────────────────────────────────│
       │                                        │                                         │
       │ 5. Firebase returns to /api/auth/callback with ID token                         │
       │───────────────────────────────────────>│                                         │
       │                                        │                                         │
       │                                        │ 6. Verify Firebase token                │
       │                                        │    Look up user in MongoDB              │
       │                                        │    Generate auth code                   │
       │                                        │    Store code (5 min TTL)               │
       │                                        │                                         │
       │ 7. 302 Redirect to ChatGPT callback    │                                         │
       │    ?code=xyz&state=abc                 │                                         │
       │<───────────────────────────────────────│                                         │
       │                                        │                                         │
       │ 8. POST /api/auth/token                │                                         │
       │    code=xyz&client_secret=yyy          │                                         │
       │───────────────────────────────────────>│                                         │
       │                                        │                                         │
       │                                        │ 9. Verify code                          │
       │                                        │    Generate JWT access_token            │
       │                                        │    Generate refresh_token               │
       │                                        │    Store refresh_token (hashed)         │
       │                                        │                                         │
       │ 10. Return { access_token, refresh_token, expires_in }                          │
       │<───────────────────────────────────────│                                         │
       │                                        │                                         │
       │ 11. ChatGPT stores tokens              │                                         │
       │                                        │                                         │
       │ 12. GET /api/voice/events              │                                         │
       │     Authorization: Bearer <jwt>        │                                         │
       │───────────────────────────────────────>│                                         │
       │                                        │                                         │
       │                                        │ 13. Verify JWT                          │
       │                                        │     Extract user claims                 │
       │                                        │     Apply authorization                 │
       │                                        │     Execute request                     │
       │                                        │                                         │
       │ 14. Return events                      │                                         │
       │<───────────────────────────────────────│                                         │
```

### JWT Claims Structure

Our JWT (not Firebase token) contains:

```json
{
  "iss": "calendar-be-af",
  "sub": "firebase-uid-123",
  "aud": "tangotiempo-voice",
  "iat": 1704582000,
  "exp": 1704596400,
  "jti": "unique-jwt-id",

  "email": "user@example.com",
  "displayName": "John Doe",
  "photoURL": "https://...",

  "roles": ["NamedUser", "RegionalOrganizer"],
  "organizerId": "mongo-organizer-id-456",

  "raInfo": {
    "isEnabled": true,
    "isApproved": true,
    "allowedRegions": ["region-id-1"],
    "allowedDivisions": [],
    "allowedCities": ["city-id-boston", "city-id-cambridge"]
  },

  "appIds": ["1"]
}
```

## Components to Build

### Phase 1: OAuth Infrastructure

| Endpoint | Method | Purpose |
|----------|--------|---------|
| /api/auth/authorize | GET | Start OAuth flow, validate client, redirect to login |
| /api/auth/login | GET | Host Firebase sign-in UI (simple HTML page) |
| /api/auth/callback | GET | Handle Firebase return, generate auth code |
| /api/auth/token | POST | Exchange auth code for JWT + refresh token |
| /api/auth/refresh | POST | Exchange refresh token for new access token |
| /api/auth/revoke | POST | Revoke refresh token |
| /api/auth/userinfo | GET | Return current user profile |

**Environment Variables Needed:**
- `JWT_SIGNING_SECRET` - Secret key for HS256 JWT signing
- `OAUTH_CLIENT_ID` - Client ID for GPT Action
- `OAUTH_CLIENT_SECRET` - Client secret for GPT Action
- `AUTH_STATE_ENCRYPTION_KEY` - Key for encrypting state parameter

### Phase 2: Middleware

| Middleware | Purpose |
|------------|---------|
| jwtAuth.js | Verify our JWT signatures, extract claims |
| hybridAuth.js | Accept Firebase ID token OR our JWT, normalize user object |
| roleAuth.js | Check required roles (NamedUser, RegionalOrganizer, RegionalAdmin) |
| ownershipAuth.js | Verify user owns resource (event, venue) |

**Hybrid Auth Flow:**
```javascript
async function hybridAuth(request, context) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return null;

  const token = authHeader.replace('Bearer ', '');

  // Try our JWT first (for GPT)
  try {
    const decoded = verifyOurJWT(token);
    return { ...decoded, authMethod: 'oauth-jwt' };
  } catch (e) {
    // Not our JWT, try Firebase
  }

  // Try Firebase ID token (for web app)
  try {
    const decoded = await verifyFirebaseToken(token);
    const user = await getUserByFirebaseUid(decoded.uid);
    return { ...decoded, ...user, authMethod: 'firebase' };
  } catch (e) {
    return null;
  }
}
```

### Phase 3: Secure Events CRUD

**Current State:** Events POST/PUT/DELETE in calendar-be-af have NO auth!

**Required Changes:**

| Endpoint | Auth Required | Authorization |
|----------|---------------|---------------|
| POST /api/events | hybridAuth | Organizer+ role, sets ownerOrganizerID from JWT |
| PUT /api/events/:id | hybridAuth | Ownership OR RA region permission |
| DELETE /api/events/:id | hybridAuth | Ownership OR RA role |

**Permission Logic (port from calendar-be):**
```javascript
// Ownership check
const isOwner = event.ownerOrganizerID === user.organizerId;

// RA region check
const isRAForRegion = user.raInfo?.isEnabled &&
  user.raInfo?.allowedCities?.includes(event.masteredCityId);

// Allow if owner OR RA for region
if (!isOwner && !isRAForRegion) {
  return forbiddenResponse('You cannot modify this event');
}
```

### Phase 4: Voice Enhancements

| Feature | Description |
|---------|-------------|
| Voice-friendly errors | Return helpful messages, not HTTP codes |
| Entity resolution | "Dance Studio X" → venueId |
| /api/voice/events/mine | Get current user's events only |
| Event search | Find by title/date with fuzzy matching |

**Voice-Friendly Error Example:**
```json
{
  "success": false,
  "error": "venue_not_found",
  "message": "I couldn't find a venue called 'Dance Studio X'. Did you mean 'Dance Studio Boston' or 'X Tango Studio'?",
  "suggestions": [
    {"name": "Dance Studio Boston", "id": "venue-1"},
    {"name": "X Tango Studio", "id": "venue-2"}
  ]
}
```

## Database Changes

### New Collections

**oauth_sessions** (temporary auth codes)
```javascript
{
  _id: ObjectId,
  code: "random-auth-code",
  state: "encrypted-state",
  firebaseUid: "uid",
  createdAt: Date,
  expiresAt: Date,  // TTL: 5 minutes
  used: false
}
```

**refresh_tokens**
```javascript
{
  _id: ObjectId,
  tokenHash: "sha256-hash-of-token",
  firebaseUid: "uid",
  deviceInfo: "ChatGPT iOS",
  createdAt: Date,
  expiresAt: Date,  // TTL: 30 days
  revokedAt: Date | null
}
```

### Indexes
```javascript
// oauth_sessions
db.oauth_sessions.createIndex({ code: 1 }, { unique: true });
db.oauth_sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// refresh_tokens
db.refresh_tokens.createIndex({ tokenHash: 1 }, { unique: true });
db.refresh_tokens.createIndex({ firebaseUid: 1 });
db.refresh_tokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
```

## Security Considerations

| Concern | Mitigation |
|---------|------------|
| Token theft | Short expiry (1-4 hours), HTTPS only |
| Privilege escalation | Verify JWT signature, cross-check roles on sensitive ops |
| CSRF in OAuth | Cryptographically random state parameter |
| Auth code interception | Single-use codes, 5 min TTL |
| Refresh token abuse | Store hashed, rotation on use, user can revoke |
| Rate limiting | Per-user limits (JWT sub), not per-IP |
| Audit trail | Log authMethod (firebase vs oauth-jwt) on all writes |

## Known Pitfalls and Mitigations

| Pitfall | Impact | Mitigation |
|---------|--------|------------|
| Events CRUD has no auth today | Security gap | Add auth before enabling voice CRUD |
| Mobile OAuth flow can break | Bad UX | Test on iOS/Android ChatGPT apps |
| Token expiry mid-conversation | Interrupted flow | 4-hour tokens + refresh mechanism |
| Recurring event ambiguity | Wrong event modified | GPT asks clarification, default to single instance |
| Event resolution by name is fuzzy | Wrong event selected | Return suggestions, require confirmation |
| Two backends (calendar-be, calendar-be-af) | Split functionality | Full 1:1 migration to AF |

## Role Hierarchy

```
Anonymous (no auth)
    │
    ▼
NamedUser (authenticated, can comment/favorite)
    │
    ▼
RegionalOrganizer (can manage OWN events)
    │
    ▼
RegionalAdmin (can manage REGION events)
    │
    ▼
SystemAdmin (can manage EVERYTHING)
    │
    ▼
SystemOwner (full control)
```

## Voice Use Cases by Role

**NamedUser:**
- "What events are happening tonight?" (GET - OK)
- "Add this to my favorites" (needs auth)

**RegionalOrganizer:**
- "Create a milonga for Saturday at 8pm" (POST - needs auth + role)
- "Update tomorrow's class to 7pm" (PUT - needs auth + ownership)
- "Cancel tonight's practica" (DELETE - needs auth + ownership)

**RegionalAdmin:**
- "Approve the new organizer John" (PUT - needs auth + RA role)
- "What's event activity in Boston this month?" (GET - needs auth + RA role)

## Implementation Phases

### Phase 1: OAuth Infrastructure (8-12 hours)
1. Create Auth_Authorize function
2. Create Auth_Login page
3. Create Auth_Callback function
4. Create Auth_Token function
5. Create Auth_Refresh function
6. Create MongoDB collections and indexes
7. Set up environment variables
8. Test OAuth flow end-to-end

### Phase 2: Middleware (4-6 hours)
1. Create jwtAuth.js
2. Create hybridAuth.js
3. Create roleAuth.js
4. Create ownershipAuth.js
5. Unit tests for all middleware

### Phase 3: Secure Events CRUD (6-8 hours)
1. Add hybridAuth to Events POST
2. Add hybridAuth + ownership to Events PUT
3. Add hybridAuth + ownership to Events DELETE
4. Port RA permission logic from calendar-be
5. Integration tests

### Phase 4: Voice Enhancements (8-12 hours)
1. Voice-friendly error messages
2. Entity resolution utilities
3. /api/voice/events/mine endpoint
4. Event search by title/date
5. E2E tests with GPT Action

### Phase 5: Testing & Documentation (8-10 hours)
1. Security testing
2. Mobile OAuth testing
3. API documentation
4. GPT Action configuration guide

**Total Estimated Effort: 34-48 hours**

## GPT Action Configuration

In ChatGPT GPT editor → Actions → Authentication:
- Type: OAuth
- Client ID: (from environment)
- Client Secret: (from environment)
- Authorization URL: https://calendarbeaf-prod.azurewebsites.net/api/auth/authorize
- Token URL: https://calendarbeaf-prod.azurewebsites.net/api/auth/token
- Scope: read:events write:events read:profile

## Success Criteria

1. ✅ User can authenticate TangoVoice GPT with their Google account
2. ✅ Organizers can create events via voice
3. ✅ Organizers can update their own events via voice
4. ✅ Organizers can cancel/delete their events via voice
5. ✅ Regional Admins can manage events in their regions via voice
6. ✅ Web app (tangotiempo.com) continues working with Firebase auth
7. ✅ Full audit trail distinguishes voice vs web changes
8. ✅ All write operations are properly authorized

---

*Created: 2026-01-07*
*Epic: CALBEAF-66*
*Author: Fulton (AI Agent)*
