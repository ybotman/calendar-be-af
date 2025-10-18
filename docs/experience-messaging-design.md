# Experience Messaging Decision Service — Preliminary Design

**Author:** Velma (Strategic Advisor)  
**Date:** 2025-10-15  
**Status:** Draft for review  

---

## 1. Problem & Strategic Goal

When TangoTiempo (and sister apps) ship meaningful upgrades, today’s experience relies on static release notes or manual outreach. We already capture two key signals:

- **Anonymous visits** via IP-based geolocation (front-end utilities + backend login tracking).
- **Authenticated usage** via Firebase user IDs and the login analytics pipeline in `UserLoginTrack`.

However, there is no coordinated way to decide, in real-time, whether a visitor should see an announcement, onboarding message, upgrade walkthrough, or nothing at all. We need a **decision service** that evaluates recency, frequency, release exposure, and campaign targeting so the front end can tailor dialogs while keeping the default experience clean (“do nothing” most of the time).

Strategically, this enables:

1. **Mission alignment** — ensuring community members are informed of major changes without overwhelming them.
2. **Progressive rollout** — gating new UX changes to cohorts before full release.
3. **Cross-channel reuse** — reusing the same decision logic for emails or SMS in the future.

The service must run on **Azure Functions** (calendar-be-af) with MongoDB as the system of record, and optionally leverage Redis for sub-100 ms lookups once scale demands it.

---

## 2. Scope

### In Scope

- Data model to record “experience state” for IPs and authenticated users.
- Decision engine that returns per-visit instructions (e.g., which banner/dialog to show).
- Azure Functions HTTP API design supporting both anonymous and logged-in calls.
- Front-end contract for TangoTiempo (Next.js) to request decisions and report outcomes.
- Migration path from Express backend to Azure Functions without service interruption.

### Out of Scope (for this draft)

- Implementation details for Redis cluster provisioning.
- Detailed UI copy or frontend component design.
- A/B testing framework (will reference hooks but not deliver tests).
- Retroactive backfill of past visits (nice-to-have, not critical for initial rollout).

---

## 3. Requirements

### Functional

1. **Decision Evaluation**  
   Given `(ipHash, firebaseUserId?, releaseId, featureFlags, timestamps)`, return zero or more recommended actions such as `SHOW_DIALOG:new-release`, `SHOW_SNACKBAR:returning-after-30-days`, `DO_NOTHING`.

2. **State Mutation**  
   Persist visit metadata in MongoDB to inform future decisions. Track:
   - First seen / last seen timestamps.
   - Last release acknowledged.
   - Campaign-specific acknowledgements (e.g., “saw Q4 upgrade walkthrough”).
   - Visit frequency counters (per day / per week).

3. **Campaign Management**  
   Maintain a collection of campaigns/upgrades that define targeting rules (release version, min days since last visit, audience filters). These can be toggled without redeploying code.

4. **Low-latency Response**  
   95% of calls should respond in <150 ms (stretch goal 80 ms). Azure Functions + Mongo must be tuned accordingly; Redis cache is optional for the first iteration.

5. **Auditability**  
   Every decision should be reproducible: log the rule and state snapshot used so we can debug why a dialog did/didn’t appear.

### Non-Functional

- **Privacy & Security**: IP addresses must be stored as salted hashes; do not retain raw IP beyond the in-flight request.
- **Configurability**: releases and campaigns should be manageable via admin UI or script (future). For now, direct Mongo updates are acceptable.
- **Resilience**: If the service fails (errors/timeouts), the front end should default to “do nothing” to avoid blocking page loads.
- **Compatibility**: Must support both Express-era front ends and future Function-only deployments during the migration window.

---

## 4. Current Signals & Gaps

| Signal Source | Current Capability | Gap for Decision Service |
| ------------- | ------------------ | ------------------------- |
| `calendar-be-af` → `UserLoginTrack` | Tracks authenticated logins with IP → city | No concept of release acks, no fast lookup structure |
| TangoTiempo front end → `LocationLogger` | Fetches IP geolocation via ipapi / AbstractAPI | No persistent storage, no knowledge of releases |
| Release notes page (`/releases`) | Manual history | No machine-readable “current release” flag |

We can reuse `UserLoginTrack` patterns (headers, Firebase auth, Mongo connection) but need dedicated collections tailored to experience state.

---

## 5. Proposed Architecture

### 5.1 Data Model (MongoDB)

#### Collections

1. **`ExperienceVisitorState`**
   - `_id`: ObjectId
   - `personKey`: hashed identifier (see below)
   - `type`: `IP` or `USER`
   - `fingerprint`: metadata snapshot (`ipHash`, `firebaseUserId`, optional device signature)
   - `firstSeenAt`, `lastSeenAt`
   - `visitCounts`: `{ daily: {2025-10-15: 3}, weekly: {...}, total: 42 }`
   - `lastReleaseSeen`: release identifier string (e.g., `2025.10.1`)
   - `campaignStates`: array of `{ campaignId, lastShownAt, acknowledgedAt, dismissedAt }`
   - `notes`: free-form JSON for future expansion (e.g., `{"betaAccess": true}`)
   - Indexes:
     - `personKey` unique
     - TTL optional for anonymous IP entries (e.g., delete after 180 days of inactivity)

