# Regression Snapshot Diff — calendar-be-af

Implements **Layer 3 post-deploy verification** per `MasterCalendar/docs/PROD-DEPLOY-PROTECTION.md`.

## Pattern

```
1. capture-baseline.sh --env=prod    # before merging TEST → PROD
   (or --env=test before DEVL → TEST)
   ↓ writes baselines/*-pre.json
2. user merges PR; Azure rolls
3. verify.sh --env=prod              # after deploy lands
   ↓ re-runs same queries; diffs against baseline
   ↓ reports N passed / M failed
4. green → signal downstream personas (Sarah/Cord/Dash) to ship dependent FE
```

## Files

| File | Purpose |
|------|---------|
| `capture-baseline.sh` | Captures PROD/TEST endpoint responses → `baselines/*-pre.json` |
| `verify.sh` | Re-runs same queries → `baselines/*-post.json` and diffs |
| `baselines/` | Captured JSON snapshots (gitignored — contains PII) |

## Note on staging changes here

Top-level `.gitignore:94` broadly ignores `scripts/`. To stage updates to files in this directory you currently need `git add -f path/to/file`. Tracked here per CALBEAF-147 until that gitignore is narrowed.

## Why baselines are gitignored

Baseline JSONs include real production user data (emails, firebaseUIDs, role lists, organizer associations). Even in a private repo that's PII we don't need in git history. The **scripts** are the durable artifact — re-running `capture-baseline.sh` against current PROD reproduces the baseline anytime.

## Adding new checks

Per Layer 3 in `PROD-DEPLOY-PROTECTION.md`:
1. Identify "risky areas" the next promotion's commits touch
2. Add a corresponding capture call in `capture-baseline.sh`
3. Add a corresponding `chk` assertion in `verify.sh`
4. Run pre-merge to seed the baseline; verify post-merge

For boundary-value tests (when PROD data doesn't naturally exercise the new capability — e.g., a cap raise on a small dataset): add explicit edge-case requests in `verify.sh`. See the existing `[4b]` block for an example.

## Last verified state

This pattern was established during the v1.28.1 → v1.28.3 promotion (PR #25, 2026-04-27) — bundle:
- CALBEAF-128 (operator scripts)
- CALBEAF-132 (TW Referer scrape-guard)
- CALBEAF-143 (role populate appId scope fix)
- CALBEAF-146 (TW page cap 100 → 500)

Result: 19/19 checks passed (including 3 boundary-value tests for the cap raise on a dataset that didn't naturally exercise the new ceiling).
