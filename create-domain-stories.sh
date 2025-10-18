#!/bin/bash

# Create JIRA stories for each domain and link to epic CALBEAF-5

# Change to the jira-tools directory
cd "$(dirname "$0")/public/AI-Guild/Scripts/jira-tools" || exit 1

# Source common configuration
source ./jira-common.sh

# Epic key to link stories to
EPIC_KEY="CALBEAF-5"

# Function to create ticket and link to epic
create_and_link_story() {
    local title=$1
    local domain=$2
    local description=$3
    
    echo "Creating story: $title"
    
    # Build labels array
    local labels='["new-feature", "domain-'$domain'", "backend", "azure-functions"]'
    
    # Create JSON payload
    local json_payload=$(cat <<EOF
{
  "fields": {
    "project": {
      "key": "$PROJECT"
    },
    "summary": "$title",
    "description": "$description",
    "issuetype": {
      "name": "Story"
    },
    "labels": $labels
  }
}
EOF
)
    
    # Create ticket
    local response=$(curl -s -u "$JIRA_EMAIL:$JIRA_TOKEN" \
        -H "Accept: application/json" \
        -H "Content-Type: application/json" \
        -d "$json_payload" \
        -X POST \
        "$JIRA_URL/rest/api/2/issue")
    
    local ticket_key=$(echo "$response" | jq -r '.key // empty')
    
    if [ -n "$ticket_key" ]; then
        echo "✅ Created $ticket_key"
        
        # Link to epic
        echo "Linking $ticket_key to epic $EPIC_KEY..."
        local link_response=$(curl -s -u "$JIRA_EMAIL:$JIRA_TOKEN" \
            -H "Accept: application/json" \
            -H "Content-Type: application/json" \
            -d '{"add": {"epic": "'$EPIC_KEY'"}}' \
            -X PUT \
            "$JIRA_URL/rest/agile/1.0/issue/$ticket_key")
        
        # Check if linking was successful
        if [ $? -eq 0 ]; then
            echo "✅ Linked to epic $EPIC_KEY"
        else
            echo "❌ Failed to link to epic"
        fi
        
        echo
    else
        echo "❌ Failed to create ticket"
        echo "$response" | jq .
        echo
    fi
}

# Create stories for each domain
echo "Creating domain stories for Calendar Backend Azure Functions..."
echo "=================================================="
echo

# 1. Categories Domain
create_and_link_story \
    "Implement Categories Domain API (1 endpoint)" \
    "categories" \
    "## Context
Implement the Categories domain API endpoints for the Calendar Backend Azure Functions project.

## Domain
Primary: Categories

## Endpoints to Implement
- GET /api/categories - List all event categories

## Technical Requirements
- Azure Function HTTP trigger
- TypeScript implementation
- Connection to existing database
- Error handling and validation
- Unit tests

## Acceptance Criteria
- Endpoint returns all categories
- Proper HTTP status codes
- JSON response format matches specification
- Unit tests pass
- Integration with existing authentication"

# 2. Events Domain
create_and_link_story \
    "Implement Events Domain API (10 endpoints)" \
    "events" \
    "## Context
Implement the Events domain API endpoints for the Calendar Backend Azure Functions project.

## Domain
Primary: Events
Related: Venues, Organizers, Categories

## Endpoints to Implement
- GET /api/events - List events with filtering
- GET /api/events/{id} - Get event details
- POST /api/events - Create new event
- PUT /api/events/{id} - Update event
- DELETE /api/events/{id} - Delete event
- GET /api/events/by-venue/{venueId} - Get events by venue
- GET /api/events/by-organizer/{organizerId} - Get events by organizer
- GET /api/events/search - Search events
- POST /api/events/{id}/duplicate - Duplicate event
- GET /api/events/upcoming - Get upcoming events

## Technical Requirements
- Azure Function HTTP triggers
- TypeScript implementation
- Database transactions for complex operations
- Pagination support
- Error handling and validation
- Unit tests

## Acceptance Criteria
- All endpoints functional
- Proper HTTP status codes
- JSON response format matches specification
- Unit tests pass
- Integration with authentication and authorization"

