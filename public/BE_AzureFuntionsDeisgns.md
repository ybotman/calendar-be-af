📦 TangoTiempo API Migration Plan — Phased Azure Functions Rollout

This document outlines the phased migration of the TangoTiempo backend API from an Express server to Azure Functions. Each migration unit will be tracked via JIRA subtasks, reflecting function readiness and deployment state.

⸻

🧠 Migration Goals
	•	Modularize backend services into serverless Azure Functions
	•	Maintain parity during transition (dual-run support)
	•	Integrate progress with JIRA subtasks
	•	Preserve user-facing API stability
	•	Enable test+cutover with minimal risk

⸻

📁 Directory & Naming Structure

Azure Functions Naming

Each backend service becomes a function in:

src/functions/<Entity>_<Action>.js

Examples:

Entity	Action	Function Name
Category	GET	Category_Get.js
Venue	POST	Venue_Post.js
Organizer	PATCH	Organizer_Update.js


⸻

🧱 Entity Migration States

Each endpoint (e.g., /api/events, /api/venues) is assigned a JIRA subtask with one of the following states:

State	Meaning
Deferred	Will be migrated later
Planned	Under design, not started
WIP	In active development
Testing	Deployed to DEVL or TEST for testing
Ready	Available in PROD
Retired	Legacy Express endpoint disabled


⸻

🧩 JIRA Subtask Convention

Each API route (or group of routes under the same prefix) should have a subtask:

Example

JIRA Epic: BE-MIGRATE
Subtask: BE-MIGRATE-17: Migrate /api/categories to Category_Get AF

Subtask fields:
	•	Component: AzureFunctions
	•	Route: /api/<entity>
	•	Function(s): <Entity>_<Verb>
	•	Status: Deferred | Planned | WIP | Testing | Ready | Retired
	•	Link to PR: If applicable

⸻

🌐 Routing Behavior by Phase

Phase	Routing Description
Phase A — Legacy	All traffic handled by Express (/api/*)
Phase B — Dual	Some routes routed to Azure via appId=test-af
Phase C — Cutover	New routes are default, Express is fallback
Phase D — Retire	All /api/* handled by Azure Functions

Routing key: appId=test-af enables early use of new functions.

⸻

🧪 Testing Approach
	•	All Azure Functions tested with:
	•	Local dev using func start
	•	Deployed test on calendarbe-test-*.azurewebsites.net
	•	Unit test coverage to be added incrementally
	•	Integration test scripts shared via /debug/db or /health

⸻

🔁 Branch & Deployment Flow

Stage	Branch	Notes
DEVL	DEVL	Initial function builds
TEST	TEST	GitHub CI deploys to Azure
PROD	PROD	After validation via JIRA


⸻

🧼 Lint & Style Guide
	•	JS: Airbnb style via ESLint
	•	ENVs: .env.local, .env.test, .env.prod
	•	Code: Avoid duplication—reuse shared middleware, models, utils
