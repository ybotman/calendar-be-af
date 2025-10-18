# Messaging & Experience Communications Platform — Design Draft

**Author:** Velma (Strategic Advisor)
**Date:** 2025-10-15
**Last Updated:** 2025-10-18 (Analytics architecture added)
**Status:** Draft for stakeholder review - REVISED  

---

## 1. Vision & Strategic Context

TangoTiempo (and partner sites) needs a consistent way to communicate with visitors, dancers (“milongeros”), and organizers across the entire experience lifecycle. We already capture IP-based visits and authenticated usage, but messaging remains ad hoc: organizers post announcements manually, upgrades depend on static release notes, and role-change guidance is handled through support channels.

We will introduce a unified messaging platform that:

1. **Targets the right audience** (anonymous visitors, authenticated users, specific cohorts, or organizer-controlled groups).
2. **Supports multiple message modes**: upgrade notices, onboarding tips, “welcome back” nudges, organizer-to-follower updates, event invitations, and paid promotional blasts.
3. **Stores messages and delivery receipts in Firebase/Firestore** for real-time access and tight integration with Firebase Auth, while leveraging Azure Functions for orchestration, segmentation, and decision logic.
4. **Honors privacy** by hashing IP addresses for anonymous tracking, capturing consent when required, and allowing opt-outs.

---

## 2. Strategic Goals & Revenue Model

### 2.1 One-Year Revenue Objective

The primary strategic goal is to **establish paid tiers and paid features** that generate meaningful revenue within 12 months. While the specific billing implementation and pricing models are not defined today, the architecture must support:

**Paid Tier Capabilities (Examples - Not Exhaustive)**:
- **Organizer Tiers**: Basic (free) → Bronze → Silver → Gold (monthly subscriptions)
- **One-Time Purchases**: Private event promotions, featured listings, bulk invitation credits
- **Vendor Accounts**: DJ profiles, venue partnerships, instructor directories
- **Premium Features**: Advanced analytics, priority support, custom branding

**Paid Messaging Features**:
- Targeted invitations to specific cohorts (geographic, behavioral, interest-based)
- Direct messaging to non-favorited users (with consent)
- Private event announcements outside public calendar
- Cross-city promotional campaigns

**Non-Messaging Paid Features** (Future Scope):
- Calendar enhancements (RSVP management, waitlist automation)
- Vendor directory listings
- Featured event placement
- Analytics dashboards for organizers

**Key Principle**: The messaging platform is the **enabler** for monetization, not the only revenue stream. Build the foundation now; layer billing integration when ready.

---

## 3. Core Use Cases

| Persona | Scenario | Channel | Notes |
| ------- | -------- | ------- | ----- |
| Anonymous visitor (IP only) | First visit after major release | Modal/banner | Requires hashed IP tracking + release awareness |
| Anonymous visitor | Prompt to create account after repeated visits | Snackbar/banner | Frequency logic similar to experience decision service |
| Authenticated user (“milongero”) | Long time no see (>45 days) | Dialog + CTA | Triggered on login |
| Authenticated user | Role change (approved organizer) | Multi-step helper | Sent immediately after role flag flips |
| Organizer → Favorited dancers | New DJ announcement | Push + inbox | 1:M targeted, respects follower relationship |
| Organizer → Criteria-based dancers (paid tier) | Invite out-of-state milongeros to special event | Campaign blast | Filters by location, interests, activity |
| User → Organizer (1:1) | Question about event | Threaded chat | Requires organizer moderation tools |
| Organizer → User (1:1) | Respond to question, send updates | Threaded chat | Supports attachments? (future) |
| System → Everyone | Upgrade rollout, downtime, policy updates | Toast, modal, email (future) | Needs acknowledgement tracking |

---

## 4. System Overview

### Components

1. **Firebase Auth** — authoritative identity for authenticated users; provides tokens for both front end and Azure Functions.

