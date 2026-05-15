---
date: 2026-05-07
persona: fulton
type: reference
state: active
feature: deployment
keywords: [urls, azure-functions, environments, deployment]
appid: global
audience: all-personas, e2e-spawners, frontend-consumers
permanence: long-term
tags: [type/reference, app/calendar-be-af]
---

# calendar-be-af — Canonical URLs

**Owner:** Fulton (calendar-be-af)
**Authoritative source:** `MasterCalendar/docs/DEPLOYMENT-MATRIX.md` (cross-project canonical)
**Purpose:** stable URL reference for spawn pre-flight, env config, and consumer integrations. If a tool or persona has cached a URL not in this list, it is stale.

## Canonical URLs

| Environment | Base URL | DB | Notes |
|---|---|---|---|
| **TEST** | `https://calendarbeaf-test.azurewebsites.net` | `TangoTiempoTest` | Stable across FA recreations (custom-named, not regional) |
| **PROD** | `https://calendarbeaf-prod.azurewebsites.net` | `TangoTiempoProd` | Stable across FA recreations |
| **Local dev** | `http://localhost:7071` | `TangoTiempoTest` (default) | `func start` |

**Rule:** these are the only URLs that should appear in consumer `.env*`, Gauge `.env.test`, deployment scripts, or documentation. Regional URLs (with random hex suffix, e.g. `<name>-<hex>.eastus-01.azurewebsites.net`) are **transient artifacts** and must not be cached.

## Health endpoint (spawn pre-flight)

```
GET <base-url>/api/health
→ 200 { ok: true, db: 'connected', ... }
```

Use this for spawn pre-flight pings (Gauge SAD addition per UC-0013 lessons-learned 2026-05-07). A non-200 indicates the URL is stale or the FA is stopped — abort spawn and re-resolve via this doc rather than retrying.

## Deprecated / do-not-use URLs

| URL | Why it appears | Correct action |
|---|---|---|
| `calendarbe-test-<hex>.eastus-01.azurewebsites.net` | Old `calendar-be` (Express) FA — **decommissioned**, different app entirely. Easy to confuse by name with calendar-be-af. | Replace with `calendarbeaf-test.azurewebsites.net` |
| Any `<anything>.eastus-01.azurewebsites.net` regional URL | Auto-generated regional alias of an Azure FA; persists even after recreation but not the canonical name | Replace with the custom-named `calendarbeaf-{test,prod}.azurewebsites.net` |

## Rotation cadence

The canonical URLs above are **stable** — they don't rotate. They're tied to a custom-named Azure Function App resource that persists across deployments.

The risk vector is **FA recreation** (delete-and-recreate during ops or Azure-side rebuild), which can reassign the regional URL while preserving the canonical name. Tools that cached a regional URL will then 404 silently. Mitigation: spawn pre-flight `GET /api/health` before authoring tests; if 404, re-resolve from this doc.

## Consumer reference (frontend env vars)

Per `MasterCalendar/docs/DEPLOYMENT-MATRIX.md`:

| Frontend | TEST `NEXT_PUBLIC_AF_URL` | PROD `NEXT_PUBLIC_AF_URL` |
|---|---|---|
| tangotiempo.com | `https://calendarbeaf-test.azurewebsites.net` | `https://calendarbeaf-prod.azurewebsites.net` |
| harmonyjunction.org | `https://calendarbeaf-test.azurewebsites.net` | `https://calendarbeaf-prod.azurewebsites.net` |
| calops | `https://calendarbeaf-test.azurewebsites.net` | `https://calendarbeaf-prod.azurewebsites.net` |

If any frontend's `.env.{test,production}` shows a different URL, it's stale.

## Provenance

- Established: per ongoing deployment practice, codified here 2026-05-07
- Trigger: UC-0013 spawn (2026-05-07T17:25Z) hit a stale URL in Gauge `.env.test`; auto-healed but surfaced the absence of a canonical reference
- Related memory rule: `feedback_env_ping_before_spawn.md` (Quinn-promoted, calendar-be-af-side `/api/health` adopted as Gauge SAD pre-flight)
