// src/functions/OrganizersSASToken.js
// Domain: Organizers - Azure Blob Storage SAS token generation for organizer images
const { app } = require('@azure/functions');
const { standardMiddleware } = require('../middleware');
const { StorageSharedKeyCredential, BlobServiceClient, generateBlobSASQueryParameters, ContainerSASPermissions, SASProtocol } = require('@azure/storage-blob');

/**
 * POST /api/organizers/generate-sas-token
 * Generate a container-level SAS token for the organizer-images blob container
 *
 * Auth: anonymous (matches calendar-be)
 *
 * Response: { success: true, sasToken: "?sv=...", containerUrl: "https://...", expiresAt: "..." }
 */
async function organizersGenerateSASTokenHandler(request, context) {
    context.log('Organizers_GenerateSASToken: Request received');

    try {
        const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
        const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;

        if (!accountName || !accountKey) {
            context.log('Organizers_GenerateSASToken: Missing storage credentials');
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

        const containerName = 'organizer-images';

        // Create shared key credential
        const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);

        // Set SAS token to expire in 1 hour
        const startsOn = new Date();
        const expiresOn = new Date(startsOn.getTime() + 60 * 60 * 1000); // 1 hour

        // Generate container-level SAS token with read, write, list permissions
        const sasToken = generateBlobSASQueryParameters({
            containerName,
            permissions: ContainerSASPermissions.parse('rwl'), // read, write, list
            startsOn,
            expiresOn,
            protocol: SASProtocol.Https
        }, sharedKeyCredential).toString();

        const containerUrl = `https://${accountName}.blob.core.windows.net/${containerName}`;

        context.log(`Organizers_GenerateSASToken: SAS token generated, expires at ${expiresOn.toISOString()}`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                sasToken: `?${sasToken}`,
                containerUrl,
                expiresAt: expiresOn.toISOString()
            })
        };

    } catch (error) {
        throw error;
    }
}

// Register function with standard middleware
app.http('Organizers_GenerateSASToken', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'organizers/generate-sas-token',
    handler: standardMiddleware(organizersGenerateSASTokenHandler)
});
