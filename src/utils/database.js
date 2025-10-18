// Database connection utilities
class DatabaseConnection {
    constructor(connectionString, type = 'cosmos') {
        this.connectionString = connectionString;
        this.type = type;
        this.client = null;
    }

    async connect() {
        if (this.type === 'cosmos') {
            const { CosmosClient } = require('@azure/cosmos');
            this.client = new CosmosClient(this.connectionString);
        }
        // Add other database types as needed
    }

    async disconnect() {
        if (this.client && this.client.dispose) {
            await this.client.dispose();
        }
    }

    getClient() {
        return this.client;
    }
}

// Cosmos DB helpers
class CosmosDbHelper {
    constructor(client, databaseName, containerName) {
        this.client = client;
        this.databaseName = databaseName;
        this.containerName = containerName;
        this.database = null;
        this.container = null;
    }

    async initialize() {
        this.database = this.client.database(this.databaseName);
        this.container = this.database.container(this.containerName);
    }

    async createItem(item) {
        const { resource } = await this.container.items.create(item);
        return resource;
    }

    async getItem(id, partitionKey = id) {
        try {
            const { resource } = await this.container.item(id, partitionKey).read();
            return resource;
        } catch (error) {
            if (error.code === 404) {
                return null;
            }
            throw error;
        }
    }

    async updateItem(id, updates, partitionKey = id) {
        const { resource } = await this.container.item(id, partitionKey).replace(updates);
        return resource;
    }

    async deleteItem(id, partitionKey = id) {
        await this.container.item(id, partitionKey).delete();
        return true;
    }

    async queryItems(query, parameters = []) {
        const querySpec = {
            query,
            parameters
        };
        
        const { resources } = await this.container.items.query(querySpec).fetchAll();
        return resources;
    }

    async getItemsByProperty(propertyName, value, limit = 100) {
        const query = `SELECT * FROM c WHERE c.${propertyName} = @value ORDER BY c._ts DESC OFFSET 0 LIMIT @limit`;
        const parameters = [
            { name: '@value', value },
            { name: '@limit', value: limit }
        ];
        
        return await this.queryItems(query, parameters);
    }
}

// Cache helper for performance optimization
class CacheHelper {
    constructor() {
        this.cache = new Map();
        this.ttlMap = new Map();
    }

    set(key, value, ttlSeconds = 300) {
        this.cache.set(key, value);
        this.ttlMap.set(key, Date.now() + (ttlSeconds * 1000));
    }

    get(key) {
        const ttl = this.ttlMap.get(key);
        if (ttl && Date.now() > ttl) {
            this.cache.delete(key);
            this.ttlMap.delete(key);
            return null;
        }
        return this.cache.get(key) || null;
    }

    delete(key) {
        this.cache.delete(key);
        this.ttlMap.delete(key);
    }

    clear() {
        this.cache.clear();
        this.ttlMap.clear();
    }

    // Clean up expired entries
    cleanup() {
        const now = Date.now();
        for (const [key, ttl] of this.ttlMap.entries()) {
            if (now > ttl) {
                this.cache.delete(key);
                this.ttlMap.delete(key);
            }
        }
    }
}

// Service Bus helper
class ServiceBusHelper {
    constructor(connectionString) {
        this.connectionString = connectionString;
        this.client = null;
    }

    async connect() {
        const { ServiceBusClient } = require('@azure/service-bus');
        this.client = new ServiceBusClient(this.connectionString);
    }

    async sendMessage(queueName, message) {
        const sender = this.client.createSender(queueName);
        await sender.sendMessages({
            body: typeof message === 'string' ? message : JSON.stringify(message),
            contentType: 'application/json'
        });
        await sender.close();
    }

    async sendBatchMessages(queueName, messages) {
        const sender = this.client.createSender(queueName);
        const batch = await sender.createMessageBatch();
        
        for (const message of messages) {
            const added = batch.tryAddMessage({
                body: typeof message === 'string' ? message : JSON.stringify(message),
                contentType: 'application/json'
            });
            
            if (!added) {
                // Send current batch and create new one
                await sender.sendMessages(batch);
                batch.clear();
                batch.tryAddMessage({
                    body: typeof message === 'string' ? message : JSON.stringify(message),
                    contentType: 'application/json'
                });
            }
        }
        
        if (batch.count > 0) {
            await sender.sendMessages(batch);
        }
        
        await sender.close();
    }

    async close() {
        if (this.client) {
            await this.client.close();
        }
    }
}

// Environment configuration helper
function getConnectionString(name, fallback = '') {
    return process.env[name] || fallback;
}

function isProduction() {
    return process.env.NODE_ENV === 'production';
}

function isDevelopment() {
    return !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
}

module.exports = {
    DatabaseConnection,
    CosmosDbHelper,
    CacheHelper,
    ServiceBusHelper,
    getConnectionString,
    isProduction,
    isDevelopment
};