2. **Cloud Firestore** — **PRIMARY** data store for:
   - Real-time messaging (threads, campaigns, deliveries)
   - User experience state (visit tracking, release acknowledgements)
   - Inbox metadata
   - Campaign configurations

   **Decision**: Firestore is the single source of truth for messaging. MongoDB is **NOT** used for messaging data.

3. **Analytics Data Store** — **CRITICAL ADDITION**
   **Problem**: Firestore is optimized for real-time document retrieval, NOT complex analytical queries (heat maps, cohort analysis, multi-dimensional aggregations).

   **Solution**: Separate analytics pipeline with options:

   **Option A: MongoDB Analytics Collection (Recommended)**
   - Firestore → Azure Function → MongoDB analytics collections
   - Reuse existing MongoDB cluster (no new infrastructure cost)
   - Optimized schema for reporting queries (denormalized, pre-aggregated)
   - Example collections:
     - `userBehaviorAnalytics`: User check-ins, class types, multi-city patterns
     - `loginHeatmaps`: Temporal patterns (time of day, day of week)
     - `cohortSegments`: Pre-computed segments for targeting
   - Pros: Familiar, cost-effective, powerful aggregation pipeline
   - Cons: Requires sync logic from Firestore

   **Option B: BigQuery + Firestore Export**
   - Firestore → automatic BigQuery export (native Firebase feature)
   - SQL-based analytics, data warehouse scale
   - Pros: No sync code needed, powerful analytics, integrates with Google Data Studio
   - Cons: Monthly cost (~$50-200 depending on query volume), requires BigQuery expertise

   **Option C: Redis + MongoDB Hybrid**
   - Redis for real-time counters (visit counts, session tracking)
   - MongoDB for historical analytics storage
   - Pros: Sub-millisecond reads for live data, cost-effective
   - Cons: More moving parts, cache invalidation complexity

   **Strategic Recommendation**: Start with **Option A (MongoDB Analytics)** for Phase 1. Evaluate BigQuery in Phase 3 when scale demands it.

4. **Azure Functions (calendar-be-af)** — orchestrators that:
   - Evaluate targeting logic (recency, frequency, paid tiers)
   - Sync Firestore messaging events → MongoDB analytics
   - Generate pre-computed cohort segments
   - Bridge IP-only visitors (hashing + storing minimal state)

5. **Next.js (tangotiempo.com)** — consumes the messaging API, renders dialogs/snackbars, surfaces inbox view, and reports acknowledgements.

---

## 4. Data Model (Firestore-first)

### 4.1 Collections & Documents

1. **`messageCampaigns`**  
   - `id` (doc id / slug)  
   - `type`: `system`, `upgrade`, `organizer_broadcast`, `organizer_targeted`, `user_to_user`  
   - `audience`: descriptor object (see targeting)  
   - `content`: { `title`, `body`, `cta`, `link`, `severity`, `media` }  
   - `deliveryChannels`: e.g., `["inbox", "modal"]`  
   - `priority`: numeric  
   - `scheduling`: { `startAt`, `endAt`, `cooldownHours`, `maxDeliveriesPerUser` }  
   - `metadata`: { `releaseId`, `roleRequirement`, `paidTierRequirement` }  
   - `status`: `draft`, `active`, `paused`, `archived`  

2. **`messageDeliveries_{env}`** (sharded by environment for simplicity; could also partition by date)  
   - Document id: auto generated  
   - Fields:
     - `campaignId`  
     - `recipient`: { `type`: `user` | `organizer` | `ip`, `id`: firebaseUid or organizerId or hashedIp }  
     - `dispatchContext`: snapshot of rules that fired (frequency, release info, etc.)  
     - `deliveryStatus`: `pending`, `delivered`, `acknowledged`, `dismissed`  
     - `deliveryChannel`  
     - `timestamps`: { `createdAt`, `deliveredAt`, `ackAt`, `expiresAt` }  
     - `payloadHash`: to dedupe repeated deliveries  

