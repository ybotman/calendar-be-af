# Data Privacy & GDPR Compliance Guide

**Project**: calendar-be-af (Azure Functions Backend)
**Created**: 2026-02-24
**Author**: Gotan (Overseer)
**Status**: AUDIT COMPLETE — ACTION REQUIRED

---

## Executive Summary

This backend captures significant PII (IP addresses, user IDs, precise geolocation, device fingerprints, behavioral patterns) with **indefinite retention** and **public API access**. Immediate remediation required for EU compliance; improvements recommended for all regions.

---

## Current Data Capture Inventory

| Data Type | Collections | Retention | GDPR Category |
|-----------|-------------|-----------|---------------|
| IP Address | UserLoginHistory, VisitorTrackingHistory, MapCenterHistory | Indefinite | Personal Data |
| Firebase UID | UserLoginHistory, UserLoginAnalytics, MapCenterHistory | Indefinite | Personal Data |
| Precise Location | All tracking collections (lat/long to ~10m accuracy) | Indefinite | Special Category* |
| Device/Browser | All tracking collections (full User-Agent) | Indefinite | Personal Data |
| FCM Token | userlogins | Indefinite | Personal Data |
| Behavioral Patterns | Analytics collections (pages, times, frequency) | Indefinite | Personal Data |

*Precise geolocation may qualify as special category data under certain interpretations.

---

## Regional Compliance Requirements

### Europe (GDPR)

**Legal Framework**: General Data Protection Regulation (EU 2016/679)

| Requirement | Current State | Action Needed |
|-------------|---------------|---------------|
| **Lawful Basis** | None documented | Document basis (consent or legitimate interest) |
| **Consent** | Not collected | Add consent mechanism before tracking |
| **Data Minimization** | Collecting max data | Reduce to necessary fields only |
| **Purpose Limitation** | Not documented | Define and document purposes |
| **Storage Limitation** | Indefinite retention | Implement TTL (30-90 days recommended) |
| **Right to Access** | No endpoint | Add `/api/user/data-export` |
| **Right to Erasure** | No endpoint | Add `/api/user/data-delete` |
| **Right to Portability** | No endpoint | Add JSON export capability |
| **Data Protection by Design** | Not implemented | Encrypt PII, pseudonymize IPs |
| **Records of Processing** | None | Create processing register |
| **DPO Notification** | N/A | Not required (<250 employees) |

**Penalties**: Up to 4% of global annual revenue or €20M, whichever is higher.

**IP Address Handling (GDPR)**:
```
CURRENT (Non-compliant):
  Full IP → Store indefinitely → Public API access

REQUIRED:
  Full IP → Truncate/Hash on write → TTL 30 days → Authenticated access only
```

### United States

**Legal Framework**: Patchwork (CCPA, state laws, sector-specific)

| Regulation | Applies? | Requirements |
|------------|----------|--------------|
| **CCPA/CPRA** (California) | If CA users | Right to know, delete, opt-out of sale |
| **VCDPA** (Virginia) | If VA users | Similar to CCPA |
| **CPA** (Colorado) | If CO users | Similar to CCPA |
| **CTDPA** (Connecticut) | If CT users | Similar to CCPA |
| **UCPA** (Utah) | If UT users | Business-friendly version |

**US Recommendations**:
- Implement "Do Not Sell My Info" if monetizing data
- Honor opt-out requests
- Privacy policy with data practices disclosure
- 45-day response window for data requests

**Note**: US is more permissive than EU. If you comply with GDPR, you largely comply with US state laws.

### Asia-Pacific

| Country | Regulation | Key Requirements |
|---------|------------|------------------|
| **Japan** | APPI (2022 amendments) | Consent for sensitive data, cross-border transfer restrictions |
| **South Korea** | PIPA | Explicit consent required, strict data localization |
| **China** | PIPL | Consent required, data localization mandatory, government access |
| **Singapore** | PDPA | Consent or legitimate interest, data breach notification |
| **Australia** | Privacy Act | APP principles, notifiable data breaches |
| **India** | DPDP Act (2023) | Consent required, data localization for critical data |

**APAC Recommendations**:
- China/Korea: Consider regional data storage or excluding these markets
- Japan/Singapore/Australia: GDPR-like compliance generally sufficient
- All: Implement consent mechanism

---

