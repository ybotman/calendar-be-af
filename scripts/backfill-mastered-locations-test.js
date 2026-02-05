// backfill-mastered-locations-test.js
// Backfill mastered location fields on isDiscovered events in TEST
// Run with: mongosh "$MONGODB_URI_TEST" --file scripts/backfill-mastered-locations-test.js

const appId = "1";
const dryRun = false; // Set to true to preview without updating

print("=== Backfill Mastered Locations (TEST - isDiscovered only) ===");
print(`Dry run: ${dryRun}`);
print("");

// ============================================
// STEP 1: Find events missing mastered data
// ============================================
print("=== STEP 1: Finding isDiscovered events missing mastered data ===");

const eventsToFix = db.events.find({
  appId: appId,
  isDiscovered: true,
  $or: [
    { masteredCityName: null },
    { masteredCityName: { $exists: false } }
  ],
  venueID: { $ne: null, $exists: true }
}).toArray();

print(`Found ${eventsToFix.length} isDiscovered events missing masteredCityName`);

if (eventsToFix.length === 0) {
  print("Nothing to fix!");
  quit();
}

// ============================================
// STEP 2: Get unique venue IDs
// ============================================
print("\n=== STEP 2: Getting unique venues ===");

const venueIds = [...new Set(eventsToFix.map(e => {
  if (!e.venueID) return null;
  // Handle both ObjectId and string
  return typeof e.venueID === 'string' ? e.venueID : e.venueID.toString();
}).filter(Boolean))];
print(`Found ${venueIds.length} unique venues to process`);

// ============================================
// STEP 3: Build venue -> mastered location map
// ============================================
print("\n=== STEP 3: Building venue mastered location map ===");

const venueMap = new Map();
let venuesWithMastered = 0;
let venuesWithoutMastered = 0;

for (const venueIdStr of venueIds) {
  let venueId;
  try {
    venueId = ObjectId(venueIdStr);
  } catch (e) {
    print(`  ! Invalid venue ID: ${venueIdStr}`);
    continue;
  }
  const venue = db.venues.findOne({ _id: venueId });

  if (!venue) {
    print(`  ! Venue not found: ${venueIdStr}`);
    continue;
  }

  // Check if venue has masteredCityId
  let masteredData = null;

  if (venue.masteredCityId) {
    // Get city (might be populated object or ObjectId)
    let city = venue.masteredCityId;
    if (venue.masteredCityId._id) {
      // Already populated
      city = venue.masteredCityId;
    } else {
      // Need to lookup
      city = db.masteredcities.findOne({ _id: venue.masteredCityId });
    }

    if (city) {
      // Get division
      let division = null;
      if (city.masteredDivisionId) {
        division = db.mastereddivisions.findOne({ _id: city.masteredDivisionId });
      }

      // Get region
      let region = null;
      if (division && division.masteredRegionId) {
        region = db.masteredregions.findOne({ _id: division.masteredRegionId });
      }

      // Get country
      let country = null;
      if (region && region.masteredCountryId) {
        country = db.masteredcountries.findOne({ _id: region.masteredCountryId });
      }

      masteredData = {
        masteredCityId: city._id,
        masteredCityName: city.cityName,
        masteredCityGeolocation: city.location || null,
        masteredDivisionId: division ? division._id : null,
        masteredDivisionName: division ? division.divisionName : null,
        masteredRegionId: region ? region._id : null,
        masteredRegionName: region ? region.regionName : null,
        masteredCountryId: country ? country._id : null,
        masteredCountryName: country ? country.countryName : null
      };

      venuesWithMastered++;
    }
  }

  // If venue doesn't have masteredCityId, try to find nearest city by venue geolocation
  if (!masteredData && venue.geolocation && venue.geolocation.coordinates) {
    const nearestCity = db.masteredcities.findOne({
      appId: appId,
      location: {
        $near: {
          $geometry: venue.geolocation,
          $maxDistance: 100000 // 100km
        }
      }
    });

    if (nearestCity) {
      // Get division
      let division = null;
      if (nearestCity.masteredDivisionId) {
        division = db.mastereddivisions.findOne({ _id: nearestCity.masteredDivisionId });
      }

      // Get region
      let region = null;
      if (division && division.masteredRegionId) {
        region = db.masteredregions.findOne({ _id: division.masteredRegionId });
      }

      // Get country
      let country = null;
      if (region && region.masteredCountryId) {
        country = db.masteredcountries.findOne({ _id: region.masteredCountryId });
      }

      masteredData = {
        masteredCityId: nearestCity._id,
        masteredCityName: nearestCity.cityName,
        masteredCityGeolocation: nearestCity.location || null,
        masteredDivisionId: division ? division._id : null,
        masteredDivisionName: division ? division.divisionName : null,
        masteredRegionId: region ? region._id : null,
        masteredRegionName: region ? region.regionName : null,
        masteredCountryId: country ? country._id : null,
        masteredCountryName: country ? country.countryName : null
      };

      venuesWithMastered++;

      // Also update the venue with masteredCityId
      if (!dryRun) {
        db.venues.updateOne(
          { _id: venue._id },
          { $set: { masteredCityId: nearestCity._id } }
        );
      }
    } else {
      venuesWithoutMastered++;
    }
  } else if (!masteredData) {
    venuesWithoutMastered++;
  }

  venueMap.set(venueIdStr, masteredData);
}

print(`Venues with mastered data: ${venuesWithMastered}`);
print(`Venues without mastered data: ${venuesWithoutMastered}`);

// ============================================
// STEP 4: Update events
// ============================================
print("\n=== STEP 4: Updating events ===");

let updated = 0;
let skipped = 0;

for (const event of eventsToFix) {
  if (!event.venueID) {
    skipped++;
    continue;
  }
  const venueIdStr = typeof event.venueID === 'string' ? event.venueID : event.venueID.toString();
  const masteredData = venueMap.get(venueIdStr);

  if (!masteredData) {
    skipped++;
    continue;
  }

  if (dryRun) {
    print(`  [DRY RUN] Would update: ${event.title?.substring(0, 40)} -> ${masteredData.masteredCityName}`);
  } else {
    db.events.updateOne(
      { _id: event._id },
      { $set: masteredData }
    );
  }

  updated++;
}

print(`\nUpdated: ${updated}`);
print(`Skipped (no mastered data): ${skipped}`);

// ============================================
// STEP 5: Summary
// ============================================
print("\n=== SUMMARY ===");
print(`Total isDiscovered events processed: ${eventsToFix.length}`);
print(`Events updated with mastered data: ${updated}`);
print(`Events skipped (venue has no mastered city): ${skipped}`);

if (dryRun) {
  print("\n[DRY RUN MODE - No changes made]");
  print("Set dryRun = false to apply changes");
}
