# Full Reconciliation Analysis Report

**Generated**: 2026-02-17
**Databases Compared**: `TangoTiempo` vs `TangoTiempoProd`

---

## Executive Summary

The divergence between databases is **much smaller than expected**:

| Category | Count | Notes |
|----------|-------|-------|
| Events only in `TangoTiempo` (LIVE) | 1 | Test event created Feb 17 |
| Events only in `TangoTiempoProd` (DEV) | 15 | Old events from March 2024 + 2 future HJ events |
| Events with field differences | 6 | All AZUL events (isActive flag) |
| Total events in both (identical) | **995** | No action needed |

**Key Finding**: 99.4% of organizer-created events are identical in both databases.

---

## Level 1: Collection-Level Summary

| Collection | `TangoTiempo` | `TangoTiempoProd` | Difference |
|------------|---------------|-------------------|------------|
| events | 1,575 | 1,670 | +95 |
| organizers | 59 | 59 | = |
| venues | 584 | 584 | = |
| userlogins | 48 | 46 | -2 |
| categories | 21 | 21 | = |
| masteredcities | 215 | 215 | = |
| masteredregions | 38 | 38 | = |
| mastereddivisions | 67 | 67 | = |
| masteredcountries | 51 | 51 | = |
| roles | 11 | 11 | = |

**Analysis**:
- The +95 event difference is mostly AI-discovered events (+81 fb-conditioner)
- Only 14 organizer-created events differ
- 2 more userlogins in LIVE (people who signed up on tangotiempo.com)

---

## Level 2: Organizer-Level Event Comparison

### Organizers with Divergent Event Counts

| Organizer | `TangoTiempo` | `TangoTiempoProd` | Only TT | Only TTP | In Both | Diff |
|-----------|---------------|-------------------|---------|----------|---------|------|
| ULTIMATE | 78 | 82 | 0 | 4 | 78 | +4 |
| SOCIETY | 365 | 367 | 0 | 2 | 365 | +2 |
| MILT-CORI | 12 | 14 | 0 | 2 | 12 | +2 |
| MIT | 12 | 14 | 0 | 2 | 12 | +2 |
| SUENO | 75 | 76 | 0 | 1 | 75 | +1 |
| LAURA | 11 | 12 | 0 | 1 | 11 | +1 |
| SUN-PRAC | 61 | 62 | 0 | 1 | 61 | +1 |
| YBOTMAN | 25 | 24 | 1 | 0 | 24 | -1 |

### Organizers with Identical Event Counts (22 organizers)

HARVARD, MISHA, QTB, HSUEH-TZE, ROGER, ACADEMY, ANDI, SPARK, AFFAIR, BLUE, DORTAN, CORAZON, WESTMA, UNKNOWN, AZUL, BTO, PS1, SGALLER, V-KRUTA, TTCALTESTER, ALEX, HENRAH

**Note**: AZUL has identical counts but 6 events have different `isActive` values.

---

## Level 2B: AI-Discovered Events

| Discovery Source | `TangoTiempo` | `TangoTiempoProd` | Difference |
|------------------|---------------|-------------------|------------|
| fb-conditioner | 254 | 335 | +81 |
| fb-conditioner-extrapolated | 319 | 319 | = |

**Action**: The +81 fb-conditioner events in `TangoTiempoProd` should be kept - they're legitimate AI-discovered events that were loaded to DEV but not synced to LIVE.

---

## Level 3: Userlogins Comparison

| Database | Count |
|----------|-------|
| `TangoTiempo` (LIVE) | 48 |
| `TangoTiempoProd` (DEV) | 46 |

### Userlogins Only in `TangoTiempo` (17 users)

These are real users who signed up via tangotiempo.com:

```
NkZKrURW5YXKd8DIHFwlHpR49ty2
KQ8KM0YEbXO4ZRxM6EYYeSF3H1n1
c64iyovWSVPNHF9OX3U0q5RAzGF2
voTQnvDLiDOwfukUmHlFSDcNzSR2
0YJZlEY5ctdosApAEyq8Qdp4cpd2
xMvcIV5nA8P6CHJb3ArrGE78TC03
E7exTzXemtWrUiEYUKILh8aacJ72
JYn7FamLNafweR1S4dtNKK2QR0Y2
8AlAgkb0TCZF9p6hN6ER42rDbGd2
7ysVrcT6SaZ5DLO4Fx8rIvzE0kf2
0iHJIMno9ES18C0W3ifLXNQVUYr1
4ouaYyFZY3eiKorWZidoKmFWU5t1
cc0j07NnggWPCcOsb6aOi8AatVs2
RAwXfWmNdQcV848Exiuxoo2kRBI3
NJirrGbOzuY0wckkbLnVIP49NZK2
Q8Bydfq4ZMXrBkam1ZeyqaURx4b2
tiKEJCWnw6ZS0elSXJZBzlNR0gH3
```

**Action**: These need to be copied to `TangoTiempoProd` before frontend swap.

### Userlogins Only in `TangoTiempoProd` (15 users)

Likely test/dev accounts:

