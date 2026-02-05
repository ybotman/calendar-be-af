// Application Insights must initialize before all other imports
const appInsights = require('applicationinsights');
if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
    appInsights.setup(process.env.APPLICATIONINSIGHTS_CONNECTION_STRING)
        .setAutoCollectRequests(true)
        .setAutoCollectPerformance(true, true)
        .setAutoCollectExceptions(true)
        .setAutoCollectDependencies(true)
        .setAutoCollectConsole(true, true)
        .setUseDiskRetryCaching(true)
        .start();
}

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
require('./functions/Health_EventCheck');
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
require('./functions/VenuesGeocode');
require('./functions/Venue_AdminAdd');
require('./functions/Venue_AgeOut_Timer');

// Organizers API
require('./functions/Organizers');
require('./functions/OrganizersSASToken');

// Roles API
require('./functions/Roles');

// UserLogins API
require('./functions/UserLogins');

// Events RA (Regional Admin) API
require('./functions/EventsRA');

// Events Summary + Image Upload
require('./functions/EventsSummary');
require('./functions/EventsImageUpload');

// Google Geo APIs - Geocoding and Timezone
require('./functions/Geo');
require('./functions/Geo_GoogleGeolocate');
require('./functions/Geo_EventDensity');

// Cloudflare Info - Expose Cloudflare headers to frontend
require('./functions/Cloudflare');

// Mastered Locations & Regions API
require('./functions/MasteredLocations');

// Frontend Logging
require('./functions/FrontendLogs');

// Voice API - Optimized endpoints for TangoVoice GPT
require('./functions/VoiceEvents');
require('./functions/VoiceAsk');

module.exports = { app };