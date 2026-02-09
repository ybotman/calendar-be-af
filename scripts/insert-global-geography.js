// insert-global-geography.js
// Run with: mongosh "mongodb+srv://..." --file scripts/insert-global-geography.js
// Or copy sections into MongoDB Compass

const appId = "1";
const now = new Date();

// ============================================
// STEP 1: INSERT MISSING COUNTRIES
// ============================================
const newCountries = [
  { countryName: "China", countryCode: "CN", isActive: true },
  { countryName: "Taiwan", countryCode: "TW", isActive: true },
  { countryName: "Singapore", countryCode: "SG", isActive: true },
  { countryName: "Russia", countryCode: "RU", isActive: true },
  { countryName: "Poland", countryCode: "PL", isActive: true },
  { countryName: "Sweden", countryCode: "SE", isActive: true },
  { countryName: "Finland", countryCode: "FI", isActive: true },
  { countryName: "Mexico", countryCode: "MX", isActive: true },
  { countryName: "Peru", countryCode: "PE", isActive: true },
  { countryName: "Colombia", countryCode: "CO", isActive: true },
  { countryName: "Chile", countryCode: "CL", isActive: true },
  { countryName: "Portugal", countryCode: "PT", isActive: true },
  { countryName: "Turkey", countryCode: "TR", isActive: true },
  { countryName: "Japan", countryCode: "JP", isActive: true },
  { countryName: "South Korea", countryCode: "KR", isActive: true },
];

print("=== INSERTING COUNTRIES ===");
newCountries.forEach(country => {
  const exists = db.masteredcountries.findOne({ countryName: country.countryName, appId });
  if (!exists) {
    db.masteredcountries.insertOne({
      ...country,
      appId,
      createdAt: now,
      updatedAt: now
    });
    print(`  + Added country: ${country.countryName}`);
  } else {
    print(`  - Exists: ${country.countryName}`);
  }
});

// ============================================
// STEP 2: GET ALL COUNTRY IDs
// ============================================
print("\n=== FETCHING COUNTRY IDs ===");
const countryMap = {};
db.masteredcountries.find({ appId }).forEach(c => {
  countryMap[c.countryName] = c._id;
  print(`  ${c.countryName}: ${c._id}`);
});

// ============================================
// STEP 3: INSERT REGIONS
// ============================================
// Using continent/sub-continent as region for international
const newRegions = [
  // Canada
  { regionName: "Canada", countryName: "Canada" },
  // Europe
  { regionName: "Western Europe", countryName: "United Kingdom" },
  { regionName: "Western Europe", countryName: "France" },
  { regionName: "Western Europe", countryName: "Germany" },
  { regionName: "Western Europe", countryName: "Spain" },
  { regionName: "Western Europe", countryName: "Portugal" },
  { regionName: "Western Europe", countryName: "Italy" },
  { regionName: "Northern Europe", countryName: "Sweden" },
  { regionName: "Northern Europe", countryName: "Finland" },
  { regionName: "Northern Europe", countryName: "Poland" },
  { regionName: "Eastern Europe", countryName: "Russia" },
  { regionName: "Eastern Europe", countryName: "Turkey" },
  // Asia
  { regionName: "East Asia", countryName: "China" },
  { regionName: "East Asia", countryName: "Taiwan" },
  { regionName: "East Asia", countryName: "Japan" },
  { regionName: "East Asia", countryName: "South Korea" },
  { regionName: "Southeast Asia", countryName: "Singapore" },
  // Latin America
  { regionName: "Mexico & Central America", countryName: "Mexico" },
  { regionName: "South America", countryName: "Argentina" },
  { regionName: "South America", countryName: "Brazil" },
  { regionName: "South America", countryName: "Peru" },
  { regionName: "South America", countryName: "Colombia" },
  { regionName: "South America", countryName: "Chile" },
  // Oceania
  { regionName: "Oceania", countryName: "Australia" },
  { regionName: "Oceania", countryName: "New Zealand" },
];

