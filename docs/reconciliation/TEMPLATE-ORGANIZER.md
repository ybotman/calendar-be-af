# Organizer Reconciliation Template

**Copy this folder structure for each organizer:**

```
{SHORT_NAME}/
├── FINDINGS.md      # What we discovered
├── TODO.md          # Pending actions (approval required)
└── COMPLETED.md     # Executed actions log
```

---

## FINDINGS.md Template

```markdown
# {ORGANIZER_NAME} ({SHORT_NAME}) - Findings

**Generated**: YYYY-MM-DD
**Status**: REVIEW | IN PROGRESS | COMPLETE

---

## Organizer Info

| Field | Value |
|-------|-------|
| Full Name | {ORGANIZER_NAME} |
| Short Name | {SHORT_NAME} |
| Organizer ID | {ORGANIZER_ID} |
| Email | {EMAIL} |
| Active | Yes/No |

---

## Summary

| Category | In LIVE | In DEV | Delta | Action Needed |
|----------|---------|--------|-------|---------------|
| Events | X | Y | +/-Z | Yes/No |
| Userlogin | X | Y | +/-Z | Yes/No |
| Venue Links | X | Y | +/-Z | Yes/No |

---

## Events Analysis

### Currently in LIVE (TangoTiempo)

| Event ID | Title | Date | Status |
|----------|-------|------|--------|
| ... | ... | ... | ... |

### Currently in DEV (TangoTiempoProd)

| Event ID | Title | Date | Status |
|----------|-------|------|--------|
| ... | ... | ... | ... |

### Missing from DEV (need to add)

| Event ID | Title | Date | Source |
|----------|-------|------|--------|
| ... | ... | ... | LIVE |

### Extra in DEV (review if keep)

| Event ID | Title | Date | Decision |
|----------|-------|------|----------|
| ... | ... | ... | KEEP/DELETE |

---

## Userlogin Analysis

| Field | LIVE | DEV | Match? |
|-------|------|-----|--------|
| firebaseUserId | ... | ... | Yes/No |
| email | ... | ... | Yes/No |
| mapCenter | ... | ... | Yes/No |
| roles | ... | ... | Yes/No |
| organizerId | ... | ... | Yes/No |

---

## Venue Links

| Venue ID | Venue Name | In LIVE | In DEV | Action |
|----------|------------|---------|--------|--------|
| ... | ... | Yes/No | Yes/No | ... |

---

## Recommendations

1. **EVENTS**: [Summary of what to do]
2. **USERLOGIN**: [Summary of what to do]
3. **VENUES**: [Summary of what to do]

---

## Questions for Gotan

- [ ] Question 1?
- [ ] Question 2?
```

---

## TODO.md Template

```markdown
# {ORGANIZER_NAME} ({SHORT_NAME}) - TODO

**Last Updated**: YYYY-MM-DD HH:MM EST

---

## EVENTS

### ACTION-{SHORT_NAME}-E001: [Description]

**Status**: PENDING APPROVAL | APPROVED | EXECUTED | SKIPPED

**Category**: EVENTS

**Technical Description**:
- Database: TangoTiempoProd
- Collection: events
- Operation: INSERT
- Document ID: {EVENT_ID}

**Statement to Execute**:
```javascript
db.events.insertOne({
  _id: ObjectId("{EVENT_ID}"),
  title: "{TITLE}",
  // ... full document
})
```

**User Description**:
We will add the "{TITLE}" event for {DATE} to the production database.

**Approval**:
- [ ] Gotan approved on: ___________
- [ ] Executed on: ___________

---

### ACTION-{SHORT_NAME}-E002: [Description]

**Status**: PENDING APPROVAL

...

---

## USERLOGIN

### ACTION-{SHORT_NAME}-U001: [Description]

**Status**: PENDING APPROVAL

**Category**: USERLOGIN

**Technical Description**:
- Database: TangoTiempoProd
- Collection: userlogins
- Operation: UPDATE
- Document ID: {USERLOGIN_ID}

**Statement to Execute**:
```javascript
db.userlogins.updateOne(
  { _id: ObjectId("{USERLOGIN_ID}") },
  { $set: { mapCenter: { lat: X, lng: Y, radiusMiles: Z } } }
)
```

**User Description**:
We will update {ORGANIZER_NAME}'s user profile with their map center settings.

**Approval**:
- [ ] Gotan approved on: ___________
- [ ] Executed on: ___________

---

## VENUES

### ACTION-{SHORT_NAME}-V001: [Description]

**Status**: PENDING APPROVAL

...

---

## Summary

| Action ID | Category | Description | Status |
|-----------|----------|-------------|--------|
| {SHORT_NAME}-E001 | EVENTS | ... | PENDING |
| {SHORT_NAME}-E002 | EVENTS | ... | PENDING |
| {SHORT_NAME}-U001 | USERLOGIN | ... | PENDING |
| {SHORT_NAME}-V001 | VENUES | ... | PENDING |
```

---

## COMPLETED.md Template

```markdown
# {ORGANIZER_NAME} ({SHORT_NAME}) - Completed Actions

**Last Updated**: YYYY-MM-DD HH:MM EST

---

## Summary for {ORGANIZER_NAME}

**What we did** (in plain English):

- [Date]: Added X events for upcoming milongas
- [Date]: Updated user profile settings
- [Date]: Linked venue "{VENUE_NAME}" to organizer

---

## Detailed Execution Log

### ACTION-{SHORT_NAME}-E001: Added "{TITLE}" Event

**Executed**: YYYY-MM-DD HH:MM EST
**Approved By**: Gotan on YYYY-MM-DD

**What We Did** (User-Friendly):
We restored the "{TITLE}" event scheduled for {DATE}. This event is now visible on tangotiempo.com.

**Technical Details**:
- Database: TangoTiempoProd
- Collection: events
- Operation: INSERT
- Document ID: {EVENT_ID}

**Statement Executed**:
```javascript
db.events.insertOne({
  _id: ObjectId("{EVENT_ID}"),
  title: "{TITLE}",
  startDate: ISODate("{DATE}"),
  // ...
})
```

**Result**:
```json
{ "acknowledged": true, "insertedId": ObjectId("{EVENT_ID}") }
```

**Verification**:
- [ ] Event visible in database
- [ ] Event visible on frontend (after FE swap)

---

### ACTION-{SHORT_NAME}-U001: Updated User Profile

**Executed**: YYYY-MM-DD HH:MM EST
**Approved By**: Gotan on YYYY-MM-DD

...

---

## Verification Checklist

After all actions complete:

- [ ] All events synced between LIVE and DEV
- [ ] Userlogin properly configured
- [ ] Venue links correct
- [ ] Organizer can create new events (tested)
```

---

## Usage Instructions

1. **Copy folder template** for each organizer
2. **Fill in FINDINGS.md** with analysis
3. **Create TODO.md** with pending actions (get approval before each)
4. **Execute approved actions** and move to COMPLETED.md
5. **Update OVERVIEW.md** with status
