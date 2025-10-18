# Visitor Tracking - MongoDB Indexes

This document defines the MongoDB indexes needed for optimal query performance on the Visitor Tracking collections.

## Collections

### 1. VisitorTrackingHistory
Raw, immutable visit events for audit trail and detailed analysis.

### 2. VisitorTrackingAnalytics
Aggregated analytics per IP for fast dashboard queries and heatmaps.

---

## Required Indexes

### VisitorTrackingHistory Collection

```javascript
// 1. Deduplication check (most frequently used query)
db.VisitorTrackingHistory.createIndex({ ip: 1, timestamp: -1 });

// 2. Find all visits for an IP
db.VisitorTrackingHistory.createIndex({ ip: 1, timestamp: -1 });

// 3. Find visits to specific pages
db.VisitorTrackingHistory.createIndex({ page: 1, timestamp: -1 });

// 4. Geo queries for heatmaps
db.VisitorTrackingHistory.createIndex({
    "latitude": 1,
    "longitude": 1
});

// 5. Find visits by location
db.VisitorTrackingHistory.createIndex({ country: 1, region: 1, city: 1 });

// 6. Device analytics
db.VisitorTrackingHistory.createIndex({ deviceType: 1, timestamp: -1 });

// 7. Date range queries
db.VisitorTrackingHistory.createIndex({ timestamp: -1 });
```

### VisitorTrackingAnalytics Collection

```javascript
// 1. Primary key - lookup visitor by IP
db.VisitorTrackingAnalytics.createIndex({ ip: 1 }, { unique: true });

// 2. Find visitors by last known location
db.VisitorTrackingAnalytics.createIndex({
    "lastKnownLocation.country": 1,
    "lastKnownLocation.region": 1,
    "lastKnownLocation.city": 1
});

// 3. Geo queries for visitor heatmaps
db.VisitorTrackingAnalytics.createIndex({
    "lastKnownLocation.latitude": 1,
    "lastKnownLocation.longitude": 1
});

// 4. Find recent visitors
db.VisitorTrackingAnalytics.createIndex({ lastVisitAt: -1 });

// 5. Find frequent visitors
db.VisitorTrackingAnalytics.createIndex({ totalVisits: -1 });

// 6. Find visitors interested in specific pages
db.VisitorTrackingAnalytics.createIndex({ "pagesVisited": 1 });

// 7. Conversion tracking - find unconverted visitors
db.VisitorTrackingAnalytics.createIndex({ convertedToUser: 1, totalVisits: -1 });
```

---

## Example Analytics Queries

### For Heatmaps

```javascript
// 1. Visitor location heatmap (pre-login interest)
db.VisitorTrackingAnalytics.aggregate([
    {
        $match: {
            "lastKnownLocation.latitude": { $exists: true },
            "lastKnownLocation.longitude": { $exists: true }
        }
    },
    {
        $group: {
            _id: {
                city: "$lastKnownLocation.city",
                lat: "$lastKnownLocation.latitude",
                lng: "$lastKnownLocation.longitude"
            },
            visitorCount: { $sum: 1 },
            totalVisits: { $sum: "$totalVisits" },
            converted: { $sum: { $cond: ["$convertedToUser", 1, 0] } }
        }
    },
    {
        $project: {
            city: "$_id.city",
            lat: "$_id.lat",
            lng: "$_id.lng",
            visitorCount: 1,
            totalVisits: 1,
            converted: 1,
            conversionRate: {
                $cond: [
                    { $gt: ["$visitorCount", 0] },
                    { $multiply: [{ $divide: ["$converted", "$visitorCount"] }, 100] },
                    0
                ]
            }
        }
    },
    {
        $sort: { visitorCount: -1 }
    }
]);

// 2. Page interest by location
db.VisitorTrackingHistory.aggregate([
    {
        $match: { page: "/calendar/boston" }
    },
    {
        $group: {
            _id: {
                city: "$city",
                region: "$region"
            },
            visits: { $sum: 1 },
            uniqueVisitors: { $addToSet: "$ip" }
        }
    },
    {
        $project: {
            city: "$_id.city",
            region: "$_id.region",
            visits: 1,
            uniqueVisitorCount: { $size: "$uniqueVisitors" }
        }
    },
    {
        $sort: { uniqueVisitorCount: -1 }
    }
]);

// 3. Device usage breakdown
db.VisitorTrackingAnalytics.aggregate([
    {
        $project: {
            devices: { $objectToArray: "$devices" }
        }
    },
    {
        $unwind: "$devices"
    },
    {
        $group: {
            _id: "$devices.k",
            totalCount: { $sum: "$devices.v" }
        }
    },
    {
        $sort: { totalCount: -1 }
    }
]);

// 4. Visit patterns by day/hour
db.VisitorTrackingAnalytics.aggregate([
    {
        $project: {
            dayOfWeek: { $objectToArray: "$visitsByDayOfWeek" }
        }
    },
    {
        $unwind: "$dayOfWeek"
    },
    {
        $group: {
            _id: "$dayOfWeek.k",
            totalVisits: { $sum: "$dayOfWeek.v" }
        }
    },
    {
        $sort: { _id: 1 }
    }
]);
```

