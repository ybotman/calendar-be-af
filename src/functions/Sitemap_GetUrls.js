// src/functions/Sitemap_GetUrls.js
// Domain: Sitemap - Generate URLs for sitemap.xml (SEO)
// Called by frontend sitemap.js with 24-hour ISR cache
//
// CALBEAF-158: Added RRULE expansion (?view=expanded) for recurring events.
// Default ?view=parent preserves existing FE behavior. SEO content build
// (CALBEAF-157) uses view=expanded to get per-occurrence URLs 6 weeks forward.
const { app } = require('@azure/functions');
const { MongoClient, ObjectId } = require('mongodb');
const { rrulestr } = require('rrule');
const { standardMiddleware } = require('../middleware');

// Categories to EXCLUDE from sitemap
const EXCLUDED_CATEGORIES = ['Classes', 'Other'];

// CALBEAF-158: RRULE expansion horizon (6 weeks forward from now)
const RRULE_EXPANSION_WEEKS = 6;
const RRULE_EXPANSION_MS = RRULE_EXPANSION_WEEKS * 7 * 24 * 60 * 60 * 1000;

/**
 * GET /api/sitemap/urls
 * Generate URLs for dynamic sitemap generation (SEO)
 *
 * Query Parameters:
 * - appId (required): 1 for TangoTiempo, 2 for HarmonyJunction
 * - type (required): "events" | "venues" | "organizers"
 * - limit (optional): default 5000
 *
 * Response:
 * {
 *   urls: [{ loc: "/event/123", lastmod: "2026-03-01T12:00:00Z" }, ...],
 *   total: 5432
 * }
 *
 * Filters applied:
 * - Events: active, non-expired (startDate > now - 1 day), excludes Classes/Other categories
 * - Venues: active, not archived, has at least 1 future event
 * - Organizers: active, enabled, wantRender=true
 *
 * Note: RRULE recurring events return parent event ID only (no expansion)
 */
async function sitemapGetUrlsHandler(request, context) {
  const appId = request.query.get('appId');
  const type = request.query.get('type');
  const limit = parseInt(request.query.get('limit')) || 5000;
  // CALBEAF-158: view=expanded expands recurring events into per-occurrence URLs
  // (6 weeks forward); view=parent (default) preserves existing parent-only behavior.
  const view = request.query.get('view') || 'parent';

  context.log('Sitemap_GetUrls: Request received', { appId, type, limit, view });

  // Validate required parameters
  if (!appId) {
    return {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'appId is required' })
    };
  }

  if (!type || !['events', 'venues', 'organizers'].includes(type)) {
    return {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'type is required (events, venues, or organizers)' })
    };
  }

  let mongoClient;

  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MongoDB connection string not configured');
    }

    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    const db = mongoClient.db();

    let urls = [];
    let total = 0;

    if (type === 'events') {
      const result = await getEventUrls(db, appId, limit, context, view);
      urls = result.urls;
      total = result.total;
    } else if (type === 'venues') {
      const result = await getVenueUrls(db, appId, limit, context);
      urls = result.urls;
      total = result.total;
    } else if (type === 'organizers') {
      const result = await getOrganizerUrls(db, appId, limit, context);
      urls = result.urls;
      total = result.total;
    }

    context.log(`Sitemap_GetUrls: Returning ${urls.length} ${type} URLs (total: ${total})`);

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls, total })
    };

  } finally {
    if (mongoClient) {
      await mongoClient.close();
    }
  }
}

/**
 * Get event URLs for sitemap
 * - Active events only
 * - startDate > now - 1 day (not expired)
 * - Excludes Classes and Other categories
 * - view=parent (default): RRULE events return parent ID only
 * - view=expanded (CALBEAF-158): RRULE events expanded to per-occurrence URLs
 *   (6 weeks forward, honors excludedDates + canceled instanceOverrides)
 * - isDiscovered events include both TangoTiempo URL and FB source URL
 */
