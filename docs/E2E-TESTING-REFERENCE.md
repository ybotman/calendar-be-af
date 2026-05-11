---
date: 2026-05-07
persona: fulton
type: e2e-testing-reference
state: active
feature: e2e-testing
keywords: [e2e, gauge, uc-corpus, endpoints, test-mutators, calendar-be-af]
appid: global
audience: gauge, quinn-as-relay, e2e-spawn-authors, fulton
permanence: long-term
template: B.2-be-api
template_source: Collab/handoffs/gotan/2026-05-07-vault-bless-and-per-app-e2e-doctype.md
exemplar: tangotiempo.com/docs/E2E-TESTING-REFERENCE.md
version: 0.2.5
---

# calendar-be-af (Azure Functions BE) — E2E Testing Reference

**Audience:** Gauge sub-agent / Quinn-as-relay / E2E spawn authors. NOT for end users.
**Authored by:** Fulton (calendar-be-af BE persona).
**Living doc:** update as endpoints land or contracts shift. Source files cited with `path:line` for deep dives.
**App context:** Backend API for the entire MasterCalendar ecosystem. Multi-tenant by `appId` (1=TangoTiempo, 2=HarmonyJunction, 3=NTTT, 6=CalOps, …). Test partition: `appId="99"` (Pattern A).
**Template:** B.2 BE/API (per Gotan bless 2026-05-07; FE selector sections do not apply).
**Companion docs:**
- `docs/CANONICAL-URLS.md` — base URLs per environment + `/api/health` spawn pre-flight pattern
- `public/swagger.json` — full endpoint inventory (canonical)
- `tangotiempo.com/docs/E2E-TESTING-REFERENCE.md` — TT FE companion (cite-by-reference for FE-side)
- `calendar-be-af-test-mutators/baseline/manifest.json` — Pattern A partition seed (manifest-canonical here)

---

## §0 Endpoint Quick Reference

Gauge's 30-second scan-before-author entry point for BE-targeted UCs.

### §0.1 Contract traps — do NOT assume these on calendar-be-af

| Trap | Reason | Working alternative |
|---|---|---|
| **Hostname `calendarbe-test-<hex>.eastus-01.azurewebsites.net`** | Old `calendar-be` (Express; **decommissioned**) — different app entirely. Easy to confuse by name. | Use canonical `https://calendarbeaf-test.azurewebsites.net` per `docs/CANONICAL-URLS.md` |
| **Same email + new firebaseUserId at same appId returns 201** | Pre-CALBEAF-83-fix BEHAVIOR. Post-fix returns **200** with rotated UID + old UID in `alternateFirebaseUserIds`. | Assert 200 (not 201) post-fix; assert `alternateFirebaseUserIds` contains old UID. See `src/functions/UserLogins.js:362-401`. |
| **`includeAiGenerated=false` does NOT exclude `isDiscovered=true` events** | Pre-CALBEAF-183-fix BEHAVIOR. Filter only checked `isAiGenerated: true`; discovery-pipeline events have `isDiscovered: true` but `isAiGenerated: null/false` (empirical: 11,661 events at appId=1, all with `isAiGenerated != true`), so they leaked through. Post-fix extends to `isDiscovered: true` when caller hasn't explicitly set the `discovered` filter. | When `includeAiGenerated=false`, assert `isDiscovered=true` events ARE EXCLUDED. To request discovered events explicitly, set `discovered=true` (overrides). See `src/functions/Events.js:288-301`. |
| **`location.coordinates` field DOES NOT EXIST on events** | Spec-authoring trap. Probe (TangoTiempoTest 2026-05-07): 0/11,661 discovered events have `location.coordinates`; 100% have `venueGeolocation.coordinates`; ~66% have `masteredCityGeolocation.coordinates`. Asserting on `location.coordinates` produces false-positive bug findings (e.g., UC-0018 secondary-finding "124 no-coord events" was field-path mismatch, not a bug). | Use **`venueGeolocation.coordinates`** (canonical, 100% populated on discovered events) or **`masteredCityGeolocation.coordinates`** (denormalized fallback, ~66% populated). NEVER reference `location.coordinates`. See §0.2 geo-field row + `src/functions/Events.js:455-484` for which field the BE actually queries based on `useCity` param. |
| **Analytics endpoint `appId` filter type-coerce asymmetry (CALBEAF-184)** | DB writer asymmetry across Analytics collections: `MapCenterHistory` + `UserLoginHistory` writers write `appId` as STRING (e.g., `"1"`); `VisitorTrackingHistory` writer writes `appId` as NUMBER (e.g., `1`). Empirical PROD 2026-05-09: 1,881/1,881 MapCenterHistory string vs 7,855/8,718 VisitorTrackingHistory number. Pre-fix `parseInt(appId, 10)` coercion: 0 matches against string-writer collections (CalOps Activity Map empty for all users). Uniform `String()` coerce would have regressed VisitorTrackingHistory to 0 (Round-1 regression caught by Dash smoke-verify before PROD push). | When asserting on Analytics endpoint responses, check the `filters.appId` field in the response — post-fix it's STRING. When writing test mutators or fixture data, follow Toby standing rule "appId always 1-99 string-managed" (VisitorTrackingHistory writer migration tracked in CALBEAF-185 Phase 2). Canonical `String()` pattern: `src/functions/Analytics_MapCenterHistory.js:108-114`. Transitional tolerant `$in: [String, Number]` pattern: `src/functions/Analytics_VisitorHistory.js:108-117`. **Process lesson**: when applying a class-pattern fix across handlers, grep each handler's actual `db.collection(...)` target — do NOT infer from collection name pattern (`VisitorTrackingHistory` vs `VisitorTrackingHistory2` are different collections; see `feedback_verify_actual_collection_target.md`). |
| **`required: true` in swagger ≠ enforced (CALBEAF-177 Phase 1 audit findings)** | Audit against TEST state 2026-05-07. Events_Create/Events_Update enforce: `appId`, `title`, `startDate`, `endDate`, `categoryFirstId` (CALBEAF-171 v1.34.0 via `validateCategoryFirstIdPresence`). **Silently optional gaps:** (a) `venueID` — missing → warn-logged at `Events.js:947`; event proceeds without `venueTimezone`; (b) `ownerOrganizerID` — missing → no 400; `authorOrganizerID` stays null (no immutable original-creator record); (c) other niche-harvest/Porter-supplied fields pending caller survey (CALBEAF-177 Phase 2, Sprint 6). | Spec assertions on Events POST/PUT: assume only the 5 listed are enforced. For fields in the silently-optional gap list, test handler accepts the missing value and observe downstream mangling (e.g., null venueTimezone, null authorOrganizerID). DO NOT assume "swagger says required → handler will reject" without checking handler source. Phase 2 tightening deferred to Sprint 6 per ticket defer-condition. |
| **`firebaseUserInfo.email` from request body** | Body-provided value persists ONLY if Firebase admin SDK `getUser()` throws; otherwise admin SDK overwrites it. In tests, mock `getFirebaseAdmin` to throw to preserve body value. | See `src/functions/UserLogins.js:384-396` for the try/catch pattern |
| **Cross-appId data leak** | Some endpoints accept `appId` query param; mis-scoped queries can leak across tenants. CALBEAF-173 fixed parent-scoped events; other endpoints under audit. | Always scope test reads by `appId`; never trust default `'1'` to mean test isolation |
| **`scripts/` dir is gitignored at root** | New scripts won't be picked up by `git add` without `-f`. Existing scripts were force-added historically. | Use `git add -f scripts/<script>.sh` for new tracked scripts |

