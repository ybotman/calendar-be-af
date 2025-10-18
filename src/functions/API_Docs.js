// src/functions/API_Docs.js
const { app } = require('@azure/functions');
const fs = require('fs');
const path = require('path');

/**
 * Swagger UI Endpoint
 * Provides interactive API documentation
 *
 * @route GET /api/docs
 * @access Public
 */
app.http('SwaggerUI', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'docs',
  handler: async (request, context) => {
    context.log('Serving Swagger UI');

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Calendar API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    body {
      margin: 0;
      padding: 0;
    }
    .topbar {
      display: none;
    }
    .swagger-ui .info {
      margin: 20px 0;
    }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/api/swagger.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout",
        defaultModelsExpandDepth: 1,
        defaultModelExpandDepth: 1,
        displayRequestDuration: true,
        filter: true,
        syntaxHighlight: {
          activate: true,
          theme: "agate"
        }
      });
    };
  </script>
</body>
</html>
    `;

    return {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8'
      },
      body: html
    };
  }
});

/**
 * Swagger JSON Endpoint
 * Serves the OpenAPI specification
 *
 * @route GET /api/swagger.json
 * @access Public
 */
app.http('SwaggerJSON', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'swagger.json',
  handler: async (request, context) => {
    context.log('Serving Swagger JSON');

    try {
      // Read swagger.json from public directory
      const swaggerPath = path.join(__dirname, '../../public/swagger.json');
      const swaggerContent = fs.readFileSync(swaggerPath, 'utf8');
      const swagger = JSON.parse(swaggerContent);

      return {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*', // Allow CORS for swagger UI
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify(swagger, null, 2)
      };
    } catch (error) {
      context.log.error('Error reading swagger.json:', error);

      return {
        status: 500,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          error: 'Failed to load API documentation',
          message: error.message
        })
      };
    }
  }
});
