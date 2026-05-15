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
require('./functions/Analytics_OrganizerActivity');
require('./functions/Analytics_LoginHistory');
require('./functions/Analytics_VisitorHistory');
require('./functions/Analytics_MapCenterHistory');
require('./functions/Analytics_EventActivity');
require('./functions/Analytics_UserLocationDistribution');
require('./functions/Analytics_SessionGeo');

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
// CALBEAF-107 — shortName endpoints
require('./functions/OrganizerShortnameCheck');
require('./functions/OrganizerShortnamesBulk');
require('./functions/OrganizerShortnamePatch');
// CALBEAF-106 — SA-gated MongoDB health endpoint (CalOps M0 Health panel)
require('./functions/Admin_MongoHealth');

// Roles API
require('./functions/Roles');

// Affiliations API (appId=2 HarmonyJunction societies)
require('./functions/Affiliations');

// UserLogins API
require('./functions/UserLogins');

// Events RA (Regional Admin) API
require('./functions/EventsRA');

// Events Instance Overrides (TIEMPO-362) - Recurring event instance modifications
require('./functions/Events_InstanceOverrides');

// Events Spotlights - Any approved organizer can add/remove spotlights on any event
require('./functions/Events_Spotlights');

// CALBEAF-110 — Bulk-enrich endpoint (Option D enrichment architecture, TEST-only)
require('./functions/Events_BulkEnrich');
// CALBEAF-110 — Tier-2 DQ periodic checker (every 30 min, TEST-only)
require('./functions/DQ_PeriodicChecker');

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

// Frontend Logging - RETIRED 2026-02-23 (never used, collection empty)
// require('./functions/FrontendLogs');

// Voice API - Optimized endpoints for TangoVoice GPT
require('./functions/VoiceEvents');
require('./functions/VoiceAsk');

// Admin API - CALOPS Dashboard endpoints (CALOPS-41/42)
require('./functions/Admin_UserActivity');
require('./functions/Admin_DataHealth');

// Backup API - Daily backups (CALBEAF-75, CALBEAF-77)
require('./functions/Backup_MongoDB');
require('./functions/Backup_Firebase');

// SEO - Sitemap URL generation + nightly content build (CALBEAF-157, CALBEAF-160)
require('./functions/Sitemap_GetUrls');
require('./functions/SEO_BuildContent');
require('./functions/SEO_GeoSummary');
require('./functions/SEO_CityPage');

// Outreach Onboarding - CALBEAF-95
require('./functions/Outreach_GenerateLink');
require('./functions/Outreach_ResolveToken');
require('./functions/Outreach_Track');
require('./functions/Outreach_Status');

module.exports = { app };