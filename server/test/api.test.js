import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Mock DB pool before importing app
vi.mock('../db/pool.js', () => {
  return {
    query: vi.fn(),
    getClient: vi.fn(),
    withTransaction: vi.fn(),
    pool: {
      on: vi.fn(),
      query: vi.fn()
    },
    default: {
      query: vi.fn(),
      getClient: vi.fn(),
      withTransaction: vi.fn(),
      pool: {
        on: vi.fn(),
        query: vi.fn()
      }
    }
  };
});

// Mock validateSession to test RBAC transitions cleanly
vi.mock('../security/sessions.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    validateSession: vi.fn()
  };
});

// Mock client IP detection to ensure consistent testing
vi.mock('../security/clientIp.js', () => ({
  getClientIp: vi.fn(() => '172.28.0.10'),
  default: {
    getClientIp: vi.fn(() => '172.28.0.10')
  }
}));

import db from '../db/pool.js';
import { validateSession, COOKIE_NAME } from '../security/sessions.js';
import app from '../app.js';
import config from '../config.js';

describe('HTTP API & Security Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Health Probes', () => {
    it('GET /api/health returns 200 OK when database is accessible', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('GET /api/health returns 503 Service Unavailable when database query fails', async () => {
      db.query.mockRejectedValueOnce(new Error('Connection lost'));

      const res = await request(app).get('/api/health');
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ status: 'error' });
    });
  });

  describe('Security Headers & Fingerprinting Prevention', () => {
    it('sets strict CSP, referrer-policy, nosniff, and removes x-powered-by', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
      const res = await request(app).get('/api/health');

      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(res.headers['content-security-policy']).toBeDefined();
      expect(res.headers['content-security-policy']).toContain("default-src 'self'");
      expect(res.headers['permissions-policy']).toContain('camera=(self)');
    });
  });

  describe('CSRF Defense Mechanisms', () => {
    it('rejects state-changing POST requests missing an Origin header with 403', async () => {
      const res = await request(app)
        .post('/api/products')
        .send({ sku: 'TEST-SKU', name: 'Test Product', selling_price: 1000, category: 'Wires' });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Missing Origin header/i);
    });

    it('rejects state-changing POST requests from an unauthorized Origin with 403', async () => {
      const res = await request(app)
        .post('/api/products')
        .set('Origin', 'https://malicious.attacker.local')
        .send({ sku: 'TEST-SKU', name: 'Test Product', selling_price: 1000, category: 'Wires' });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Cross-origin request rejected/i);
    });

    it('rejects state-changing POST with valid Origin but missing x-csrf-token with 403', async () => {
      const res = await request(app)
        .post('/api/products')
        .set('Origin', config.publicOrigin)
        .send({ sku: 'TEST-SKU', name: 'Test Product', selling_price: 1000, category: 'Wires' });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Missing or invalid CSRF token/i);
    });

    it('permits safe GET requests without Origin or CSRF tokens', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
    });
  });

  describe('Authentication & Role-Based Access Control (RBAC)', () => {
    it('rejects unauthenticated requests to protected endpoints with 401', async () => {
      const endpoints = [
        ['get', '/api/auth/me'],
        ['get', '/api/products'],
        ['get', '/api/customers'],
        ['get', '/api/documents'],
        ['get', '/api/reports/sales'],
        ['get', '/api/reports/profit'],
        ['get', '/api/admin/status']
      ];

      for (const [method, route] of endpoints) {
        const res = await request(app)[method](route);
        expect(res.status, `Failed at ${method.toUpperCase()} ${route}`).toBe(401);
      }
    });

    it('blocks staff user from accessing owner-only profit and admin routes with 403', async () => {
      // Mock session resolving to staff role
      validateSession.mockResolvedValue({
        userId: '11111111-1111-1111-1111-111111111111',
        username: 'staff_user',
        role: 'staff',
        sessionId: 'session-staff-1'
      });

      // 1. Staff accessing owner-only profit report
      const profitRes = await request(app)
        .get('/api/reports/profit')
        .set('Cookie', [`${COOKIE_NAME}=valid_staff_token`]);

      expect(profitRes.status).toBe(403);
      expect(profitRes.body.error).toMatch(/Insufficient privileges/i);

      // 2. Staff accessing system admin status
      const adminRes = await request(app)
        .get('/api/admin/status')
        .set('Cookie', [`${COOKIE_NAME}=valid_staff_token`]);

      expect(adminRes.status).toBe(403);
      expect(adminRes.body.error).toMatch(/Insufficient privileges/i);

      // 3. Staff accessing audit log
      const auditRes = await request(app)
        .get('/api/admin/audit')
        .set('Cookie', [`${COOKIE_NAME}=valid_staff_token`]);

      expect(auditRes.status).toBe(403);
      expect(auditRes.body.error).toMatch(/Insufficient privileges/i);
    });
  });

  describe('Public Marketing Site & Static SPA Routing', () => {
    it('serves public landing page at GET /', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('Devi Electrical');
    });

    it('serves billing SPA entrypoint at GET /billing/', async () => {
      const res = await request(app).get('/billing/');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('Devi Electrical');
    });

    it('serves robots.txt with search engine crawl directives', async () => {
      const res = await request(app).get('/robots.txt');
      expect(res.status).toBe(200);
      expect(res.text).toContain('User-agent: *');
      expect(res.text).toContain('Disallow: /billing/');
    });

    it('serves sitemap.xml with canonical XML content', async () => {
      const res = await request(app).get('/sitemap.xml');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('xml');
      expect(res.text).toContain('<urlset');
    });
  });

  describe('Login Rate Limiter', () => {
    it('throttles rapid login requests exceeding threshold with HTTP 429', async () => {
      // The loginLimiter allows max 10 requests per 15 minutes window
      db.query.mockResolvedValue({ rows: [] });

      const attempts = [];
      for (let i = 0; i < 12; i++) {
        attempts.push(
          request(app)
            .post('/api/auth/login')
            .set('Origin', config.publicOrigin)
            .send({ username: `attacker_${i}`, password: 'wrongpassword' })
        );
      }

      const results = await Promise.all(attempts);
      const throttled = results.filter(r => r.status === 429);
      expect(throttled.length).toBeGreaterThan(0);
      expect(throttled[0].body.error).toMatch(/Too many login attempts/i);
    });
  });
});
