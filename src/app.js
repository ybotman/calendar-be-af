const { app } = require('@azure/functions');

// Import function modules
require('./functions/calendar-api');
require('./functions/calendar-maintenance');
require('./functions/calendar-events');
require('./functions/API_Docs');

// Import standalone function files
require('./functions/Health_Basic');
require('./functions/Metrics_Get');
require('./functions/Category_Get');
require('./functions/Role_List');

// Note: Health endpoint is in Health_Basic.js, not duplicated here

module.exports = { app };