### §0.2 Endpoint cheat-sheet by resource

Top-N most-touched endpoints in UC corpus. Full inventory in `public/swagger.json`.

| Resource | Method | Path | Source | Notes |
|---|---|---|---|---|
| **Health** | GET | `/api/health` | `src/functions/Health.js` | Spawn pre-flight; returns `{ ok: true, db: 'connected' }` |
| **UserLogins** | POST | `/api/userlogins` | `src/functions/UserLogins.js:312` | Email-lane dedup at `:362-401` (CALBEAF-83) |
| **UserLogins** | GET | `/api/userlogins/firebase/{firebaseId}` | `src/functions/UserLogins.js:27` | Alternates fallback at `:67-72` |
| **UserLogins** | GET | `/api/userlogins/all` | `src/functions/UserLogins.js` | Filterable by appId, email |
| **Events** | GET | `/api/events` | `src/functions/Events.js:123` (handler) | Parent-scoped query v1.33.0 (CALBEAF-173). `includeAiGenerated=false` excludes both `isAiGenerated:true` AND `isDiscovered:true` post-CALBEAF-183 (`Events.js:288-301`). Geo via `venueGeolocation` default or `masteredCityGeolocation` when `useCity=true` (`Events.js:455-484`). |
| **Events** | POST | `/api/events` | `src/functions/Events_Create.js` | `categoryFirstId` required (CALBEAF-171 v1.34.0) |
| **EventsRA** | POST | `/api/eventsRA` | `src/functions/EventsRA_Create.js` | RegionalAdmin write path; body-parity with Events_Create per CALBEAF-172 |
| **Events_BulkEnrich** | POST | `/api/events/bulk-enrich` | `src/functions/Events_BulkEnrich.js` | D-architecture; CALBEAF-110 |
| **Venues** | POST | `/api/venues` | `src/functions/Venues_Create.js` | Geocoding side-effect on save |
| **Roles** | GET | `/api/roles` | `src/functions/Roles.js` | Per-appId; canonical roleNames + roleNameCodes |

### §0.2.1 Geo-field canonical names (read this before any geo-related spec assertion)

| Field | Used by BE? | Population (empirical 2026-05-07) | Notes |
|---|---|---|---|
| **`venueGeolocation`** (`{type:'Point', coordinates:[lng,lat]}`) | **YES — canonical** | 11,661/11,661 discovered events (100%) | Default `$geoWithin` field when `useGeoSearch=true`. Per-venue precision. |
| **`masteredCityGeolocation`** (`{type:'Point', coordinates:[lng,lat]}`) | **YES — fallback** | 7,722/11,661 discovered events (~66%) | Used when query param `useCity=true`. City-level precision (less precise but more frequently populated). |
| **`location.coordinates`** | **NO — does not exist** | 0/11,661 (field is not on event documents) | **Do not assert on this path.** Asserting on it produces false-positive bug findings (UC-0018 secondary-finding 2026-05-07 was a field-path mismatch). |

**Spec authoring rule:** validate any geo-field name against this table BEFORE writing assertions. The BE handler at `src/functions/Events.js:455-484` is source-of-truth for which field the geo-radius query targets based on the `useCity` param.

**Canonical BASE_URL source-of-truth for Gauge spec authoring** (per Quinn framework Layer-2 fix 2026-05-11; UC-0021/0022 URL-typo class avoidance): `e2e-calendar-framework/config/template-vars.yaml` `TEST_BASE_URL_BE` field is the framework-side canonical; **this** `docs/CANONICAL-URLS.md` is the BE-side authoritative reference. Hard-coded URL constants in spec files are the gap that produced the `calendarbeuf` (missing 'a') typo across UC-0021/0022 retry-1 attempts. Spec authoring should read from `template-vars.yaml`, not hard-code; Gauge SAD URL-constant-enforcement is the framework-side complement.