### For Conversion Funnel Analysis

```javascript
// 1. Conversion rate by city
db.VisitorTrackingAnalytics.aggregate([
    {
        $group: {
            _id: "$lastKnownLocation.city",
            totalVisitors: { $sum: 1 },
            converted: { $sum: { $cond: ["$convertedToUser", 1, 0] } },
            avgVisitsBeforeConversion: {
                $avg: { $cond: ["$convertedToUser", "$totalVisits", null] }
            }
        }
    },
    {
        $project: {
            city: "$_id",
            totalVisitors: 1,
            converted: 1,
            notConverted: { $subtract: ["$totalVisitors", "$converted"] },
            conversionRate: {
                $multiply: [{ $divide: ["$converted", "$totalVisitors"] }, 100]
            },
            avgVisitsBeforeConversion: { $round: ["$avgVisitsBeforeConversion", 1] }
        }
    },
    {
        $match: { totalVisitors: { $gte: 5 } } // Only cities with 5+ visitors
    },
    {
        $sort: { conversionRate: -1 }
    }
]);

// 2. High-intent visitors (visited multiple times but not converted)
db.VisitorTrackingAnalytics.find({
    convertedToUser: false,
    totalVisits: { $gte: 3 }
}, {
    ip: 1,
    lastKnownLocation: 1,
    totalVisits: 1,
    pagesVisited: 1,
    lastVisitAt: 1
}).sort({ totalVisits: -1 }).limit(100);

// Message: "100 high-intent visitors not yet converted - retargeting opportunity!"

// 3. Page popularity before conversion
db.VisitorTrackingAnalytics.aggregate([
    {
        $match: { convertedToUser: true }
    },
    {
        $project: {
            pages: { $objectToArray: "$pagesVisited" }
        }
    },
    {
        $unwind: "$pages"
    },
    {
        $group: {
            _id: "$pages.k",
            totalViews: { $sum: "$pages.v" },
            userCount: { $sum: 1 }
        }
    },
    {
        $project: {
            page: "$_id",
            totalViews: 1,
            userCount: 1,
            avgViewsPerUser: { $divide: ["$totalViews", "$userCount"] }
        }
    },
    {
        $sort: { userCount: -1 }
    }
]);

// Answer: "Which pages drive conversions?"
```

### For Geographic Targeting

```javascript
// 1. Cities with high interest but low conversion
db.VisitorTrackingAnalytics.aggregate([
    {
        $group: {
            _id: {
                city: "$lastKnownLocation.city",
                region: "$lastKnownLocation.region",
                country: "$lastKnownLocation.country"
            },
            visitorCount: { $sum: 1 },
            totalVisits: { $sum: "$totalVisits" },
            converted: { $sum: { $cond: ["$convertedToUser", 1, 0] } }
        }
    },
    {
        $project: {
            city: "$_id.city",
            region: "$_id.region",
            country: "$_id.country",
            visitorCount: 1,
            totalVisits: 1,
            converted: 1,
            conversionRate: {
                $multiply: [{ $divide: ["$converted", "$visitorCount"] }, 100]
            },
            avgVisitsPerVisitor: { $divide: ["$totalVisits", "$visitorCount"] }
        }
    },
    {
        $match: {
            visitorCount: { $gte: 10 },      // At least 10 visitors
            conversionRate: { $lt: 10 }       // Less than 10% conversion
        }
    },
    {
        $sort: { visitorCount: -1 }
    }
]);

// Message: "Boston has 50 visitors (avg 3 visits each) but only 4% convert - targeting opportunity!"

// 2. New vs. returning visitors by location
db.VisitorTrackingAnalytics.aggregate([
    {
        $group: {
            _id: "$lastKnownLocation.city",
            totalVisitors: { $sum: 1 },
            singleVisitors: {
                $sum: { $cond: [{ $eq: ["$totalVisits", 1] }, 1, 0] }
            },
            repeatingVisitors: {
                $sum: { $cond: [{ $gt: ["$totalVisits", 1] }, 1, 0] }
            }
        }
    },
    {
        $project: {
            city: "$_id",
            totalVisitors: 1,
            singleVisitors: 1,
            repeatingVisitors: 1,
            returnRate: {
                $multiply: [
                    { $divide: ["$repeatingVisitors", "$totalVisitors"] },
                    100
                ]
            }
        }
    },
    {
        $sort: { returnRate: -1 }
    }
]);

// 3. Gap analysis: Visitors in cities with no events
// (Combine with Events collection)
db.VisitorTrackingAnalytics.aggregate([
    {
        $match: {
            "lastKnownLocation.city": { $exists: true }
        }
    },
    {
        $group: {
            _id: {
                city: "$lastKnownLocation.city",
                region: "$lastKnownLocation.region",
                country: "$lastKnownLocation.country"
            },
            visitorCount: { $sum: 1 },
            totalVisits: { $sum: "$totalVisits" },
            ips: { $push: "$ip" }
        }
    },
    {
        $lookup: {
            from: "Events",
            let: { city: "$_id.city", region: "$_id.region" },
            pipeline: [
                {
                    $match: {
                        $expr: {
                            $and: [
                                { $eq: ["$venue.city", "$$city"] },
                                { $eq: ["$venue.region", "$$region"] },
                                { $gte: ["$startDate", new Date()] }
                            ]
                        }
                    }
                }
            ],
            as: "upcomingEvents"
        }
    },
    {
        $match: {
            upcomingEvents: { $size: 0 }  // Cities with NO upcoming events
        }
    },
    {
        $sort: { visitorCount: -1 }
    },
    {
        $project: {
            city: "$_id.city",
            region: "$_id.region",
            country: "$_id.country",
            visitorCount: 1,
            totalVisits: 1,
            message: {
                $concat: [
                    { $toString: "$visitorCount" },
                    " visitors from ",
                    "$_id.city",
                    " but no events scheduled - opportunity!"
                ]
            }
        }
    }
]);
```