3. **`messageThreads`** (for 1:1 or small group chats)  
   - `participants`: array of user/organizer IDs  
   - `createdBy`, `createdAt`, `lastMessageAt`  
   - `type`: `question`, `support`, `followup`  
   - `permissions`: ensures organizer can only message opted-in milongeros  

4. **`messageThreadMessages`** (subcollection under `messageThreads/{threadId}/messages`)  
   - `senderId`, `senderRole`  
   - `body`, `attachments` (future)  
   - `sentAt`, `status` (`sent`, `read`)  

5. **`experienceProfiles`** (anonymous + authenticated state, consolidation of visitor tracking)  
   - `personKey`: hashed ip or firebaseUid (doc id)  
   - `type`: `ip`, `user`  
  - `firstSeenAt`, `lastSeenAt`, `visitCounts`  
   - `releaseState`: `lastSeenReleaseId`, `acknowledgedReleases[]`  
   - `segments`: tags computed by backend (e.g., `dormant_over_30`, `paid_gold`, `favorite_of_org123`)  
   - `linkedKeys`: to connect IP state with user once they login  

6. **`segments`** (optional; may live in `experienceProfiles` as computed field)  
   - Describes dynamic groups (geo, behavior, paid tier). Could be materialized daily.

7. **MongoDB Visitor State (Phase 1)**  
   - Continue storing hashed IP + release info if migrating to Firestore is not immediate. Azure Functions will mirror essential fields to Firestore asynchronously.

### 4.2 Security Rules

Leverage Firestore security rules:

- Authenticated users can read their own inbox (`messageDeliveries.recipient.id == request.auth.uid`).
- Organizers can send messages only if:
  - They hold paid tier permission for targeted broadcasts.
  - Recipient either favorited organizer or qualifies via paid criteria (enforced server-side; rules enforce read-only).
- Anonymous visitor messages (upgrade banners) delivered via API response, not Firestore direct read, to avoid exposing hashed IP docs to clients.

---

## 4.3 Analytics Data Model (MongoDB)

**Purpose**: Support complex reporting queries that Firestore cannot efficiently handle.

**Collections**:

1. **`userBehaviorAnalytics`**
   - `_id`: ObjectId
   - `personKey`: firebaseUid or hashed IP
   - `personType`: `user` | `ip`
   - `checkins`: array of check-in events
     - `eventId`, `eventType` (`beginner`, `intermediate`, `advanced`, `practica`, `milonga`)
     - `venueId`, `cityId`, `timestamp`
   - `travelPattern`: computed field
     - `uniqueCities`: count of distinct cities visited
     - `multiCityScore`: 0-10 scale (0 = single city, 10 = 5+ cities)
     - `lastCities[]`: recent 5 cities
   - `classPreferences`:
     - `beginnerCount`, `intermediateCount`, `advancedCount`
     - `primaryLevel`: most frequent class type
   - `sessionTiming`: login time patterns
     - `hourOfDayDistribution`: {0-23 hour bins with counts}
     - `dayOfWeekDistribution`: {Mon-Sun with counts}
     - `peakLoginHour`: most common login hour
   - `engagement`:
     - `totalVisits`, `visitFrequency` (visits/week average)
     - `lastSeenAt`, `firstSeenAt`
   - `segments[]`: computed tags (`dormant`, `power_user`, `multi_city_traveler`, `advanced_dancer`, etc.)
   - `updatedAt`

   **Indexes**:
   - `{ personKey: 1 }` unique
   - `{ segments: 1, "travelPattern.uniqueCities": 1 }` for targeting
   - `{ "classPreferences.primaryLevel": 1, "engagement.visitFrequency": 1 }` for cohort queries

2. **`loginHeatmaps`**
   - Aggregated time-series data for dashboards
   - Daily/weekly/monthly granularity
   - Pre-computed for performance

3. **`cohortSegments`** (materialized view, updated daily)
   - `segmentId`: `multi_city_travelers_advanced`
   - `criteria`: JSON definition
   - `memberCount`: cached count
   - `lastComputed`: timestamp
   - `members[]`: array of personKeys (for small cohorts) or pointer to query

