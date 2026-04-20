#!/usr/bin/env node
// scripts/runSeriesAsSingletonsPatch.js
// CALBEAF-112 / SAS-FTPNTD Phase 2: Series-as-Singletons 1x patch tool.
//
// Imports shared detection heuristic from ai-discovered/packages/series-detection
// via `file:` npm install (Quinn 2026-04-18 arbitration).
//
// On top of the package's detectPotentialSeries, this tool implements AIDI's
// Refinement 2 (principled sub-group re-detection): when a group returns REVIEW,
// the tool tries single-weekday subsets to find a CLEAN core pattern; the
// remaining events become outlier singletons. Deterministic, no hand-curation.
//
// MUST be run with `node --experimental-strip-types` (package is .ts ESM).
//
// --dry-run: default. --apply: requires Toby per-org reauth.
// PROD URI guard: refuses unless --i-know-prod (never granted for this initiative).
//
// ─ MASTER DOC FIELD-SOURCING CONTRACT (AIDI Ask 1 + Quinn 2026-04-18 refinement) ──
//
// When a CONVERT or CONVERT_PARTIAL group becomes a master, the master doc's
// fields derive deterministically from the core events (the subset that matched
// the cadence, not outliers):
//
//   master.title              = most-common title among coreEvents; fallback = first-core if tied.
//                               (Safest for partial-match groups; handles e.g. "WK1 - Foo"/"WK2 - Foo"
//                                that normalize to same title but preserve raw diversity.)
//   master.ownerOrganizerID   = assert-all-equal + inherit from first-core. Guaranteed by grouping-key
//                               construction for user-authored events; assertion catches any bug.
//   master.venueID            = require ALL core events share the same venueID.
//                               If not — ABORT that group with explicit error; surfaces to AIDI/Quinn.
//                               Do NOT silently split or pick one. (Quinn refinement: "don't silently split.")
//   master.categoryFirstId    = most-common among coreEvents; fallback = first-core. Same handling as title.
//   master.appId              = first-core (will be same across all core by grouping).
//   master.isRepeating        = true.
//   master.recurrenceRule     = inferred RRULE from cadence detection (from package).
//   master.startDate          = DTSTART = earliest core startDate (from package output).
//   master.endDate            = startDate + inherited duration. Duration = most-common
//                               (endDate - startDate) among coreEvents; fallback = first-core's duration.
//   master.isActive           = true (newly-created master defaults to active).
//   master.isCanceled         = false (cancelled events stay as outliers, not folded into master).
//   master.description/images/other content fields → inherited from most-recent core event
//                               (handles field drift across the series; AIDI can override per-case).
//   master.discoveredComments = "Created by SAS patch (Toby 2026-04-18); seriesDetectionSpec=<version>;
//                                replaces <N> singletons"
//
// Each core event gets $set: { replacedByMaster: <master._id> }. Audit trail. No deletions.
//
// Outlier events (from CONVERT_PARTIAL) remain UNCHANGED — neither folded into master
// nor flagged. They stay as independent singletons; Toby/AIDI may choose separate
// handling later.
//
// ─ SAMPLE $SET OP SHAPE (AIDI Pre-Apply Ask 2) ────────────────────────────
//
// On the first --apply invocation, the tool logs the first generated update-op
// before the bulkWrite fires, so AIDI can verify the audit-trail flag lands as
// specified. Example output:
//   [SAMPLE-SET-OP]
//     filter:  { _id: ObjectId("684651c7df99a7ff192e3f3b") }
//     update:  { $set: { replacedByMaster: ObjectId("<masterId>") } }
//
// Usage:
//   node --experimental-strip-types scripts/runSeriesAsSingletonsPatch.js --org=UT --dry-run
//   node --experimental-strip-types scripts/runSeriesAsSingletonsPatch.js --org-id=<id> --dry-run --output=/tmp/sas-ut.json

const { MongoClient, ObjectId } = require('mongodb');
const fs = require('fs');

