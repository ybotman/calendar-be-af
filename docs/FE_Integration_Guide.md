# Frontend Integration Guide - Azure Functions Status Dashboard

**For:** Calops Frontend LLM
**Purpose:** Add Azure Functions health monitoring to status dashboard
**Created:** 2025-10-06

---

## Overview

Add red/green status lights to the calops dashboard (`/dashboard`) to monitor:
- ✅ **Azure Functions Health** (new)
- ✅ **Express Backend Health** (existing)
- ⬜ Events Service (future)
- ⬜ Venues Service (future)

---

## Azure Functions Health Endpoint

### Local Development

**Endpoint:** `http://localhost:7071/api/health`
**Method:** `GET`
**Auth:** None (anonymous)

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-10-06T20:30:45.123Z",
  "service": "calendar-backend-functions"
}
```

**Status Codes:**
- `200` = 🟢 Healthy
- `500` = 🔴 Unhealthy
- Timeout/No Response = 🔴 Down

### Production (Azure TEST Environment)

**Endpoint:** `https://calendarbe-test-bpg5caaqg5chbndu.eastus-01.azurewebsites.net/api/health`
**Method:** `GET`
**Auth:** None (anonymous)

**Same response format as local**

### Production (Azure PROD Environment)

**Endpoint:** `https://calendarbe-prod-<hash>.azurewebsites.net/api/health`
**Method:** `GET`
**Auth:** None (anonymous)

---

## Implementation Guide for Frontend

### Step 1: Create API Client Module

**File:** `calops/src/lib/api-client/health.js`

```javascript
import axios from 'axios';

const AZURE_FUNCTIONS_URL = process.env.NEXT_PUBLIC_AF_URL || 'http://localhost:7071';
const EXPRESS_URL = process.env.NEXT_PUBLIC_BE_URL || 'http://localhost:3010';

export default {
  /**
   * Check Azure Functions health
   */
  async checkAzureFunctions() {
    try {
      const response = await axios.get(`${AZURE_FUNCTIONS_URL}/api/health`, {
        timeout: 5000
      });
      return {
        status: 'healthy',
        available: true,
        timestamp: response.data.timestamp,
        service: response.data.service
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        available: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  },

  /**
   * Check Express backend health
   */
  async checkExpress() {
    try {
      const response = await axios.get(`${EXPRESS_URL}/api/health`, {
        timeout: 5000
      });
      return {
        status: 'healthy',
        available: true,
        timestamp: response.data.timestamp,
        service: 'Express Backend'
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        available: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  },

  /**
   * Check all services
   */
  async checkAll() {
    const [azureFunctions, express] = await Promise.allSettled([
      this.checkAzureFunctions(),
      this.checkExpress()
    ]);

    return {
      azureFunctions: azureFunctions.status === 'fulfilled'
        ? azureFunctions.value
        : { status: 'error', available: false },
      express: express.status === 'fulfilled'
        ? express.value
        : { status: 'error', available: false },
      timestamp: new Date().toISOString()
    };
  }
};
```

### Step 2: Add Environment Variables

**File:** `calops/.env.local`

```bash
# Express Backend (current production)
NEXT_PUBLIC_BE_URL=http://localhost:3010

# Azure Functions (migration target)
NEXT_PUBLIC_AF_URL=http://localhost:7071

# Calops admin app port
PORT=3003
```

**File:** `calops/.env.production`

```bash
# Express Backend
NEXT_PUBLIC_BE_URL=https://calendar-be-prod.example.com

# Azure Functions
NEXT_PUBLIC_AF_URL=https://calendarbe-prod-<hash>.azurewebsites.net
```

**File:** `calops/.env.test`

```bash
# Express Backend
NEXT_PUBLIC_BE_URL=https://calendar-be-test.example.com

# Azure Functions
NEXT_PUBLIC_AF_URL=https://calendarbe-test-bpg5caaqg5chbndu.eastus-01.azurewebsites.net
```

### Step 3: Create Status Dashboard Component

**File:** `calops/src/components/dashboard/ServiceStatus.js`

```javascript
'use client';

import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  Grid,
  Chip,
  CircularProgress
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import healthApi from '@/lib/api-client/health';

export default function ServiceStatus() {
  const [status, setStatus] = useState({
    azureFunctions: { status: 'loading', available: null },
    express: { status: 'loading', available: null }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkServices();
    // Refresh every 30 seconds
    const interval = setInterval(checkServices, 30000);
    return () => clearInterval(interval);
  }, []);

  async function checkServices() {
    setLoading(true);
    const results = await healthApi.checkAll();
    setStatus(results);
    setLoading(false);
  }

  const getStatusIcon = (service) => {
    if (service.status === 'loading') {
      return <CircularProgress size={20} />;
    }
    return service.available
      ? <CheckCircleIcon sx={{ color: 'success.main' }} />
      : <ErrorIcon sx={{ color: 'error.main' }} />;
  };

  const getStatusColor = (service) => {
    if (service.status === 'loading') return 'default';
    return service.available ? 'success' : 'error';
  };

  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Typography variant="h6" gutterBottom>
        System Status
      </Typography>

      <Grid container spacing={2}>
        {/* Azure Functions */}
        <Grid item xs={12} sm={6}>
          <Box display="flex" alignItems="center" gap={1}>
            {getStatusIcon(status.azureFunctions)}
            <Typography variant="body1">
              Azure Functions
            </Typography>
            <Chip
              label={status.azureFunctions.available ? 'Healthy' : 'Down'}
              color={getStatusColor(status.azureFunctions)}
              size="small"
            />
          </Box>
          {status.azureFunctions.timestamp && (
            <Typography variant="caption" color="text.secondary" sx={{ ml: 4 }}>
              Last check: {new Date(status.azureFunctions.timestamp).toLocaleTimeString()}
            </Typography>
          )}
        </Grid>

        {/* Express Backend */}
        <Grid item xs={12} sm={6}>
          <Box display="flex" alignItems="center" gap={1}>
            {getStatusIcon(status.express)}
            <Typography variant="body1">
              Express Backend
            </Typography>
            <Chip
              label={status.express.available ? 'Healthy' : 'Down'}
              color={getStatusColor(status.express)}
              size="small"
            />
          </Box>
          {status.express.timestamp && (
            <Typography variant="caption" color="text.secondary" sx={{ ml: 4 }}>
              Last check: {new Date(status.express.timestamp).toLocaleTimeString()}
            </Typography>
          )}
        </Grid>
      </Grid>
    </Paper>
  );
}
```

