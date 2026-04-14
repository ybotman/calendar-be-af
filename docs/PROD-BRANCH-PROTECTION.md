# PROD Branch Protection Strategy

**Created**: 2026-03-18
**Author**: Fulton (AI) + Ybotman
**Status**: Recommended, pending implementation

---

## Goal

Establish a human gate on PROD deployments while allowing AI agents to work freely on DEVL/TEST branches.

---

## Recommended Protection: Two Gates

### Gate 1: GitHub Branch Protection

Prevents direct pushes to PROD. All changes must go through PR with human approval.

```bash
gh api repos/ybotman/calendar-be-af/branches/PROD/protection -X PUT \
  --input - <<'EOF'
{
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false
  },
  "enforce_admins": true,
  "required_status_checks": null,
  "restrictions": null
}
EOF
```

| Rule | Effect |
|------|--------|
| Require 1 approval | PR to PROD needs human "Approve" click |
| Enforce admins | Even admins must use PR (no bypass) |
| Dismiss stale reviews | New commits require re-approval |

### Gate 2: Workflow Manual Trigger Only

Change `.github/workflows/azure-functions-prod.yml`:

```yaml
# FROM:
on:
  push:
    branches:
      - PROD

# TO:
on:
  workflow_dispatch:
    inputs:
      reason:
        description: 'Deployment reason'
        required: true
```

| Benefit | Why |
|---------|-----|
| Merge ≠ Deploy | Merging to PROD doesn't auto-deploy |
| Explicit action | Human must click "Run workflow" |
| Audit trail | Reason logged for each deployment |

---

## Resulting Workflow

```
AI Agent (Fulton) workflow:
├── DEVL: Push freely ✅
├── TEST: Push freely ✅
└── PROD: Create PR only → Wait for approval

Human (Ybotman) workflow:
├── Review PR to PROD
├── Click "Approve"
├── Merge PR
└── Manually trigger deployment workflow
```

---

## Repos to Apply

| Repo | Status |
|------|--------|
| ybotman/calendar-be-af | Pending |
| ybotman/tangotiempo.com | Pending |
| ybotman/harmonyjunction.org | Consider |
| ybotman/calops | Consider |

---

## Rollback Strategy

1. **CalendarAF-PROD** as hot standby (needs setup)
2. DNS/Traffic Manager switch capability
3. Previous deployment zips saved locally

---

## Implementation Checklist

- [ ] Set up branch protection on calendar-be-af PROD
- [ ] Set up branch protection on tangotiempo.com PROD
- [ ] Change PROD workflows to workflow_dispatch only
- [ ] Set up CalendarAF-PROD as hot standby
- [ ] Document rollback procedure
- [ ] Test PR → Approve → Deploy flow

---

## Related

- CALBEAF-89: GitHub Actions deployment issue
- docs/compass_artifact_wf-*.md: Azure Functions deployment research
- Session 2026-03-17: Discovery of deployment issues
