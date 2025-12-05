# LLM Test Prompt: Express BE vs Azure Functions BE 1:1 Comparison

Use this prompt to have an LLM verify that the Azure Functions backend (calendar-be-af) matches the Express backend (calendar-be) 1:1.

---

## PROMPT FOR LLM

```
You are a QA engineer testing API endpoint parity between two backends:
- EXPRESS BE: https://calendarbe.tangotiempo.com (or localhost:3005)
- AZURE FUNCTIONS BE: https://calendarbeaf-test.azurewebsites.net (or localhost:7071)

Your task is to verify 1:1 parity between these backends. For each endpoint, compare:
1. Response structure (JSON shape)
2. Field names and types
3. Pagination format
4. Error response format
5. Query parameter support

## ENDPOINTS TO TEST

### Categories
| Method | Express Route | AF Route |
|--------|--------------|----------|
| GET | /api/categories?appId=1 | /api/categories?appId=1 |

Expected: Same response structure with `categories` array and `pagination` object.

### Events
| Method | Express Route | AF Route |
|--------|--------------|----------|
| GET | /api/events?appId=1&limit=5 | /api/events?appId=1&limit=5 |
| GET | /api/events/{id}?appId=1 | /api/events/{id}?appId=1 |
| POST | /api/events | /api/events |
| PUT | /api/events/{id} | /api/events/{id} |
| DELETE | /api/events/{id} | /api/events/{id} |

### Venues
| Method | Express Route | AF Route |
|--------|--------------|----------|
| GET | /api/venues?appId=1&limit=5 | /api/venues?appId=1&limit=5 |
| GET | /api/venues/{id} | /api/venues/{id} |
| POST | /api/venues | /api/venues |
| PUT | /api/venues/{id} | /api/venues/{id} |
| DELETE | /api/venues/{id} | /api/venues/{id} |

### Organizers
| Method | Express Route | AF Route |
|--------|--------------|----------|
| GET | /api/organizers?appId=1&limit=5 | /api/organizers?appId=1&limit=5 |
| GET | /api/organizers/{id}?appId=1 | /api/organizers/{id}?appId=1 |
| POST | /api/organizers | /api/organizers |
| PUT | /api/organizers/{id} | /api/organizers/{id} |
| DELETE | /api/organizers/{id} | /api/organizers/{id} |
| PATCH | /api/organizers/{id}/connect-user | /api/organizers/{id}/connect-user |
| PATCH | /api/organizers/{id}/disconnect-user | /api/organizers/{id}/disconnect-user |

### Roles
| Method | Express Route | AF Route |
|--------|--------------|----------|
| GET | /api/roles?appId=1 | /api/roles?appId=1 |

## TEST PROCEDURE

For each endpoint pair:

1. **GET Requests**: Call both endpoints with same parameters, compare:
   - Response wrapper (e.g., `data`, `events`, `organizers`, `venues`)
   - Pagination object structure: `{ total, page, limit, pages }`
   - Document any differences

2. **POST/PUT Requests**: Use same request body, compare:
   - Success response structure
   - Created/updated object fields
   - Error handling (400, 404, 409 responses)

3. **DELETE Requests**: Compare:
   - Success message format
   - 404 handling for non-existent IDs

## SAMPLE TEST COMMANDS

```bash
# Categories comparison
EXPRESS=$(curl -s "https://calendarbe.tangotiempo.com/api/categories?appId=1&limit=2")
AF=$(curl -s "https://calendarbeaf-test.azurewebsites.net/api/categories?appId=1&limit=2")

# Compare structure
echo "EXPRESS:" && echo $EXPRESS | jq 'keys'
echo "AF:" && echo $AF | jq 'keys'

# Organizers comparison
EXPRESS=$(curl -s "https://calendarbe.tangotiempo.com/api/organizers?appId=1&limit=2")
AF=$(curl -s "https://calendarbeaf-test.azurewebsites.net/api/organizers?appId=1&limit=2")

echo "EXPRESS pagination:" && echo $EXPRESS | jq '.pagination'
echo "AF pagination:" && echo $AF | jq '.pagination'

# Venues comparison
EXPRESS=$(curl -s "https://calendarbe.tangotiempo.com/api/venues?appId=1&limit=2")
AF=$(curl -s "https://calendarbeaf-test.azurewebsites.net/api/venues?appId=1&limit=2")

echo "EXPRESS wrapper:" && echo $EXPRESS | jq 'keys'
echo "AF wrapper:" && echo $AF | jq 'keys'
```

## KNOWN DIFFERENCES TO DOCUMENT

Note any intentional differences:
- Response wrapper names (Express uses `venues`, AF uses `data`)
- Timestamp fields added by AF
- Additional metadata fields

## OUTPUT FORMAT

Provide a report in this format:

| Endpoint | Express Response | AF Response | Match? | Notes |
|----------|-----------------|-------------|--------|-------|
| GET /categories | {...} | {...} | Yes/No | ... |
| GET /events | {...} | {...} | Yes/No | ... |
| ... | ... | ... | ... | ... |

## ACCEPTANCE CRITERIA

- All GET endpoints return same data (may differ in wrapper name)
- Pagination structure is identical
- POST/PUT return created/updated objects with same fields
- DELETE returns success message
- Error responses use same HTTP status codes
```

---

## QUICK CURL TESTS

```bash
# Set base URLs
EXPRESS="https://calendarbe.tangotiempo.com"
AF="https://calendarbeaf-test.azurewebsites.net"

# Test all GET endpoints
echo "=== Categories ===" && \
curl -s "$EXPRESS/api/categories?appId=1&limit=1" | jq 'keys' && \
curl -s "$AF/api/categories?appId=1&limit=1" | jq 'keys'

echo "=== Events ===" && \
curl -s "$EXPRESS/api/events?appId=1&limit=1" | jq 'keys' && \
curl -s "$AF/api/events?appId=1&limit=1" | jq 'keys'

echo "=== Venues ===" && \
curl -s "$EXPRESS/api/venues?appId=1&limit=1" | jq 'keys' && \
curl -s "$AF/api/venues?appId=1&limit=1" | jq 'keys'

echo "=== Organizers ===" && \
curl -s "$EXPRESS/api/organizers?appId=1&limit=1" | jq 'keys' && \
curl -s "$AF/api/organizers?appId=1&limit=1" | jq 'keys'

echo "=== Roles ===" && \
curl -s "$EXPRESS/api/roles?appId=1&limit=1" | jq 'keys' && \
curl -s "$AF/api/roles?appId=1&limit=1" | jq 'keys'
```

---

## LOCAL TESTING

For local testing:
- Express BE: `cd calendar-be && npm start` (port 3005)
- Azure Functions: `cd calendar-be-af && npm run dev` (port 7071)

```bash
EXPRESS="http://localhost:3005"
AF="http://localhost:7071"
```