### Step 4: Add to Dashboard Page

**File:** `calops/src/app/dashboard/page.js`

```javascript
import ServiceStatus from '@/components/dashboard/ServiceStatus';

export default function DashboardPage() {
  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      {/* Add at top of dashboard */}
      <ServiceStatus />

      {/* Rest of dashboard content */}
      {/* ... */}
    </Container>
  );
}
```

---

## Testing Locally

### 1. Start Azure Functions

```bash
cd calendar-be-af
npm run dev
```

**Expected output:**
```
Azure Functions Core Tools
...
Functions:
  health: [GET] http://localhost:7071/api/health
```

### 2. Test Health Endpoint

```bash
curl http://localhost:7071/api/health
```

**Expected response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-10-06T20:30:45.123Z",
  "service": "calendar-backend-functions"
}
```

### 3. Start Calops

```bash
cd calops
# Update .env.local
echo "NEXT_PUBLIC_AF_URL=http://localhost:7071" >> .env.local
npm run dev
```

### 4. View Dashboard

Navigate to: `http://localhost:3003/dashboard`

**Expected:**
- 🟢 Azure Functions: Healthy
- 🟢 Express Backend: Healthy (if running on 3010)

---

## Environment-Specific URLs

### Local Development

| Service | URL |
|---------|-----|
| Azure Functions | `http://localhost:7071` |
| Express Backend | `http://localhost:3010` |
| Calops Dashboard | `http://localhost:3003` |

### Azure TEST Environment

| Service | URL |
|---------|-----|
| Azure Functions | `https://calendarbe-test-bpg5caaqg5chbndu.eastus-01.azurewebsites.net` |
| Express Backend | TBD |
| Calops Dashboard | TBD |

### Azure PROD Environment

| Service | URL |
|---------|-----|
| Azure Functions | `https://CalendarBEAF-PROD.azurewebsites.net` (from GitHub Actions workflow) |
| Express Backend | TBD |
| Calops Dashboard | TBD |

---

## Available Azure Functions Endpoints (Current)

Based on `src/app.js` and `src/functions/`:

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/health` | GET | anonymous | Health check |
| `/api/calendars` | GET, POST | function | Calendar CRUD |
| `/api/calendars/{id}` | GET, PUT, DELETE | function | Single calendar |
| `/api/calendars/{calendarId}/events` | GET, POST | function | Events for calendar |
| `/api/calendars/{calendarId}/events/{eventId}` | GET, PUT, DELETE | function | Single event |
| `/api/admin/maintenance` | POST | function | Manual maintenance trigger |

**Note:** Most endpoints require function key authentication in production. Health endpoint is public.

---

## Future Additions (Events & Venues Services)

When implementing Events and Venues health checks:

### Events Service Health

```javascript
async checkEvents() {
  try {
    const response = await axios.get(`${AZURE_FUNCTIONS_URL}/api/calendars`, {
      timeout: 5000,
      headers: {
        'x-functions-key': process.env.NEXT_PUBLIC_AF_KEY // Production only
      }
    });
    return {
      status: 'healthy',
      available: true,
      count: response.data?.length || 0
    };
  } catch (error) {
    return { status: 'unhealthy', available: false };
  }
}
```

### Venues Service Health

```javascript
async checkVenues() {
  // Similar pattern - endpoint TBD
}
```

---

## Troubleshooting

### Azure Functions shows "Down"

1. **Check server is running:**
   ```bash
   lsof -i :7071
   ```

2. **Restart Azure Functions:**
   ```bash
   cd calendar-be-af
   killall func
   npm run dev
   ```

3. **Check health endpoint manually:**
   ```bash
   curl http://localhost:7071/api/health
   ```

4. **Check for errors in terminal where `npm run dev` is running**

### CORS Errors

If you see CORS errors in browser console:

**Update:** `calendar-be-af/host.json`

```json
{
  "version": "2.0",
  "extensions": {
    "http": {
      "customHeaders": {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
      }
    }
  }
}
```

---

## Summary for FE LLM

**To add Azure Functions health monitoring:**

1. Create `health.js` API client with `checkAzureFunctions()` method
2. Add `NEXT_PUBLIC_AF_URL` environment variable
3. Create `ServiceStatus` component showing red/green lights
4. Add component to dashboard page
5. Test with `curl http://localhost:7071/api/health`

**URLs to use:**
- **Local:** `http://localhost:7071/api/health`
- **Azure TEST:** `https://calendarbe-test-bpg5caaqg5chbndu.eastus-01.azurewebsites.net/api/health`
- **Azure PROD:** `https://CalendarBEAF-PROD.azurewebsites.net/api/health`

**Current State:** Server needs restart after Service Bus fix. Once running, health endpoint will respond with 200 OK.
