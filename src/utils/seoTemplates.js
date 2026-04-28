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
// Per-segment + per-source TT blurbs (placeholder copy — swap in seoBlurbs.js or here)
// =============================================================================
const BLURBS = {
    RO: {
        milonga: 'A milonga is a tango social dance event where dancers gather to enjoy traditional Argentine tango music and dancing. This event is organized and curated by a registered TangoTiempo organizer.',
        practica: 'A practica is a tango practice session — less formal than a milonga, with dancers refining technique and trying new patterns. Hosted by a TangoTiempo organizer.',
        travelworthy: 'This is a multi-day, travel-worthy tango event — festivals, marathons, encuentros — designed for dancers traveling from out of town. Organized by a TangoTiempo registered organizer.',
        beginner: 'This event is marked as a beginner-only event by the organizer — a welcoming space for those new to Argentine tango.',
    },
    AI: {
        milonga: 'A milonga is a tango social dance event. This listing was automatically discovered from external sources and curated for the TangoTiempo community.',
        practica: 'A practica is a tango practice session. This listing was automatically discovered from external sources and added to TangoTiempo.',
        travelworthy: 'This multi-day tango event was discovered from external sources — likely a festival, marathon, or encuentro — and is recommended for traveling tango dancers.',
        beginner: 'This beginner-friendly tango event was identified from external sources. New dancers welcome.',
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
        schema.organizer = {
            '@type': 'Organization',
            name: escapeJsonString(event.ownerOrganizerName || event.organizerName),
        };
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

    const ttUrl = `https://${niche.domain}/events/${event._id}${occIso ? `?date=${occIso}` : ''}`;

    const blurb = BLURBS[source][segment] || '';
    const datePretty = occurrenceDate
        ? (occurrenceDate instanceof Date ? occurrenceDate : new Date(occurrenceDate)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
        : (event.startDate ? new Date(event.startDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');

    const titleTag = `${event.title}${datePretty ? ` — ${datePretty}` : ''} | ${niche.displayName}`;
    const metaDesc = truncate(event.description || `${event.title} — ${segment} on ${niche.displayName}`, 160);

    const ogImage = (source === 'RO' && event.eventImage)
        ? `<meta property="og:image" content="${escapeHtml(event.eventImage)}">`
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
<main>
<h1>${escapeHtml(event.title)}</h1>
${renderDateBlock(event, occurrenceDate)}
${renderLocationBlock(event)}
${renderImageBlock(event, source)}
${renderOrganizerBlock(event, source)}
${renderDescriptionBlock(event)}
<section class="tt-blurb">
<p>${escapeHtml(blurb)}</p>
</section>
<p class="cta"><a href="${escapeHtml(ttUrl)}">View this event on ${escapeHtml(niche.displayName)} →</a></p>
${renderSourceBlock(event, source)}
</main>
<footer>
<p><small>Part of <a href="https://${escapeHtml(niche.domain)}">${escapeHtml(niche.displayName)}</a>'s calendar of ${escapeHtml(segment)} events.</small></p>
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