---

## Setup Script

Run this script in MongoDB shell to create all indexes:

```javascript
// VisitorTrackingHistory indexes
db.VisitorTrackingHistory.createIndex({ ip: 1, timestamp: -1 });
db.VisitorTrackingHistory.createIndex({ page: 1, timestamp: -1 });
db.VisitorTrackingHistory.createIndex({ latitude: 1, longitude: 1 });
db.VisitorTrackingHistory.createIndex({ country: 1, region: 1, city: 1 });
db.VisitorTrackingHistory.createIndex({ deviceType: 1, timestamp: -1 });
db.VisitorTrackingHistory.createIndex({ timestamp: -1 });

// VisitorTrackingAnalytics indexes
db.VisitorTrackingAnalytics.createIndex({ ip: 1 }, { unique: true });
db.VisitorTrackingAnalytics.createIndex({
    "lastKnownLocation.country": 1,
    "lastKnownLocation.region": 1,
    "lastKnownLocation.city": 1
});
db.VisitorTrackingAnalytics.createIndex({
    "lastKnownLocation.latitude": 1,
    "lastKnownLocation.longitude": 1
});
db.VisitorTrackingAnalytics.createIndex({ lastVisitAt: -1 });
db.VisitorTrackingAnalytics.createIndex({ totalVisits: -1 });
db.VisitorTrackingAnalytics.createIndex({ "pagesVisited": 1 });
db.VisitorTrackingAnalytics.createIndex({ convertedToUser: 1, totalVisits: -1 });

print("✅ All visitor tracking indexes created successfully!");
```

---

## Link Visitor to User (Conversion Tracking)

When a visitor converts to a logged-in user:

```javascript
// After successful user registration/login
// Link the visitor IP to the user ID

const userIp = request.headers.get('CF-Connecting-IP');

await db.VisitorTrackingAnalytics.updateOne(
    { ip: userIp },
    {
        $set: {
            convertedToUser: true,
            firebaseUserId: user.uid,
            conversionDate: new Date()
        }
    }
);
```

This enables funnel analysis: visitor → user conversion tracking.

---

## Performance Notes

1. **Deduplication Query**: Most frequent query (every visitor hit). Compound index on `{ip: 1, timestamp: -1}` is critical.
2. **Geo Indexes**: For spatial queries (nearby visitors), consider 2dsphere index:
   ```javascript
   db.VisitorTrackingAnalytics.createIndex({
       "lastKnownLocation": "2dsphere"
   });
   ```
3. **TTL Index** (Optional): Auto-delete old visitor data after N days:
   ```javascript
   db.VisitorTrackingHistory.createIndex(
       { timestamp: 1 },
       { expireAfterSeconds: 7776000 } // 90 days
   );
   ```

---

**Last Updated:** 2025-10-15
**Maintained By:** AI-GUILD YBOTBOT