**Sync Strategy**:
- Firestore triggers (or periodic Azure Function) → write events to MongoDB
- Example: User checks into event → Firestore document created → Cloud Function/Azure Function syncs to `userBehaviorAnalytics`
- Batch updates daily for computed fields (segments, heat maps)

---

### 4.4 Analytics Query Examples

**Query 1: Find advanced dancers who travel to 3+ cities**
```javascript
db.userBehaviorAnalytics.find({
  "classPreferences.primaryLevel": "advanced",
  "travelPattern.uniqueCities": { $gte: 3 }
})
```

**Query 2: Night owls (login between 10pm-2am) in NYC area**
```javascript
db.userBehaviorAnalytics.find({
  "sessionTiming.peakLoginHour": { $gte: 22, $lte: 26 }, // 22-2am (26 mod 24)
  "checkins.cityId": ObjectId("...NYC...")
})
```

**Query 3: Dormant users (no visit in 45+ days) who were previously active**
```javascript
db.userBehaviorAnalytics.find({
  "engagement.lastSeenAt": { $lt: new Date(Date.now() - 45*24*60*60*1000) },
  "engagement.visitFrequency": { $gte: 2 } // was visiting 2+/week
})
```

**Query 4: Beginner dancers in multiple cities (potential upsell target)**
```javascript
db.userBehaviorAnalytics.find({
  "classPreferences.primaryLevel": "beginner",
  "travelPattern.multiCityScore": { $gte: 5 },
  "engagement.totalVisits": { $gte: 10 }
})
```

---

## 5. Targeting & Segmentation

### 5.1 Audience Dimensions

1. **Identity**
   - `ip` (anonymous, hashed)
   - `user` (firebaseUid)
   - `organizer` (organizerId linked to Firebase user)
2. **Role & Tier**
   - Organizer roles (RO/RA/SA) from `userlogins`
   - Paid tier membership (Bronze/Silver/Gold) stored in Firestore profile or Mongo
3. **Behavioral**
   - Last visit date (`experienceProfiles.lastSeenAt`)
   - Visit frequency counts
   - Release acknowledgements
4. **Relationship**
   - Favorited organizer list
   - Past event attendance
   - RSVP history
5. **Geographic**
   - City / region / country from geolocation
   - Within radius of event venue
6. **Custom Criteria**
   - Feature flags / betas
   - Backend-defined segments (e.g., “dormant_new_yorkers_q4”)

### 5.2 Decision Engine

Azure Function `MessageDecide` orchestrates targeting:

1. Load request context (headers, auth, hashed IP).
2. Retrieve or compute `experienceProfile`.
3. Load active campaigns from Firestore (cache in-memory for 5 minutes).
4. Evaluate campaigns by priority:
   - Requirements: role, paid tier, relationship.
   - Time windows: first visit since release, long time no see.
   - Frequency: ensure cooldown/hard limits.
5. Prepare delivery instructions (list of message payloads).
6. Persist `messageDeliveries` entries (status `pending`) for tracking.
7. Return response to front end with payloads to render immediately (modals, banners, etc.).

For organizer-initiated messages, a separate function `MessageSend` will validate audience segments and create `messageDeliveries` in Firestore for each recipient (batch operations + cloud tasks for large campaigns).

---

## 6. Message Flow Scenarios

### 6.1 System Upgrade Message (Anonymous or Authenticated)

1. Next.js calls `/api/experience/decide` (reuse or extend existing endpoint).  
2. Function hashes IP, reads `experienceProfiles`, compares `releaseId`.  
3. If new release not acknowledged, create `messageDeliveries` entry, respond with dialog payload.  
4. Front end renders modal; on user closing, call `/api/messages/ack` to set status `acknowledged`.  
5. `ExperienceProfiles` updated with latest release to avoid repeated prompts.

### 6.2 Organizer Broadcast to Favorited Followers

