# calendar-be-af
CalendarBE with Azure Functions

## Overview
Azure Functions backend for the Calendar application, migrating from Express.js to serverless architecture.

## Available Functions

### Categories
- `GET /api/categories` - Get categories by appId (implemented)

### Health (coming soon)
- `GET /api/health` - Basic health check
- `GET /api/health/version` - Version and environment info

### Roles (coming soon)
- `GET /api/roles` - Get roles by appId

## Local Development
```bash
# Install dependencies
npm install

# Run locally
npm start

# Run tests
npm test

# Lint code
npm run lint
```

## Environment Variables
Create a `local.settings.json` from the template:
- `MONGODB_URI` - MongoDB connection string
- `MONGODB_DB_NAME` - Database name (default: TangoTiempo)
- `NODE_ENV` - Environment (development/test/production)