## Recommended Implementation

### Phase 1: Critical (Do First)

#### 1.1 Secure Analytics Endpoints
```javascript
// CURRENT (insecure)
authLevel: 'anonymous'

// REQUIRED
authLevel: 'function'  // Require API key
// OR
authLevel: 'anonymous' + role-based middleware check
```

**Files to update**:
- `Analytics_LoginHistory.js`
- `Analytics_VisitorHistory.js`
- `Analytics_VisitorHeatmap.js`
- `Analytics_MapCenterHistory.js`
- `Analytics_OrganizerActivity.js`

#### 1.2 IP Address Pseudonymization
```javascript
// src/utils/privacy.js (NEW FILE)
export function pseudonymizeIP(ip) {
  if (!ip || ip === 'unknown') return 'unknown';

  // IPv4: truncate last octet
  if (ip.includes('.')) {
    return ip.replace(/\.\d+$/, '.0');
  }

  // IPv6: truncate last 80 bits
  if (ip.includes(':')) {
    const parts = ip.split(':');
    return parts.slice(0, 3).join(':') + ':0:0:0:0:0';
  }

  return 'unknown';
}

export function hashIP(ip, dailySalt) {
  // For analytics where you need unique counts but not actual IPs
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(ip + dailySalt).digest('hex').slice(0, 16);
}
```

#### 1.3 Add TTL Indexes to MongoDB
```javascript
// Run in MongoDB shell or via migration script

// 90-day retention for raw tracking data
db.UserLoginHistory.createIndex({ "timestamp": 1 }, { expireAfterSeconds: 7776000 });
db.VisitorTrackingHistory.createIndex({ "timestamp": 1 }, { expireAfterSeconds: 7776000 });
db.MapCenterHistory.createIndex({ "timestamp": 1 }, { expireAfterSeconds: 7776000 });

// 1-year retention for aggregated analytics (less PII)
db.UserLoginAnalytics.createIndex({ "lastLogin": 1 }, { expireAfterSeconds: 31536000 });
db.VisitorTrackingAnalytics.createIndex({ "lastVisit": 1 }, { expireAfterSeconds: 31536000 });
```

### Phase 2: GDPR Rights Endpoints

#### 2.1 Data Export Endpoint
```javascript
// src/functions/User_DataExport.js (NEW FILE)
// GET /api/user/data-export
// Auth: Required (Firebase)
// Returns: JSON of all user data across collections
```

#### 2.2 Data Deletion Endpoint
```javascript
// src/functions/User_DataDelete.js (NEW FILE)
// DELETE /api/user/data-delete
// Auth: Required (Firebase)
// Actions:
//   1. Delete from UserLoginHistory (by firebaseUserId)
//   2. Delete from UserLoginAnalytics (by firebaseUserId)
//   3. Delete from MapCenterHistory (by firebaseUserId)
//   4. Delete FCM tokens from userlogins
//   5. Anonymize any remaining references
//   6. Log deletion request (for audit, without PII)
```

### Phase 3: Consent Management

#### 3.1 Consent Tracking
```javascript
// New collection: UserConsent
{
  visitorId: "uuid",           // For anonymous users
  firebaseUserId: "uid",       // For authenticated users
  consents: {
    analytics: { granted: true, timestamp: ISODate(), version: "1.0" },
    marketing: { granted: false, timestamp: ISODate(), version: "1.0" },
    geolocation: { granted: true, timestamp: ISODate(), version: "1.0" }
  },
  ipAtConsent: "truncated",    // For fraud prevention
  updatedAt: ISODate()
}
```

#### 3.2 Consent Check Middleware
```javascript
// src/middleware/consentCheck.js (NEW FILE)
export function requireConsent(consentType) {
  return async (request, context, next) => {
    const visitorId = request.headers.get('X-Visitor-ID');
    const consent = await checkConsent(visitorId, consentType);

    if (!consent) {
      return { status: 451, body: { error: 'Consent required', type: consentType } };
    }

    return next(request, context);
  };
}
```

---

## Logging Best Practices

### What to Log (All Regions)
```javascript
// SAFE to log
context.log(`Request received: ${method} ${path}`);
context.log(`Response: ${statusCode} in ${duration}ms`);
context.log(`Error: ${errorType} - ${sanitizedMessage}`);
context.log(`Correlation ID: ${correlationId}`);
```