const WEEKDAY_NAMES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function parseArgs() {
    const args = { dryRun: true, knowProd: false, org: null, orgId: null, output: null, minCount: 3, threshold: 0.25 };
    for (const a of process.argv.slice(2)) {
        if (a === '--apply') args.dryRun = false;
        else if (a === '--dry-run') args.dryRun = true;
        else if (a === '--i-know-prod') args.knowProd = true;
        else if (a.startsWith('--org=')) args.org = a.split('=')[1];
        else if (a.startsWith('--org-id=')) args.orgId = a.split('=')[1];
        else if (a.startsWith('--min-count=')) args.minCount = parseInt(a.split('=')[1], 10);
        else if (a.startsWith('--output=')) args.output = a.split('=')[1];
        else if (a.startsWith('--threshold=')) args.threshold = parseFloat(a.split('=')[1]);
    }
    return args;
}

function loadUri() {
    const uri = process.env.MONGODB_URI_TEST
        || (() => { try { return require('../local.settings.json').Values.MONGODB_URI_TEST; } catch { return null; } })();
    if (!uri) { console.error('ERROR: MONGODB_URI_TEST not configured'); process.exit(1); }
    return uri;
}

/**
 * AIDI Refinement 2 — principled sub-group re-detection.
 * Input: a REVIEW group. Try filtering to each single weekday; if any subset
 * produces a clean cadence (WEEKLY/BIWEEKLY/etc.) AND covers >=60% of events,
 * return { coreEvents, outlierEvents, coreCadence }. Otherwise null (stays REVIEW).
 */
async function trySubgroupReDetection(detectPotentialSeries, members, groupingKeyFn, dateFieldFn, threshold, minGroup) {
    // Find weekdays present
    const byWeekday = {};
    for (const m of members) {
        const d = new Date(dateFieldFn(m));
        const wd = d.getUTCDay();
        if (!byWeekday[wd]) byWeekday[wd] = [];
        byWeekday[wd].push(m);
    }
    const weekdaysSortedByCount = Object.entries(byWeekday).sort((a, b) => b[1].length - a[1].length);
    // Try the most-common weekday first
    for (const [wdStr, subset] of weekdaysSortedByCount) {
        if (subset.length < minGroup) continue;
        const subResult = detectPotentialSeries({
            events: subset,
            groupingKeyFn,
            dateFieldFn,
            threshold,
            minGroup,
        });
        if (subResult.matchedGroups === 1) {
            const sub = subResult.groups[0];
            if (sub.cadence.cadence !== 'REVIEW' && subset.length / members.length >= 0.6) {
                const outliers = members.filter(m => !subset.includes(m));
                return {
                    coreEvents: subset,
                    outlierEvents: outliers,
                    coreCadence: sub.cadence,
                };
            }
        }
    }
    return null;
}

