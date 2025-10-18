# Category_Get Azure Function

## Overview
Azure Function that retrieves categories filtered by application ID with pagination support.

## Endpoint
- **HTTP Method**: GET
- **Route**: `/api/categories`
- **Authentication**: None (public endpoint)

## Parameters

### Query Parameters
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| appId | string | Yes | - | Application identifier |
| page | number | No | 1 | Page number for pagination |
| limit | number | No | 100 | Items per page (max 500) |
| select | string | No | - | Comma-separated field names to include |

### Examples
```
GET /api/categories?appId=1
GET /api/categories?appId=1&page=2&limit=50
GET /api/categories?appId=1&select=categoryName,categoryCode
```

## Response Format

### Success Response (200)
```json
{
  "categories": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "appId": "1",
      "categoryName": "Milonga",
      "categoryCode": "MIL",
      "categoryNameAbbreviation": "MILO",
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "pagination": {
    "total": 25,
    "page": 1,
    "limit": 100,
    "pages": 1
  }
}
```

### Error Responses

#### 400 Bad Request
```json
{
  "message": "appId is required"
}
```

#### 503 Service Unavailable
```json
{
  "message": "Database unavailable",
  "details": "Connection timeout" // Only in development
}
```

#### 500 Internal Server Error
```json
{
  "message": "Error fetching categories",
  "details": "Specific error message" // Only in development
}
```

## Features

### Pagination
- Supports page-based pagination
- Default limit: 100 items per page
- Maximum limit: 500 items per page
- Returns total count and page information

### Field Selection
- Use `select` parameter to specify fields
- Example: `select=categoryName,categoryCode`
- `_id` is included by default unless explicitly excluded with `-_id`

### Sorting
- Results are automatically sorted by `categoryName` in ascending order

### Connection Pooling
- Reuses MongoDB connections across function invocations
- Improves performance and reduces connection overhead

## Environment Variables
- `MONGODB_URI`: MongoDB connection string (required)
- `MONGODB_DB_NAME`: Database name (default: "TangoTiempo")
- `NODE_ENV`: Environment mode (development shows detailed errors)

## Testing

### Local Testing
```bash
# Start the function locally
func start

# Test the endpoint
curl "http://localhost:7071/api/categories?appId=1"
```

### Unit Tests
```bash
npm test Category_Get.test.js
```

### Integration Testing
Use the provided Postman collection or create test scripts:

```javascript
// Example test script
const response = await fetch('https://your-function-app.azurewebsites.net/api/categories?appId=1');
const data = await response.json();
console.assert(data.categories !== undefined, 'Categories should be defined');
console.assert(data.pagination !== undefined, 'Pagination should be defined');
```

## Performance Considerations
- Connection pooling reduces latency
- Parallel execution of count and find queries
- Efficient pagination with skip/limit
- Lean queries for better memory usage

## Migration Notes
This function replaces the Express endpoint at `/api/categories` with full feature parity:
- ✅ Pagination support
- ✅ Field selection
- ✅ Error handling
- ✅ Logging
- ✅ Connection pooling
- ✅ Input validation

## Future Enhancements
- [ ] Add caching layer for frequently accessed categories
- [ ] Support for filtering by active/inactive status
- [ ] Add rate limiting per appId
- [ ] Support for bulk operations