// CALBEAF-172 — code-shape regression test for EventsRA_Create body acceptance.
//
// Pre-fix: EventsRA_Create destructured 8 fields from requestBody (title, startDate,
// endDate, ownerOrganizerID, venueID, description, cost, appId) and silently dropped
// everything else (categoryFirst, categoryFirstId, isRepeating, recurrenceRule,
// forBeginners, travelWorthy, eventImage, spotlights, shortTitle, etc.).
//
// Post-fix (commit 7c5c0526): spread+omit pattern. const userInput = { ...requestBody }
// then delete userInput.{BE-controlled-fields}. Event document built as
// { ...userInput, ...BE-overrides }, preserving all user-supplied fields.
//
// This regression test is a code-shape assertion: scans the EventsRA_Create handler
// source for the spread+omit pattern and the absence of the pre-fix destructure.
//
// Why not a behavioral test: the handler is intertwined with auth, mongo, venue/organizer
// lookup. Extracting the body-handling logic into a unit-testable function would be
// CALBEAF-172 scope creep. Code-shape is the bug-shaped regression — a future PR
// reverting to destructure-and-drop would fail this test.
//
// User-acceptance regression for runtime behavior: Sarah's RA Create FE TEST verification
// (Sunday Practica RRULE 50 create) — this is the existing gate Toby uses to confirm
// the post-fix RA flow persists categoryFirst/isRepeating/etc.

const fs = require('fs');
const path = require('path');

const RA_FILE = path.join(__dirname, '..', 'src', 'functions', 'EventsRA.js');

describe('CALBEAF-172 — EventsRA_Create body-acceptance regression (code-shape)', () => {
    const source = fs.readFileSync(RA_FILE, 'utf8');

    // Locate the eventsRACreateHandler block to scope assertions
    const createHandlerMatch = source.match(
        /async function eventsRACreateHandler\(request, context\) \{[\s\S]*?\n\}/
    );

    test('eventsRACreateHandler is defined', () => {
        expect(createHandlerMatch).not.toBeNull();
    });

    const createHandler = createHandlerMatch ? createHandlerMatch[0] : '';

    test('uses spread pattern: `const userInput = { ...requestBody };`', () => {
        expect(createHandler).toMatch(/const\s+userInput\s*=\s*\{\s*\.\.\.requestBody\s*\}/);
    });

    test('omits BE-controlled fields explicitly via delete', () => {
        // The fix establishes an explicit allowlist via deleting BE-controlled fields.
        // These deletes must be present so userInput is safe to spread into the event doc.
        expect(createHandler).toMatch(/delete\s+userInput\.authorOrganizerID/);
        expect(createHandler).toMatch(/delete\s+userInput\.createdByRA/);
        expect(createHandler).toMatch(/delete\s+userInput\._id/);
        expect(createHandler).toMatch(/delete\s+userInput\.createdAt/);
        expect(createHandler).toMatch(/delete\s+userInput\.updatedAt/);
    });

    test('does NOT use the pre-fix destructure-only-8-fields pattern', () => {
        // Pre-fix code looked like:
        //   const { title, startDate, endDate, ownerOrganizerID, venueID,
        //           description, cost, appId } = requestBody;
        // and used these 8 fields exclusively to build the event document, dropping
        // everything else. The fix kept a smaller destructure ONLY for validation/coercion
        // pulls — but the event document is built from userInput (the spread).
        //
        // Bug-shaped check: there must NOT be a destructure on requestBody that pulls
        // ALL 8 of the original fields together. (A smaller destructure for validation
        // is allowed; this test guards against the full pre-fix shape.)
        const eightFieldDestructureOnRequestBody = /const\s*\{\s*title\s*,\s*startDate\s*,\s*endDate\s*,\s*ownerOrganizerID\s*,\s*venueID\s*,\s*description\s*,\s*cost\s*,\s*appId\s*\}\s*=\s*requestBody/;
        expect(createHandler).not.toMatch(eightFieldDestructureOnRequestBody);
    });

    test('builds event document by spreading userInput', () => {
        // The fix builds eventData = { ...userInput, ...BE-overrides } so all user-supplied
        // fields propagate. A future regression that builds eventData = { title, startDate,
        // ...explicit-list } would fail this test.
        expect(createHandler).toMatch(/eventData\s*=\s*\{\s*\.\.\.userInput/);
    });
});