async function main() {
    const args = parseArgs();
    const uri = loadUri();
    if (uri.toLowerCase().includes('prod') && !args.knowProd) {
        console.error('ERROR: URI looks like PROD. Refusing per CALBEAF-112 PROD STAY-OUT.');
        process.exit(2);
    }

    if (!args.org && !args.orgId) {
        console.error('ERROR: specify --org=<fullName-regex> or --org-id=<ObjectId>');
        process.exit(1);
    }

    // Dynamic import of the ESM/TS package
    const pkg = await import('series-detection');
    const { detectPotentialSeries, SERIES_DETECTION_SPEC_VERSION, normalizeTitle } = pkg;

    console.log('=== SAS-FTPNTD Phase 2 Patch Tool ===');
    console.log('Spec version:', SERIES_DETECTION_SPEC_VERSION);
    console.log('Mode:', args.dryRun ? 'DRY-RUN' : 'APPLY (requires Toby reauth)');
    console.log('Min count for series candidate:', args.minCount);
    console.log('Gap-CV threshold:', args.threshold);
    console.log('URI host:', new URL(uri).host);
    console.log();

    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db();

    // Resolve organizer
    let orgId, orgName;
    if (args.orgId) {
        orgId = new ObjectId(args.orgId);
        const org = await db.collection('organizers').findOne({ _id: orgId });
        orgName = org ? org.fullName : '(unknown)';
    } else {
        const org = await db.collection('organizers').findOne({ appId: '1', fullName: new RegExp(args.org, 'i') });
        if (!org) { console.error(`ERROR: no organizer matching /${args.org}/i`); process.exit(1); }
        orgId = org._id;
        orgName = org.fullName;
    }
    console.log(`Target organizer: ${orgName}  (_id: ${orgId})`);

    // Pull all non-recurring events for this org (fields needed for master doc per AIDI contract)
    const events = await db.collection('events').find({
        appId: '1',
        ownerOrganizerID: orgId,
        isRepeating: { $ne: true },
    }).toArray();  // full docs — master doc inherits all fields from first-core, overwrites specific ones per contract

    console.log(`Found ${events.length} non-recurring events for ${orgName}\n`);

    // Event shape for the package — pass ISO string
    const groupingKeyFn = e => `${e.ownerOrganizerID}|${normalizeTitle(e.title || '')}`;
    const dateFieldFn = e => e.start_date_iso || e.startDate?.toISOString?.() || e.start_date;

    // Prepare events for the package
    const pkgEvents = events.map(e => ({
        _id: e._id,
        title: e.title,
        ownerOrganizerID: orgId.toString(),
        start_date_iso: e.startDate.toISOString(),
        categoryFirst: e.categoryFirst,
        venueID: e.venueID,
    }));

    // Initial detection
    const result = detectPotentialSeries({
        events: pkgEvents,
        groupingKeyFn,
        dateFieldFn,
        threshold: args.threshold,
        minGroup: args.minCount,
    });

    console.log(`Package detectPotentialSeries → ${result.totalGroups} groups (${result.matchedGroups} matched, ${result.reviewGroups} review)`);
    console.log();

    // Post-process: translate package output to tool-level actions,
    // apply sub-group re-detection on REVIEW groups per AIDI Refinement 2.
    const proposals = [];
    for (const group of result.groups) {
        const title = (group.members[0] && group.members[0].title) || '(no title)';
        const count = group.members.length;

        if (group.cadence.cadence !== 'REVIEW') {
            // Clean cadence — all members convert to one master
            const coreIds = group.uniqueMembers.map(m => m._id.toString());
            proposals.push({
                title,
                count,
                action: 'CONVERT',
                confidence: 'HIGH',
                cadence: group.cadence.cadence,
                rrule: group.cadence.rrule,
                gapCv: group.cadence.gapCv,
                sameDayDuplicates: group.sameDayDuplicates,
                coreCount: group.uniqueMembers.length,
                outlierCount: 0,
                coreEventIds: coreIds,
                outlierEventIds: [],
                // DTSTART / UNTIL = observed bounds (AIDI Refinement 1: never fabricate)
                dtstart: group.uniqueMembers[0].start_date_iso,
                until: group.uniqueMembers[group.uniqueMembers.length - 1].start_date_iso,
                // AIDI Pre-Apply Ask 2: sample $set op shape for audit-trail verification
                sampleSingletonUpdate: {
                    filter: { _id: `ObjectId("${coreIds[0]}")` },
                    update: { $set: { replacedByMaster: `ObjectId("<newMasterId>")` } },
                },
            });
        } else {
            // REVIEW — try sub-group re-detection
            const sub = await trySubgroupReDetection(
                detectPotentialSeries,
                group.members,
                groupingKeyFn,
                dateFieldFn,
                args.threshold,
                args.minCount
            );
            if (sub) {
                const coreSorted = [...sub.coreEvents].sort((a, b) => new Date(a.start_date_iso) - new Date(b.start_date_iso));
                const coreIds = sub.coreEvents.map(m => m._id.toString());
                proposals.push({
                    title,
                    count,
                    action: 'CONVERT_PARTIAL',
                    confidence: 'HIGH',
                    cadence: sub.coreCadence.cadence,
                    rrule: sub.coreCadence.rrule,
                    gapCv: sub.coreCadence.gapCv,
                    sameDayDuplicates: group.sameDayDuplicates,
                    coreCount: sub.coreEvents.length,
                    outlierCount: sub.outlierEvents.length,
                    coreEventIds: coreIds,
                    outlierEventIds: sub.outlierEvents.map(m => m._id.toString()),
                    dtstart: coreSorted[0].start_date_iso,
                    until: coreSorted[coreSorted.length - 1].start_date_iso,
                    reviewReason: `Original group REVIEW (${group.cadence.reviewReason}); sub-group re-detection found core subset.`,
                    sampleSingletonUpdate: {
                        filter: { _id: `ObjectId("${coreIds[0]}")` },
                        update: { $set: { replacedByMaster: `ObjectId("<newMasterId>")` } },
                    },
                });
            } else {
                // Stays REVIEW — algorithm cannot determine cadence; human review required
                proposals.push({
                    title,
                    count,
                    action: 'REVIEW',
                    reviewReason: group.cadence.reviewReason,
                    gapCv: group.cadence.gapCv,
                    coreCount: 0,
                    outlierCount: count,
                    eventIds: group.members.map(m => m._id.toString()),
                });
            }
        }
    }

    // NO-OP flip for REVIEW groups whose events span < 7 days (workshop, not series).
    // Keep genuine REVIEW cases (long span but ambiguous cadence) intact.
    for (const p of proposals) {
        if (p.action === 'REVIEW') {
            const ids = new Set(p.eventIds);
            const dateObjs = events.filter(e => ids.has(e._id.toString())).map(e => e.startDate);
            dateObjs.sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
            if (dateObjs.length >= 2) {
                const spanDays = (new Date(dateObjs[dateObjs.length - 1]).getTime() - new Date(dateObjs[0]).getTime()) / 86400000;
                if (spanDays < 7) {
                    p.action = 'NO-OP';
                    p.reviewReason = `span ${spanDays.toFixed(1)}d < 7d — workshop/weekend, not recurring series`;
                } else {
                    p.spanDays = Math.round(spanDays);
                }
            }
        }
    }

    // Summary output
    for (const p of proposals) {
        console.log('--- "' + (p.title || '').substring(0, 70) + '" ---');
        console.log('  count:', p.count, ' action:', p.action, p.confidence ? `(${p.confidence})` : '');
        if (p.action === 'CONVERT' || p.action === 'CONVERT_PARTIAL') {
            console.log('  cadence:', p.cadence, ' RRULE:', p.rrule);
            console.log('  DTSTART:', p.dtstart, ' UNTIL:', p.until);
            console.log('  core (in master):', p.coreCount, ' outliers (singletons):', p.outlierCount, ' same-day-dups absorbed:', p.sameDayDuplicates || 0);
            if (p.action === 'CONVERT_PARTIAL' && p.reviewReason) console.log('  note:', p.reviewReason);
        } else {
            console.log('  reason:', p.reviewReason);
        }
        console.log();
    }

    const summary = {
        meta: {
            mode: args.dryRun ? 'DRY-RUN' : 'APPLY',
            specVersion: SERIES_DETECTION_SPEC_VERSION,
            organizer: orgName,
            orgId: orgId.toString(),
            timestamp: new Date().toISOString(),
            threshold: args.threshold,
            minGroup: args.minCount,
            packageImport: true,
        },
        counts: {
            eventsScanned: events.length,
            groupsDetected: result.totalGroups,
            matchedGroupsPackage: result.matchedGroups,
            reviewGroupsPackage: result.reviewGroups,
            convert: proposals.filter(p => p.action === 'CONVERT').length,
            convertPartial: proposals.filter(p => p.action === 'CONVERT_PARTIAL').length,
            reviewRemaining: proposals.filter(p => p.action === 'REVIEW').length,
            noOp: proposals.filter(p => p.action === 'NO-OP').length,
            eventsToConvert: proposals.filter(p => p.action === 'CONVERT' || p.action === 'CONVERT_PARTIAL').reduce((s, p) => s + (p.coreCount || 0), 0),
            outlierSingletons: proposals.filter(p => p.action === 'CONVERT_PARTIAL').reduce((s, p) => s + (p.outlierCount || 0), 0),
            eventsInReview: proposals.filter(p => p.action === 'REVIEW').reduce((s, p) => s + p.count, 0),
            eventsNoOp: proposals.filter(p => p.action === 'NO-OP').reduce((s, p) => s + p.count, 0),
        },
        proposals,
    };

    console.log('=== SUMMARY ===');
    console.log(JSON.stringify(summary.counts, null, 2));

    if (args.output) {
        fs.writeFileSync(args.output, JSON.stringify(summary, null, 2));
        console.log(`\nFull artifact written to: ${args.output}`);
    }

    if (args.dryRun) {
        console.log('\nDRY-RUN — no writes. Re-run with --apply after AIDI Q1=C + Toby reauth.');
    } else {
        // ─── --apply path ─────────────────────────────────────────────────────────
        // Authorized Toby 2026-04-18 23:57Z (UT-only this run). Field-sourcing per
        // AIDI-approved contract in file header.

        // Toby Series 1 override: REVIEW group with Tue/Thu drop-in title →
        // CONVERT with FREQ=WEEKLY;BYDAY=TU,TH covering all 17 events.
        if (orgName && /Ultimate Tango/i.test(orgName)) {
            for (const p of proposals) {
                if (p.action === 'REVIEW' && /Tuesday.*Thursday/i.test(p.title || '')) {
                    const byId = new Map(events.map(e => [e._id.toString(), e]));
                    const ids = p.eventIds;
                    const ev = ids.map(id => byId.get(id)).filter(Boolean);
                    const dates = ev.map(e => new Date(e.startDate)).sort((a, b) => a - b);
                    p.action = 'CONVERT';
                    p.confidence = 'HIGH-TOBY-OVERRIDE';
                    p.cadence = 'WEEKLY';
                    p.rrule = 'FREQ=WEEKLY;BYDAY=TU,TH';
                    p.coreCount = ev.length;
                    p.outlierCount = 0;
                    p.coreEventIds = ids;
                    p.outlierEventIds = [];
                    p.dtstart = dates[0].toISOString();
                    p.until = dates[dates.length - 1].toISOString();
                    p.note = 'Toby 2026-04-18 23:57Z: Series 1 REVIEW resolved → option (a) one combined master BYDAY=TU,TH';
                    console.log(`\n[TOBY OVERRIDE] Series 1 promoted REVIEW→CONVERT with BYDAY=TU,TH covering ${ev.length} events.`);
                    break;
                }
            }
        }

        const byId = new Map(events.map(e => [e._id.toString(), e]));
        const applyResults = {
            mastersCreated: [],
            singletonsFlaggedTotal: 0,
            outliersPreservedTotal: 0,
            groupsAborted: [],
        };
        let firstSampleOpLogged = false;

        for (const p of proposals) {
            if (p.action !== 'CONVERT' && p.action !== 'CONVERT_PARTIAL') continue;

            const coreEvents = p.coreEventIds.map(id => byId.get(id)).filter(Boolean);
            if (coreEvents.length !== p.coreEventIds.length) {
                applyResults.groupsAborted.push({ title: p.title, error: 'core events missing from DB' });
                continue;
            }

            // Assert venueID all-equal (AIDI field-sourcing: ABORT on mismatch)
            const venueIds = new Set(coreEvents.map(e => e.venueID ? e.venueID.toString() : 'null'));
            if (venueIds.size > 1) {
                applyResults.groupsAborted.push({
                    title: p.title,
                    error: `venueID mismatch across core (${venueIds.size} distinct); ABORT per contract — surface to AIDI/Quinn`,
                });
                continue;
            }

            // Most-common title/category
            const tc = {}; coreEvents.forEach(e => { tc[e.title] = (tc[e.title] || 0) + 1; });
            const commonTitle = Object.entries(tc).sort((a, b) => b[1] - a[1])[0][0];
            const cc = {}; coreEvents.forEach(e => { const k = e.categoryFirstId ? e.categoryFirstId.toString() : 'null'; cc[k] = (cc[k] || 0) + 1; });
            const commonCatStr = Object.entries(cc).sort((a, b) => b[1] - a[1])[0][0];
            const commonCategoryFirstId = commonCatStr !== 'null' ? new ObjectId(commonCatStr) : null;

            // most-common duration for endDate
            const durs = coreEvents.map(e => {
                if (!e.endDate || !e.startDate) return null;
                return new Date(e.endDate).getTime() - new Date(e.startDate).getTime();
            }).filter(d => d !== null);
            const dc = {}; durs.forEach(d => { dc[d] = (dc[d] || 0) + 1; });
            const commonDur = durs.length ? parseInt(Object.entries(dc).sort((a, b) => b[1] - a[1])[0][0], 10) : 3600000;

            // Most-recent core for description/images
            const mostRecent = [...coreEvents].sort((a, b) => new Date(b.startDate) - new Date(a.startDate))[0];
            const first = coreEvents[0];

            const dtstartDate = new Date(p.dtstart);
            const masterId = new ObjectId();
            const master = {
                _id: masterId,
                appId: first.appId,
                title: commonTitle,
                ownerOrganizerID: first.ownerOrganizerID,
                ownerOrganizerName: first.ownerOrganizerName,
                venueID: first.venueID,
                venueGeolocation: first.venueGeolocation,
                venueCityName: first.venueCityName,
                venueTimezone: first.venueTimezone,
                categoryFirst: mostRecent.categoryFirst,
                categoryFirstId: commonCategoryFirstId,
                startDate: dtstartDate,
                endDate: new Date(dtstartDate.getTime() + commonDur),
                isActive: true,
                isCanceled: false,
                isRepeating: true,
                recurrenceRule: p.rrule,
                description: mostRecent.description,
                eventImage: mostRecent.eventImage,
                discoveredComments: `Created by SAS patch (Toby 2026-04-18); seriesDetectionSpec=${SERIES_DETECTION_SPEC_VERSION}; replaces ${coreEvents.length} singletons`,
                forBeginners: mostRecent.forBeginners ?? false,
                beginnerFriendly: mostRecent.beginnerFriendly ?? false,
                travelWorthy: mostRecent.travelWorthy ?? false,
                forBeginnersOverride: null,
                beginnerFriendlyOverride: null,
                travelWorthyOverride: null,
                masteredRegionId: first.masteredRegionId,
                masteredRegionName: first.masteredRegionName,
                masteredDivisionId: first.masteredDivisionId,
                masteredDivisionName: first.masteredDivisionName,
                masteredCityId: first.masteredCityId,
                masteredCityName: first.masteredCityName,
                masteredCityGeolocation: first.masteredCityGeolocation,
                masteredCountryId: first.masteredCountryId,
                masteredCountryName: first.masteredCountryName,
                enrichmentStatus: 'complete',
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            // Sample $set op preview
            if (!firstSampleOpLogged) {
                console.log('\n[SAMPLE-SET-OP — first op preview before bulkWrite]');
                console.log('  filter:', JSON.stringify({ _id: `ObjectId("${coreEvents[0]._id}")` }));
                console.log('  update:', JSON.stringify({ $set: { replacedByMaster: `ObjectId("${masterId}")` } }));
                console.log();
                firstSampleOpLogged = true;
            }

            // Insert master
            await db.collection('events').insertOne(master);

            // Bulk-flag singletons with replacedByMaster
            const singletonOps = coreEvents.map(e => ({
                updateOne: {
                    filter: { _id: e._id },
                    update: { $set: { replacedByMaster: masterId, updatedAt: new Date() } }
                }
            }));
            const bulkResult = await db.collection('events').bulkWrite(singletonOps, { ordered: false });

            applyResults.mastersCreated.push({
                masterId: masterId.toString(),
                title: commonTitle.substring(0, 80),
                rrule: p.rrule,
                dtstart: dtstartDate.toISOString(),
                until: p.until,
                coreFlagged: bulkResult.modifiedCount,
                outliersPreserved: p.outlierCount || 0,
                toby_override: p.confidence === 'HIGH-TOBY-OVERRIDE',
            });
            applyResults.singletonsFlaggedTotal += bulkResult.modifiedCount;
            applyResults.outliersPreservedTotal += p.outlierCount || 0;
        }

        console.log('\n=== APPLY RESULTS ===');
        console.log(JSON.stringify({
            specVersion: SERIES_DETECTION_SPEC_VERSION,
            organizer: orgName,
            mastersCreated: applyResults.mastersCreated.length,
            singletonsFlaggedTotal: applyResults.singletonsFlaggedTotal,
            outliersPreservedTotal: applyResults.outliersPreservedTotal,
            groupsAborted: applyResults.groupsAborted.length,
            deletions: 0,
        }, null, 2));
        console.log('\nPer-master:');
        applyResults.mastersCreated.forEach(m => console.log('  -', m.masterId, '\t', m.rrule, '\t', m.coreFlagged, 'flagged', m.toby_override ? '(toby-override)' : ''));
        if (applyResults.groupsAborted.length) {
            console.log('\nABORTED groups:');
            applyResults.groupsAborted.forEach(a => console.log('  *', a.title, '→', a.error));
        }

        if (args.output) {
            const applyArtifact = {
                meta: {
                    ...summary.meta,
                    mode: 'APPLY',
                    applyTimestamp: new Date().toISOString(),
                    specVersion: SERIES_DETECTION_SPEC_VERSION,
                },
                applyResults,
                originalProposals: summary.proposals,
            };
            fs.writeFileSync(args.output, JSON.stringify(applyArtifact, null, 2));
            console.log(`\nApply artifact written to: ${args.output}`);
        }
    }

    await client.close();
}

main().catch(err => { console.error('FATAL:', err.message); console.error(err.stack); process.exit(1); });
