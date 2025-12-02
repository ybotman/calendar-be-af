# Changelog

All notable changes to the Calendar Backend Azure Functions project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.8.0] - 2025-10-28

### Added - TIEMPO-329: Managed User Entry Flow
- **User_FCMToken** (POST /api/user/fcm-token) - Firebase Cloud Messaging token management
  - Register, update, and delete FCM tokens for push notifications
  - Supports multi-device token management per user
  - Swagger documentation included
- **User_OnboardingStatus** (POST /api/user/onboarding-status) - User onboarding checklist tracking
  - Track completion of: set home location, enable notifications, follow organizers
  - Returns onboarding completion percentage
  - Swagger documentation included
- **Geo_EventDensity** (POST /api/geo/event-density) - Event density detection for populated areas
  - Detects high-density event clusters using configurable radius and threshold
  - Returns cluster centers and event counts for heatmap visualization
  - Swagger documentation included

### Enhanced - TIEMPO-329: Visitor & User Tracking
- **VisitorTrack** - Enhanced visitor tracking with UUID support
  - Accept `visitor_id` UUID from frontend cookie
  - Detect first-time vs returning visitors
  - Return `is_first_time` and `is_returning` flags in response
  - Deduplication by `visitor_id` instead of just IP address
- **UserLoginTrack** - Enhanced login tracking
  - Accept and store `isFirstLogin` flag from frontend
  - Support first-login user onboarding state detection

### Fixed
- **VisitorTrack** - Localhost IP fallback for development testing
  - Use 127.0.0.1 when IP address is 'unknown' (localhost development)
  - Prevents 400 Bad Request errors during local testing

### Documentation
- Added comprehensive Swagger documentation for all new endpoints
- Updated API schemas: FCMTokenInput, OnboardingStatusInput, EventDensityInput
- Enhanced response schemas with examples

## [1.7.0] - 2025-10-24

### Added
- Keep-alive workflow to prevent Azure Functions cold starts
- GitHub Actions workflow for automatic health check pings

### Fixed
- ESLint configuration for code quality
- Deployment configuration fixes

## [1.6.0] - 2025-10-19

### Fixed
- Production database misconfiguration (TIEMPO-323)
  - Corrected MONGODB_URI to point to TangoTiempoProd for PROD environment
  - Previously writing analytics to TEST database

### Enhanced
- User login tracking with geolocation support
- Visitor tracking analytics

## [1.5.0] - 2025-10-17

### Added
- Standardized function naming convention (Resource_HttpVerb pattern)
- Middleware infrastructure (standardMiddleware, lightweightMiddleware)
- Structured logging with JSON format
- In-memory metrics collection
- OpenAPI 3.0 / Swagger documentation
- API documentation endpoint (GET /api/docs)

### Enhanced
- Error handling with custom error classes
- CORS configuration
- Response format standardization

---

## Version History Summary

- **1.8.0** - TIEMPO-329 user entry flow features (FCM, onboarding, event density)
- **1.7.0** - Keep-alive workflow, ESLint fixes
- **1.6.0** - Production database fix
- **1.5.0** - Foundation (middleware, logging, Swagger)

---

**Legend**:
- `Added` - New features
- `Changed` - Changes to existing functionality
- `Deprecated` - Soon-to-be removed features
- `Removed` - Removed features
- `Fixed` - Bug fixes
- `Security` - Vulnerability fixes
- `Enhanced` - Improvements to existing features
