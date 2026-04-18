#!/usr/bin/env node
// scripts/runSeriesAsSingletonsPatch.js
// CALBEAF-112 / SAS-FTPNTD Phase 2: Series-as-Singletons 1x patch tool.
//
// Per-organizer: detects non-recurring same-title events that form a weekly
// cadence, proposes a recurring master with inferred RRULE, flags outliers
// and ambiguous cases as REVIEW (never-invent-RRULE rule), and optionally
// applies the conversion.
//
// --dry-run: default. Reports proposed masters + flagged REVIEW cases. No writes.
// --apply: write changes (requires Toby per-org reauth).
//
// PROD STAY-OUT guard: refuses PROD URI unless --i-know-prod (never granted
// for this initiative per Toby 2026-04-18 hard rail).
//
// Current status: scaffold. Inline cadence detection. Once Harvey extracts
// ai-discovered/packages/series-detection/, this tool will switch to:
//   const { detectPotentialSeries } = require('series-detection');
// via `file:../../ai-discovered/packages/series-detection` npm install per Quinn
// 2026-04-18 arbitration.
//
// Usage:
//   node scripts/runSeriesAsSingletonsPatch.js --org=UT --dry-run
//   node scripts/runSeriesAsSingletonsPatch.js --org-id=680d9a06e0cc7a532a560556 --dry-run
//   node scripts/runSeriesAsSingletonsPatch.js --org-id=<id> --apply       # requires Toby reauth

const { MongoClient, ObjectId } = require('mongodb');
const fs = require('fs');

// TODO(harvey-extraction): replace inline inference with:
// const { detectPotentialSeries, SERIES_DETECTION_SPEC_VERSION } = require('series-detection');
const SERIES_DETECTION_SPEC_VERSION = 'fulton-inline-0.1';

function parseArgs() {
    const args = { dryRun: true, knowProd: false, org: null, orgId: null, output: null, minCount: 3 };
    for (const a of process.argv.slice(2)) {
        if (a === '--apply') args.dryRun = false;
        else if (a === '--dry-run') args.dryRun = true;
        else if (a === '--i-know-prod') args.knowProd = true;
        else if (a.startsWith('--org=')) args.org = a.split('=')[1];
        else if (a.startsWith('--org-id=')) args.orgId = a.split('=')[1];
        else if (a.startsWith('--min-count=')) args.minCount = parseInt(a.split('=')[1], 10);
        else if (a.startsWith('--output=')) args.output = a.split('=')[1];
    }
    return args;
}

function loadUri() {
    const uri = process.env.MONGODB_URI_TEST
        || (() => { try { return require('../local.settings.json').Values.MONGODB_URI_TEST; } catch { return null; } })();
    if (!uri) { console.error('ERROR: MONGODB_URI_TEST not configured'); process.exit(1); }
    return uri;
}

