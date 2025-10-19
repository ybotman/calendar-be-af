const { app } = require('@azure/functions');

// Import function modules
require('./functions/Events');
require('./functions/API_Docs');

// Import standalone function files
require('./functions/Health_Basic');
require('./functions/Health_Version');
require('./functions/Health_MongoDB');
require('./functions/Health_MongoDB_Test');
require('./functions/Health_MongoDB_Prod');
require('./functions/Metrics_Get');
require('./functions/Categories');

// MapCenter API - User location storage (combined GET/PUT)
require('./functions/MapCenter');

// Analytics Tracking - Login, Visitor, and MapCenter tracking
require('./functions/UserLoginTrack');
require('./functions/VisitorTrack');
require('./functions/MapCenterTrack');

// Venue API
require('./functions/Venues');

// Google Geo APIs - Geocoding and Timezone
require('./functions/Geo');

// Cloudflare Info - Expose Cloudflare headers to frontend
require('./functions/Cloudflare');

// Note: Role_List, Venue_Create, Venue_Delete exist locally but not in git - commit them first

module.exports = { app };