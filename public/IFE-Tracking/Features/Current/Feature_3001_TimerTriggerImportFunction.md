# FEATURE_TimerTriggerImportFunction

> **IFE Feature Document**  
> This document captures all decisions, actions, and status updates for the Timer Trigger Azure Function that runs `simple-import.js` with calculated date ranges.

## 🗂️ KANBAN (Required)
**Last updated:** 2025-05-23 15:00

- [ ] Create feature tracking document
- [ ] Define timer trigger schedule and parameters
- [ ] Implement Azure Function code (index.js)
- [ ] Write unit tests and integration tests
- [ ] Validate ENV override behavior
- [ ] Document usage and deployment steps
- [ ] Review and merge into DEVL

## 🧭 SCOUT (Required)
**Last updated:** 2025-05-23 15:00

- Identified need for Timer Trigger function to automate BTC import via `utils/btcImport/simple-import.js`
- Determined date range requirements: `today - 5 days` and `last day of month + 12 months`
- Confirmed use of `child_process.exec` for script invocation
- ENV var `IMPORT_DATE_RANGE_OVERRIDE` should override calculated dates

## 🏛️ ARCHITECT (Required)
**Last updated:** 2025-05-23 15:00

- Use Azure Functions Timer Trigger with CRON expression `0 0 4 * * *` (4am UTC daily)
- Leverage Node.js function runtime for minimal dependencies
- Encapsulate date calculation logic in function entry point
- Ensure proper error logging and handling for failed imports

## 🛠️ BUILDER (Required)
**Last updated:** 2025-05-23 18:30

- ✅ Fixed async execution issue using `util.promisify(exec)`
- ✅ Implemented proper date calculation logic (today-5 days to last day of month+12)
- ✅ Added comprehensive ENV override parsing with validation
- ✅ Enhanced error handling with detailed logging
- ✅ Tested date calculation logic - working correctly
- ✅ Added proper timeout and buffer limits for script execution
- ✅ Function now properly awaits script completion before returning

---

## Summary
A new Azure Function (`TimerTriggerImportFunction`) that runs the existing Node.js script `utils/btcImport/simple-import.js` on a daily schedule at 4am UTC, calculating dynamic date ranges and allowing an optional override via ENV variable.

## Motivation
Automate the monthly BTC data import process without manual intervention and provide flexibility for ad-hoc runs through an override.

## Scope
- **In-Scope:** Timer Trigger function code, date calculation, ENV override handling, logging.
- **Out-of-Scope:** Script logic inside `simple-import.js`, changes to data schemas, front-end components.

## Feature Behavior
| Area       | Behavior Description                                                  |
|------------|------------------------------------------------------------------------|
| Timer      | Triggers daily at 4am UTC via CRON `0 0 4 * * *`                      |
| Logic      | Calculates `startDate = today - 5 days`, `endDate = last day of month + 12 months` or uses override |
| Invocation | Runs `node utils/btcImport/simple-import.js <startDate> <endDate>` via `child_process.exec` |
| ENV        | `IMPORT_DATE_RANGE_OVERRIDE` format `YYYY-MM-DD,YYYY-MM-DD` overrides both dates |

## Design
- Single `index.js` entry point with helper for date calculations
- Leverage built-in `process.env` and `child_process` modules

## Tasks
| Status | Task                                                             | Last Updated |
|--------|------------------------------------------------------------------|--------------|
| ✅ Complete | Scaffold function project under `functions/btcImportFunction` | 2025-05-23   |
| ✅ Complete | Implement date calculation and override logic                 | 2025-05-23   |
| ✅ Complete | Integrate `child_process.exec` call with proper async handling | 2025-05-23   |
| ✅ Complete | Add logging and error handling                                  | 2025-05-23   |
| ✅ Complete | Test date calculation logic                                     | 2025-05-23   |
| ⏳ Pending | Deployment and validation on Azure                              | 2025-05-24   |

## Rollback Plan
- Disable Timer Trigger in Azure Function App settings
- Revert merged code in `feature/3001-timer-trigger-import-function`
- Monitor logs to ensure no further invocations

## Dependencies
- Node.js child_process module
- Existing script at `utils/btcImport/simple-import.js`
- Azure Functions Core Tools for local testing

## Linked Issues / Docs
- Related script: `utils/btcImport/simple-import.js`
- Azure Functions docs: https://docs.microsoft.com/azure/azure-functions/functions-bindings-timer

## Owner
@tobybalsley

## Timeline
| Milestone   | Date       |
|-------------|------------|
| Created     | 2025-05-23 |
| First Dev   | 2025-05-23 |
| Review      | 2025-05-24 |
| Completed   |            |

---

## Best Practices
- Follow Azure Functions performance guidelines
- Use environment configurations for all sensitive values
- Write idempotent functions for safe retries

## Git Integration
- Branch from `DEVL`: `feature/3001-timer-trigger-import-function`
- Commit this file as first commit
- Implement code in subsequent commits referencing this document
