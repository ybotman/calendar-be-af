/**
 * Timezone mapping utilities for venue timezone auto-detection
 * Ported from calendar-be utils/timezoneMapping.js (CALBE-45)
 */

const STATE_TIMEZONE_MAP = {
    'CT': 'America/New_York', 'DC': 'America/New_York', 'DE': 'America/New_York',
    'FL': 'America/New_York', 'GA': 'America/New_York', 'IN': 'America/Indiana/Indianapolis',
    'KY': 'America/New_York', 'MA': 'America/New_York', 'MD': 'America/New_York',
    'ME': 'America/New_York', 'MI': 'America/Detroit', 'NC': 'America/New_York',
    'NH': 'America/New_York', 'NJ': 'America/New_York', 'NY': 'America/New_York',
    'OH': 'America/New_York', 'PA': 'America/New_York', 'RI': 'America/New_York',
    'SC': 'America/New_York', 'VA': 'America/New_York', 'VT': 'America/New_York',
    'WV': 'America/New_York',
    'AL': 'America/Chicago', 'AR': 'America/Chicago', 'IA': 'America/Chicago',
    'IL': 'America/Chicago', 'KS': 'America/Chicago', 'LA': 'America/Chicago',
    'MN': 'America/Chicago', 'MO': 'America/Chicago', 'MS': 'America/Chicago',
    'ND': 'America/Chicago', 'NE': 'America/Chicago', 'OK': 'America/Chicago',
    'SD': 'America/Chicago', 'TN': 'America/Chicago', 'TX': 'America/Chicago',
    'WI': 'America/Chicago',
    'CO': 'America/Denver', 'ID': 'America/Boise', 'MT': 'America/Denver',
    'NM': 'America/Denver', 'UT': 'America/Denver', 'WY': 'America/Denver',
    'AZ': 'America/Phoenix',
    'CA': 'America/Los_Angeles', 'NV': 'America/Los_Angeles',
    'OR': 'America/Los_Angeles', 'WA': 'America/Los_Angeles',
    'AK': 'America/Anchorage',
    'HI': 'Pacific/Honolulu'
};

const CITY_TIMEZONE_MAP = {
    'Boston': 'America/New_York', 'New York': 'America/New_York',
    'New York City': 'America/New_York', 'NYC': 'America/New_York',
    'Philadelphia': 'America/New_York', 'Washington': 'America/New_York',
    'Washington DC': 'America/New_York', 'Miami': 'America/New_York',
    'Atlanta': 'America/New_York', 'Chicago': 'America/Chicago',
    'Dallas': 'America/Chicago', 'Houston': 'America/Chicago',
    'Austin': 'America/Chicago', 'Denver': 'America/Denver',
    'Phoenix': 'America/Phoenix', 'Los Angeles': 'America/Los_Angeles',
    'San Francisco': 'America/Los_Angeles', 'Seattle': 'America/Los_Angeles',
    'Portland': 'America/Los_Angeles', 'Las Vegas': 'America/Los_Angeles',
    'San Diego': 'America/Los_Angeles', 'Cambridge': 'America/New_York',
    'Somerville': 'America/New_York', 'Brooklyn': 'America/New_York',
    'Queens': 'America/New_York', 'Bronx': 'America/New_York',
    'Arlington': 'America/New_York', 'Alexandria': 'America/New_York'
};

const COUNTRY_TIMEZONE_MAP = {
    'US': 'America/New_York', 'CA': 'America/Toronto',
    'MX': 'America/Mexico_City', 'GB': 'Europe/London',
    'FR': 'Europe/Paris', 'DE': 'Europe/Berlin',
    'ES': 'Europe/Madrid', 'IT': 'Europe/Rome',
    'JP': 'Asia/Tokyo', 'CN': 'Asia/Shanghai',
    'AU': 'Australia/Sydney', 'BR': 'America/Sao_Paulo',
    'AR': 'America/Argentina/Buenos_Aires'
};

/**
 * Get timezone for a venue based on location data
 * Priority: existing tz > city name > state > country > default
 */
function getTimezoneForVenue(venue) {
    if (venue.timezone) return venue.timezone;
    if (venue.city) {
        const cityTz = CITY_TIMEZONE_MAP[venue.city];
        if (cityTz) return cityTz;
    }
    if (venue.state) {
        const stateTz = STATE_TIMEZONE_MAP[venue.state.toUpperCase()];
        if (stateTz) return stateTz;
    }
    if (venue.country) {
        const countryTz = COUNTRY_TIMEZONE_MAP[venue.country.toUpperCase()];
        if (countryTz) return countryTz;
    }
    return 'America/New_York';
}

module.exports = {
    STATE_TIMEZONE_MAP,
    CITY_TIMEZONE_MAP,
    COUNTRY_TIMEZONE_MAP,
    getTimezoneForVenue
};