### §0.3 Test partition / marker note

calendar-be-af test infrastructure follows the calendar ecosystem partition pattern (per memory `feedback_test_mutator_compound_scope.md`):

- **Pattern A:** persistent test data at `appId="99"`; test users + fixtures with `_testFixtureKey` (e.g., `E2EUSER`, `E2EORG`, `ROLE_NU`); reset via `reset-test-user` / `reset-orphans` mutators
- **Pattern B:** ephemeral per-correlation data at `appId="1"`; markers `isE2ETestUser: true` + `_testCorrelationId: ${UC_ID}-${ts}-${rand4hex}`; cleanup via `delete-test-user-by-correlation` (ADR-0017 in pipeline)

**CALBEAF-side dedup invariant (CALBEAF-83 fix):** `userLoginsCollection.findOne({firebaseUserId, appId})` is the primary uniqueness gate; email-lane dedup at `{firebaseUserInfo.email, appId}` rotates UID on re-registration. **Both gates are appId-scoped** — multi-tenant isolation preserved.

---

## §1 Glossary

| Term | Meaning |
|---|---|
| **calendar-be-af** | Azure Functions backend for MasterCalendar; this codebase. Successor to deprecated `calendar-be` (Express). |
| **AF** | Azure Function (single endpoint handler) |
| **TT / HJ / NTTT / CalOps** | Frontend consumer apps (appIds 1, 2, 3, 6 respectively) |
| **TangoTiempoTest / TangoTiempoProd** | Mongo databases (TEST/PROD environments respectively); same Atlas cluster, different DB name |
| **`appId`** | Tenant identifier (string); REQUIRED scope for nearly every query |
| **`firebaseUserInfo`** | Embedded subdoc on userlogins; `email`, `displayName`, `photoURL`, `emailVerified` |
| **`alternateFirebaseUserIds`** | Array on userlogins; old UIDs preserved when current UID rotates (CALBEAF-83 mechanism); GET-by-firebaseId falls back to this array |
| **`roleIds`** | Array of ObjectIds referencing `roles` collection; per-user role assignment scoped by appId |
| **D-architecture** | Bulk-enrich pipeline architecture (CALBEAF-110); TEST-only standing scope per memory rule |
| **TRACKED_FIELDS** | Pipeline-managed event fields; writer-layer parity required across backfill / bulk-enrich / Tier-2 / CRUD (memory rule) |
| **Test-mutator** | Privileged endpoint family for E2E test setup/teardown; ecosystem-canonical at `calendar-be-af-test-mutators/baseline/manifest.json` |

---

## §2 Resource / Role Model

### §2.1 Top-level resources (collections)

| Collection | Purpose | appId-scoped? | Notes |
|---|---|---|---|
| `userlogins` | User identity + role assignments | yes | Compound dedup `{firebaseUserId, appId}`; email-lane dedup `{firebaseUserInfo.email, appId}` (CALBEAF-83) |
| `roles` | Per-appId role definitions | yes | `roleName` + `roleNameCode` + appId; `NamedUser` is default post-signup |
| `events` | Calendar events | yes | RRULE-recurring + singleton; categoryFirstId required (CALBEAF-171) |
| `venues` | Event venues | yes | Geocoded on save; masteredCity/Region/Country denormalized |
| `organizers` | Event hosts | yes | Linked from RegionalOrganizer userlogins |
| `categories` | Event taxonomy | yes | Per-appId category trees |
| `masteredcountries` / `masteredregions` / `masteredcities` | Geographic hierarchy | global | Denormalized into venue+event records (memory: orphaned-hierarchy-fails-open) |

### §2.2 Role taxonomy (per appId)