const WEEKDAY_NAMES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// Inline series-detection — UT-safe heuristic.
// - groupingKey: (ownerOrganizerID, title)
// - require count >= minCount
// - compute weekday distribution, time distribution, gap stats
// - CLEAN if: single dominant weekday (>=80% of events) OR multiple weekdays but consistent pattern; consistent time (>=80%); gap variance small
// - REVIEW if: multiple weekdays without clear pattern, or time variance high, or outliers
// - NO-OP if: span < 7 days (not a recurring series)
function inferSeries(events) {
    if (events.length < 2) return { action: 'NO-OP', reason: 'insufficient count' };

    const dates = events.map(e => new Date(e.startDate)).sort((a, b) => a - b);
    const spanDays = (dates[dates.length - 1] - dates[0]) / 86400000;
    if (spanDays < 7) {
        return { action: 'NO-OP', reason: `span ${spanDays.toFixed(1)}d < 7d — workshop/weekend, not series` };
    }

    // Weekday distribution
    const wdCount = {};
    dates.forEach(d => { const w = d.getUTCDay(); wdCount[w] = (wdCount[w] || 0) + 1; });
    const wdEntries = Object.entries(wdCount).map(([w, c]) => ({ w: parseInt(w, 10), c })).sort((a, b) => b.c - a.c);
    const dominantWds = wdEntries.filter(e => e.c / dates.length >= 0.2);  // weekdays with ≥20% of events
    const dominantWdPct = dominantWds.reduce((s, e) => s + e.c, 0) / dates.length;

    // Time distribution (UTC HH:MM)
    const timeCount = {};
    dates.forEach(d => { const t = d.getUTCHours() + ':' + String(d.getUTCMinutes()).padStart(2, '0'); timeCount[t] = (timeCount[t] || 0) + 1; });
    const dominantTime = Object.entries(timeCount).sort((a, b) => b[1] - a[1])[0];
    const dominantTimePct = dominantTime[1] / dates.length;

    // Gap stats
    const gaps = [];
    for (let i = 1; i < dates.length; i++) gaps.push((dates[i] - dates[i - 1]) / 86400000);
    const medianGap = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)];

    // CLEAN criteria: dominant weekday set accounts for >=80% of events, dominant time >=80%
    if (dominantWdPct >= 0.8 && dominantTimePct >= 0.8) {
        const byday = dominantWds.map(e => WEEKDAY_NAMES[e.w]).join(',');
        const [hh, mm] = dominantTime[0].split(':');
        const dtstart = new Date(dates[0]);
        dtstart.setUTCHours(parseInt(hh, 10), parseInt(mm, 10), 0, 0);
        const until = new Date(dates[dates.length - 1]);
        until.setUTCHours(parseInt(hh, 10), parseInt(mm, 10), 0, 0);
        const rrule = `FREQ=WEEKLY;BYDAY=${byday}`;

        // AIDI Refinement 2 (2026-04-18): principled core-vs-outlier partition.
        // When CONVERT fires but some events don't match the inferred pattern
        // (different weekday OR different time), separate them so the master
        // covers ONLY pattern-matching events; outliers stay as singletons.
        const dominantWdSet = new Set(dominantWds.map(e => e.w));
        const coreEvents = [];
        const outlierEvents = [];
        for (const ev of events) {
            const d = new Date(ev.startDate);
            const wd = d.getUTCDay();
            const time = d.getUTCHours() + ':' + String(d.getUTCMinutes()).padStart(2, '0');
            if (dominantWdSet.has(wd) && time === dominantTime[0]) {
                coreEvents.push(ev);
            } else {
                outlierEvents.push(ev);
            }
        }

        return {
            action: outlierEvents.length > 0 ? 'CONVERT_PARTIAL' : 'CONVERT',
            confidence: 'HIGH',
            rrule,
            dtstart: dtstart.toISOString(),
            until: until.toISOString(),
            byday,
            time: dominantTime[0],
            eventCount: events.length,
            coreEventCount: coreEvents.length,
            outlierEventCount: outlierEvents.length,
            coreEventIds: coreEvents.map(e => e._id.toString()),
            outlierEventIds: outlierEvents.map(e => e._id.toString()),
            spanDays: Math.round(spanDays),
            medianGap: Math.round(medianGap),
        };
    }

    // REVIEW: mixed weekdays or times but majority pattern visible
    if (dominantWdPct >= 0.6 && dominantTimePct >= 0.6) {
        return {
            action: 'REVIEW',
            reason: `majority pattern visible (wd=${(dominantWdPct * 100).toFixed(0)}%, time=${(dominantTimePct * 100).toFixed(0)}%) but outliers present. Human review required — do not auto-convert.`,
            wdDistribution: wdCount,
            timeDistribution: timeCount,
            dominantWd: dominantWds.map(e => WEEKDAY_NAMES[e.w] + ':' + e.c).join(','),
            dominantTime: dominantTime[0] + ':' + dominantTime[1],
            spanDays: Math.round(spanDays),
        };
    }

    return {
        action: 'NO-OP',
        reason: `no clear cadence (wd=${(dominantWdPct * 100).toFixed(0)}%, time=${(dominantTimePct * 100).toFixed(0)}%)`,
    };
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

    console.log('=== SAS-FTPNTD Phase 2 Patch Tool ===');
    console.log('Spec version:', SERIES_DETECTION_SPEC_VERSION);
    console.log('Mode:', args.dryRun ? 'DRY-RUN' : 'APPLY (requires Toby reauth)');
    console.log('Min count for series candidate:', args.minCount);
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

    // Find candidate series
    const groups = await db.collection('events').aggregate([
        { $match: { appId: '1', ownerOrganizerID: orgId, isRepeating: { $ne: true } } },
        { $group: {
            _id: '$title',
            count: { $sum: 1 },
            events: { $push: { _id: '$_id', startDate: '$startDate', categoryFirst: '$categoryFirst', venueID: '$venueID' } }
        } },
        { $match: { count: { $gte: args.minCount } } },
        { $sort: { count: -1 } }
    ]).toArray();

    console.log(`Found ${groups.length} title-groups with count >= ${args.minCount}\n`);

    const proposals = [];
    for (const g of groups) {
        const inference = inferSeries(g.events);
        proposals.push({ title: g._id, count: g.count, inference, events: g.events });

        console.log('--- "' + (g._id || '').substring(0, 70) + '" ---');
        console.log('  count:', g.count, ' action:', inference.action, inference.confidence ? `(${inference.confidence})` : '');
        if (inference.action === 'CONVERT' || inference.action === 'CONVERT_PARTIAL') {
            console.log('  RRULE:', inference.rrule);
            console.log('  DTSTART:', inference.dtstart, ' UNTIL:', inference.until);
            if (inference.action === 'CONVERT_PARTIAL') {
                console.log('  core (included in master):', inference.coreEventCount, ' outliers (stay singletons):', inference.outlierEventCount);
            }
        } else {
            console.log('  reason:', inference.reason);
        }
        console.log();
    }

    // Summary
    const summary = {
        meta: {
            mode: args.dryRun ? 'DRY-RUN' : 'APPLY',
            specVersion: SERIES_DETECTION_SPEC_VERSION,
            organizer: orgName,
            orgId: orgId.toString(),
            timestamp: new Date().toISOString(),
        },
        counts: {
            groupsFound: groups.length,
            convertHigh: proposals.filter(p => p.inference.action === 'CONVERT' && p.inference.confidence === 'HIGH').length,
            convertPartial: proposals.filter(p => p.inference.action === 'CONVERT_PARTIAL').length,
            review: proposals.filter(p => p.inference.action === 'REVIEW').length,
            noOp: proposals.filter(p => p.inference.action === 'NO-OP').length,
            eventsToConvert: proposals.filter(p => p.inference.action === 'CONVERT' || p.inference.action === 'CONVERT_PARTIAL').reduce((s, p) => s + (p.inference.coreEventCount || p.count), 0),
            outlierSingletons: proposals.filter(p => p.inference.action === 'CONVERT_PARTIAL').reduce((s, p) => s + (p.inference.outlierEventCount || 0), 0),
            eventsInReview: proposals.filter(p => p.inference.action === 'REVIEW').reduce((s, p) => s + p.count, 0),
            eventsLeftAsSingles: proposals.filter(p => p.inference.action === 'NO-OP').reduce((s, p) => s + p.count, 0),
        },
        proposals: proposals.map(p => ({
            title: p.title,
            count: p.count,
            inference: p.inference,
            eventIds: p.events.map(e => e._id.toString()),
        })),
    };

    console.log('=== SUMMARY ===');
    console.log(JSON.stringify(summary.counts, null, 2));

    if (args.output) {
        fs.writeFileSync(args.output, JSON.stringify(summary, null, 2));
        console.log(`\nFull proposal written to: ${args.output}`);
    }

    if (args.dryRun) {
        console.log('\nDRY-RUN — no writes. Re-run with --apply after Toby reauth.');
    } else {
        // --apply path: implementation intentionally stubbed until AIDI approves the conversion + Toby reauths.
        console.error('\nAPPLY path not yet implemented (awaiting AIDI+Toby governance sign-off on proposal structure).');
        process.exit(3);
    }

    await client.close();
}

main().catch(err => { console.error('FATAL:', err.message); console.error(err.stack); process.exit(1); });
