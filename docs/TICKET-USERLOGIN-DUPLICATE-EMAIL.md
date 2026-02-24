# JIRA Ticket Draft: UserLogins Duplicate Email Fix

**Project**: CALBEAF
**Type**: Bug
**Priority**: Medium

---

## Summary

UserLogins POST should check email for existing user, not just firebaseUserId

---

## Problem

When a user re-registers with the same email but a different Firebase UID (e.g., deleted Firebase account and created new one), the system creates a **DUPLICATE userlogin record** instead of updating the existing one.

---

## Root Cause

`POST /api/userlogins` (UserLogins.js line 348) only checks for existing user by `firebaseUserId`:

```javascript
const existing = await userLoginsCollection.findOne({ firebaseUserId, appId });
```

It does **NOT** check by `firebaseUserInfo.email`, so same-email users with different Firebase UIDs create duplicates.

---

## Real-World Example

**Elena Getmanova** (egetmanova@gmail.com) has 2 records:

| Created | Firebase UID | Status |
|---------|--------------|--------|
| Sep 2025 | `xMvcIV5nA8P6CHJb3ArrGE78TC03` | Incomplete, orphaned |
| Feb 2026 | `tiKEJCWnw6ZS0elSXJZBzlNR0gH3` | Active |

---

## Proposed Fix

In `POST /api/userlogins`, after checking by firebaseUserId, also check by email:

1. **If user found by email with DIFFERENT firebaseUserId** → UPDATE existing record:
   - Move old firebaseUserId to `alternateFirebaseUserIds` array
   - Set new firebaseUserId as primary
   - Update `firebaseUserInfo` with new data
   - Preserve roles, organizer links, history

2. **If user found by firebaseUserId** → Return 409 Conflict (existing behavior)

3. **If no user found** → Create new (existing behavior)

---

## Acceptance Criteria

- [ ] User re-registering with same email gets their existing record updated, not a new one
- [ ] Old Firebase UID preserved in `alternateFirebaseUserIds` for audit trail
- [ ] User retains their roles, organizer links, and history
- [ ] GET by firebaseId still works (checks both primary and alternates)

---

## Files to Modify

- `src/functions/UserLogins.js` - `userLoginsCreateHandler()` function (lines 311-421)

---

## Code Change (Pseudocode)

```javascript
// In userLoginsCreateHandler, after line 348:

// Check by firebaseUserId first (existing)
const existingByFirebase = await userLoginsCollection.findOne({ firebaseUserId, appId });
if (existingByFirebase) {
    return 409 Conflict; // existing behavior
}

// NEW: Check by email
const email = body.firebaseUserInfo?.email;
if (email) {
    const existingByEmail = await userLoginsCollection.findOne({
        'firebaseUserInfo.email': email,
        appId
    });

    if (existingByEmail) {
        // UPDATE existing record instead of creating new
        const oldFirebaseId = existingByEmail.firebaseUserId;

        await userLoginsCollection.updateOne(
            { _id: existingByEmail._id },
            {
                $set: {
                    firebaseUserId: firebaseUserId,  // new UID
                    firebaseUserInfo: body.firebaseUserInfo,
                    updatedAt: new Date()
                },
                $addToSet: {
                    alternateFirebaseUserIds: oldFirebaseId  // preserve old
                }
            }
        );

        return 200 with updated user;  // or 201 if you prefer
    }
}

// If neither found, create new (existing behavior)
```

---

## Notes

- The `alternateFirebaseUserIds` field already exists and is checked by `GET /api/userlogins/firebase/{firebaseId}` (line 68-72)
- This fix leverages existing infrastructure

---

**Created**: 2026-02-18
**Author**: Fulton (AI Agent)
**Status**: Draft - JIRA unavailable, create manually when available