print("\n=== INSERTING REGIONS ===");
newRegions.forEach(region => {
  const countryId = countryMap[region.countryName];
  if (!countryId) {
    print(`  ! Country not found: ${region.countryName}`);
    return;
  }
  const exists = db.masteredregions.findOne({
    regionName: region.regionName,
    masteredCountryId: countryId,
    appId
  });
  if (!exists) {
    db.masteredregions.insertOne({
      regionName: region.regionName,
      masteredCountryId: countryId,
      appId,
      isActive: true,
      createdAt: now,
      updatedAt: now
    });
    print(`  + Added region: ${region.regionName} (${region.countryName})`);
  } else {
    print(`  - Exists: ${region.regionName} (${region.countryName})`);
  }
});

// ============================================
// STEP 4: GET ALL REGION IDs
// ============================================
print("\n=== FETCHING REGION IDs ===");
const regionMap = {};
db.masteredregions.find({ appId }).forEach(r => {
  const country = db.masteredcountries.findOne({ _id: r.masteredCountryId });
  const key = `${r.regionName}|${country ? country.countryName : 'unknown'}`;
  regionMap[key] = r._id;
  print(`  ${r.regionName} (${country ? country.countryName : '?'}): ${r._id}`);
});

// ============================================
// STEP 5: INSERT DIVISIONS
// ============================================
const newDivisions = [
  // Canada
  { divisionName: "Ontario", regionName: "Canada", countryName: "Canada" },
  { divisionName: "Quebec", regionName: "Canada", countryName: "Canada" },
  { divisionName: "British Columbia", regionName: "Canada", countryName: "Canada" },
  { divisionName: "Alberta", regionName: "Canada", countryName: "Canada" },
  // UK
  { divisionName: "England", regionName: "Western Europe", countryName: "United Kingdom" },
  { divisionName: "Scotland", regionName: "Western Europe", countryName: "United Kingdom" },
  // France
  { divisionName: "France", regionName: "Western Europe", countryName: "France" },
  // Germany
  { divisionName: "Germany", regionName: "Western Europe", countryName: "Germany" },
  // Spain
  { divisionName: "Spain", regionName: "Western Europe", countryName: "Spain" },
  // Portugal
  { divisionName: "Portugal", regionName: "Western Europe", countryName: "Portugal" },
  // Italy
  { divisionName: "Italy", regionName: "Western Europe", countryName: "Italy" },
  // Sweden
  { divisionName: "Sweden", regionName: "Northern Europe", countryName: "Sweden" },
  // Finland
  { divisionName: "Finland", regionName: "Northern Europe", countryName: "Finland" },
  // Poland
  { divisionName: "Poland", regionName: "Northern Europe", countryName: "Poland" },
  // Russia
  { divisionName: "Russia", regionName: "Eastern Europe", countryName: "Russia" },
  // Turkey
  { divisionName: "Turkey", regionName: "Eastern Europe", countryName: "Turkey" },
  // China
  { divisionName: "Eastern China", regionName: "East Asia", countryName: "China" },
  { divisionName: "Northern China", regionName: "East Asia", countryName: "China" },
  { divisionName: "Southern China", regionName: "East Asia", countryName: "China" },
  // Taiwan
  { divisionName: "Taiwan", regionName: "East Asia", countryName: "Taiwan" },
  // Japan
  { divisionName: "Japan", regionName: "East Asia", countryName: "Japan" },
  // South Korea
  { divisionName: "South Korea", regionName: "East Asia", countryName: "South Korea" },
  // Singapore
  { divisionName: "Singapore", regionName: "Southeast Asia", countryName: "Singapore" },
  // Mexico
  { divisionName: "Central Mexico", regionName: "Mexico & Central America", countryName: "Mexico" },
  { divisionName: "Northern Mexico", regionName: "Mexico & Central America", countryName: "Mexico" },
  { divisionName: "Yucatan", regionName: "Mexico & Central America", countryName: "Mexico" },
  // Argentina
  { divisionName: "Argentina", regionName: "South America", countryName: "Argentina" },
  // Brazil
  { divisionName: "Southeast Brazil", regionName: "South America", countryName: "Brazil" },
  // Peru
  { divisionName: "Peru", regionName: "South America", countryName: "Peru" },
  // Colombia
  { divisionName: "Colombia", regionName: "South America", countryName: "Colombia" },
  // Chile
  { divisionName: "Chile", regionName: "South America", countryName: "Chile" },
  // Australia
  { divisionName: "Eastern Australia", regionName: "Oceania", countryName: "Australia" },
  { divisionName: "Western Australia", regionName: "Oceania", countryName: "Australia" },
  // New Zealand
  { divisionName: "New Zealand", regionName: "Oceania", countryName: "New Zealand" },
];