1. Organizer opens admin UI, composes message.  
2. Front end calls `/api/messages/org-broadcast` with payload and targeting type `favorites`.  
3. Function validates organizer tier, fetches follower list from Firestore/Mongo.  
4. Writes `messageDeliveries` documents per recipient (`deliveryChannel: inbox`).  
5. Users receive real-time updates via Firestore listener in Next.js (if using SSR/CSR hybrid).  
6. Acknowledgements captured when user opens message.

### 6.3 Paid Organizer Campaign (Criteria-based)

1. Organizer selects filters (location, events attended).  
2. Function queries `experienceProfiles` / analytics view for matching recipients.  
3. For large audiences, queue via Azure Queue + durable functions to chunk delivery creation.  
4. Pricing/enforcement: store `campaignCost`, decrement organizer’s credit balance.  
5. Delivery statuses tracked similarly.

### 6.4 Milongero-to-Organizer Question

1. User clicks “Ask Organizer” on event page.  
2. Next.js either finds existing thread (`messageThreads` with both participants) or creates new one.  
3. Messages posted via `/api/messages/thread` endpoint (requires auth).  
4. Organizer sees message in inbox; replies update same thread.  
5. Optionally send push/email notifications (future extension).

---

## 7. Backend Components (Azure Functions)

| Function | Description | Auth | Dependencies |
| -------- | ----------- | ---- | ------------ |
| `ExperienceDecide` | Entry point for system-driven messages (upgrade, welcome back) | Optional Firebase | Firestore + (Mongo visitor state Phase 1) |
| `ExperienceAck` | Acknowledge/dismiss system messages | Optional Firebase | Firestore |
| `MessageInbox` | Fetch user inbox (paginated) | Firebase | Firestore |
| `MessageSendOrganizers` | Organizer broadcasts to followers or segments | Firebase (organizer + paid tier check) | Firestore, Mongo (for follower lists) |
| `MessageSendUser` | User-to-organizer message | Firebase | Firestore |
| `MessageThreads` | CRUD for thread metadata | Firebase | Firestore |
| `MessageAdminCampaigns` | Admin operations on campaigns | Firebase (admin) | Firestore |
| `ExperienceProfileSync` | Background job to sync Mongo visitor data → Firestore `experienceProfiles` (Phase 1) | App key / managed identity | MongoDB, Firestore |

All HTTP functions should use `standardMiddleware` for logging, metrics, and error handling. Long-running broadcast jobs should use Durable Functions or Azure Queue-triggered functions to stay within execution limits.

---

## 8. Front-End Integration (Next.js)

1. **Bootstrapping**: After Firebase auth state settles, call `ExperienceDecide` with `releaseId`, `featureFlags`, and request metadata (similar to existing experience service).  
2. **Message Rendering**:
   - System messages: modals/snackbars based on payload.
   - Inbox: use Firestore client SDK for real-time updates (only for authenticated users).
3. **Acknowledgement Reporting**: call `ExperienceAck` when user interacts with message.
4. **Threaded Messaging**: integrate Firestore subcollections via client SDK for immediate updates (optionally via SSR API routes for security).
5. **Organizer Console**: add UI flows for composing messages, selecting target segments, reviewing delivery analytics.
6. **Caching**: respect `nextCheckInSeconds` to avoid redundant decision calls.  
7. **Offline Handling**: queue user-sent messages locally with optimistic UI; reconcile on reconnect.

---

## 9. Privacy, Compliance, and Consent

- **IP Anonymization**: Hash IP addresses with rotating salt before storage; do not expose hashed values to clients.  
- **Opt-outs**: Provide user-level settings for receiving organizer broadcasts or system marketing messages; store in Firestore (`experienceProfiles.preferences`).  
- **Paid messaging compliance**: Track consent for organizer campaigns, enforce double opt-in for cross-region invitations where required.  
- **Data retention**:  
  - Anonymous experience profiles: purge after 180 days inactivity.  
  - Message threads: configurable retention (default 18 months).  
