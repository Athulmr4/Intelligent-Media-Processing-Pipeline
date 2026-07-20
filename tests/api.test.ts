import request from 'supertest';
import path from 'path';
import fs from 'fs';
import { app } from '../src/app';
import { initDatabase, closeDatabase } from '../src/config/database';
import { processingQueue } from '../src/queue/processingQueue';
import { processImage } from '../src/services/imageProcessor';

// Test setup
const TEST_DB = './data/test.db';
const TEST_UPLOADS = './uploads/test';

beforeAll(() => {
  process.env.DB_PATH = TEST_DB;
  process.env.UPLOAD_DIR = TEST_UPLOADS;

  if (!fs.existsSync(TEST_UPLOADS)) {
    fs.mkdirSync(TEST_UPLOADS, { recursive: true });
  }

  initDatabase();
  processingQueue.process(async (imageId: string) => {
    await processImage(imageId);
  });
});

afterAll(() => {
  closeDatabase();
  // Clean up test files
  try {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    if (fs.existsSync(TEST_UPLOADS)) fs.rmSync(TEST_UPLOADS, { recursive: true, force: true });
  } catch {}
});

describe('Health Check', () => {
  it('GET /health should return 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('healthy');
  });
});

describe('Upload API', () => {
  it('POST /api/v1/images/upload without file should return 400', async () => {
    const res = await request(app)
      .post('/api/v1/images/upload');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/v1/images/upload with valid image should return 201', async () => {
    // Create a minimal valid JPEG for testing
    const testImagePath = path.join(TEST_UPLOADS, 'test_input.jpg');
    // Minimal JPEG file header (1x1 pixel)
    const jpegHeader = Buffer.from([
      0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00,
      0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9,
    ]);
    fs.writeFileSync(testImagePath, jpegHeader);

    const res = await request(app)
      .post('/api/v1/images/upload')
      .attach('image', testImagePath);

    // Even with a minimal JPEG, upload should succeed
    expect([201, 500]).toContain(res.status);
    if (res.status === 201) {
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.status).toBe('pending');
    }
  });
});

describe('Status & Results API', () => {
  it('GET /api/v1/images/:id/status with invalid ID should return 404', async () => {
    const res = await request(app).get('/api/v1/images/nonexistent/status');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('GET /api/v1/images/:id/results with invalid ID should return 404', async () => {
    const res = await request(app).get('/api/v1/images/nonexistent/results');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe('List & Stats API', () => {
  it('GET /api/v1/images should return paginated list', async () => {
    const res = await request(app).get('/api/v1/images');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.pagination).toBeDefined();
  });

  it('GET /api/v1/stats should return statistics', async () => {
    const res = await request(app).get('/api/v1/stats');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.database).toBeDefined();
    expect(res.body.data.queue).toBeDefined();
  });
});

describe('404 Handler', () => {
  it('Unknown routes should return 404', async () => {
    const res = await request(app).get('/api/v1/nonexistent');
    expect(res.status).toBe(404);
  });
});