# 3. Venues Domain
create_and_link_story \
    "Implement Venues Domain API (6 endpoints)" \
    "venues" \
    "## Context
Implement the Venues domain API endpoints for the Calendar Backend Azure Functions project.

## Domain
Primary: Venues
Related: Events, Locations

## Endpoints to Implement
- GET /api/venues - List venues with filtering
- GET /api/venues/{id} - Get venue details
- POST /api/venues - Create new venue
- PUT /api/venues/{id} - Update venue
- DELETE /api/venues/{id} - Delete venue
- GET /api/venues/search - Search venues by name/location

## Technical Requirements
- Azure Function HTTP triggers
- TypeScript implementation
- Geospatial queries for location-based search
- Error handling and validation
- Unit tests

## Acceptance Criteria
- All endpoints functional
- Location-based search working
- Proper HTTP status codes
- JSON response format matches specification
- Unit tests pass
- Authorization checks implemented"

# 4. UserLogins Domain
create_and_link_story \
    "Implement UserLogins Domain API (18 endpoints)" \
    "auth" \
    "## Context
Implement the UserLogins domain API endpoints for authentication and user management in the Calendar Backend Azure Functions project.

## Domain
Primary: Authentication/Users
Related: Organizers, Roles

## Endpoints to Implement
- POST /api/auth/login - User login
- POST /api/auth/logout - User logout
- POST /api/auth/refresh - Refresh token
- POST /api/auth/register - User registration
- POST /api/auth/forgot-password - Password reset request
- POST /api/auth/reset-password - Password reset confirmation
- GET /api/users - List users (admin)
- GET /api/users/{id} - Get user details
- PUT /api/users/{id} - Update user
- DELETE /api/users/{id} - Delete user
- GET /api/users/profile - Get current user profile
- PUT /api/users/profile - Update current user profile
- POST /api/users/{id}/roles - Assign roles
- DELETE /api/users/{id}/roles/{roleId} - Remove role
- GET /api/users/{id}/permissions - Get user permissions
- POST /api/auth/verify-email - Email verification
- POST /api/auth/resend-verification - Resend verification email
- PUT /api/users/{id}/password - Change password

## Technical Requirements
- Azure Function HTTP triggers
- JWT token implementation
- Password hashing (bcrypt)
- Email service integration
- Rate limiting for auth endpoints
- Session management
- Unit tests

## Acceptance Criteria
- Secure authentication flow
- Token refresh mechanism
- Role-based access control
- Email verification working
- Password reset flow complete
- Unit tests pass"

# 5. Organizers Domain
create_and_link_story \
    "Implement Organizers Domain API (10 endpoints)" \
    "organizers" \
    "## Context
Implement the Organizers domain API endpoints for the Calendar Backend Azure Functions project.

## Domain
Primary: Organizers
Related: Events, Users, Locations

## Endpoints to Implement
- GET /api/organizers - List organizers
- GET /api/organizers/{id} - Get organizer details
- POST /api/organizers - Create organizer
- PUT /api/organizers/{id} - Update organizer
- DELETE /api/organizers/{id} - Delete organizer
- GET /api/organizers/{id}/events - Get organizer's events
- GET /api/organizers/by-region/{regionId} - Get organizers by region
- POST /api/organizers/{id}/admins - Add admin to organizer
- DELETE /api/organizers/{id}/admins/{userId} - Remove admin
- GET /api/organizers/search - Search organizers

## Technical Requirements
- Azure Function HTTP triggers
- TypeScript implementation
- Relationship management with users
- Event association handling
- Error handling and validation
- Unit tests

## Acceptance Criteria
- All endpoints functional
- Admin management working
- Event associations correct
- Proper HTTP status codes
- JSON response format matches specification
- Unit tests pass"

# 6. MasteredLocations Domain
create_and_link_story \
    "Implement MasteredLocations Domain API (6 endpoints)" \
    "geo" \
    "## Context
Implement the MasteredLocations domain API endpoints for hierarchical location management in the Calendar Backend Azure Functions project.

## Domain
Primary: Geographic/Locations
Related: Venues, Events, Organizers