- **Audit trails**: Log sender, audience, content hash, and delivery stats. For paid campaigns, retain records for invoicing.

---

## 10. Observability & Analytics

- **Application Insights**: instrument Azure Functions with events (`message_decision`, `message_send`, `inbox_fetch`).  
- **Firestore Analytics**: export message deliveries to BigQuery (future) for cohort analysis.  
- **Dashboards**:
  - Campaign impressions vs acknowledgements.
  - Organizer broadcast performance (opens, responses).
  - Dormant-user reactivation rates.
- **Alerting**: set budgets for Firebase/Firestore usage, throttle large broadcasts (cooldown per organizer).

---

## 11. Phased Roadmap

1. **Phase 0 — Foundations**
   - Align on Firestore structure, confirm Firebase Admin SDK usage in Azure Functions.
   - Decide whether to mirror existing Mongo visitor data or migrate fully.

2. **Phase 1 — System & Upgrade Messaging**
   - Implement `experienceProfiles` + `ExperienceDecide` in Firestore.
   - Support anonymous + authenticated upgrade banners, welcome flows, long-time-no-see.
   - Build front-end integration for modals/snackbars.

3. **Phase 2 — Organizer & User Messaging**
   - Deliver inbox UI, message threads, and organizer broadcast to favorited followers.
   - Add paid-tier checks and simple audience filters (region, favorited).  
   - Provide analytics screen for organizers (basic counts).

4. **Phase 3 — Advanced Targeting & Campaigns**
   - Criteria-based broadcasts (location radius, event attendance).  
   - Paid credit tracking, invoicing hooks.  
   - Integrate Redis (optional) for accelerated decision reads if Firestore queries become bottleneck.  
   - Establish automated Firestore usage monitoring + batching thresholds for analytics sync.

5. **Phase 4 — Cross-channel & Automation**
   - Email/SMS extensions.  
   - Journeys (multi-step sequences).  
   - A/B testing and rollout controls.

---

## 12. Analytics Architecture Summary (CRITICAL ADDITION - 2025-10-18)

### 12.1 The Analytics Gap - Resolved

**Problem Identified**: Firestore excels at real-time document retrieval but cannot efficiently support:
- Complex aggregations (heat maps, cohort counts)
- Multi-dimensional queries (class type + travel pattern + timing)
- Historical trend analysis
- Large-scale reporting for paid targeting features

**Solution**: **Dual-Store Architecture**
1. **Firestore**: Real-time messaging, inbox, experience state (immediate user-facing interactions)
2. **MongoDB**: Analytics warehouse for behavioral data (batch-updated, no real-time requirement)

**Why This Works**:
- Firestore handles what it's best at (real-time, relationship-based data)
- MongoDB handles what it's best at (complex queries, aggregations)
- Sync via Azure Functions (event-driven or batch)
- No cost increase (reuse existing Mongo cluster)

### 12.2 Analytics Enables Paid Tiers

The MongoDB analytics layer is **essential** for paid targeting features:

**Organizer Targeting Scenarios** (Paid Features):
1. "Send invite to advanced dancers who've attended events in 3+ cities"
   - Query: `userBehaviorAnalytics` with class level + travel pattern filters
2. "Target dormant NYC dancers who haven't visited in 30 days"
   - Query: engagement metrics + geographic filters
3. "Find night owls (10pm+ logins) interested in practica"
   - Query: session timing + event type preference
4. "Multi-city travelers checking beginner classes (upsell prospects)"
   - Query: travel score + class level + engagement

**Without MongoDB analytics**: These queries would require:
- Slow Firestore collection scans (thousands of documents)
- Client-side filtering (privacy/performance issues)
- Manual cohort management (not scalable)

**With MongoDB analytics**: Sub-second query execution for thousands of users.

### 12.3 Data Flow Architecture

