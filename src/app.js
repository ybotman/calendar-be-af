const { app } = require('@azure/functions');

// Import function modules
require('./functions/calendar-api');
require('./functions/calendar-maintenance');
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
// Note: Role_List, Venue_Create, Venue_Delete not yet committed - add when ready

module.exports = { app };