print("\n=== INSERTING DIVISIONS ===");
newDivisions.forEach(div => {
  const regionKey = `${div.regionName}|${div.countryName}`;
  const regionId = regionMap[regionKey];
  if (!regionId) {
    print(`  ! Region not found: ${regionKey}`);
    return;
  }
  const exists = db.mastereddivisions.findOne({
    divisionName: div.divisionName,
    masteredRegionId: regionId,
    appId
  });
  if (!exists) {
    db.mastereddivisions.insertOne({
      divisionName: div.divisionName,
      masteredRegionId: regionId,
      appId,
      isActive: true,
      createdAt: now,
      updatedAt: now
    });
    print(`  + Added division: ${div.divisionName} (${div.countryName})`);
  } else {
    print(`  - Exists: ${div.divisionName} (${div.countryName})`);
  }
});

// ============================================
// STEP 6: GET ALL DIVISION IDs
// ============================================
print("\n=== FETCHING DIVISION IDs ===");
const divisionMap = {};
db.mastereddivisions.find({ appId }).forEach(d => {
  divisionMap[d.divisionName] = d._id;
  print(`  ${d.divisionName}: ${d._id}`);
});

// ============================================
// STEP 7: INSERT CITIES
// ============================================
// [lng, lat] format for GeoJSON
const newCities = [
  // === US CITIES (12 missing) ===
  { cityName: "Tucson", divisionName: "Mountain", coords: [-110.9747, 32.2226] },
  { cityName: "Orange County", divisionName: "Pacific", coords: [-117.8311, 33.7175] },
  { cityName: "Sacramento", divisionName: "Pacific", coords: [-121.4944, 38.5816] },
  { cityName: "San Jose", divisionName: "Pacific", coords: [-121.8863, 37.3382] },
  { cityName: "Jacksonville", divisionName: "South Atlantic", coords: [-81.6557, 30.3322] },
  { cityName: "Orlando", divisionName: "South Atlantic", coords: [-81.3792, 28.5383] },
  { cityName: "Tampa", divisionName: "South Atlantic", coords: [-82.4572, 27.9506] },
  { cityName: "Savannah", divisionName: "South Atlantic", coords: [-81.0998, 32.0809] },
  { cityName: "Northampton", divisionName: "New England", coords: [-72.6329, 42.3251] },
  { cityName: "Ann Arbor", divisionName: "East North Central", coords: [-83.7430, 42.2808] },
  { cityName: "Asheville", divisionName: "South Atlantic", coords: [-82.5515, 35.5951] },
  { cityName: "Ithaca", divisionName: "Middle Atlantic", coords: [-76.4966, 42.4440] },

  // === CANADA ===
  { cityName: "Toronto", divisionName: "Ontario", coords: [-79.3832, 43.6532] },
  { cityName: "Vancouver", divisionName: "British Columbia", coords: [-123.1207, 49.2827] },
  { cityName: "Montreal", divisionName: "Quebec", coords: [-73.5673, 45.5017] },
  { cityName: "Calgary", divisionName: "Alberta", coords: [-114.0719, 51.0447] },
  { cityName: "Ottawa", divisionName: "Ontario", coords: [-75.6972, 45.4215] },

  // === UK ===
  { cityName: "London", divisionName: "England", coords: [-0.1276, 51.5074] },
  { cityName: "Manchester", divisionName: "England", coords: [-2.2426, 53.4808] },
  { cityName: "Edinburgh", divisionName: "Scotland", coords: [-3.1883, 55.9533] },

  // === FRANCE ===
  { cityName: "Paris", divisionName: "France", coords: [2.3522, 48.8566] },
  { cityName: "Lyon", divisionName: "France", coords: [4.8357, 45.7640] },
  { cityName: "Marseille", divisionName: "France", coords: [5.3698, 43.2965] },

  // === GERMANY ===
  { cityName: "Berlin", divisionName: "Germany", coords: [13.4050, 52.5200] },
  { cityName: "Munich", divisionName: "Germany", coords: [11.5820, 48.1351] },
  { cityName: "Hamburg", divisionName: "Germany", coords: [9.9937, 53.5511] },

  // === SPAIN ===
  { cityName: "Madrid", divisionName: "Spain", coords: [-3.7038, 40.4168] },
  { cityName: "Barcelona", divisionName: "Spain", coords: [2.1734, 41.3851] },

  // === PORTUGAL ===
  { cityName: "Lisbon", divisionName: "Portugal", coords: [-9.1393, 38.7223] },
  { cityName: "Porto", divisionName: "Portugal", coords: [-8.6291, 41.1579] },

  // === ITALY ===
  { cityName: "Rome", divisionName: "Italy", coords: [12.4964, 41.9028] },
  { cityName: "Milan", divisionName: "Italy", coords: [9.1900, 45.4642] },
  { cityName: "Florence", divisionName: "Italy", coords: [11.2558, 43.7696] },

  // === SWEDEN ===
  { cityName: "Stockholm", divisionName: "Sweden", coords: [18.0686, 59.3293] },
  { cityName: "Gothenburg", divisionName: "Sweden", coords: [11.9746, 57.7089] },

  // === FINLAND ===
  { cityName: "Helsinki", divisionName: "Finland", coords: [24.9384, 60.1699] },

  // === POLAND ===
  { cityName: "Warsaw", divisionName: "Poland", coords: [21.0122, 52.2297] },
  { cityName: "Krakow", divisionName: "Poland", coords: [19.9450, 50.0647] },

  // === RUSSIA ===
  { cityName: "Moscow", divisionName: "Russia", coords: [37.6173, 55.7558] },
  { cityName: "St. Petersburg", divisionName: "Russia", coords: [30.3351, 59.9343] },

  // === TURKEY ===
  { cityName: "Istanbul", divisionName: "Turkey", coords: [28.9784, 41.0082] },
  { cityName: "Ankara", divisionName: "Turkey", coords: [32.8597, 39.9334] },

  // === CHINA ===
  { cityName: "Beijing", divisionName: "Northern China", coords: [116.4074, 39.9042] },
  { cityName: "Shanghai", divisionName: "Eastern China", coords: [121.4737, 31.2304] },
  { cityName: "Guangzhou", divisionName: "Southern China", coords: [113.2644, 23.1291] },
  { cityName: "Shenzhen", divisionName: "Southern China", coords: [114.0579, 22.5431] },
  { cityName: "Hong Kong", divisionName: "Southern China", coords: [114.1694, 22.3193] },
  { cityName: "Chengdu", divisionName: "Eastern China", coords: [104.0665, 30.5728] },

  // === TAIWAN ===
  { cityName: "Taipei", divisionName: "Taiwan", coords: [121.5654, 25.0330] },
  { cityName: "Kaohsiung", divisionName: "Taiwan", coords: [120.3133, 22.6273] },

  // === JAPAN ===
  { cityName: "Tokyo", divisionName: "Japan", coords: [139.6917, 35.6895] },
  { cityName: "Osaka", divisionName: "Japan", coords: [135.5023, 34.6937] },
  { cityName: "Kyoto", divisionName: "Japan", coords: [135.7681, 35.0116] },

  // === SOUTH KOREA ===
  { cityName: "Seoul", divisionName: "South Korea", coords: [126.9780, 37.5665] },
  { cityName: "Busan", divisionName: "South Korea", coords: [129.0756, 35.1796] },

  // === SINGAPORE ===
  { cityName: "Singapore", divisionName: "Singapore", coords: [103.8198, 1.3521] },

  // === MEXICO ===
  { cityName: "Mexico City", divisionName: "Central Mexico", coords: [-99.1332, 19.4326] },
  { cityName: "Guadalajara", divisionName: "Central Mexico", coords: [-103.3496, 20.6597] },
  { cityName: "Monterrey", divisionName: "Northern Mexico", coords: [-100.3161, 25.6866] },
  { cityName: "Cancun", divisionName: "Yucatan", coords: [-86.8515, 21.1619] },

  // === ARGENTINA ===
  { cityName: "Buenos Aires", divisionName: "Argentina", coords: [-58.3816, -34.6037] },
  { cityName: "Mendoza", divisionName: "Argentina", coords: [-68.8272, -32.8895] },
  { cityName: "Cordoba", divisionName: "Argentina", coords: [-64.1888, -31.4201] },

  // === BRAZIL ===
  { cityName: "São Paulo", divisionName: "Southeast Brazil", coords: [-46.6333, -23.5505] },
  { cityName: "Rio de Janeiro", divisionName: "Southeast Brazil", coords: [-43.1729, -22.9068] },

  // === PERU ===
  { cityName: "Lima", divisionName: "Peru", coords: [-77.0428, -12.0464] },

  // === COLOMBIA ===
  { cityName: "Bogotá", divisionName: "Colombia", coords: [-74.0721, 4.7110] },
  { cityName: "Medellín", divisionName: "Colombia", coords: [-75.5636, 6.2442] },

  // === CHILE ===
  { cityName: "Santiago", divisionName: "Chile", coords: [-70.6693, -33.4489] },
  { cityName: "Valparaiso", divisionName: "Chile", coords: [-71.6273, -33.0472] },

  // === AUSTRALIA ===
  { cityName: "Sydney", divisionName: "Eastern Australia", coords: [151.2093, -33.8688] },
  { cityName: "Melbourne", divisionName: "Eastern Australia", coords: [144.9631, -37.8136] },
  { cityName: "Brisbane", divisionName: "Eastern Australia", coords: [153.0251, -27.4698] },
  { cityName: "Perth", divisionName: "Western Australia", coords: [115.8605, -31.9505] },

  // === NEW ZEALAND ===
  { cityName: "Auckland", divisionName: "New Zealand", coords: [174.7633, -36.8485] },
  { cityName: "Wellington", divisionName: "New Zealand", coords: [174.7762, -41.2866] },
];

