# Field-Naming Hygiene — BE Migration Patterns

**Companion to:** `MasterCalendar/docs/FIELD-NAMING-HYGIENE.md`
**Owner:** Fulton (calendar-be-af)
**Status:** Draft for joint sign-off — covers Phase B mechanics
**Last updated:** 2026-05-01

> **Scope:** This doc captures the BE-side mechanics for Phase B (canonical-name aliasing) of the joint plan. Sarah owns FE-side normalization in Phase A; this doc is what BE delivers in lockstep.

---

## Mission

Make canonical IDs (`<entity>Id` lowercase-d) the primary field on BE responses without breaking any existing consumer. Achieve via API-layer aliasing — no DB document migration needed (Phase C deferred).

---

## Pattern: Mongoose `toJSON` transform with dual-name output

The standard mechanism in mongoose schemas:

```js
// In the schema definition for, e.g., Event:
const EventSchema = new mongoose.Schema({
    venueID:      { type: ObjectId, ref: 'Venue' },         // legacy stored field
    ownerOrganizerID: { type: ObjectId, ref: 'Organizer' }, // legacy stored field
    // ... rest of schema
}, {
    toJSON: {
        transform: (doc, ret) => {
            // CANONICAL OUT — write the new lowercase-d name as primary
            ret.venueId         = ret.venueID;
            ret.ownerOrganizerId = ret.ownerOrganizerID;
            // KEEP LEGACY OUT — for back-compat during sunset window
            // (don't delete ret.venueID — both ship until sunset date)
            return ret;
        }
    }
});
```

This makes responses look like:
```json
{
    "_id": "...",
    "venueId": "abc123",       // CANONICAL (new — preferred)
    "venueID": "abc123",       // LEGACY (deprecated, removed at sunset)
    "ownerOrganizerId": "...", // CANONICAL
    "ownerOrganizerID": "..."  // LEGACY
}
```

**Why both ship simultaneously:**
- Existing FE code still reads legacy → no break
- New FE code (Sarah's Phase A canonical reads) gets the new name
- Internal BE consumers (my own SEO endpoints, AIDI/Porter loaders, niche-harvest) migrate at their own pace

---

## Pattern: WRITE-side acceptance (POST/PUT)

For inputs, accept either name with canonical preference:

```js
// In the handler:
const venueId = body.venueId || body.venueID || body.locationID;  // canonical → legacy → ancient
```

Then store under whatever the schema defines — typically the legacy field for now, since that's what mongoose schemas already expect. Don't migrate the storage column — let the schema rename happen during Phase C if it ever does.

---

## Per-entity sunset SLA template

For each entity rolled out, document:

| Field | Status |
|-------|--------|
| **Canonical** | `<entity>Id` (e.g., `venueId`) |
| **Legacy alias output** | `<entity>ID` (e.g., `venueID`) |
| **Sunset date** | Phase A FE migration complete + 90 days |
| **Sunset action** | Remove legacy from `toJSON` transform; drop from FE; pin to canonical only |
| **Rollback path** | Revert toJSON transform — single-line change |

90 days is the buffer for any external consumer (mobile app, partner integration, AIDI loader, niche-harvest) to migrate. We can shorten if no external consumers detected.

---

## Per-entity rollout checklist

For each entity (Venue first, then Organizer subtypes, etc.):

### Pre-roll
- [ ] Verify Sarah's Phase A FE PR is merged to TEST (canonical writes + legacy reads)
- [ ] Confirm no other consumer reads only legacy

### BE Phase B steps
1. [ ] Update Mongoose `toJSON` transform — add canonical field as alias of legacy
2. [ ] Update internal BE consumers (my own SEO + ops endpoints) to read canonical
3. [ ] Verify TEST: response has both names, both = same value
4. [ ] PR TEST → PROD with regression baseline (old name still ships, new name now also ships)
5. [ ] Mark legacy field deprecated in JSDoc / API_Docs.json

### Sunset (90 days later)
1. [ ] Remove legacy alias from toJSON transform
2. [ ] Verify FE/external consumers all migrated (no 4xx on legacy field reads)
3. [ ] Final PR — drop legacy, version bump

---

## Special cases

### `_id` (Mongo PK)
**Don't alias.** `_id` stays as-is everywhere. It's not an inconsistency — it's THE Mongo identifier convention. Mongoose's built-in `.id` virtual returns `_id.toString()` for free if a consumer wants the string form.

### `firebaseUserId`
**Don't alias.** External-namespace identifier (Firebase auth), distinct from any Mongo PK. The "User" prefix is correct because it's a User-scoped FirebaseId, not a Firebase-scoped UserId. Names are correct as-is.

### `grantedOrganizer*`
**Don't alias — drop instead** (per joint-plan decision, per TIEMPO-346). Already deprecated in favor of `eventRole`. Phase B for this entity is "remove the field from response" not "rename it."

### Nested-doc IDs (ownerOrganizer.id, alternateOrganizers[].id)
**Already canonical.** New schema (TIEMPO-346 alt-org refactor) uses `.id` on subdocuments. Mongoose's subdocument `.id` is the same as `_id.toString()` virtual. No work needed.

---

## Anti-patterns to avoid

| ❌ Don't | ✅ Do |
|---------|------|
| `schema.set('strict', false)` to allow both names | Explicitly map in `toJSON` transform |
| Rename the actual Mongo document field (Phase C) | Alias at the API layer (Phase B) |
| Drop legacy on day 1 of Phase B | Keep legacy for ~90-day sunset buffer |
| Add canonical AND legacy AND a third compat name | Two names max — canonical + legacy. Anything else is cruft. |
| Migrate without coordination on the FE | Wait for Sarah's Phase A PR per entity |

---

## Decisions Log (BE-side, append to MasterCalendar/docs/FIELD-NAMING-HYGIENE.md decisions)

- **2026-05-01** Fulton signed off on `<entity>Id` lowercase-d as canonical, with explicit exceptions for `_id` and `firebaseUserId`.
- **2026-05-01** Decision: BE Phase B uses Mongoose `toJSON` aliasing — no DB migration. Sunset SLA: 90 days from FE Phase A merge.
- **2026-05-01** `grantedOrganizer*` will be DROPPED (not aliased) — already deprecated per TIEMPO-346.
- **2026-05-01** Entity #1: Venue + ownerOrganizer flat fields together (lockstep, single FE/BE cycle).

---

## Open questions (joint with Sarah)

1. Sunset window of 90 days — adjust if external consumers have shorter migration capacity?
2. Do we add a deprecation warning to API_Docs.json or just rely on the doc?
3. Is there value in returning a `_deprecatedFields: ['venueID']` array in responses to help FE consumers self-audit?

---

## Cross-references

- Joint plan: `MasterCalendar/docs/FIELD-NAMING-HYGIENE.md`
- Mongoose docs: https://mongoosejs.com/docs/api/schema.html#schema-virtual
- Pattern precedent: SEO_GeoSummary `parentSlug`/`regionSlug`/`countrySlug` triple-alias
