// ../calendar-be-af/src/functions/Category_Get.js
const { app } = require('@azure/functions');
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || 'TangoTiempo';

app.http('Category_Get', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const appId = request.query.get('appId');
    const select = request.query.get('select');

    if (!appId) {
      return {
        status: 400,
        jsonBody: { message: 'appId is required' },
      };
    }

    try {
      const client = new MongoClient(uri);
      await client.connect();
      const db = client.db(dbName);
      const collection = db.collection('categories');

      const projection = {};
      if (select) {
        select.split(',').forEach(field => {
          projection[field.trim()] = 1;
        });
      }

      const categories = await collection
        .find({ appId })
        .project(projection)
        .sort({ name: 1 })
        .toArray();

      return {
        status: 200,
        jsonBody: { categories },
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
    }
  },
});