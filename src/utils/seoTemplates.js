// src/utils/seoTemplates.js
// CALBEAF-159 — SEO HTML templates per segment + source for SEO content build (CALBEAF-157).
//
// 8 active variants: 4 categories × 2 sources (RO=organizer-set, AI=isDiscovered).
// CLASS category deferred. RO includes image + organizer block; AI omits both.
//
// Dispatch: renderSeoPage(event, { segment, source, occurrenceDate, niche })
//   - event: full event doc (Mongo shape)
//   - segment: 'milonga' | 'practica' | 'travelworthy' | 'beginner'
//   - source: 'RO' | 'AI'
//   - occurrenceDate: Date|null — for recurring events, the specific occurrence; null for one-off
//   - niche: { slug, displayName, domain } — e.g., { slug: 'TT', displayName: 'TangoTiempo', domain: 'www.tangotiempo.com' }

'use strict';

// =============================================================================
// HTML escape — defense against organizer/AI-discovered text injection
// =============================================================================
function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeJsonString(s) {
    if (s == null) return '';
    return String(s).replace(/[\\"]/g, (c) => '\\' + c).replace(/[\n\r\t]/g, ' ');
}

function truncate(s, n = 160) {
    if (!s) return '';
    const clean = String(s).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    return clean.length <= n ? clean : clean.slice(0, n - 1).trimEnd() + '…';
}

// =============================================================================
// Per-segment + per-source blurbs — awaiting final copy from Sarah/Quinn
// =============================================================================
const BLURBS = {
    RO: {
        milonga:      'A milonga is a social Argentine tango dance — an evening where the community gathers to connect through music and movement. This event is listed directly by a TangoTiempo organizer. TangoTiempo is a free global calendar for the Argentine tango community.',
        practica:     'A practica is an informal Argentine tango practice session — a relaxed space to work on technique, explore new figures, and grow as a dancer. This event is posted by a TangoTiempo organizer. TangoTiempo is a free global calendar connecting tango dancers everywhere.',
        travelworthy: 'This is a travelworthy tango event — a multi-day festival, marathon, or encuentro that draws dancers from across the region or around the world. Posted by a TangoTiempo organizer as a destination event worth planning a trip for. TangoTiempo is a free global tango calendar helping you find the best events near you and far from home.',
        beginner:     'This event is explicitly beginner-friendly — a welcoming space for anyone new to Argentine tango, from first-timers to those still finding their footing. Posted by a TangoTiempo organizer who has marked it as appropriate for beginners. TangoTiempo is a free global tango calendar for dancers at every level.',
    },
    AI: {
        milonga:      'A milonga is a social Argentine tango dance where the community gathers to dance and connect. TangoTiempo discovered and aggregated this event from public sources — confirm details with the organizer before attending. TangoTiempo is a free global calendar for the Argentine tango community worldwide.',
        practica:     'A practica is an informal Argentine tango practice session where dancers work on technique in a low-pressure, community setting. TangoTiempo discovered and aggregated this event from public sources — confirm details with the organizer. TangoTiempo is a free global calendar connecting tango dancers everywhere.',
        travelworthy: 'This tango festival, marathon, or encuentro has been identified by TangoTiempo as travelworthy — an event that draws dancers beyond the local community and is worth the journey. Discovered and aggregated from public sources — verify details with the organizer before booking travel. TangoTiempo is a free global calendar helping dancers find events worth the trip.',
        beginner:     'This event has been identified as beginner-friendly — a welcoming entry point for those new to Argentine tango. TangoTiempo discovered and aggregated this event from public sources; we encourage beginners to contact the organizer to confirm it\'s the right fit. TangoTiempo is a free global tango calendar for dancers at every stage of the journey.',
    },
};

// Schema.org @type by segment
const SCHEMA_TYPE = {
    milonga: 'Event',
    practica: 'Event',
    travelworthy: 'Event',
    beginner: 'Event',
};

// =============================================================================
// Block renderers — small composable pieces
// =============================================================================
function renderImageBlock(event, source) {
    if (source === 'AI') return ''; // AI variants omit image
    if (!event.eventImage) return '';
    return `<figure class="event-image">
      <img src="${escapeHtml(event.eventImage)}" alt="${escapeHtml(event.title)}" loading="lazy">
    </figure>`;
}

function renderOrganizerBlock(event, source) {
    if (source === 'AI') return ''; // AI variants omit organizer
    const name = event.ownerOrganizerName || event.organizerName;
    if (!name) return '';
    return `<section class="organizer">
      <h2>Organizer</h2>
      <p>${escapeHtml(name)}</p>
    </section>`;
}

function renderDateBlock(event, occurrenceDate) {
    const date = occurrenceDate || event.startDate;
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    const dateStr = d.toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'
    });
    return `<section class="event-date"><p><strong>Date:</strong> ${escapeHtml(dateStr)}</p></section>`;
}