```
g3dLVabdZCZVh49sYTMYAQGZHdg1
NJirrGbOzuY0wckkbLnVIP49NZK2
T1a2bMt4eahyp3uitwV1d3YXE7F3
mTVZZqI8Y5RDTXibivtGalwEC5o1
pomhJimptyYWeVEdvLzr8zN6S2h2
mpliDdfHtxaad5Bj0UZrvPDJcRs2
QCFRf5vg0GSQAAWkFygvdYciN5n1
ekUo8TP5RmTMcUX5s9VQh5U5Ckt2
JTosPrKRN0gQBhkbuM6DVoj27CG2
8uKPwknLB5YCmejSfK9mflSNRD42
nzjSVHSrD1O8c48msNSB7XEPkVC3
KWrkB2lOOzMI4TD8Q6wZRdpkTHN2
RAwXfWmNdQcV848Exiuxoo2kRBI3
Dp6dXorvfKa1C9GdGIStcv0XI592
ea8r0x8t1CUmLHev99teyMu2SbX2
```

**Action**: Review if any are real organizers. Most can probably stay (test accounts).

---

## Level 4: Unique Events Details

### Events ONLY in `TangoTiempo` (LIVE) - 1 event

| Organizer | Created | Title |
|-----------|---------|-------|
| YBOTMAN | 2026-02-17 | TEST |

**Action**: This is a test event. Delete from `TangoTiempo` or ignore.

### Events ONLY in `TangoTiempoProd` (DEV) - 15 events

| Organizer | Start Date | Title | Notes |
|-----------|------------|-------|-------|
| LAURA | 2024-03-02 | Partylonga NoHo | Old, deleted from LIVE |
| SOCIETY | 2024-03-02 | Milonga TRANOCHANDO Hosted by Guillermo | Old |
| SUENO | 2024-03-02 | Argentine Tango in West Hartford, CT | Old |
| MILT-CORI | 2024-03-03 | Milonga NUEVA | Old |
| MILT-CORI | 2024-03-03 | Milonga NUEVA: March with Melina! | Old |
| ULTIMATE | 2024-03-03 | UT Beginner's Tango – Learn Argentine Ta | Old |
| ULTIMATE | 2024-03-03 | UT Pre-Advanced Argentine Tango – Forwar | Old |
| ULTIMATE | 2024-03-03 | Do things together! Learn Argentine Tang | Old |
| ULTIMATE | 2024-03-03 | UT – Beginner – Do things together! Lear | Old |
| SUN-PRAC | 2024-03-03 | Boston Weekly Sunday Practica | Old |
| SOCIETY | 2024-03-03 | "PRACTILONGA CAMINITO" –the true Practic | Old |
| MIT | 2024-03-04 | MIT Tango Class 1: Beginner/Adv Beginner | Old |
| MIT | 2024-03-05 | MIT Tango Class 2: Intermediate | Old |
| BHS | 2027-07-04 | 2027 BHS International Convention | Future HJ event |
| HI | 2027-11-10 | Harmony Inc. International Convention 20 | Future HJ event |

**Analysis**:
- 13 events from March 2024 - these were intentionally deleted from LIVE
- 2 future HarmonyJunction events (appId=2) - legitimate, should stay

**Action**: Delete the 13 old events from `TangoTiempoProd`, keep the 2 HJ events.

---

## Level 5: Field-Level Differences

### Events with Different Field Values - 6 events (all AZUL)

| Event Title | Field | `TangoTiempo` | `TangoTiempoProd` |
|-------------|-------|---------------|-------------------|
| Milonga Sal Azul | isActive | **false** | true |
| Milonga Sal Azul | isActive | **false** | true |
| Milonga Sal Azul | isActive | **false** | true |
| Milonga Sal Azul | isActive | **false** | true |
| Milonga Sal Azul | isActive | **false** | true |
| Milonga Sal Azul | isActive | **false** | true |

**Analysis**: AZUL intentionally deactivated 6 events on the LIVE site. This deactivation needs to be applied to `TangoTiempoProd`.

**Action**: Set `isActive: false` for these 6 events in `TangoTiempoProd`.

---

## Reconciliation Action Plan

### Phase 1A: AZUL Events (Priority: HIGH)

1. Get list of 6 AZUL event IDs with `isActive` mismatch
2. Update `TangoTiempoProd`: Set `isActive: false` for these 6 events
3. Verify

### Phase 1B: Old Events Cleanup (Priority: MEDIUM)

1. Delete 13 old events (March 2024) from `TangoTiempoProd`
2. These were intentionally removed from LIVE

### Phase 1C: Test Event (Priority: LOW)

1. Delete YBOTMAN "TEST" event from `TangoTiempo` (or leave it, it's harmless)

### Phase 2: Userlogins

1. Copy 17 userlogins from `TangoTiempo` to `TangoTiempoProd`
2. These are real users who signed up on LIVE site

### Phase 3: Frontend Swap

After all above is complete, swap Vercel environment variables.

---

## Summary Statistics

| Metric | Value |
|--------|-------|
| Total organizer-created events in `TangoTiempo` | 1,002 |
| Total organizer-created events in `TangoTiempoProd` | 1,016 |
| Events identical in both | 995 (99.4%) |
| Events with field differences | 6 |
| Events unique to `TangoTiempo` | 1 |
| Events unique to `TangoTiempoProd` | 15 |
| Userlogins to copy to `TangoTiempoProd` | 17 |

**Conclusion**: The database divergence is minimal. Reconciliation is straightforward.

---

## Appendix: Scripts Used

```bash
# Run full analysis
node scripts/reconciliation-analysis.js

# Backup verification
node -e "require('./local.settings.json'); ..." # See BACKUP-LOG.md
```