print("\n=== INSERTING CITIES ===");
let citiesAdded = 0;
let citiesSkipped = 0;

newCities.forEach(city => {
  const divisionId = divisionMap[city.divisionName];
  if (!divisionId) {
    print(`  ! Division not found: ${city.divisionName} for ${city.cityName}`);
    return;
  }

  const exists = db.masteredcities.findOne({
    cityName: city.cityName,
    masteredDivisionId: divisionId,
    appId
  });

  if (!exists) {
    db.masteredcities.insertOne({
      cityName: city.cityName,
      masteredDivisionId: divisionId,
      location: {
        type: "Point",
        coordinates: city.coords
      },
      appId,
      isActive: true,
      createdAt: now,
      updatedAt: now
    });
    print(`  + Added city: ${city.cityName}`);
    citiesAdded++;
  } else {
    print(`  - Exists: ${city.cityName}`);
    citiesSkipped++;
  }
});

print(`\n=== SUMMARY ===`);
print(`Countries: ${db.masteredcountries.countDocuments({ appId })}`);
print(`Regions: ${db.masteredregions.countDocuments({ appId })}`);
print(`Divisions: ${db.mastereddivisions.countDocuments({ appId })}`);
print(`Cities: ${db.masteredcities.countDocuments({ appId })}`);
print(`\nCities added: ${citiesAdded}, skipped: ${citiesSkipped}`);