2. **`ExperienceCampaigns`**
   - `_id`: campaign slug (e.g., `new-release-2025q4`)
   - `type`: `release`, `onboarding`, `reengagement`
   - `trigger`: definition object:
     - `releaseId` (for release campaigns)
     - `minDaysSinceLastSeen`
     - `maxDaysSinceLastSeen` (optional)
     - `minVisits` / `maxVisits`
     - `requireAuth`: boolean
     - `segment` filters (e.g., `roles`, `regions`, `deviceType`)
   - `messagePayload`: UI contract for front end (title, body, CTA, severity)
   - `priority`: integer (higher = more important)
   - `active`: boolean
   - `validFrom`, `validTo`

3. **`ExperienceDecisionsLog`** (optional at launch; can be capped collection)
   - `personKey`, `timestamp`, `decisions`, `campaignsEvaluated`, `reasonCodes`, `requestContext`

4. **Cache Store (future)** — Azure Cache for Redis
   - Keys: `ex:person:{personKey}` with JSON payload mirroring `ExperienceVisitorState`.
   - TTL: e.g., 10 minutes to keep read traffic off Mongo during spikes.

#### Identifier Strategy

- **IP visitors**: `personKey = hash(ip + environment + salt)`  
  Use SHA-256 with a salt stored in KeyVault to avoid reversible IP storage.
- **Authenticated users**: `personKey = firebaseUserId`.
- **Hybrid**: When both are present, link the IP state to the user state via `linkedPersonKeys` field to correlate behavior across login boundary.

### 5.2 Decision Flow

1. **Front end call**: When the Next.js app loads (or user logs in), it posts to `/api/experience/decide`.
2. **Function input**: Body includes:
   ```json
   {
     "releaseId": "2025.10.1",
     "featureFlags": ["calendar-upgrade-v2"],
     "timezone": "America/New_York",
     "timezoneOffset": -240,
     "lastClientActionAt": "2025-10-10T17:20:00Z" // optional
   }
   ```
   Headers provide Firebase token (if logged in) and the function derives IP as in `UserLoginTrack`.
3. **State retrieval**: Compute `personKey`, fetch from Redis (if enabled) or Mongo.
4. **Campaign evaluation**:
   - Load active campaigns (cache list in memory for 5 min).
   - For each campaign, evaluate trigger rules against visitor state and request context.
   - Collect highest-priority campaign that passes; allow multiple if business rules permit.
5. **State update**:
   - Update visit counters and timestamps.
   - Mark campaigns as shown (with `lastShownAt`).
   - If front end later acknowledges/dismisses, a separate endpoint updates `acknowledgedAt`.
6. **Response**:
   ```json
   {
     "releaseStatus": { "latestReleaseId": "2025.10.1", "alreadySeen": false },
     "decisions": [
       {
         "action": "SHOW_DIALOG",
         "campaignId": "new-release-2025q4",
         "payload": { ...messagePayload... },
         "reason": ["first_visit_since_release"]
       }
     ],
     "nextCheckInSeconds": 3600
   }
   ```
   If no campaigns fire, return `decisions: []`.

7. **Logging**: Persist decision summary in `ExperienceDecisionsLog` (if enabled) and send structured log to Application Insights for queries.

### 5.3 API Surface (Azure Functions)

| Endpoint | Method | Auth | Purpose |
| -------- | ------ | ---- | ------- |
| `/api/experience/decide` | POST | Optional Firebase | Main decision call, handles both anonymous and authenticated |
| `/api/experience/ack` | POST | Optional Firebase | Front end confirms user saw/dismissed a campaign |
| `/api/experience/state` | GET | Firebase + Admin role | Ops tooling to inspect a visitor/user state |
| `/api/experience/campaigns` | GET/POST | Firebase + Admin role | Manage campaigns (phase 2; initial version can use manual Mongo updates) |

Each function should wrap the handler with `standardMiddleware` for logging, metrics, and error handling.

### 5.4 Front-End Integration

1. **Bootstrap**: On app load, call `decide` once the app knows:
   - Release ID (read from `/releases.json` or environment variable).
   - Auth state (Firebase).
   - Feature flags (if any).
2. **Throttle**: Cache the response in memory/localStorage for `nextCheckInSeconds` to avoid repeated calls.
3. **UI Handling**: When decisions array is non-empty:
   - Render the highest-priority dialog/snackbar.
   - Invoke `/api/experience/ack` after the user interacts (dismiss, complete walkthrough).
