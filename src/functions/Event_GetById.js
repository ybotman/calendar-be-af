// ../calendar-be-af/src/functions/Event_GetById.js
const { app } = require('@azure/functions');
const { MongoClient, ObjectId } = require('mongodb');

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || 'TangoTiempo';

/**
 * Event_GetById - GET /api/events/id/:id
 *
 * Fetches a single event by MongoDB ObjectId with full details for social sharing
 *
 * Query params:
 *   - appId: Required application identifier
 *
 * Returns:
 *   - event: Full event object with populated venue and organizer
 *   - meta: SEO/OpenGraph metadata for social sharing
 *
 * Related tickets:
 *   - CALBEAF-21: Event_GetById Azure Function
 *   - CALBE-50: Single Event API for Social Sharing
 *   - TIEMPO-256: Frontend deep linking
 */
app.http('Event_GetById', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'events/id/{id}',
  handler: async (request, context) => {
    const appId = request.query.get('appId');
    const eventId = request.params.id;

    // Validate required parameters
    if (!appId) {
      return {
        status: 400,
        jsonBody: { message: 'appId is required' },
      };
    }

    if (!eventId) {
      return {
        status: 400,
        jsonBody: { message: 'Event ID is required' },
      };
    }

    // Validate MongoDB ObjectId format
    if (!ObjectId.isValid(eventId)) {
      return {
        status: 400,
        jsonBody: { message: 'Invalid event ID format' },
      };
    }

    let client;
    try {
      client = new MongoClient(uri);
      await client.connect();
      const db = client.db(dbName);

      // Fetch event with aggregation to populate venue and organizer
      const events = db.collection('events');
      const pipeline = [
        {
          $match: {
            _id: new ObjectId(eventId),
            appId: appId,
          },
        },
        {
          $lookup: {
            from: 'venues',
            localField: 'venueID',
            foreignField: '_id',
            as: 'venue',
          },
        },
        {
          $lookup: {
            from: 'organizers',
            localField: 'ownerOrganizerID',
            foreignField: '_id',
            as: 'organizer',
          },
        },
        {
          $addFields: {
            venue: { $arrayElemAt: ['$venue', 0] },
            organizer: { $arrayElemAt: ['$organizer', 0] },
          },
        },
      ];

      const result = await events.aggregate(pipeline).toArray();

      if (result.length === 0) {
        return {
          status: 404,
          jsonBody: { message: 'Event not found' },
        };
      }

      const event = result[0];

      // Generate SEO metadata for social sharing
      const meta = {
        title: event.title || 'Event',
        description: generateDescription(event),
        image: event.featuredImage || event.eventImage || event.bannerImage || '',
        canonical: `https://tangotiempo.com/event/${eventId}`,
        ogType: 'event',
        ogSiteName: 'TangoTiempo',
      };

      // Return event with metadata
      return {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300', // Cache for 5 minutes
          'ETag': `"${eventId}-${event.updatedAt || event.startDate}"`,
        },
        jsonBody: {
          event,
          meta,
        },
      };
    } catch (err) {
      context.log.error('MongoDB error:', err.message);
      return {
        status: 500,
        jsonBody: {
          message: 'Internal server error',
          error: err.message,
        },
      };
    } finally {
      if (client) {
        await client.close();
      }
    }
  },
});

/**
 * Generate SEO-friendly description from event details
 */
function generateDescription(event) {
  const parts = [];

  // Add date
  if (event.startDate) {
    const date = new Date(event.startDate);
    const dateStr = date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    parts.push(dateStr);
  }

  // Add time
  if (event.startDate && !event.isAllDay) {
    const time = new Date(event.startDate);
    const timeStr = time.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
    parts.push(timeStr);
  }

  // Add venue name and city
  if (event.venue && event.venue.name) {
    parts.push(`at ${event.venue.name}`);
  }
  if (event.venueCityName) {
    parts.push(event.venueCityName);
  } else if (event.masteredCityName) {
    parts.push(event.masteredCityName);
  }

  // Add organizer
  if (event.ownerOrganizerName || (event.organizer && event.organizer.name)) {
    const organizerName = event.ownerOrganizerName || event.organizer.name;
    parts.push(`by ${organizerName}`);
  }

  // Add description snippet if available
  if (event.description) {
    const snippet = event.description.substring(0, 100);
    parts.push(snippet + (event.description.length > 100 ? '...' : ''));
  }

  return parts.join('. ');
}