function renderLocationBlock(event) {
    const venueName = event.venueName || '';
    const city = event.masteredCityName || event.venueCityName || '';
    const country = event.masteredCountryName || '';
    const parts = [venueName, city, country].filter(Boolean);
    if (parts.length === 0) return '';
    return `<section class="event-location"><p><strong>Location:</strong> ${escapeHtml(parts.join(', '))}</p></section>`;
}

function renderDescriptionBlock(event) {
    if (!event.description) return '';
    return `<section class="description"><p>${escapeHtml(event.description)}</p></section>`;
}

function renderSourceBlock(event, source) {
    if (source !== 'AI') return '';
    if (!event.source) return '';
    return `<section class="source-attribution">
      <p><small>Originally discovered from: <a href="${escapeHtml(event.source)}" rel="nofollow noopener">external source</a></small></p>
    </section>`;
}

// =============================================================================
// JSON-LD structured data — Schema.org Event
// =============================================================================
function renderJsonLd(event, segment, source, occurrenceDate, seoUrl, niche) {
    const startDate = occurrenceDate
        ? (occurrenceDate instanceof Date ? occurrenceDate : new Date(occurrenceDate))
        : (event.startDate instanceof Date ? event.startDate : new Date(event.startDate));
    const endDate = event.endDate instanceof Date ? event.endDate : new Date(event.endDate);

    const schema = {
        '@context': 'https://schema.org',
        '@type': SCHEMA_TYPE[segment] || 'Event',
        name: escapeJsonString(event.title || ''),
        description: escapeJsonString(truncate(event.description, 500)),
        startDate: !isNaN(startDate.getTime()) ? startDate.toISOString() : undefined,
        endDate: !isNaN(endDate.getTime()) ? endDate.toISOString() : undefined,
        url: seoUrl,
        eventStatus: 'https://schema.org/EventScheduled',
        eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        organizer: {
            '@type': 'Organization',
            name: 'TangoTiempo',
            url: `https://${niche.domain}`,
        },
        offers: {
            '@type': 'Offer',
            price: '0',
            priceCurrency: 'USD',
            availability: 'https://schema.org/InStock',
            url: `https://${niche.domain}`,
        },
    };

    if (event.venueName || event.masteredCityName || event.venueCityName) {
        schema.location = {
            '@type': 'Place',
            name: escapeJsonString(event.venueName || ''),
            address: {
                '@type': 'PostalAddress',
                addressLocality: escapeJsonString(event.masteredCityName || event.venueCityName || ''),
                addressCountry: escapeJsonString(event.masteredCountryName || ''),
            },
        };
    }

    if (source === 'RO' && (event.ownerOrganizerName || event.organizerName)) {
        schema.organizer = [
            { '@type': 'Organization', name: 'TangoTiempo', url: `https://${niche.domain}` },
            { '@type': 'Organization', name: escapeJsonString(event.ownerOrganizerName || event.organizerName) },
        ];
    }

    if (source === 'RO' && event.eventImage) {
        schema.image = event.eventImage;
    }

    return `<script type="application/ld+json">${JSON.stringify(schema)}</script>`;
}

