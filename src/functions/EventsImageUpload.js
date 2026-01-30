// src/functions/EventsImageUpload.js
// Domain: Events - Image upload to Azure Blob Storage with Firebase auth
const { app } = require('@azure/functions');
const { standardMiddleware } = require('../middleware');
const { firebaseAuth, unauthorizedResponse } = require('../middleware/firebaseAuth');
const { StorageSharedKeyCredential, BlobServiceClient } = require('@azure/storage-blob');
const multipart = require('parse-multipart-data');
const { v4: uuidv4 } = require('uuid');

/**
 * POST /api/events/upload-image
 * Upload an event image to Azure Blob Storage
 *
 * Auth: Firebase auth required
 *
 * Request: multipart/form-data with fields:
 * - image: The image file
 * - appId: Application ID (optional, default: "1")
 *
 * Response: { success: true, imageUrl: "https://..." }
 */
async function eventsUploadImageHandler(request, context) {
    context.log('Events_UploadImage: Request received');

    // Authenticate via Firebase
    const user = await firebaseAuth(request, context);
    if (!user) {
        return unauthorizedResponse();
    }

    const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
    const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;

    if (!accountName || !accountKey) {
        context.log('Events_UploadImage: Missing storage credentials');
        return {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: 'ServiceUnavailable',
                message: 'Azure Storage credentials are not configured. Set AZURE_STORAGE_ACCOUNT_NAME and AZURE_STORAGE_ACCOUNT_KEY environment variables.',
                timestamp: new Date().toISOString()
            })
        };
    }

    // Parse multipart form data
    const contentType = request.headers.get('content-type') || '';
    const boundary = contentType.split('boundary=')[1];

    if (!boundary) {
        return {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: 'ValidationError',
                message: 'Request must be multipart/form-data with a boundary',
                timestamp: new Date().toISOString()
            })
        };
    }

    const bodyBuffer = Buffer.from(await request.arrayBuffer());
    const parts = multipart.parse(bodyBuffer, boundary);

    // Find the image file part
    const imagePart = parts.find(part => part.name === 'image');
    if (!imagePart || !imagePart.data || imagePart.data.length === 0) {
        return {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: 'ValidationError',
                message: 'No image file found. Upload with field name "image".',
                timestamp: new Date().toISOString()
            })
        };
    }

    // Extract appId from form data or default
    const appIdPart = parts.find(part => part.name === 'appId');
    const appId = appIdPart ? appIdPart.data.toString() : '1';

    // Build blob name: {appId}/{uuid}-{originalFilename}
    const originalFilename = imagePart.filename || 'image.jpg';
    const blobName = `${appId}/${uuidv4()}-${originalFilename}`;
    const containerName = 'event-images';

    // Create blob client and upload
    const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);
    const blobServiceClient = new BlobServiceClient(
        `https://${accountName}.blob.core.windows.net`,
        sharedKeyCredential
    );

    const containerClient = blobServiceClient.getContainerClient(containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    // Determine content type from the file
    const mimeType = imagePart.type || 'application/octet-stream';

    await blockBlobClient.upload(imagePart.data, imagePart.data.length, {
        blobHTTPHeaders: {
            blobContentType: mimeType
        }
    });

    const imageUrl = `https://${accountName}.blob.core.windows.net/${containerName}/${blobName}`;

    context.log(`[EVENT IMAGE UPLOAD] blobName: ${blobName}, size: ${imagePart.data.length}, type: ${mimeType}, user: ${user.uid}`);

    return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            success: true,
            imageUrl
        })
    };
}

// Register function with standard middleware
app.http('Events_UploadImage', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'events/upload-image',
    handler: standardMiddleware(eventsUploadImageHandler)
});
