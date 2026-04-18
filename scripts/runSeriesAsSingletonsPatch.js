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

    // Pull all non-recurring events for this org
    const events = await db.collection('events').find({
        appId: '1',
        ownerOrganizerID: orgId,
        isRepeating: { $ne: true },
    }).project({ _id: 1, title: 1, startDate: 1, categoryFirst: 1, venueID: 1 }).toArray();

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
                coreEventIds: group.uniqueMembers.map(m => m._id.toString()),
                outlierEventIds: [],
                // DTSTART / UNTIL = observed bounds (AIDI Refinement 1: never fabricate)
                dtstart: group.uniqueMembers[0].start_date_iso,
                until: group.uniqueMembers[group.uniqueMembers.length - 1].start_date_iso,
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
                    coreEventIds: sub.coreEvents.map(m => m._id.toString()),
                    outlierEventIds: sub.outlierEvents.map(m => m._id.toString()),
                    dtstart: coreSorted[0].start_date_iso,
                    until: coreSorted[coreSorted.length - 1].start_date_iso,
                    reviewReason: `Original group REVIEW (${group.cadence.reviewReason}); sub-group re-detection found core subset.`,
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
        console.error('\nAPPLY path not yet implemented (stubbed awaiting AIDI + Toby sign-off on dry-run artifact).');
        process.exit(3);
    }

    await client.close();
}

main().catch(err => { console.error('FATAL:', err.message); console.error(err.stack); process.exit(1); });
