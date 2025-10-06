# Calendar Backend - Azure Functions

A modern Azure Functions-based backend service for the Master Calendar application suite. This project will gradually replace the existing Azure server API with a serverless, scalable architecture.

## 🏗️ Architecture

This project follows Azure Functions v4 best practices with a modular structure:

- **HTTP Triggers**: RESTful API endpoints for calendar and event management
- **Timer Triggers**: Scheduled maintenance tasks
- **Service Bus Triggers**: Asynchronous event processing
- **Cosmos DB**: Primary data storage
- **Application Insights**: Monitoring and telemetry

## 📁 Project Structure

```
src/
├── app.js                          # Main application entry point
├── functions/
│   ├── calendar-api.js            # Calendar CRUD operations
│   ├── calendar-events.js         # Event management endpoints
│   └── calendar-maintenance.js    # Scheduled tasks and async processing
└── utils/
    ├── validation.js              # Input validation and response helpers
    └── database.js                # Database connection utilities
```

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ 
- Azure Functions Core Tools v4
- Azure CLI (optional, for deployment)

### Installation

1. Install dependencies:
```bash
npm install
```

2. Configure local settings:
```bash
cp local.settings.json.example local.settings.json
# Edit local.settings.json with your connection strings
```

3. Start the development server:
```bash
npm run dev
```

The API will be available at `http://localhost:7071`

### Available Endpoints

#### Health Check
- `GET /api/health` - Service health status

#### Calendar Management
- `GET /api/calendars` - List all calendars
- `POST /api/calendars` - Create a new calendar
- `GET /api/calendars/{id}` - Get calendar by ID
- `PUT /api/calendars/{id}` - Update calendar
- `DELETE /api/calendars/{id}` - Delete calendar

#### Event Management
- `GET /api/calendars/{calendarId}/events` - List events for a calendar
- `POST /api/calendars/{calendarId}/events` - Create a new event
- `GET /api/calendars/{calendarId}/events/{eventId}` - Get event by ID
- `PUT /api/calendars/{calendarId}/events/{eventId}` - Update event
- `DELETE /api/calendars/{calendarId}/events/{eventId}` - Delete event

#### Admin/Maintenance
- `POST /api/admin/maintenance` - Trigger manual maintenance tasks

## 🧪 Testing

Run the test suite:
```bash
npm test
```

Run tests in watch mode:
```bash
npm run test:watch
```

## 📋 Configuration

### Environment Variables

Configure these in `local.settings.json` for local development:

- `CALENDAR_DB_CONNECTION_STRING` - Cosmos DB connection string
- `SERVICE_BUS_CONNECTION_STRING` - Service Bus connection string
- `APPLICATION_INSIGHTS_CONNECTION_STRING` - App Insights connection string

### Deployment Settings

For production deployment, configure these in your Azure Function App:

- Authentication levels (currently set to `function`)
- CORS settings
- Application settings and connection strings

## 🔄 Migration Strategy

This Azure Functions project is designed to gradually replace the existing server API:

1. **Phase 1**: Implement core calendar and event APIs
2. **Phase 2**: Add advanced features (recurring events, notifications)
3. **Phase 3**: Migrate user management and authentication
4. **Phase 4**: Deprecate and remove old server API

## 📈 Monitoring

The application includes:

- Application Insights integration for telemetry
- Structured logging with correlation IDs
- Health check endpoints for monitoring
- Performance tracking for database operations

## 🛠️ Development

### Adding New Functions

1. Create a new file in `src/functions/`
2. Import and register your functions in `src/app.js`
3. Follow the established patterns for validation and error handling

### Database Operations

Use the provided `CosmosDbHelper` class for consistent database operations:

```javascript
const { CosmosDbHelper } = require('../utils/database');
const dbHelper = new CosmosDbHelper(client, 'CalendarDB', 'Calendars');
```

### Validation

All input validation uses Joi schemas defined in `src/utils/validation.js`:

```javascript
const { validateCalendar } = require('../utils/validation');
const { error, value } = validateCalendar(requestData);
```

## 🚀 Deployment

Deploy to Azure using the Azure Functions Core Tools:

```bash
npm run deploy
```

Or use Azure DevOps/GitHub Actions for CI/CD pipeline deployment.

## 📚 Next Steps

- [ ] Implement database layer with Cosmos DB
- [ ] Add authentication and authorization
- [ ] Implement recurring events functionality
- [ ] Add email notifications via SendGrid/Communication Services
- [ ] Set up monitoring and alerting
- [ ] Create CI/CD pipeline
- [ ] Add integration tests
- [ ] Implement caching layer
- [ ] Add API versioning
- [ ] Document API with OpenAPI/Swagger
