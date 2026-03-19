// src/functions/Sitemap_GetUrls.js
// Domain: Sitemap - Generate URLs for sitemap.xml (SEO)
// Called by frontend sitemap.js with 24-hour ISR cache
const { app } = require('@azure/functions');
const { MongoClient, ObjectId } = require('mongodb');
const { standardMiddleware } = require('../middleware');

// Categories to EXCLUDE from sitemap
const EXCLUDED_CATEGORIES = ['Classes', 'Other'];

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

  context.log('Sitemap_GetUrls: Request received', { appId, type, limit });

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
      const result = await getEventUrls(db, appId, limit, context);
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
 * - RRULE events return parent ID only (no expansion)
 * - isDiscovered events include both TangoTiempo URL and FB source URL
 */
async function getEventUrls(db, appId, limit, context) {
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
  const events = await eventsCollection
    .find(filter)
    .project({ _id: 1, updatedAt: 1, startDate: 1, isDiscovered: 1, source: 1 })
    .sort({ startDate: 1 })
    .limit(limit)
    .toArray();

  const total = await eventsCollection.countDocuments(filter);

  // Format URLs
  // isDiscovered events get 2 URLs: TangoTiempo page + FB source
  const urls = events.map(event => {
    const entry = {
      loc: `/event/${event._id}`,
      lastmod: (event.updatedAt || event.startDate || new Date()).toISOString()
    };

    // Add FB source URL for discovered events
    if (event.isDiscovered && event.source) {
      entry.sourceUrl = event.source;
    }

    return entry;
  });

  return { urls, total };
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