async function getEventUrls(db, appId, limit, context, view = 'parent') {
  const eventsCollection = db.collection('events');
  const categoriesCollection = db.collection('categories');

  // Get category IDs to exclude
  const excludedCategories = await categoriesCollection.find({
    appId,
    categoryName: { $in: EXCLUDED_CATEGORIES }
  }).toArray();

  const excludedCategoryIds = excludedCategories.map(c => c._id);
  context.log(`Sitemap: Excluding ${excludedCategoryIds.length} category IDs (${EXCLUDED_CATEGORIES.join(', ')})`);

  // Date filter: events not expired (startDate > yesterday)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  // Build filter
  const filter = {
    appId,
    isActive: true,
    startDate: { $gte: yesterday }
  };

  // Exclude events in Classes/Other categories
  // Check all 3 category fields
  if (excludedCategoryIds.length > 0) {
    filter.$and = [
      { $or: [
        { categoryFirstId: { $exists: false } },
        { categoryFirstId: null },
        { categoryFirstId: { $nin: excludedCategoryIds } }
      ]},
      { $or: [
        { categorySecondId: { $exists: false } },
        { categorySecondId: null },
        { categorySecondId: { $nin: excludedCategoryIds } }
      ]},
      { $or: [
        { categoryThirdId: { $exists: false } },
        { categoryThirdId: null },
        { categoryThirdId: { $nin: excludedCategoryIds } }
      ]}
    ];
  }

  // Query events - include source field for discovered events
  // CALBEAF-158: also project recurrence fields for view=expanded
  const events = await eventsCollection
    .find(filter)
    .project({
      _id: 1, updatedAt: 1, startDate: 1, endDate: 1,
      isDiscovered: 1, source: 1,
      isRepeating: 1, recurrenceRule: 1,
      excludedDates: 1, instanceOverrides: 1
    })
    .sort({ startDate: 1 })
    .limit(limit)
    .toArray();

  const total = await eventsCollection.countDocuments(filter);

  // Format URLs
  // isDiscovered events get 2 URLs: TangoTiempo page + FB source
  const urls = [];
  const expansionUntil = new Date(Date.now() + RRULE_EXPANSION_MS);

  for (const event of events) {
    const lastmod = (event.updatedAt || event.startDate || new Date()).toISOString();
    const sourceUrl = (event.isDiscovered && event.source) ? event.source : undefined;

    if (view === 'expanded' && event.isRepeating && event.recurrenceRule) {
      // CALBEAF-158: expand RRULE 6 weeks forward, honor excludedDates +
      // canceled instanceOverrides. On parse error, fall back to parent URL.
      const occurrences = expandRruleOccurrences(event, expansionUntil, context);
      if (occurrences.length === 0) {
        // No future occurrences (or parse failure) — emit parent URL as fallback
        const entry = { loc: `/event/${event._id}`, lastmod };
        if (sourceUrl) entry.sourceUrl = sourceUrl;
        urls.push(entry);
      } else {
        for (const date of occurrences) {
          const isoDate = date.toISOString().slice(0, 10);
          const entry = { loc: `/event/${event._id}/${isoDate}`, lastmod };
          if (sourceUrl) entry.sourceUrl = sourceUrl;
          urls.push(entry);
        }
      }
    } else {
      // view=parent OR non-recurring event — single URL
      const entry = { loc: `/event/${event._id}`, lastmod };
      if (sourceUrl) entry.sourceUrl = sourceUrl;
      urls.push(entry);
    }
  }

  return { urls, total };
}

/**
 * CALBEAF-158: Expand a recurring event's RRULE into per-occurrence Date objects
 * within [now, expansionUntil]. Honors event.excludedDates and canceled
 * instanceOverrides. Returns [] on parse error or if event has no recurrenceRule.
 */