// =============================================================================
// Main renderer
// =============================================================================
function renderSeoPage(event, options) {
    const { segment, source, occurrenceDate = null, niche } = options;

    if (!event || !event._id || !event.title) {
        throw new Error('renderSeoPage: event missing required fields (_id, title)');
    }
    if (!['milonga', 'practica', 'travelworthy', 'beginner'].includes(segment)) {
        throw new Error(`renderSeoPage: invalid segment ${segment}`);
    }
    if (!['RO', 'AI'].includes(source)) {
        throw new Error(`renderSeoPage: invalid source ${source}`);
    }
    if (!niche || !niche.slug || !niche.domain) {
        throw new Error('renderSeoPage: niche.slug and niche.domain required');
    }

    const occIso = occurrenceDate
        ? (occurrenceDate instanceof Date ? occurrenceDate : new Date(occurrenceDate)).toISOString().slice(0, 10)
        : null;
    const seoBase = `https://seo.${niche.domain.replace(/^www\./, '')}`;
    const seoUrl = occIso
        ? `${seoBase}/${segment}/${source}/${event._id}-${occIso}.html`
        : `${seoBase}/${segment}/${source}/${event._id}.html`;

    // TT route is /event/{id} (singular) — confirmed in tangotiempo.com/src/app/event/[id]/page.js
    const ttUrl = `https://${niche.domain}/event/${event._id}${occIso ? `?date=${occIso}` : ''}`;

    const blurb = BLURBS[source][segment] || '';
    const datePretty = occurrenceDate
        ? (occurrenceDate instanceof Date ? occurrenceDate : new Date(occurrenceDate)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
        : (event.startDate ? new Date(event.startDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');

    const titleTag = `${event.title}${datePretty ? ` — ${datePretty}` : ''} | ${niche.displayName}`;
    const metaDesc = truncate(event.description || `${event.title} — ${segment} on ${niche.displayName}`, 160);

    const ogImage = (source === 'RO' && event.eventImage)
        ? `<meta property="og:image" content="${escapeHtml(event.eventImage)}">`
        : '';

    const aiBadge = source === 'AI'
        ? `<p class="ai-badge">AI-Discovered — aggregated from public sources by TangoTiempo</p>`
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(titleTag)}</title>
<meta name="description" content="${escapeHtml(metaDesc)}">
<link rel="canonical" href="${escapeHtml(seoUrl)}">
<meta name="robots" content="index, follow">
<meta property="og:title" content="${escapeHtml(event.title)}">
<meta property="og:description" content="${escapeHtml(metaDesc)}">
<meta property="og:type" content="event">
<meta property="og:url" content="${escapeHtml(seoUrl)}">
${ogImage}
${renderJsonLd(event, segment, source, occurrenceDate, seoUrl, niche)}
</head>
<body>
<header class="tt-header">
  <a href="https://${escapeHtml(niche.domain)}">${escapeHtml(niche.displayName)}</a>
  <span class="tt-tagline">Free tango calendar for the world</span>
</header>
<main>
<h1>${escapeHtml(event.title)}</h1>
${aiBadge}
${renderDateBlock(event, occurrenceDate)}
${renderLocationBlock(event)}
${renderImageBlock(event, source)}
${renderOrganizerBlock(event, source)}
${renderDescriptionBlock(event)}
<section class="tt-blurb">
<p>${escapeHtml(blurb)}</p>
</section>
<p class="cta"><a href="${escapeHtml(ttUrl)}">View &amp; register on ${escapeHtml(niche.displayName)} →</a></p>
${renderSourceBlock(event, source)}
</main>
<footer>
<p><a href="https://${escapeHtml(niche.domain)}">${escapeHtml(niche.displayName)}</a> — Free tango calendar for the world. <a href="https://${escapeHtml(niche.domain)}/${escapeHtml(segment)}">More ${escapeHtml(segment)} events →</a></p>
</footer>
</body>
</html>`;
}

module.exports = {
    renderSeoPage,
    // exposed for tests:
    escapeHtml,
    truncate,
    BLURBS,
};
