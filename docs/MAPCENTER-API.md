# MapCenter API - Frontend Integration Guide

## Overview
MapCenter API allows users to save and retrieve their preferred map center location (latitude, longitude, zoom) for the TangoTiempo map interface.

**JIRA**: CALBEAF-48
**Frontend Ticket**: TIEMPO-312
**Status**: Ready for integration

---

## Endpoints

### 1. GET /api/mapcenter
Retrieve user's saved map center from MongoDB.

**Authentication**: Required (Firebase Bearer token)

**Request:**
```http
GET /api/mapcenter
Authorization: Bearer <firebase-id-token>
```

**Response (Success - Map center exists):**
```json
{
  "success": true,
  "data": {
    "lat": 40.7128,
    "lng": -74.0060,
    "zoom": 12,
    "updatedAt": "2025-10-13T20:45:00.000Z"
  },
  "timestamp": "2025-10-13T20:45:01.234Z"
}
```

**Response (Success - No map center saved):**
```json
{
  "success": true,
  "data": null,
  "timestamp": "2025-10-13T20:45:01.234Z"
}
```

**Response (Unauthorized):**
```json
{
  "success": false,
  "error": "Unauthorized - Valid Firebase token required",
  "timestamp": "2025-10-13T20:45:01.234Z"
}
```

---

### 2. PUT /api/mapcenter
Save user's map center to MongoDB.

**Authentication**: Required (Firebase Bearer token)

**Request:**
```http
PUT /api/mapcenter
Authorization: Bearer <firebase-id-token>
Content-Type: application/json

{
  "lat": 40.7128,
  "lng": -74.0060,
  "zoom": 12
}
```

**Validation Rules:**
- `lat`: Number between -90 and 90 (required)
- `lng`: Number between -180 and 180 (required)
- `zoom`: Integer between 1 and 20 (required)

**Response (Success):**
```json
{
  "success": true,
  "data": {
    "lat": 40.7128,
    "lng": -74.0060,
    "zoom": 12,
    "updatedAt": "2025-10-13T20:45:00.000Z"
  },
  "timestamp": "2025-10-13T20:45:01.234Z"
}
```

**Response (Validation Error):**
```json
{
  "success": false,
  "error": "Latitude must be between -90 and 90",
  "timestamp": "2025-10-13T20:45:01.234Z"
}
```

**Response (User Not Found):**
```json
{
  "success": false,
  "error": "User not found",
  "timestamp": "2025-10-13T20:45:01.234Z"
}
```

---

## Environment URLs

### Local Development
- **Azure Functions (NEW)**: `http://localhost:7071/api/mapcenter`
- **Express Backend**: N/A (Feature not implemented)

### TEST Environment
- **URL**: `https://calbeaf-test.azurewebsites.net/api/mapcenter`
- **Status**: Pending deployment

### Production Environment
- **URL**: `https://calbeaf-prod.azurewebsites.net/api/mapcenter`
- **Status**: Not yet deployed

---

## Frontend Integration (React/Next.js)

### Example: Fetch User's Map Center

```typescript
import { getAuth } from 'firebase/auth';

async function fetchUserMapCenter() {
  try {
    const auth = getAuth();
    const user = auth.currentUser;

    if (!user) {
      throw new Error('User not authenticated');
    }

    const token = await user.getIdToken();

    const response = await fetch('http://localhost:7071/api/mapcenter', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const result = await response.json();

    if (!result.success) {
      console.error('Failed to fetch map center:', result.error);
      return null;
    }

    return result.data; // { lat, lng, zoom } or null

  } catch (error) {
    console.error('Error fetching map center:', error);
    return null;
  }
}
```

### Example: Save User's Map Center

```typescript
import { getAuth } from 'firebase/auth';

async function saveUserMapCenter(lat: number, lng: number, zoom: number) {
  try {
    const auth = getAuth();
    const user = auth.currentUser;

    if (!user) {
      throw new Error('User not authenticated');
    }

    const token = await user.getIdToken();

    const response = await fetch('http://localhost:7071/api/mapcenter', {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ lat, lng, zoom })
    });

    const result = await response.json();

    if (!result.success) {
      console.error('Failed to save map center:', result.error);
      return false;
    }

    console.log('Map center saved:', result.data);
    return true;

  } catch (error) {
    console.error('Error saving map center:', error);
    return false;
  }
}
```

### React Hook Example

```typescript
import { useState, useEffect } from 'react';
import { getAuth } from 'firebase/auth';

export function useMapCenter() {
  const [mapCenter, setMapCenter] = useState<{
    lat: number;
    lng: number;
    zoom: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch on mount
  useEffect(() => {
    fetchMapCenter();
  }, []);

  const fetchMapCenter = async () => {
    setLoading(true);
    setError(null);

    try {
      const auth = getAuth();
      const user = auth.currentUser;

      if (!user) {
        setMapCenter(null);
        return;
      }

      const token = await user.getIdToken();
      const response = await fetch('http://localhost:7071/api/mapcenter', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const result = await response.json();

      if (result.success) {
        setMapCenter(result.data);
      } else {
        setError(result.error);
      }

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const saveMapCenter = async (lat: number, lng: number, zoom: number) => {
    try {
      const auth = getAuth();
      const user = auth.currentUser;

      if (!user) {
        throw new Error('User not authenticated');
      }

      const token = await user.getIdToken();
      const response = await fetch('http://localhost:7071/api/mapcenter', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ lat, lng, zoom })
      });

      const result = await response.json();

      if (result.success) {
        setMapCenter(result.data);
        return true;
      } else {
        setError(result.error);
        return false;
      }

    } catch (err) {
      setError(err.message);
      return false;
    }
  };

  return { mapCenter, loading, error, saveMapCenter, refetch: fetchMapCenter };
}
```

---

## MongoDB Schema

**Collection**: `Users`
**Field**: `mapCenter`

```javascript
{
  firebaseUserId: "abc123...",
  // ... other user fields
  mapCenter: {
    lat: Number,    // -90 to 90
    lng: Number,    // -180 to 180
    zoom: Number,   // 1 to 20
    updatedAt: Date
  }
}
```

---

## Testing Checklist

- [ ] User can save map center with valid lat/lng/zoom
- [ ] User can retrieve saved map center
- [ ] Returns null when no map center is saved
- [ ] Validates lat range (-90 to 90)
- [ ] Validates lng range (-180 to 180)
- [ ] Validates zoom range (1 to 20)
- [ ] Returns 401 without Firebase token
- [ ] Returns 401 with invalid Firebase token
- [ ] Returns 404 if user doesn't exist in database

---

## Error Handling

All error responses follow this format:
```json
{
  "success": false,
  "error": "Error message here",
  "timestamp": "ISO 8601 timestamp"
}
```

**Common Errors:**
- **401 Unauthorized**: Missing or invalid Firebase token
- **400 Bad Request**: Invalid lat/lng/zoom values
- **404 Not Found**: User doesn't exist in MongoDB
- **500 Internal Server Error**: Server-side error (check logs)

---

## Next Steps for Frontend

1. **Update API base URL** in frontend config:
   ```typescript
   const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:7071';
   ```

2. **Implement useMapCenter hook** in your codebase

3. **Update Map component** to:
   - Load saved map center on mount
   - Show "Save as Default" button
   - Call `saveMapCenter()` when user clicks button

4. **Test locally** with Azure Functions running on port 7071

5. **Deploy to TEST** once local testing passes

---

## Support

**Questions?** Contact backend team or reference:
- JIRA: CALBEAF-48
- Frontend Ticket: TIEMPO-312