4. **Edge Cases**:
   - If API fails, log mildly and continue without blocking content.
   - For SSR pages, fetch on client side only to avoid exposing keys server-side.

---

## 6. Data Storage Considerations

| Option | Pros | Cons | Recommendation |
| ------ | ---- | ---- | -------------- |
| MongoDB only | Simpler, reuse existing cluster | 10–20 ms read/write average; might be slower under load | **Phase 1** (launch) |
| MongoDB + Redis cache | Sub-ms repeated reads, offload from Mongo | Extra ops cost, cache invalidation | **Phase 2** (when traffic > 5k DAU) |
| MongoDB + Materialized view (e.g., per-day docs) | Better analytics | More complex writes | Evaluate later |

Partitioning: store environment field to segregate DEVL/TEST/PROD within same collection or use separate databases per environment (current pattern). Keep indexes lean to meet latency goals.

---

## 7. Decision Rules Library (Initial Templates)

1. **New Release Announcement**
   - Trigger: `releaseId` > `state.lastReleaseSeen`
   - Require: first visit since release OR lastSeen > 7 days before release date.
   - Action: dialog with summary + link to `/releases`.

2. **Dormant Returnee**
   - Trigger: `lastSeenAt` older than 30 days.
   - Action: snackbar welcoming them back + highlight major change.

3. **Frequent Power User**
   - Trigger: `visitCounts.daily[currentDay] > 5`.
   - Action: suppress announcements to avoid fatigue; optionally mark for beta prompt.

4. **Feature Rollout Cohort**
   - Trigger: feature flag present, user role = organizer, release not yet acknowledged.
   - Action: modal offering guided tour.

Rules should be data-driven in `ExperienceCampaigns` so new campaigns can be added without deployments.

---

## 8. Security & Privacy

- **IP Handling**:  
  - Immediately hash with `SHA-256(ip + SALT)` before persistence.  
  - Keep raw IP only in request scope.  
  - Rotate salt yearly; store in Azure Key Vault.
- **GDPR/CCPA**:  
  - Provide admin endpoint to delete visitor state by user request.  
  - Enforce TTL on anonymous entries (e.g., purge after 180 days of inactivity).
- **Rate Limiting**:  
  - Add per-IP rate limit (e.g., 60 calls/min) to `decide` endpoint using `standardMiddleware` metrics.
- **Auditing**:  
  - `ExperienceDecisionsLog` should include anonymized personKey only.

---

## 9. Observability

- **Application Insights**:  
  - Custom events: `experience_decision` with properties (`campaignId`, `action`, `personType`, `latencyMs`, `cacheHit`).
- **Metrics Endpoint**:  
  - Extend existing `/api/metrics` to include counts for decision evaluations, cache hit ratio, and errors.
- **Dashboards**:  
  - Create Kusto queries for “Campaign impressions over time” and “First-visit release acknowledgment”.

---

## 10. Rollout Plan

1. **Phase 0 – Catalog Existing Signals**
   - Document how release IDs are generated and surfaced.
   - Ensure Firebase auth flows are consistent in Azure Functions.

2. **Phase 1 – Minimal Viable Decision Service**
   - Implement `ExperienceVisitorState`, `ExperienceCampaigns`.
   - Deliver `/api/experience/decide` returning new-release dialog only.
   - Integrate with front end in DEVL using feature flag.

3. **Phase 2 – Expand Campaigns & Telemetry**
   - Add `/api/experience/ack`.
   - Introduce dormancy and frequency rules.
   - Ship to TEST, monitor latency, tune indexes.

4. **Phase 3 – Redis Acceleration (optional)**
   - Stand up Azure Cache for Redis (Basic tier).  
   - Cache visitor state reads with invalidation on update.

5. **Phase 4 – Operationalize**
   - Admin tooling for campaign management.
   - Document SOP for adding a new release campaign.

---

## 11. Open Questions

1. **Release Identification**: Who sets the canonical `releaseId`? Should it mirror the `/releases` page slug or come from CI/CD?
2. **Multi-device Users**: If a user logs in from multiple IPs/devices, do we want to merge state aggressively or keep separate IP cohorts?
3. **Front-end Trigger Timing**: Should the decision be fetched on every page load, only on home page, or just after login?
4. **Message Fatigue Rules**: Do we enforce global cooldowns (e.g., max one dialog per 24 hours) beyond campaign-specific logic?
5. **Future Channels**: Should the data model anticipate email/SMS triggers now (e.g., store communication preferences)?

---

## 12. Next Steps

1. Review and align on data model + API surface (feedback from backend/front end leads).
2. Define acceptance criteria for Phase 1 decision rules.
3. Create implementation tickets (Azure Functions, Mongo schema migrations, front-end integration).
4. Decide whether to prototype Redis in Phase 1 or defer.

Velma recommends architect mode follow-up to break down the build sequence once stakeholders approve this design.

