# User Login Analytics - MongoDB Indexes

This document defines the MongoDB indexes needed for optimal query performance on the User Login Analytics collections.

## Collections

### 1. UserLoginHistory
Raw, immutable login events for audit trail and detailed analysis.

### 2. UserLoginAnalytics
Aggregated analytics per user for fast dashboard queries and heatmaps.

---

## Required Indexes

### UserLoginHistory Collection

```javascript
// 1. Find all logins for a user (most common query)
db.UserLoginHistory.createIndex({ firebaseUserId: 1, timestamp: -1 });

// 2. Filter by date range for analytics
db.UserLoginHistory.createIndex({ timestamp: -1 });

// 3. Geo queries for heatmaps (find logins near a location)
db.UserLoginHistory.createIndex({
    "latitude": 1,
    "longitude": 1
});

// 4. Find logins by location
db.UserLoginHistory.createIndex({ country: 1, region: 1, city: 1 });

// 5. Device analytics
db.UserLoginHistory.createIndex({ deviceType: 1, timestamp: -1 });

// 6. IP tracking for security
db.UserLoginHistory.createIndex({ ip: 1, timestamp: -1 });
```

### UserLoginAnalytics Collection

```javascript
// 1. Primary key - lookup user analytics
db.UserLoginAnalytics.createIndex({ firebaseUserId: 1 }, { unique: true });

// 2. Find users by last known location (for targeting)
db.UserLoginAnalytics.createIndex({
    "lastKnownLocation.country": 1,
    "lastKnownLocation.region": 1,
    "lastKnownLocation.city": 1
});

// 3. Geo queries for user heatmaps
db.UserLoginAnalytics.createIndex({
    "lastKnownLocation.latitude": 1,
    "lastKnownLocation.longitude": 1
});

// 4. Find active users
db.UserLoginAnalytics.createIndex({ lastLoginAt: -1 });

// 5. Find users who login frequently
db.UserLoginAnalytics.createIndex({ totalLogins: -1 });

// 6. Location history queries
db.UserLoginAnalytics.createIndex({ "locationHistory.city": 1 });
```

---

## Example Queries

### For Heatmaps

```javascript
// 1. User location heatmap (where are our users?)
db.UserLoginAnalytics.aggregate([
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
            userCount: { $sum: 1 },
            totalLogins: { $sum: "$totalLogins" }
        }
    },
    {
        $sort: { userCount: -1 }
    }
]);

// 2. Login frequency by day of week
db.UserLoginAnalytics.aggregate([
    {
        $project: {
            logins: { $objectToArray: "$loginsByDayOfWeek" }
        }
    },
    {
        $unwind: "$logins"
    },
    {
        $group: {
            _id: "$logins.k",
            totalLogins: { $sum: "$logins.v" }
        }
    },
    {
        $sort: { _id: 1 }
    }
]);

// 3. Device usage breakdown
db.UserLoginAnalytics.aggregate([
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
            count: { $sum: "$devices.v" }
        }
    }
]);
```

### For Targeted Outreach

```javascript
// 1. Find users in specific region (e.g., Boston area for tango event promotion)
db.UserLoginAnalytics.find({
    "lastKnownLocation.city": "Boston",
    "lastKnownLocation.region": "Massachusetts"
}, {
    firebaseUserId: 1,
    lastKnownLocation: 1,
    totalLogins: 1,
    lastLoginAt: 1
});

// 2. Find users who login on weekends (good for event targeting)
db.UserLoginAnalytics.find({
    $or: [
        { "loginsByDayOfWeek.Saturday": { $gt: 5 } },
        { "loginsByDayOfWeek.Sunday": { $gt: 5 } }
    ]
}, {
    firebaseUserId: 1,
    lastKnownLocation: 1,
    loginsByDayOfWeek: 1
}).sort({ totalLogins: -1 });

// 3. Gap analysis: Users in areas with no events
// (Requires joining with Events collection)
db.UserLoginAnalytics.aggregate([
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
            userCount: { $sum: 1 },
            users: { $push: "$firebaseUserId" }
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
                                { $eq: ["$venue.region", "$$region"] }
                            ]
                        }
                    }
                }
            ],
            as: "events"
        }
    },
    {
        $match: {
            events: { $size: 0 } // Cities with NO events
        }
    },
    {
        $sort: { userCount: -1 }
    },
    {
        $project: {
            city: "$_id.city",
            region: "$_id.region",
            country: "$_id.country",
            userCount: 1,
            message: {
                $concat: [
                    { $toString: "$userCount" },
                    " tango enthusiasts in ",
                    "$_id.city",
                    " searching for events!"
                ]
            }
        }
    }
]);
```

### For Security & Anomaly Detection

```javascript
// 1. Find users with logins from multiple countries (potential account sharing)
db.UserLoginAnalytics.find({
    $where: "this.locationHistory.length > 1"
}, {
    firebaseUserId: 1,
    locationHistory: 1
}).forEach(user => {
    const countries = new Set(user.locationHistory.map(loc => loc.country));
    if (countries.size > 2) {
        print(`User ${user.firebaseUserId} has logins from ${countries.size} countries`);
    }
});

// 2. Recent login activity (last 7 days)
const sevenDaysAgo = new Date();
sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

db.UserLoginHistory.find({
    timestamp: { $gte: sevenDaysAgo }
}).sort({ timestamp: -1 });

// 3. Find all IPs used by a user (security audit)
db.UserLoginHistory.distinct("ip", {
    firebaseUserId: "user123"
});
```

---

## Setup Script

Run this script in MongoDB shell to create all indexes:

```javascript
// UserLoginHistory indexes
db.UserLoginHistory.createIndex({ firebaseUserId: 1, timestamp: -1 });
db.UserLoginHistory.createIndex({ timestamp: -1 });
db.UserLoginHistory.createIndex({ latitude: 1, longitude: 1 });
db.UserLoginHistory.createIndex({ country: 1, region: 1, city: 1 });
db.UserLoginHistory.createIndex({ deviceType: 1, timestamp: -1 });
db.UserLoginHistory.createIndex({ ip: 1, timestamp: -1 });

// UserLoginAnalytics indexes
db.UserLoginAnalytics.createIndex({ firebaseUserId: 1 }, { unique: true });
db.UserLoginAnalytics.createIndex({
    "lastKnownLocation.country": 1,
    "lastKnownLocation.region": 1,
    "lastKnownLocation.city": 1
});
db.UserLoginAnalytics.createIndex({
    "lastKnownLocation.latitude": 1,
    "lastKnownLocation.longitude": 1
});
db.UserLoginAnalytics.createIndex({ lastLoginAt: -1 });
db.UserLoginAnalytics.createIndex({ totalLogins: -1 });
db.UserLoginAnalytics.createIndex({ "locationHistory.city": 1 });

print("✅ All indexes created successfully!");
```

---

## Performance Notes

1. **Compound Indexes**: The order matters. Most selective field should come first.
2. **Geo Indexes**: For spatial queries (nearby users), consider using 2dsphere index:
   ```javascript
   db.UserLoginAnalytics.createIndex({
       "lastKnownLocation": "2dsphere"
   });
   ```
3. **Index Size**: Monitor index size with `db.UserLoginAnalytics.stats()`.
4. **Query Plans**: Use `.explain("executionStats")` to verify indexes are being used.

---

**Last Updated:** 2025-10-15
**Maintained By:** AI-GUILD YBOTBOT
