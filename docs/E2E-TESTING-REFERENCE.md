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
version: 0.1
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
| **`required: true` in swagger ≠ enforced** | Some fields (CALBEAF-177 audit pending) are declared required but silently optional. | Don't trust swagger for required-field assertions; test explicit POST-without-field → expect rejection, observe accept-and-mangle |
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
| **Events** | GET | `/api/events` | `src/functions/Events_Get.js` | Parent-scoped query landed v1.33.0 (CALBEAF-173) |
| **Events** | POST | `/api/events` | `src/functions/Events_Create.js` | `categoryFirstId` required (CALBEAF-171 v1.34.0) |
| **EventsRA** | POST | `/api/eventsRA` | `src/functions/EventsRA_Create.js` | RegionalAdmin write path; body-parity with Events_Create per CALBEAF-172 |
| **Events_BulkEnrich** | POST | `/api/events/bulk-enrich` | `src/functions/Events_BulkEnrich.js` | D-architecture; CALBEAF-110 |
| **Venues** | POST | `/api/venues` | `src/functions/Venues_Create.js` | Geocoding side-effect on save |
| **Roles** | GET | `/api/roles` | `src/functions/Roles.js` | Per-appId; canonical roleNames + roleNameCodes |

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

**Mutator inventory (per Sarah's TT exemplar references; v0.1 stub — full enumeration v0.2):**

| Mutator | Purpose | Pattern |
|---|---|---|
| `reset-test-user` | Reset Pattern A persistent user (`tango.tiempo.test@gmail.com` at appId=99) to baseline | Pattern A teardown |
| `reset-orphans` | Sweep orphan records at appId=99 | Pattern A teardown |
| `delete-test-user-by-correlation` | Delete Pattern B users by `_testCorrelationId` (ADR-0017 in pipeline; my lane) | Pattern B teardown |
| `elevate-test-user-role` | Apply role changes per role-elevation-matrix.md (must honor TIEMPO-443 invariant — bundle SL with RO) | Both patterns |

**Authoring rule:** any new test-mutator must:
1. Land in `calendar-be-af-test-mutators/baseline/manifest.json` with version bump
2. Be `appId`-scoped (compound dedup)
3. Honor Pattern A/B partition rules (Pattern A → appId=99 fixture-keys; Pattern B → appId=1 + correlation markers)
4. Be cited from this §15 within the same commit

ADR-0017 (`delete-test-user-by-correlation`) draft will land here when slot fires (pipeline post-S5).

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

---

## §19 Change Log

| Version | Date | Author | Scope |
|---|---|---|---|
| v0.1 | 2026-05-07 | Fulton | Initial commission per Charter v5 §DoR criterion #11 + Gotan B.2 BE/API template + Sarah TT v0.2 exemplar shape. Seed content for §0 + §11 + §15 + §17; full enumeration deferred to v0.2+. CALBEAF-83 fix landed and folded into §0.1 (contract trap) + §0.3 (test partition note) + §12 (side-effects) + §16 (UC reference). |

**Pending v0.2 expansions:**
- §11 full endpoint taxonomy (table for every handler in `src/functions/`)
- §15 full test-mutator manifest enumeration (sync with `calendar-be-af-test-mutators/baseline/manifest.json` content)
- §0.1 trap expansion as Phase D Story 4.1 corpus surfaces new traps (CALBEAF-172/166/131 candidates)
- §13 expanded with concrete cold-start metrics + warm-up guidance
