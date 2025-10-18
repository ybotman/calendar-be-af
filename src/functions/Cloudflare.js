// src/functions/Cloudflare.js
// Cloudflare information endpoint - Exposes Cloudflare headers to frontend
const { app } = require('@azure/functions');
const { standardMiddleware } = require('../middleware');

/**
 * GET /api/cloudflare/info
 *
 * @description Exposes Cloudflare proxy headers to frontend
 * Frontend JavaScript cannot read HTTP request headers directly,
 * so this endpoint reads the headers and returns them in the response body.
 *
 * Cloudflare Headers:
 * - CF-Connecting-IP: Real visitor IP address (bypasses proxies)
 * - CF-IPCountry: Two-letter country code (ISO 3166-1 alpha-2)
 * - CF-Ray: Unique request identifier for debugging
 * - CF-Visitor: Protocol information (http/https)
 *
 * Use Cases:
 * - Get user's real IP address for geolocation
 * - Display user's country
 * - Track visitor location for analytics
 * - Debugging with CF-Ray ID
 *
 * @returns {CloudflareInfo} Cloudflare headers and visitor information
 *
 * @example
 * GET /api/cloudflare/info
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "ip": "203.45.67.89",
 *     "country": "US",
 *     "countryName": "United States",
 *     "ray": "8a1b2c3d4e5f6789",
 *     "protocol": "https",
 *     "headers": {
 *       "cf-connecting-ip": "203.45.67.89",
 *       "cf-ipcountry": "US",
 *       "cf-ray": "8a1b2c3d4e5f6789",
 *       "cf-visitor": "{\"scheme\":\"https\"}"
 *     }
 *   }
 * }
 */
async function cloudflareInfoHandler(request, context) {
    context.log('Cloudflare_Info: Request received');

    try {
        // Read Cloudflare headers
        const cfConnectingIp = request.headers.get('cf-connecting-ip');
        const cfCountry = request.headers.get('cf-ipcountry');
        const cfRay = request.headers.get('cf-ray');
        const cfVisitor = request.headers.get('cf-visitor');

        // Fallback to X-Forwarded-For if not behind Cloudflare
        const fallbackIp = request.headers.get('x-forwarded-for')?.split(',')[0]
                        || request.headers.get('x-real-ip')
                        || 'unknown';

        const visitorIp = cfConnectingIp || fallbackIp;

        // Parse CF-Visitor JSON if present
        let protocol = 'unknown';
        if (cfVisitor) {
            try {
                const visitorData = JSON.parse(cfVisitor);
                protocol = visitorData.scheme || 'unknown';
            } catch (e) {
                context.log('Failed to parse CF-Visitor header');
            }
        }

        // Country name mapping (common countries)
        const countryNames = {
            'US': 'United States',
            'CA': 'Canada',
            'GB': 'United Kingdom',
            'AU': 'Australia',
            'DE': 'Germany',
            'FR': 'France',
            'IT': 'Italy',
            'ES': 'Spain',
            'MX': 'Mexico',
            'BR': 'Brazil',
            'JP': 'Japan',
            'CN': 'China',
            'IN': 'India',
            'RU': 'Russia',
            'NL': 'Netherlands',
            'SE': 'Sweden',
            'NO': 'Norway',
            'DK': 'Denmark',
            'FI': 'Finland',
            'PL': 'Poland',
            'CH': 'Switzerland',
            'AT': 'Austria',
            'BE': 'Belgium',
            'IE': 'Ireland',
            'NZ': 'New Zealand',
            'SG': 'Singapore',
            'KR': 'South Korea',
            'AR': 'Argentina',
            'CL': 'Chile',
            'CO': 'Colombia',
            'PT': 'Portugal',
            'GR': 'Greece',
            'CZ': 'Czech Republic',
            'HU': 'Hungary',
            'RO': 'Romania',
            'TH': 'Thailand',
            'PH': 'Philippines',
            'MY': 'Malaysia',
            'VN': 'Vietnam',
            'ID': 'Indonesia',
            'ZA': 'South Africa',
            'EG': 'Egypt',
            'IL': 'Israel',
            'TR': 'Turkey',
            'SA': 'Saudi Arabia',
            'AE': 'United Arab Emirates',
            'XX': 'Unknown'
        };

        const countryName = cfCountry ? (countryNames[cfCountry] || cfCountry) : 'Unknown';

        context.log('Cloudflare info retrieved:', {
            ip: visitorIp,
            country: cfCountry || 'unknown',
            behindCloudflare: !!cfConnectingIp
        });

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                data: {
                    ip: visitorIp,
                    country: cfCountry || 'unknown',
                    countryName: countryName,
                    ray: cfRay || null,
                    protocol: protocol,
                    behindCloudflare: !!cfConnectingIp,
                    headers: {
                        'cf-connecting-ip': cfConnectingIp || null,
                        'cf-ipcountry': cfCountry || null,
                        'cf-ray': cfRay || null,
                        'cf-visitor': cfVisitor || null,
                        'x-forwarded-for': request.headers.get('x-forwarded-for') || null,
                        'x-real-ip': request.headers.get('x-real-ip') || null
                    }
                },
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        // Let errorHandler middleware handle the error
        throw error;
    }
}

// Register function with standard middleware
app.http('Cloudflare_Info', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'cloudflare/info',
    handler: standardMiddleware(cloudflareInfoHandler)
});