## Endpoints to Implement
- GET /api/locations - List locations with hierarchy
- GET /api/locations/{id} - Get location details
- GET /api/locations/{id}/children - Get child locations
- GET /api/locations/search - Search locations
- GET /api/locations/tree - Get location hierarchy tree
- POST /api/locations/geocode - Geocode address to location

## Technical Requirements
- Azure Function HTTP triggers
- TypeScript implementation
- Hierarchical data queries
- Geocoding service integration
- Caching for performance
- Error handling and validation
- Unit tests

## Acceptance Criteria
- Hierarchical navigation working
- Search functionality accurate
- Geocoding integration functional
- Performance optimized with caching
- Unit tests pass"

# 7. Firebase Integration
create_and_link_story \
    "Implement Firebase Integration API (3 endpoints)" \
    "firebase" \
    "## Context
Implement Firebase integration endpoints for real-time features and notifications in the Calendar Backend Azure Functions project.

## Domain
Primary: Firebase/Real-time
Related: Events, Users

## Endpoints to Implement
- POST /api/firebase/token - Exchange auth token for Firebase token
- POST /api/firebase/notify - Send push notification
- GET /api/firebase/config - Get Firebase client config

## Technical Requirements
- Azure Function HTTP triggers
- Firebase Admin SDK integration
- Custom token generation
- Push notification service
- Security rules synchronization
- Error handling
- Unit tests

## Acceptance Criteria
- Firebase authentication working
- Push notifications delivered
- Client configuration secure
- Token exchange secure
- Unit tests pass"

# 8. Roles Domain
create_and_link_story \
    "Implement Roles Domain API (1 endpoint)" \
    "roles" \
    "## Context
Implement the Roles domain API endpoint for role management in the Calendar Backend Azure Functions project.

## Domain
Primary: Roles/Authorization
Related: Users

## Endpoints to Implement
- GET /api/roles - List all available roles

## Technical Requirements
- Azure Function HTTP trigger
- TypeScript implementation
- Role definition management
- Permission mapping
- Error handling
- Unit tests

## Acceptance Criteria
- Returns all system roles
- Includes permission details
- Proper HTTP status codes
- JSON response format matches specification
- Unit tests pass"

# 9. Health Check Domain
create_and_link_story \
    "Implement Health Check Domain API (5 endpoints)" \
    "health" \
    "## Context
Implement health check and monitoring endpoints for the Calendar Backend Azure Functions project.

## Domain
Primary: Health/Monitoring
Related: All systems

## Endpoints to Implement
- GET /api/health - Basic health check
- GET /api/health/detailed - Detailed system status
- GET /api/health/database - Database connectivity check
- GET /api/health/dependencies - External dependencies status
- GET /api/version - API version information

## Technical Requirements
- Azure Function HTTP triggers
- TypeScript implementation
- Database connectivity tests
- External service checks
- Response time monitoring
- Error handling
- Unit tests

## Acceptance Criteria
- All health checks functional
- Accurate status reporting
- Fast response times
- Proper HTTP status codes
- Monitoring integration ready
- Unit tests pass"

# 10. Legacy Regions Domain
create_and_link_story \
    "Implement Legacy Regions Domain API (7 endpoints)" \
    "regions" \
    "## Context
Implement the Legacy Regions domain API endpoints for backward compatibility with the existing regions system in the Calendar Backend Azure Functions project.

## Domain
Primary: Regions (Legacy)
Related: Locations, Organizers, Events

## Endpoints to Implement
- GET /api/regions - List all regions
- GET /api/regions/{id} - Get region details
- GET /api/regions/{id}/subregions - Get subregions
- GET /api/regions/{id}/events - Get events in region
- GET /api/regions/{id}/organizers - Get organizers in region
- GET /api/regions/{id}/venues - Get venues in region
- GET /api/regions/migrate/{id} - Migrate region to new location system

## Technical Requirements
- Azure Function HTTP triggers
- TypeScript implementation
- Legacy data mapping
- Migration utilities
- Backward compatibility
- Error handling and validation
- Unit tests

## Acceptance Criteria
- All legacy endpoints functional
- Data correctly mapped to new structure
- Migration endpoint working
- No breaking changes for existing clients
- Unit tests pass"

echo "=================================================="
echo "All domain stories created and linked to epic $EPIC_KEY"
echo "=================================================="