```
User Action (Event Check-in, Login, etc.)
    ↓
Firestore Document Created/Updated (experienceProfiles)
    ↓
Azure Function Trigger (Firestore onChange)
    ↓
Transform & Aggregate Data
    ↓
MongoDB Analytics Write (userBehaviorAnalytics)
    ↓
Daily Batch Job → Update Computed Fields (segments, heat maps)
    ↓
Organizer Queries Analytics via API
    ↓
Azure Function → MongoDB Query → Return Cohort IDs
    ↓
Message Delivery (Firestore messageDeliveries per recipient)
```

**Key Insight**: Analytics is a **pre-requisite** for paid messaging features, not an afterthought.

### 12.4 Implementation Priority

**Phase 0 (Immediate)**:
- Design MongoDB analytics schema (completed in this document)
- Define sync strategy (Firestore → MongoDB)

**Phase 1 (With Messaging MVP)**:
- Implement basic sync (visit tracking, check-ins)
- Build simple cohort queries (dormant users, geographic)

**Phase 2 (Before Paid Features)**:
- Complete analytics schema (class preferences, travel patterns, timing)
- Build pre-computed segment engine
- Create organizer-facing query API

**Phase 3 (Paid Launch)**:
- Advanced filtering UI for organizers
- Real-time cohort size estimates
- Campaign analytics dashboards

**Critical Path**: Analytics infrastructure must be production-ready BEFORE launching paid targeting features. Don't launch billing without the queries to back it up.

---

## 13. Open Questions

1. ~~**Firestore vs Mongo for anonymous state**~~: **RESOLVED** - Firestore for messaging, MongoDB for analytics only.
2. **Organizer-to-user consent model**: Should followers opt in explicitly to receiving broadcast messages, or is favoriting sufficient consent?
3. **Paid tier enforcement**: How do we represent organizer subscription levels (Firestore profile vs existing billing service)? **NOTE**: Analytics layer enables tier validation via campaign cost calculations.
4. **Large audience delivery**: Do we need Azure Queue / Durable Functions from day one, or is batching within a single function acceptable initially?
5. **UI prioritization**: Which front-end surfaces launch first—global dialog system, inbox, or organizer console?
6. **Thread moderation**: Do organizers have moderation tools (mute, report abuse) at launch, or is that deferred?
7. **Analytics sync latency**: How fresh must analytics data be? Real-time sync or 5-minute batch acceptable for targeting?
8. **BigQuery future**: At what scale (DAU) should we evaluate migrating analytics to BigQuery?  

---

## 14. Next Actions

1. **Stakeholder review** of this REVISED design (backend, frontend, product).
2. **Approve analytics architecture**: MongoDB analytics layer as described in Section 12.
3. **Define Phase 1 MVP scope**: System messages only OR include basic organizer features?
4. **Prioritize against other initiatives**: Google Geolocation (in progress), BE→AF Migration (planned), Messaging Platform (this design).
5. **Design MongoDB sync mechanism**: Firestore triggers vs polling vs event bus?
6. **Inventory Firebase configurations**: Rules, indexes, security for new collections.
7. **Align billing prerequisite**: No paid features launch without billing integration complete.
8. **Define batching policy**: agree on acceptable analytics delay (e.g., 5 minutes) and queue technology (Azure Queue Storage vs Service Bus).
9. **Create implementation tickets**: Break down Phases 0-2 into JIRA stories.

**Key Decision Needed from BE_toby**:
- **Sequencing**: Complete Google Geolocation → then Messaging Platform? Or parallel development?
- **Analytics timing**: Build analytics layer in Phase 0 (before messaging) or Phase 2 (before paid features)?

Velma recommends an Architect-mode follow-up to translate the agreed scope into technical tasks and sequencing once these decisions are made.

---

## 15. Strategic Advisor Summary (Added 2025-10-18)

**Key Updates in This Revision**:

1. **Analytics Gap Closed**: MongoDB analytics layer now fully specified with schema, query examples, and sync strategy.

