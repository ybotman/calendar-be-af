# Changes by Organizer

**Generated**: 2026-02-17
**Source of Truth**: `TangoTiempo` database (LIVE site - tangotiempo.com)

This document shows what each organizer did on the LIVE site that needs to be reflected in `TangoTiempoProd`.

---

## Summary

| Organizer | Created | Deactivated | Deleted from LIVE |
|-----------|---------|-------------|-------------------|
| AZUL | 0 | **6** | 0 |
| YBOTMAN | **1** | 0 | 0 |
| ULTIMATE | 0 | 0 | 4 |
| SOCIETY | 0 | 0 | 2 |
| MILT-CORI | 0 | 0 | 2 |
| MIT | 0 | 0 | 2 |
| LAURA | 0 | 0 | 1 |
| SUENO | 0 | 0 | 1 |
| SUN-PRAC | 0 | 0 | 1 |
| BHS | 0 | 0 | 1 (HarmonyJunction) |
| HI | 0 | 0 | 1 (HarmonyJunction) |

**Note**: "Deleted from LIVE" means these events exist in `TangoTiempoProd` but were removed from `TangoTiempo` (LIVE). We need to delete them from `TangoTiempoProd` to match.

---

## AZUL (Milonga Sal Azul Team)

### DEACTIVATED on LIVE (6 events)

AZUL deactivated these upcoming milonga events on the LIVE site:

| Start Date | Event Title |
|------------|-------------|
| 2026-02-20 | Milonga Sal Azul |
| 2026-02-27 | Milonga Sal Azul |
| 2026-03-06 | Milonga Sal Azul |
| 2026-03-12 | Milonga Sal Azul |
| 2026-03-19 | Milonga Sal Azul |
| 2026-03-26 | Milonga Sal Azul |

**Action**: Set `isActive: false` for these 6 events in `TangoTiempoProd`.

---

## YBOTMAN (Toby Balsley)

### CREATED on LIVE (1 event)

| Start Date | Event Title |
|------------|-------------|
| 2026-02-20 | TEST |

**Action**: This is a test event. Can be deleted from `TangoTiempo` or ignored.

---

## ULTIMATE (Ultimate Tango)

### DELETED from LIVE (4 events)

These old events were deleted from LIVE but still exist in `TangoTiempoProd`:

| Start Date | Event Title |
|------------|-------------|
| 2024-03-03 | UT Beginner's Tango – Learn Argentine Tango in 8 weeks |
| 2024-03-03 | UT Pre-Advanced Argentine Tango – Forward Sacadas |
| 2024-03-03 | Do things together! Learn Argentine Tango! |
| 2024-03-03 | UT – Beginner – Do things together! Learn Argentine Tango |

**Action**: Delete these 4 events from `TangoTiempoProd`.

---

## SOCIETY (Tango Society of Boston)

### DELETED from LIVE (2 events)

| Start Date | Event Title |
|------------|-------------|
| 2024-03-02 | Milonga TRANOCHANDO Hosted by Guillermo Merlo |
| 2024-03-03 | "PRACTILONGA CAMINITO" – the true Practica in Boston |

**Action**: Delete these 2 events from `TangoTiempoProd`.

---

## MILT-CORI (Milton and Corin)

### DELETED from LIVE (2 events)

| Start Date | Event Title |
|------------|-------------|
| 2024-03-03 | Milonga NUEVA |
| 2024-03-03 | Milonga NUEVA: March with Melina! |

**Action**: Delete these 2 events from `TangoTiempoProd`.

---

## MIT (MIT Tango Club)

### DELETED from LIVE (2 events)

| Start Date | Event Title |
|------------|-------------|
| 2024-03-04 | MIT Tango Class 1: Beginner/Adv Beginner |
| 2024-03-05 | MIT Tango Class 2: Intermediate |

**Action**: Delete these 2 events from `TangoTiempoProd`.

---

## LAURA (Laura Grandi)

### DELETED from LIVE (1 event)

| Start Date | Event Title |
|------------|-------------|
| 2024-03-02 | Partylonga NoHo |

**Action**: Delete this event from `TangoTiempoProd`.

---

## SUENO

### DELETED from LIVE (1 event)

| Start Date | Event Title |
|------------|-------------|
| 2024-03-02 | Argentine Tango in West Hartford, CT |

**Action**: Delete this event from `TangoTiempoProd`.

---

## SUN-PRAC (Sunday Practica)

### DELETED from LIVE (1 event)

| Start Date | Event Title |
|------------|-------------|
| 2024-03-03 | Boston Weekly Sunday Practica |

**Action**: Delete this event from `TangoTiempoProd`.

---

## BHS (HarmonyJunction - appId=2)

### DELETED from LIVE (1 event)

| Start Date | Event Title |
|------------|-------------|
| 2027-07-04 | 2027 BHS International Convention |

**Note**: This is a HarmonyJunction event (appId=2), not TangoTiempo. It may have been intentionally created only in DEV for testing.

**Action**: Review - possibly KEEP in `TangoTiempoProd` if it's a legitimate HJ event.

---

## HI (HarmonyJunction - appId=2)

### DELETED from LIVE (1 event)

| Start Date | Event Title |
|------------|-------------|
| 2027-11-10 | Harmony Inc. International Convention 2027 |

**Note**: This is a HarmonyJunction event (appId=2), not TangoTiempo.

**Action**: Review - possibly KEEP in `TangoTiempoProd` if it's a legitimate HJ event.

---

## User Signups on LIVE Site

17 users signed up on tangotiempo.com (LIVE) after the cutover. These userlogins exist in `TangoTiempo` but not in `TangoTiempoProd`:

| Sign-up Date | Name | Notes |
|--------------|------|-------|
| 2025-06-03 | (anonymous) | No name/email stored |
| 2025-09-20 | (anonymous) | |
| 2025-09-21 | (anonymous) | |
| 2025-09-21 | (anonymous) | |
| 2025-09-22 | (anonymous) | |
| 2025-09-24 | (anonymous) | |
| 2025-09-24 | (anonymous) | |
| 2025-09-25 | (anonymous) | |
| 2025-09-25 | (anonymous) | |
| 2025-09-25 | (anonymous) | |
| 2025-10-01 | (anonymous) | |
| 2025-10-30 | (anonymous) | |
| 2026-01-13 | (anonymous) | |
| 2026-01-14 | (anonymous) | |
| 2026-02-07 | (anonymous) | |
| 2026-02-16 | Cyla | Recent signup |
| 2026-02-17 | Elena | Recent signup |

**Action**: Copy these 17 userlogins from `TangoTiempo` to `TangoTiempoProd`.

---

## Action Summary

### To update in `TangoTiempoProd`:

1. **AZUL**: Set `isActive: false` for 6 events
2. **Delete 13 old events** (March 2024) from: ULTIMATE (4), SOCIETY (2), MILT-CORI (2), MIT (2), LAURA (1), SUENO (1), SUN-PRAC (1)
3. **Copy 17 userlogins** from `TangoTiempo`

### To review:

4. **BHS & HI events**: Keep if legitimate HarmonyJunction events
5. **YBOTMAN TEST event**: Delete from `TangoTiempo` (optional)