### What NOT to Log
```javascript
// NEVER log these
context.log(`User IP: ${ip}`);              // PII
context.log(`User email: ${email}`);         // PII
context.log(`Firebase UID: ${uid}`);         // Can be linked to PII
context.log(`Location: ${lat}, ${long}`);    // Sensitive
context.log(`User-Agent: ${ua}`);            // Fingerprinting risk
```

### Current Violations to Fix

| File | Line | Issue | Fix |
|------|------|-------|-----|
| `UserLoginTrack.js` | ~45 | Logs Firebase UID | Remove or hash |
| `VisitorTrack.js` | ~377 | Logs IP address | Remove |
| `VisitorTrack.js` | ~169 | Logs visitor_id | Remove or hash |

---

## Regional Configuration

Add environment variables to control behavior by region:

```bash
# .env additions
PRIVACY_REGION=eu              # us | eu | apac
PRIVACY_IP_HANDLING=truncate   # truncate | hash | full
PRIVACY_RETENTION_DAYS=90      # TTL for raw tracking data
PRIVACY_CONSENT_REQUIRED=true  # Require consent before tracking
PRIVACY_ANALYTICS_AUTH=true    # Require auth for analytics endpoints
```

```javascript
// src/config/privacy.js (NEW FILE)
export const privacyConfig = {
  region: process.env.PRIVACY_REGION || 'us',

  ipHandling: process.env.PRIVACY_IP_HANDLING ||
    (process.env.PRIVACY_REGION === 'eu' ? 'truncate' : 'full'),

  retentionDays: parseInt(process.env.PRIVACY_RETENTION_DAYS) ||
    (process.env.PRIVACY_REGION === 'eu' ? 90 : 365),

  consentRequired: process.env.PRIVACY_CONSENT_REQUIRED === 'true' ||
    process.env.PRIVACY_REGION === 'eu',

  analyticsAuthRequired: process.env.PRIVACY_ANALYTICS_AUTH === 'true' ||
    process.env.PRIVACY_REGION === 'eu'
};
```

---

## Implementation Priority

| Priority | Task | Effort | Impact |
|----------|------|--------|--------|
| **P0** | Secure analytics endpoints (add auth) | 2 hours | Prevents data breach |
| **P0** | Remove IP/UID from context.log | 1 hour | Stops PII leaking to logs |
| **P1** | Add TTL indexes to MongoDB | 1 hour | Enables data retention |
| **P1** | Implement IP truncation | 2 hours | GDPR IP compliance |
| **P2** | Add data export endpoint | 4 hours | GDPR right to access |
| **P2** | Add data deletion endpoint | 4 hours | GDPR right to erasure |
| **P3** | Consent management system | 8 hours | Full GDPR consent |
| **P3** | Privacy configuration by region | 4 hours | Multi-region support |

---

## Compliance Checklist

### Before EU Launch
- [ ] Analytics endpoints require authentication
- [ ] IP addresses truncated or hashed before storage
- [ ] TTL indexes added to all tracking collections
- [ ] Privacy policy published and linked
- [ ] Cookie consent banner implemented (frontend)
- [ ] Data export endpoint functional
- [ ] Data deletion endpoint functional
- [ ] No PII in application logs
- [ ] Records of processing activities documented

### Before US Launch (CA users)
- [ ] Privacy policy with CCPA disclosures
- [ ] "Do Not Sell" link if applicable
- [ ] Data deletion request process
- [ ] 45-day response capability

### Before APAC Launch
- [ ] Country-specific consent requirements reviewed
- [ ] Data localization requirements assessed
- [ ] Cross-border transfer mechanisms in place

---

## References

- [GDPR Full Text](https://gdpr-info.eu/)
- [CCPA Text](https://oag.ca.gov/privacy/ccpa)
- [ICO Guide to GDPR](https://ico.org.uk/for-organisations/guide-to-data-protection/guide-to-the-general-data-protection-regulation-gdpr/)
- [CNIL Cookie Guidelines](https://www.cnil.fr/en/cookies-and-other-tracking-devices-cnil-publishes-new-guidelines)
- [Azure Functions Security Best Practices](https://learn.microsoft.com/en-us/azure/azure-functions/security-concepts)

---

*Document maintained by Gotan. Last updated: 2026-02-24*