2. **Firestore Role Clarified**: Single source of truth for messaging data ONLY. MongoDB handles analytics/reporting.

3. **Paid Tier Foundation**: Analytics architecture enables revenue features. Don't launch paid targeting without this infrastructure.

4. **1-Year Goal Alignment**: Platform designed to support paid tiers (organizer subscriptions, one-time purchases, vendor accounts) without solving billing implementation today.

5. **Cost-Effective Solution**: Reuses existing MongoDB cluster instead of adding BigQuery costs prematurely.

6. **Practical Phasing**: Analytics builds incrementally alongside messaging features, ensuring paid tier readiness.
7. **Cost Awareness**: Firestore usage is kept predictable through batching, queue-based workers, and quarterly archival.

**Strategic Recommendation**: Approve this architecture. Build analytics in parallel with Phase 1 messaging to avoid blocking paid features in Phase 3.

**Velma's Confidence**: 95% - This design balances real-time messaging needs (Firestore) with complex analytics requirements (MongoDB) while keeping costs manageable and implementation pragmatic.

---

## 16. Firestore Cost Management & Batching Strategy

### 16.1 Usage Expectations

- Target scale: 1k–10k weekly active users in the first year.
- Real-time requirements apply to **messaging delivery** and **inbox updates** only.
- Analytics updates (visit tracking, heat maps, release acknowledgements) may lag by **up to 5 minutes** without hurting UX.
- Archival cadence: aggregate and export historical delivery data quarterly to keep Firestore storage lean.

### 16.2 Billing Guardrails

- Firestore free tier covers ~50k reads / 20k writes per day; above that, paid rates roughly $0.18 per 100k writes and $0.06 per 100k reads (region dependent).
- Example: 10k WAU × 10 writes per day ≈ 3 M writes/month → ≈ $5.40. Storage costs ($0.026/GB) remain low with quarterly aggregation.
- Action items:
  - Create Google Cloud Budget alert for Firestore at $25/month.
  - Instrument Azure Functions to log write/read counts per invocation for Application Insights dashboards.

### 16.3 Batching Mechanics

| Workload | Latency Target | Approach |
| -------- | -------------- | -------- |
| Message send/deliver/ack | Immediate | Direct Firestore writes/reads |
| Experience profile updates | ≤5 min | Append event to queue → batch worker updates Firestore/Mongo |
| Analytics aggregation | ≤15 min | Timer job processes queued events into MongoDB collections |
| Quarterly archival | Offline | Scheduled export to Cloud Storage + batched deletes |

**Queue Options**:
- Azure Queue Storage (simple, low-cost) or Service Bus (if we need topics/retries).
- Event payload: `{ personKey, eventType, timestamp, metadata }`.
- Queue retention: 7 days; worker runs every 1–5 minutes updating MongoDB and downsizing Firestore documents (e.g., increment counters per day).

### 16.4 Temporary Staging

- Use a lightweight **`analyticsEvents`** Firestore collection or Application Insights telemetry as the ingestion source.
- Preferred path: write events directly to Azure Queue (no Firestore write) from messaging functions; if queue unavailable, fall back to storing batched events in Firestore and clear them once processed.
- Worker conversions:
  1. Pull N events.
  2. Group by `personKey`.
  3. Update MongoDB `userBehaviorAnalytics` documents with incremental counters.
  4. Update Firestore `experienceProfiles` once per batch (not per event).

### 16.5 Monitoring & Alerts

- Cloud Monitoring dashboards: Firestore ops, queue length, worker latency.
- Alert thresholds:
  - Queue length > 10k events → scale workers / investigate backlog.
  - Firestore write rate > 5 writes/sec sustained → raise warning.
  - MongoDB update duration > 1 min → log and retry.

### 16.6 Decision Summary

- Messaging stays real time; tracking and analytics move to queue-driven batches.
- Queue staging prevents Firestore write explosions and keeps costs predictable.
- Quarterly archival + per-day counters reduce storage churn.
- Implementation details captured for Architect-mode planning.
