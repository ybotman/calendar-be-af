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
require('./functions/Analytics_VisitorHeatmap');

// User Profile & Onboarding - TIEMPO-329 Phase 2/3
require('./functions/User_FCMToken');
require('./functions/User_OnboardingStatus');

// Venue API
require('./functions/Venues');
require('./functions/Venue_AdminAdd');
require('./functions/Venue_AgeOut_Timer');

// Organizers API
require('./functions/Organizers');

// Roles API
require('./functions/Roles');

// UserLogins API
require('./functions/UserLogins');

// Google Geo APIs - Geocoding and Timezone
require('./functions/Geo');
require('./functions/Geo_GoogleGeolocate');
require('./functions/Geo_EventDensity');

// Cloudflare Info - Expose Cloudflare headers to frontend
require('./functions/Cloudflare');

// Voice API - Optimized endpoints for TangoVoice GPT
require('./functions/VoiceEvents');
require('./functions/VoiceAsk');

// Note: Role_List, Venue_Create, Venue_Delete exist locally but not in git - commit them first

module.exports = { app };