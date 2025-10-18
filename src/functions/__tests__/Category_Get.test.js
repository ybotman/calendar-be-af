// src/functions/__tests__/Category_Get.test.js
const { MongoClient } = require('mongodb');

// Mock MongoDB
jest.mock('mongodb');

// Mock Azure Functions
const mockContext = {
  log: jest.fn(),
  log: Object.assign(jest.fn(), {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn()
  })
};

const mockRequest = (query = {}, headers = {}) => ({
  query: new Map(Object.entries(query)),
  headers: new Map(Object.entries(headers))
});

describe('Category_Get Function', () => {
  let mockDb, mockCollection, mockClient;
  let Category_Get;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Setup MongoDB mocks
    mockCollection = {
      find: jest.fn().mockReturnThis(),
      project: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      toArray: jest.fn(),
      countDocuments: jest.fn()
    };

    mockDb = {
      collection: jest.fn().mockReturnValue(mockCollection)
    };

    mockClient = {
      connect: jest.fn().mockResolvedValue(),
      db: jest.fn().mockReturnValue(mockDb)
    };

    MongoClient.mockImplementation(() => mockClient);

    // Clear module cache and re-require
    jest.resetModules();
    const categoryModule = require('../Category_Get');
    // Extract the handler from the app.http call
    Category_Get = categoryModule.handler || 
      jest.requireActual('@azure/functions').app.http.mock.calls[0][1].handler;
  });

  describe('Parameter Validation', () => {
    it('should return 400 when appId is missing', async () => {
      const request = mockRequest({});
      const result = await Category_Get(request, mockContext);

      expect(result.status).toBe(400);
      expect(JSON.parse(result.body)).toEqual({ message: 'appId is required' });
      expect(mockContext.log.warn).toHaveBeenCalledWith('Missing appId in categories request');
    });

    it('should accept appId and return categories', async () => {
      const mockCategories = [
        { _id: '1', categoryName: 'Milonga', categoryCode: 'MIL' },
        { _id: '2', categoryName: 'Workshop', categoryCode: 'WRK' }
      ];

      mockCollection.toArray.mockResolvedValue(mockCategories);
      mockCollection.countDocuments.mockResolvedValue(2);

      const request = mockRequest({ appId: '1' });
      const result = await Category_Get(request, mockContext);

      expect(result.status).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.categories).toEqual(mockCategories);
      expect(body.pagination).toEqual({
        total: 2,
        page: 1,
        limit: 100,
        pages: 1
      });
    });
  });

  describe('Pagination', () => {
    it('should handle pagination parameters correctly', async () => {
      mockCollection.toArray.mockResolvedValue([]);
      mockCollection.countDocuments.mockResolvedValue(150);

      const request = mockRequest({ 
        appId: '1',
        page: '2',
        limit: '50'
      });
      
      await Category_Get(request, mockContext);

      expect(mockCollection.skip).toHaveBeenCalledWith(50); // (2-1) * 50
      expect(mockCollection.limit).toHaveBeenCalledWith(50);
    });

    it('should enforce maximum limit of 500', async () => {
      mockCollection.toArray.mockResolvedValue([]);
      mockCollection.countDocuments.mockResolvedValue(1000);

      const request = mockRequest({ 
        appId: '1',
        limit: '1000'
      });
      
      await Category_Get(request, mockContext);

      expect(mockCollection.limit).toHaveBeenCalledWith(500);
    });

    it('should handle invalid pagination parameters', async () => {
      mockCollection.toArray.mockResolvedValue([]);
      mockCollection.countDocuments.mockResolvedValue(10);

      const request = mockRequest({ 
        appId: '1',
        page: 'invalid',
        limit: 'invalid'
      });
      
      await Category_Get(request, mockContext);

      expect(mockCollection.skip).toHaveBeenCalledWith(0); // Default page 1
      expect(mockCollection.limit).toHaveBeenCalledWith(100); // Default limit
    });
  });

  describe('Field Selection', () => {
    it('should handle select parameter for field projection', async () => {
      mockCollection.toArray.mockResolvedValue([]);
      mockCollection.countDocuments.mockResolvedValue(0);

      const request = mockRequest({ 
        appId: '1',
        select: 'categoryName,categoryCode'
      });
      
      await Category_Get(request, mockContext);

      expect(mockCollection.project).toHaveBeenCalledWith({
        categoryName: 1,
        categoryCode: 1,
        _id: 1
      });
    });

    it('should exclude _id when -_id is in select', async () => {
      mockCollection.toArray.mockResolvedValue([]);
      mockCollection.countDocuments.mockResolvedValue(0);

      const request = mockRequest({ 
        appId: '1',
        select: 'categoryName,-_id'
      });
      
      await Category_Get(request, mockContext);

      expect(mockCollection.project).toHaveBeenCalledWith({
        categoryName: 1
      });
    });
  });

  describe('Error Handling', () => {
    it('should return 503 for MongoDB connection errors', async () => {
      const mongoError = new Error('Connection failed');
      mongoError.name = 'MongoNetworkError';
      mockClient.connect.mockRejectedValue(mongoError);

      const request = mockRequest({ appId: '1' });
      const result = await Category_Get(request, mockContext);

      expect(result.status).toBe(503);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('Database unavailable');
      expect(mockContext.log.error).toHaveBeenCalled();
    });

    it('should return 500 for general errors', async () => {
      mockCollection.toArray.mockRejectedValue(new Error('Unknown error'));

      const request = mockRequest({ appId: '1' });
      const result = await Category_Get(request, mockContext);

      expect(result.status).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('Error fetching categories');
    });

    it('should include error details in development mode', async () => {
      process.env.NODE_ENV = 'development';
      const error = new Error('Detailed error message');
      mockCollection.toArray.mockRejectedValue(error);

      const request = mockRequest({ appId: '1' });
      const result = await Category_Get(request, mockContext);

      const body = JSON.parse(result.body);
      expect(body.details).toBe('Detailed error message');
      
      // Clean up
      delete process.env.NODE_ENV;
    });
  });

  describe('Sorting', () => {
    it('should sort by categoryName', async () => {
      mockCollection.toArray.mockResolvedValue([]);
      mockCollection.countDocuments.mockResolvedValue(0);

      const request = mockRequest({ appId: '1' });
      await Category_Get(request, mockContext);

      expect(mockCollection.sort).toHaveBeenCalledWith({ categoryName: 1 });
    });
  });

  describe('Logging', () => {
    it('should log request details', async () => {
      mockCollection.toArray.mockResolvedValue([]);
      mockCollection.countDocuments.mockResolvedValue(0);

      const request = mockRequest({ appId: '1' });
      await Category_Get(request, mockContext);

      expect(mockContext.log).toHaveBeenCalledWith(
        'Categories GET request received:',
        expect.objectContaining({
          appId: '1',
          page: '1',
          limit: '100'
        })
      );
    });

    it('should log results summary', async () => {
      const mockCategories = [{ _id: '1' }, { _id: '2' }];
      mockCollection.toArray.mockResolvedValue(mockCategories);
      mockCollection.countDocuments.mockResolvedValue(10);

      const request = mockRequest({ appId: '1' });
      await Category_Get(request, mockContext);

      expect(mockContext.log).toHaveBeenCalledWith(
        'Found 2 categories for appId: 1 (page 1/1)'
      );
    });
  });
});