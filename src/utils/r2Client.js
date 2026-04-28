// src/utils/r2Client.js
// CALBEAF-157 — Cloudflare R2 writer wrapper (S3-compatible via AWS SDK v3).
//
// Niche-aware: reads per-niche credentials from environment variables.
// If any required env var is missing, returns null — callers must guard.
//
// Required env vars (per niche):
//   R2_ENDPOINT              — https://<account_id>.r2.cloudflarestorage.com
//   R2_BUCKET_<SLUG>         — bucket name, e.g. R2_BUCKET_TT
//   R2_ACCESS_KEY_ID_<SLUG>  — R2 Access Key ID
//   R2_SECRET_ACCESS_KEY_<SLUG> — R2 Secret Access Key
//
// Kill switch (must be 'true' on PROD only):
//   SEO_WRITES_ENABLED — if not exactly 'true', all puts are skipped

'use strict';

const { S3Client, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const SEO_WRITES_ENABLED = process.env.SEO_WRITES_ENABLED === 'true';

/**
 * Build an S3Client pointed at R2 for the given niche slug.
 * Returns null if any required env var is absent.
 */
function buildR2Client(nicheSlug) {
    const slug = (nicheSlug || '').toUpperCase();
    const endpoint = process.env.R2_ENDPOINT;
    const bucket = process.env[`R2_BUCKET_${slug}`];
    const accessKeyId = process.env[`R2_ACCESS_KEY_ID_${slug}`];
    const secretAccessKey = process.env[`R2_SECRET_ACCESS_KEY_${slug}`];

    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
        return null;
    }

    const client = new S3Client({
        region: 'auto',
        endpoint,
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle: false,
    });

    return { client, bucket };
}

/**
 * Write HTML content to R2 at key `path`.
 * Returns { written: true, key } on success.
 * Returns { written: false, reason } when skipped (no client or kill switch).
 * Throws on upload error.
 */
async function putHtml(nicheSlug, path, html) {
    if (!SEO_WRITES_ENABLED) {
        return { written: false, reason: 'SEO_WRITES_ENABLED not set' };
    }

    const r2 = buildR2Client(nicheSlug);
    if (!r2) {
        return { written: false, reason: `R2 creds not configured for niche ${nicheSlug}` };
    }

    const cmd = new PutObjectCommand({
        Bucket: r2.bucket,
        Key: path,
        Body: html,
        ContentType: 'text/html; charset=utf-8',
        CacheControl: 'public, max-age=3600',
    });

    await r2.client.send(cmd);
    return { written: true, key: path };
}

/**
 * List objects in a bucket prefix (for diagnostics).
 * Returns array of keys, or [] if not configured.
 */
async function listKeys(nicheSlug, prefix = '') {
    const r2 = buildR2Client(nicheSlug);
    if (!r2) return [];

    const cmd = new ListObjectsV2Command({ Bucket: r2.bucket, Prefix: prefix, MaxKeys: 100 });
    const res = await r2.client.send(cmd);
    return (res.Contents || []).map((o) => o.Key);
}

module.exports = { putHtml, listKeys, SEO_WRITES_ENABLED };
