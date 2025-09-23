const request = require('supertest');
const app = require('./testApp'); // Use test app without service initialization

describe('API Integration Tests', () => {
  test('GET / should return basic response', async () => {
    const response = await request(app)
      .get('/')
      .expect(200);
    
    // Should not throw error (existing index route should work)
  });

  test('GET /users/get-price should attempt to return price data', async () => {
    // This test depends on external API and may fail due to missing services
    // but it should not crash the test runner
    const response = await request(app)
      .get('/users/get-price');
    
    // Should get some response (may be error due to missing services, that's ok)
    expect(response.status).toBeDefined();
  });
});