Confirmed via `roles` collection (mongosh sweep 2026-05-06; per Sarah's TT exemplar §2.1):

| Role | `roleName` | `roleNameCode` | Tier |
|---|---|---|---|
| NamedUser | `"NamedUser"` | `"NU"` | content (default) |
| Spotlighter | `"Spotlighter"` | `"SL"` | content (between NU/RO) |
| RegionalOrganizer | `"RegionalOrganizer"` | `"RO"` | content |
| RegionalAdmin | `"RegionalAdmin"` | `"RA"` | admin |
| SystemAdmin | `"SystemAdmin"` | `"SA"` | system |
| SystemOwner | `"SystemOwner"` | `"SO"` | system |

**Auth gate model:** `firebaseAuth` middleware (`src/middleware/firebaseAuth.js`) verifies Bearer token via Firebase admin SDK; `roleIds` lookup happens in handler against `appId`-scoped `roles` collection.

---

## §4 Auth header conventions

```
Authorization: Bearer <firebase-id-token>
```

- Verified via `getFirebaseAdmin()` (`src/lib/firebase-admin.js`) → `auth().verifyIdToken()`
- Decoded `uid` exposed as `request.user.uid`
- Public endpoints: `authLevel: 'anonymous'` (e.g., POST userlogins for signup, GET health)
- Protected endpoints: middleware rejects with 401 `unauthorizedResponse` on bad/missing token

**Test mode:** mock `firebaseAuth` to return a controllable user (see `tests/Events_BulkEnrich.test.js:24-33` and `tests/UserLogins_Create.test.js:21-26` for the canonical mock pattern).

---

## §11 Endpoint Taxonomy

**Canonical inventory:** `public/swagger.json` (always authoritative for endpoints + request/response shapes).

**Per-resource handler locations:** all Azure Functions live under `src/functions/<Domain>_<Action>.js` and are auto-registered via `app.http()` calls in each file. **CRITICAL:** new handlers must also be `require()`'d in `src/app.js` to register at runtime (memory: New Azure Function Checklist; 2026-02-23 retro).

Top-level handler files (selected):

```
src/functions/
  Health.js                — GET /api/health
  UserLogins.js            — userlogins CRUD + firebase lookup
  Events_Get.js            — GET /api/events (filtered)
  Events_Create.js         — POST /api/events
  Events_Update.js         — PUT /api/events/:id
  EventsRA_Create.js       — RegionalAdmin POST/PUT path
  Events_BulkEnrich.js     — D-architecture bulk pipeline
  Venues_Get.js            — GET /api/venues
  Venues_Create.js         — POST /api/venues
  Organizers.js            — organizers CRUD
  Roles.js                 — GET /api/roles
  Categories.js            — GET /api/categories
  Geo_*.js                 — geo lookup endpoints
  Sitemap_*.js             — SEO sitemap generators
  AppAuth.js               — app-level auth tokens
  Admin_*.js               — admin/data-health endpoints
```

For new endpoints in v0.2+ this section will become a complete table.

---

## §12 Stateful Side-Effects + Race Conditions

| Endpoint | Side-effect | Race / interaction |
|---|---|---|
| POST `/api/userlogins` | (CALBEAF-83) email-lane dedup may UPDATE existing record at `{firebaseUserInfo.email, appId}` | Two near-simultaneous POSTs with same email could race — current impl is two-step `findOne+updateOne` (microsecond window). Acceptable for auth-create rate. |
| POST `/api/userlogins` | Firebase admin `getUser(firebaseUserId)` enrichment overwrites body's `firebaseUserInfo` | If admin throws, body value persists; if admin returns, admin wins. Test-side mock admin to control. |
| POST `/api/userlogins` (auto-create branch) | If user exists at appId=1 and GET fires for non-default appId, auto-creates appId-N record from appId=1 base (`UserLogins.js:76-104`) | Cross-appId provisioning side-effect; not idempotent if appId=1 base changes mid-flow |
| POST `/api/events/bulk-enrich` | Writer-layer pipeline (D-architecture; CALBEAF-110) | TEST-only standing scope; PROD STAY-OUT per memory rule |
| Backfill scripts | Composite-key UPSERT only; never `insertOne` | CALBEAF-174 incident: 68 orphan `masteredcities` from `insertOne` regression. Memory rule: backfills must upsert. |

---

## §13 Bootstrap & Self-Heal

- **MongoDB connection:** per-handler ephemeral (`new MongoClient(uri).connect()` then `close()` in finally); no connection pool reuse across invocations
- **Firebase admin:** lazy-init via `getFirebaseAdmin()` (`src/lib/firebase-admin.js`); cached after first init
- **Cold-start:** Azure Consumption Plan; first-request after idle may take ~3-5s. Spawn pre-flight `GET /api/health` warms the FA (per `docs/CANONICAL-URLS.md`)
- **Self-heal:** alternateFirebaseUserIds fallback in GET (`UserLogins.js:67-72`) — if primary UID lookup misses, falls back to alternates; covers CALBEAF-83 post-fix re-registration

---

## §15 Test-Mutator Endpoints (canonical-here for ecosystem)

This document is the canonical owner for test-mutator endpoint contracts; FE references (Sarah TT, Cord HJ, etc.) cite-by-reference here.

**Manifest source-of-truth:** `calendar-be-af-test-mutators/baseline/manifest.json` (manifest v1.1, commit `b14afdc` per Sarah's TT v0.2 ref).

**Mutator inventory** (with API contracts; partial v0.2.3; full enumeration as gaps surface):

| Mutator | Purpose | Pattern | Required body fields |
|---|---|---|---|
| `reset-test-user` | Reset Pattern A persistent user (`tango.tiempo.test@gmail.com` at appId=99) to baseline | Pattern A teardown | (TBD — fold when next consumed) |
| `reset-orphans` | Sweep orphan records at appId=99 | Pattern A teardown | (TBD) |
| `delete-test-user-by-correlation` | Delete Pattern B users by `_testCorrelationId` (ADR-0017 in pipeline; my lane) | Pattern B teardown | (TBD — ADR-0017 will fold contract) |
| **`elevate-test-user-role`** | Apply role changes per `role-elevation-matrix.md` (MUST honor TIEMPO-443 invariant — bundle SL with RO on RegionalOrganizer elevation) | Both patterns | **`firebaseUserId`** (target user UID), **`correlationId`** (`'preset-baseline'` for Pattern A; per-spawn correlation for Pattern B), **`targetRole`** (short-code: `NU`/`SL`/`RO`/`RA`/`SA`), **`appId`** |

**`elevate-test-user-role` API contract (from UC-0020 escalation 2026-05-07T21:30Z; Gauge-discovered-via-source friction noted):**

```
POST <test-mutator-base-url>/elevate-test-user-role
Content-Type: application/json

{
  "firebaseUserId": "<target user UID; mandatory>",
  "correlationId": "preset-baseline" | "<UC_ID>-<ts>-<rand4hex>",
  "targetRole": "NU" | "SL" | "RO" | "RA" | "SA",
  "appId": "1" | "99"
}
```

**Honors TIEMPO-443 invariant:** elevating to `RO` must result in `roleIds: [NU._id, SL._id, RO._id]` (full bundle, SET semantics REPLACES existing roleIds). Elevating to `RA` from RO preserves `regionalOrganizerInfo` and lands `roleIds: [NU._id, SL._id, RO._id, RA._id]` (admin-tier orthogonal to content tier per Sarah TT §2.2). Mutator MUST NOT short-circuit the bundle on RO elevation.

**Authoring rule (extended):** any new test-mutator must:
1. Land in `calendar-be-af-test-mutators/baseline/manifest.json` with version bump
2. Be `appId`-scoped (compound dedup)
3. Honor Pattern A/B partition rules (Pattern A → appId=99 fixture-keys; Pattern B → appId=1 + correlation markers)
4. Be cited from this §15 within the same commit
5. **Document the request body contract here at mutator-add time** (UC-0020 lesson 2026-05-07: Gauge had to read source to discover `elevate-test-user-role` body fields = sub-agent friction; same-arc documentation prevents this)

ADR-0017 (`delete-test-user-by-correlation`) draft will land here when slot fires (pipeline post-S5).

### §15.1 Pattern A browser-login credential persistence (Sprint 5 cross-team gap; Sprint 6 Phase 2 candidate)

**UC-0020 surfaced (2026-05-07T21:30Z):** Pattern A persistent test user `tango.tiempo.test@gmail.com` at appId=99 has its password generated at mint-time by `bootstrap-e2e-user.js` but **not persisted** to any standard credential store. Result: any UC requiring actual browser login (vs mutator-only API operations) blocks on credential-not-available.

**Two viable paths (Quinn arbiter ask 21:30Z):**

- **(a) Persist generated password to `.env.test.local` (gitignored) or `keys.json`:** simpler, faster, Sprint 5-unblock; standard credential-handling pattern; risk = plaintext password on disk locally (acceptable for TEST-only Pattern A user; not for PROD)
- **(b) Firebase custom-token injection:** Admin SDK mints custom token at spawn-time → injects into browser sessionStorage; credential-less browser auth; more substantive infra; Sprint 6 candidate per security maturity

**Fulton recommendation (BE lane input):** path (a) for Sprint 5 unblock with persistence to `.env.test.local`. Reasoning:
- `bootstrap-e2e-user.js` already generates the password; emit it to the persistence target at mint-time (one-line addition)
- `.env.test.local` is the conventional gitignored env file; CI/CD pipelines and local devs both read it
- Pattern A user is TEST-only (appId=99 partition); plaintext-on-disk risk is bounded
- Path (b) is correct long-term but introduces Admin SDK injection surface that needs its own audit

**Open: who owns `bootstrap-e2e-user.js`?** Per §15 ecosystem-canonical mapping, calendar-be-af is the §15 owner; bootstrap-e2e-user.js logically falls in `calendar-be-af-test-mutators/` repo. If that repo's owner is Quinn or Sarah's lane, this needs explicit lane assignment before Sprint 5 closes.

---

## §15.5 Merge Mechanisms + Per-App Guard Rails (BE)

> **Loose-numbering convention note (per ADR-0014 v1.2 Constraint C, Archie 2026-05-07):** §15.5 is a **SIBLING** of §15 (not a child). The `.5` suffix indicates an insertion between §15 and §16; markdown headings reflect this (h2 for §15.5, h3 for §15.5.x sub-sections). Canonical baseline §0–§19 are number-stable; insertions use §N.5 / §N.M and tooling MUST treat as siblings.

**Mirror of Sarah's TT §15.5 (`tangotiempo.com/docs/E2E-TESTING-REFERENCE.md` v0.8, commit `d874db7c`).** Cross-app number-mirror: same section number across both docs for cross-persona reference. **Sarah's §15.5 is the canonical taxonomy**; this section is the calendar-be-af-specific enumeration.

### §15.5.1 Three-layer guard-rail cake

| Layer | Mechanism | Calendar-be-af enforcement |
|---|---|---|
| **Layer 1** | Project rule | `gh pr merge` BANNED in any flag form per `MasterCalendar/CLAUDE.md` global rule (PROD-context concern: runs as Toby's gh auth, bypasses human-merge requirement). Local `git merge --no-ff` is the canonical merge mechanism. |
| **Layer 2** | VM hook / branch-policy automation | **NONE for calendar-be-af.** No VM-side branch-protection hook; auto-deploy on TEST/PROD push happens via GitHub Actions (`test_calendarbeaf-test.yml`, `azure-functions-prod.yml`) — that's deploy automation, NOT merge gating. **This differentiates from TT FE which has a VM-hook merge guard.** |
| **Layer 3** | Branching strategy | `MasterCalendar/docs/GIT-BRANCHING-STRATEGY.md` (T1/T2/T3 tiers + CR triggers). Auth/Security + DB schema + API contract changes = CR for TEST. PROD always requires explicit Toby approval. |

### §15.5.2 Layer-1 scoping note

The `gh pr merge` ban is **PROD-context-scoped** per CLAUDE.md: "ANY flags … runs as Toby's CLI auth and bypasses the human-merge requirement." For DEVL-bound feature merges (autonomous per branching strategy), the safe mechanism is local `git merge --no-ff` + `git push origin DEVL`. PR ceremony in GitHub auto-closes when DEVL contains the commits.

### §15.5.3 Per-repo asymmetric guard table (calendar-be-af row)

| Repo | Layer-1 (project rule) | Layer-2 (VM hook) | Layer-3 (branching strategy) | Auto-deploy |
|---|---|---|---|---|
| **calendar-be-af** (this) | `gh pr merge` BAN (PROD-context) | **NONE** | DEVL → TEST → PROD per `MasterCalendar/docs/GIT-BRANCHING-STRATEGY.md` | GitHub Actions on TEST/PROD push |
| **tangotiempo.com** | `gh pr merge` BAN | **VM hook** (per Sarah TT §15.5.3) | sandbox/* → TEST per TT branching | Vercel auto-deploy by branch |

The asymmetry matters: BE merges proceed entirely in local-git-land then push. There's no VM-side veto. Discipline = entirely on the human + persona side.

### §15.5.4 Path table for calendar-be-af merges

| From | To | Mechanism | Approval |
|---|---|---|---|
| `feature/CALBEAF-XXX-*` | `DEVL` | local `git merge --no-ff` + `git push origin DEVL` | Autonomous on T2/T3; CR-trigger only |
| `DEVL` | `TEST` | local `git merge DEVL` on TEST branch + `git push origin TEST` | **CR ask** for Auth/Security + DB schema + API contract changes; announce-only otherwise. Auto-deploy fires on push. |
| `TEST` | `PROD` | local `git merge TEST` on PROD branch + `git push origin PROD` | **EXPLICIT TOBY APPROVAL ALWAYS** per `MasterCalendar/docs/PROD-DEPLOY-PROTECTION.md` |

### §15.5.5 What-Fulton-does-on-merge-block (5-step protocol)

When a CR-trigger fires or merge gate engages:

1. **Identify the CR trigger** (Auth flow / DB schema / API contract / Multi-file refactor / Env config / Dependency upgrade).
2. **Compose CR ask** with: tier rationale, mitigations in place (regression tests, rollback path, empirical evidence), consumer-impact analysis (which of TT/HJ/CalOps/NTTT could be affected).
3. **Send to Quinn** (E2E arbiter) + cc Number2 (sprint visibility) per state-transition broadcast discipline.
4. **Standby for green light** — do not autonomous-push if T1 CORE or auth-flow + multi-consumer.
5. **On approval, fire 5-step post-approval sequence:** local merge → push DEVL → merge TEST → push TEST (auto-deploys) → curl smoke verification → JIRA transition + signal.

This protocol was field-validated twice on 2026-05-07 (CALBEAF-83 + CALBEAF-183 same-day cycle). Both got Quinn green-light on bounded-reversible reasoning + auto-pushed cleanly.

### §15.5.6 Cross-persona pre-flight stats (BE+FE combined)

| Persona | Lane | Candidates surveyed | Stale-BACKLOG miss without 4-rule pre-flight |
|---|---|---|---|
| Sarah | TT FE | 14-15 | 3-4 (~25%) |
| Fulton | calendar-be-af BE | 3 | 2 (~67%; small-N noise) |
| **Combined** | — | **17-18** | **~29% miss rate** |

Reference: my `feedback_recommender_pre_flight_4_rule.md` + Sarah's `feedback_e2e_doc_maintenance.md` (3-rule companion) + Quinn's `feedback_code_fault_uc_readiness_gate.md` v2 (framework). Three layers of codification — per-persona-instance (Sarah + Fulton) + framework-level (Quinn).

### §15.5.7 Discovery-discipline meta-lesson

Per Sarah's TT §15.5.7 (Charter §B.X candidate): merge-gate-failures during a green-light cycle frequently surface guard-rail asymmetries the team hadn't enumerated. Field-validated catches this Sprint 5:
- TT VM hook caught Sarah pushing without expected gate (TT-side Sprint 5 PR #357 cycle)
- BE has no VM hook → all gating via human + branching strategy → CR ask for auth-flow contract changes is THE gate

**Lesson:** when adopting per-app E2E-TESTING-REFERENCE.md, the §15.5 enumeration is required (per Charter §B.X candidate); no merge-mechanism column is empty. "None" is a valid value but must be explicit, not omitted.

---

## §16 Common UC Patterns (BE perspective)

UC composition through test mutators, BE-side:

**Pattern A UC shape (persistent user):**
1. Spawn pre-flight: `GET /api/health` → 200
2. (optional) Mutator: `reset-test-user` → idempotent reset
3. Test scenario: actions against canonical Pattern A user at appId=99
4. Mutator: `reset-orphans` → cleanup any incidental writes

**Pattern B UC shape (ephemeral correlated):**
1. Spawn pre-flight: `GET /api/health` → 200
2. Generate `correlationId = ${UC_ID}-${ts}-${rand4hex}`
3. Test scenario: actions create users at appId=1 with markers `isE2ETestUser: true` + `_testCorrelationId: <id>`
4. Mutator: `delete-test-user-by-correlation` with `correlationId` → targeted cleanup

**Backend-only API UC shape (no FE):**
1. Pre-flight `/api/health`
2. Direct curl/HTTP harness (see `scripts/verify-CALBEAF-83-fix.sh` as canonical example for CALBEAF-83 / UC-0013 round-trip closure)
3. Assert response shape + status; assert DB side-effects via mongosh sweep

**UC-0013 reference:** the canonical BE-direct UC shape for Phase D Routing v0 baseline. Pattern A (appId=99). Reproduction: POST userlogins twice with same email + different firebaseUserId; pre-fix asserts dup; post-fix asserts rotation. See `scripts/verify-CALBEAF-83-fix.sh` for curl-equivalent.

---

## §17 Memories + Cross-Session Knowledge

calendar-be-af persona memories (from `~/.claude/projects/.../memory/MEMORY.md` as of 2026-05-07):

| Memory | Scope |
|---|---|
| `feedback_jira_url.md` | hdtsllc.atlassian.net (NOT ybotman) |
| `feedback_ftpntd.md` | Fix The Process, Not The Data — three-layer fix; FTPNTD-on-self extension 2026-05-07 |
| `feedback_scope_changes.md` | Ping Quinn before locked-plan scope changes |
| `feedback_scope_quinn_coordination.md` | Cross-project coordination = Quinn lane |
| `project_d_architecture_prod_stay_out.md` | D-arch is TEST-only |
| `project_d_architecture_standing_test_auth.md` | Standing TEST-scope auth for D-arch |
| `feedback_sampling_bias.md` | Don't project N/N from tiny samples |
| `feedback_writer_layer_parity.md` | TRACKED_FIELDS must mirror across all writers |
| `feedback_no_location_fallback.md` | Don't substitute mastered* fields |
| `feedback_orphaned_hierarchy_fails_open.md` | ~33% of mastered* parents are orphans; use denormalized fields |
| `feedback_tests_fail_before_pass.md` | Filter on null silently passes; use set-membership |
| `feedback_backfill_scripts_must_upsert.md` | Backfills must UPSERT not insertOne (CALBEAF-174) |
| `feedback_plan_stays_current.md` | Inline-edit plan at transition time |
| `feedback_state_transition_immediate_motion.md` | Fire next motion same beat |
| `feedback_test_mutator_compound_scope.md` | Compound dedup `{firebaseUserId, appId}`; Pattern A/B partition |
| `feedback_state_transition_broadcast_discipline.md` | Material state transitions broadcast or scoped persona-list |

These rules apply to all calendar-be-af UC authoring + test-mutator design.

---

## §18 Living-Doc Protocol

### §18.1 FTPNTD self-application (MANDATORY per template)

**Standing maintenance rule:** any PR to calendar-be-af touching:
- a new endpoint or endpoint contract change
- a test-mutator manifest change
- a new memory rule promoted that affects test infrastructure
- a new documented failure mode (e.g., new contract trap)

**MUST update §0 (quick reference) and the affected detailed section in the SAME COMMIT.** Reviewer enforces in PR review.

If the change is a contract trap: §0.1 entry MANDATORY in same commit.
If the change is a new endpoint: §0.2 + §11 entries MANDATORY in same commit.
If the change is a new mutator: §15 entry MANDATORY + manifest version bump in same commit.

**Three-layer FTPNTD self-application** (per `feedback_ftpntd.md` 2026-05-07):
- **Data layer:** fix the immediate doc drift
- **Code-process layer:** the §18.1 rule itself + reviewer enforcement
- **Team-human layer:** doc owner = Fulton; auditor signal = §19 change log

### §18.2 Owner + versioning

- **Owner:** Fulton (calendar-be-af persona). Co-edit allowed by Quinn-as-relay; PR back through Fulton.
- **Versioning:** semantic-ish. Patch (`v0.1.x`) for value/citation updates. Minor (`v0.x.0`) for new sections or significant restructure. Major (`v1.0.0`) reserved for first stable enumeration of all endpoints.
- **Audit cadence:** minimum monthly Fulton self-review; opportunistic on every UC-related PR.

### §18.3 Discovery protocol (for Gauge / Quinn / new spawn authors)

Path: `~/MyDocs/AppDev/MasterCalendar/calendar-be-af/docs/E2E-TESTING-REFERENCE.md`
Vault mount (post Herald-execution per Gotan §A.1): `_GHOST_CALBEAF_DOCS/E2E-TESTING-REFERENCE.md`
Cite by relative path from `MasterCalendar/` for cross-project references.

### §18.4 Cadence norms (inherited from TT v0.5/v0.7 protocol)

Adopted from Sarah's TT exemplar protocol (offer 2026-05-07T20:36Z; symmetric value):

- **Same-day-turnaround on §0.X content updates:** when Phase D corpus spawns surface new contract traps or endpoint changes, the §0/§11/§15 update lands in the same spawn-evidence window — not deferred to retro. Empirical baseline (Sarah TT): 5 versions in <1 hour during Sprint 4 motion 5; calendar-be-af aims for the same cadence on contract-evidence updates.
- **Codify-at-standby-gap:** when standby-gaps appear between motions (e.g., awaiting spawn verdict, awaiting CR), use the gap to codify accumulated session lessons into the doc. Don't wait for a retro window — codify-in-flight prevents context-loss across sessions.

**Cross-reference:** `feedback_code_fault_uc_readiness_gate.md` v2 (Quinn framework-folded 2026-05-07T20:35Z) defines the 4-rule recommender-side pre-flight, including the lane-attribution-check (rule 4) that catches FE/BE misattribution. **Apply before classifying any CALBEAF candidate as `expected-RED:fulton`** — symmetric risk for FE-side actual fix surface on a CALBEAF-filed ticket.

---

## §19 Change Log

| Version | Date | Author | Scope |
|---|---|---|---|
| v0.1 | 2026-05-07 | Fulton | Initial commission per Charter v5 §DoR criterion #11 + Gotan B.2 BE/API template + Sarah TT v0.2 exemplar shape. Seed content for §0 + §11 + §15 + §17; full enumeration deferred to v0.2+. CALBEAF-83 fix landed and folded into §0.1 (contract trap) + §0.3 (test partition note) + §12 (side-effects) + §16 (UC reference). |
| v0.1.1 | 2026-05-07 | Fulton | §18.4 cadence norms inherited from TT v0.5/v0.7 (same-day-turnaround + codify-at-standby-gap, per Sarah offer 20:36Z). Cross-reference to 4-rule recommender-side pre-flight (Quinn framework-folded `feedback_code_fault_uc_readiness_gate.md` v2). No content change to §0/§11/§15. |
| v0.1.2 | 2026-05-07 | Fulton | §0.1 trap added: CALBEAF-183 (UC-0018 / TIEMPO-364 mirror) — `includeAiGenerated=false` does NOT exclude `isDiscovered=true` events pre-fix. Empirical evidence cited (11,661 events at appId=1, all `isAiGenerated != true`). Post-fix extends to `isDiscovered: true` when caller hasn't explicitly set `discovered` filter. Same-commit-with-fix per §18.1+§18.4 cadence (first practical exercise of the rule). |
| v0.1.3 | 2026-05-07 | Fulton | §0.1 trap added: `location.coordinates` field DOES NOT EXIST on events (UC-0018 secondary-finding source). §0.2 Events GET row enhanced with explicit geo-field naming + post-CALBEAF-183 filter behavior. NEW §0.2.1 Geo-field canonical names table (venueGeolocation 100% / masteredCityGeolocation ~66% / `location.coordinates` does-not-exist) + spec-authoring rule pointing to `Events.js:455-484` source-of-truth. Per Quinn §0.2 v0.2-enhancement candidate ratify 2026-05-07T21:01Z + §18.4 codify-at-standby-gap. |
| v0.2 | 2026-05-07 | Fulton | NEW §15.5 Merge Mechanisms + Per-App Guard Rails (BE) — mirror of Sarah TT §15.5 (`tangotiempo.com/docs/E2E-TESTING-REFERENCE.md` v0.8 commit `d874db7c`). 7 sub-sections: 3-layer guard-rail cake / Layer-1 PROD-context scoping / per-repo asymmetric table (BE has NO VM hook — key differentiator) / merge path table / Fulton 5-step CR-block protocol field-validated by CALBEAF-83+CALBEAF-183 same-day cycle / cross-persona pre-flight stats (Sarah+Fulton+Quinn three-layer codification) / Charter §B.X discovery-discipline meta-lesson. Minor version bump per §18.2 new-section rule. Standby-gap codification per §18.4. |
| v0.2.1 | 2026-05-07 | Fulton | Structural fix per ADR-0014 v1.2 Constraint C (Archie 21:11Z arbiter call): §15.5 promoted from h3 (child of §15) to h2 (sibling of §15); §15.5.x sub-sections demoted h4→h3 to maintain hierarchy under §15.5. Loose-numbering convention note added at top of §15.5. Frontmatter `version` updated to track actual version. **Empirical-precedent note (Archie observation):** the operational-sense-of-§15.5-as-sibling was already in team use at v0.2 land 21:06Z, ~5 min BEFORE Constraint C formal codification 21:11Z. Codification followed practice; this v0.2.1 brings the markdown into tooling-compliance with the just-formalized convention. |
| v0.2.2 | 2026-05-07 | Fulton | §0.1 CALBEAF-177 Phase 1 audit findings folded into trap entry: concrete field list (5 enforced — appId/title/startDate/endDate/categoryFirstId; 2 silently-optional gaps — venueID warn-only at `Events.js:947`, ownerOrganizerID silent → authorOrganizerID null). Phase 2 tightening defers to Sprint 6 per ticket defer-condition (caller-survey gating on Discovery-half re-engagement). **Out-of-scope structural finding flagged separately to Quinn:** DEVL is BEHIND TEST by 5+ commits including CALBEAF-171/172/173/168; `src/utils/eventCategoryValidation.js` exists on TEST but absent from DEVL. Branching divergence requires Quinn arbitration (Option A: TEST→DEVL backmerge recommended). |
| v0.2.3 | 2026-05-07 | Fulton | §15 mutator inventory expanded with `elevate-test-user-role` API contract (per UC-0020 escalation 2026-05-07T21:30Z; Gauge-discovered-via-source friction). TIEMPO-443 invariant explicitly documented (RO elevation MUST bundle SL+NU). Authoring rule extended: rule 5 — same-arc body-contract documentation at mutator-add time. NEW §15.1 Pattern A browser-login credential persistence — UC-0020 cross-team gap surfaced; Fulton BE-lane recommendation: path (a) `.env.test.local` persistence for Sprint 5 unblock (path b Firebase custom-token injection = Sprint 6 candidate). Standby-gap codification per §18.4 (9th this Sprint 5 arc per Quinn 21:24Z citation). |
| v0.2.4 | 2026-05-10 | Fulton | §0.1 CALBEAF-184 trap fold (catch-up per Herald §6.3-rule-2 enforcement check 18:50Z). Documents Analytics endpoint appId filter type-coerce asymmetry: MapCenterHistory + UserLoginHistory writers store STRING (parseInt coercion = 0 matches); VisitorTrackingHistory writer stores NUMBER (uniform String() would regress). Canonical String() pattern + transitional tolerant $in pattern both cited with src:line refs. Process lesson cross-referenced: `feedback_verify_actual_collection_target.md` (collection-name distinction VisitorTrackingHistory vs VisitorTrackingHistory2). PROD push for CALBEAF-184 already landed via surgical hotfix PR #33 (cherry-pick `52c272d5`+`a924d220` onto origin/PROD); doc-update lands separately on DEVL here because HDTS-DOCS-STANDARD §18.1 hotfix-class edge case (PR off PROD branch where doc didn't yet exist; v1.3 amendment candidate per Herald). |
| v0.2.5 | 2026-05-11 | Fulton | §0.2.1 add Canonical BASE_URL source-of-truth note (per Quinn framework Layer-2 fix 13:30Z) — `template-vars.yaml TEST_BASE_URL_BE` is the framework-side canonical; `docs/CANONICAL-URLS.md` is the BE-side authoritative; spec authoring should read from config not hard-code (UC-0021/0022 `calendarbeuf` typo class avoidance). Standby-gap codification autonomous per Quinn 13:30Z greenlight. |

**Pending v0.2 expansions:**
- §11 full endpoint taxonomy (table for every handler in `src/functions/`)
- §15 full test-mutator manifest enumeration (sync with `calendar-be-af-test-mutators/baseline/manifest.json` content)
- §0.1 trap expansion as Phase D Story 4.1 corpus surfaces new traps (CALBEAF-172/166/131 candidates)
- §13 expanded with concrete cold-start metrics + warm-up guidance
