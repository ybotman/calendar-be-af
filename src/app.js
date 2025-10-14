const { app } = require('@azure/functions');

// Import function modules
require('./functions/calendar-events');
require('./functions/API_Docs');

// Import standalone function files
require('./functions/Health_Basic');
require('./functions/Health_Version');
require('./functions/Health_MongoDB');
require('./functions/Health_MongoDB_Test');
require('./functions/Health_MongoDB_Prod');
require('./functions/Metrics_Get');
require('./functions/Category_Get');
require('./functions/Event_GetById');

// MapCenter API - User location storage (combined GET/PUT)
require('./functions/MapCenter');

// Venue API
require('./functions/Venue_Get');

// Note: Role_List, Venue_Create, Venue_Delete exist locally but not in git - commit them first

module.exports = { app };