function expandRruleOccurrences(event, expansionUntil, context) {
  try {
    if (!event.recurrenceRule) return [];

    const dtstart = event.startDate instanceof Date ? event.startDate : new Date(event.startDate);
    if (isNaN(dtstart.getTime())) return [];

    // Build a complete RRULE string with DTSTART for parsing
    const dtstartStr = dtstart.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const ruleStr = event.recurrenceRule.startsWith('RRULE:')
      ? event.recurrenceRule
      : `RRULE:${event.recurrenceRule}`;
    const fullRule = `DTSTART:${dtstartStr}\n${ruleStr}`;

    const rule = rrulestr(fullRule);
    const now = new Date();
    let occurrences = rule.between(now, expansionUntil, true);

    // Filter out excludedDates (per-occurrence cancellations stored as ISO strings)
    if (Array.isArray(event.excludedDates) && event.excludedDates.length > 0) {
      const excludedSet = new Set(
        event.excludedDates.map(d => {
          const dt = d instanceof Date ? d : new Date(d);
          return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
        }).filter(Boolean)
      );
      occurrences = occurrences.filter(d => !excludedSet.has(d.toISOString().slice(0, 10)));
    }

    // Filter out canceled instanceOverrides (LOADER-CONTRACT §10.2 + spotlights canceled type)
    if (Array.isArray(event.instanceOverrides) && event.instanceOverrides.length > 0) {
      const canceledSet = new Set(
        event.instanceOverrides
          .filter(o => o && (o.canceled === true || o.isCanceled === true ||
                  (Array.isArray(o.spotlights) && o.spotlights.some(s => s?.type === 'canceled'))))
          .map(o => {
            const dt = o.date instanceof Date ? o.date : new Date(o.date || o.instanceKey);
            return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
          })
          .filter(Boolean)
      );
      occurrences = occurrences.filter(d => !canceledSet.has(d.toISOString().slice(0, 10)));
    }

    return occurrences;
  } catch (err) {
    if (context?.log) {
      context.log(`Sitemap RRULE expansion error for event ${event._id}: ${err.message}`);
    }
    return [];
  }
}

/**
 * Get venue URLs for sitemap
 * - Active venues only
 * - Not archived
 * - Has at least 1 future event
 */
async function getVenueUrls(db, appId, limit, context) {
  const venuesCollection = db.collection('venues');
  const eventsCollection = db.collection('events');

  // Date filter for future events
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  // Get venue IDs that have future events
  const venueIdsWithEvents = await eventsCollection.distinct('venueID', {
    appId,
    isActive: true,
    startDate: { $gte: yesterday }
  });

  context.log(`Sitemap: Found ${venueIdsWithEvents.length} venues with future events`);

  // Filter venues
  const filter = {
    appId,
    isActive: true,
    isArchived: { $ne: true },
    _id: { $in: venueIdsWithEvents }
  };

  const venues = await venuesCollection
    .find(filter)
    .project({ _id: 1, updatedAt: 1, createdAt: 1 })
    .sort({ venueName: 1 })
    .limit(limit)
    .toArray();

  const total = await venuesCollection.countDocuments(filter);

  // Format URLs
  const urls = venues.map(venue => ({
    loc: `/venue/${venue._id}`,
    lastmod: (venue.updatedAt || venue.createdAt || new Date()).toISOString()
  }));

  return { urls, total };
}

/**
 * Get organizer URLs for sitemap
 * - Active organizers only
 * - Enabled
 * - wantRender = true
 */
async function getOrganizerUrls(db, appId, limit, context) {
  const organizersCollection = db.collection('organizers');

  const filter = {
    appId,
    isActive: true,
    isEnabled: true,
    wantRender: true
  };

  const organizers = await organizersCollection
    .find(filter)
    .project({ _id: 1, updatedAt: 1, createdAt: 1 })
    .sort({ fullName: 1 })
    .limit(limit)
    .toArray();

  const total = await organizersCollection.countDocuments(filter);

  // Format URLs
  const urls = organizers.map(org => ({
    loc: `/organizer/${org._id}`,
    lastmod: (org.updatedAt || org.createdAt || new Date()).toISOString()
  }));

  return { urls, total };
}

// Register function
app.http('Sitemap_GetUrls', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'sitemap/urls',
  handler: standardMiddleware(sitemapGetUrlsHandler)
});

module.exports = { sitemapGetUrlsHandler };
