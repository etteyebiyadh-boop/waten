const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bcrypt = require('bcrypt');

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'waten-test-'));
const adminPassword = 'AdminTest123!';

fs.writeFileSync(
  path.join(tempDataDir, 'config.json'),
  JSON.stringify(
    {
      adminPasswordHash: bcrypt.hashSync(adminPassword, 10),
      fallbackImage: ''
    },
    null,
    2
  )
);

process.env.DATA_DIR = tempDataDir;
process.env.NODE_ENV = 'test';
process.env.REQUEST_LOGS = 'false';

const { app } = require('../server');

let server;
let baseUrl = '';

async function requestJson(pathname, { method = 'GET', body, headers = {} } = {}) {
  const init = {
    method,
    headers: { ...headers }
  };

  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${baseUrl}${pathname}`, init);
  const raw = await response.text();
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch (_) {
    payload = null;
  }

  return {
    status: response.status,
    headers: response.headers,
    body: payload,
    raw
  };
}

test.before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  fs.rmSync(tempDataDir, { recursive: true, force: true });
});

test('GET /health returns ok and hardening headers', async () => {
  const response = await requestJson('/health');
  assert.equal(response.status, 200);
  assert.equal(response.body?.ok, true);
  assert.ok(response.headers.get('x-request-id'));
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  const csp = response.headers.get('content-security-policy') || '';
  assert.ok(csp.includes("default-src 'self'"));
  assert.ok(csp.includes("object-src 'none'"));
});

test('user registration, login, session check, and orders flow', async () => {
  const email = `user-${Date.now()}@example.com`;
  const password = 'UserPass123!';

  const register = await requestJson('/api/users/register', {
    method: 'POST',
    body: {
      name: 'Test User',
      email,
      password,
      phone: '+21655555555'
    },
    headers: { 'x-forwarded-for': '50.0.0.1' }
  });
  assert.equal(register.status, 201);
  assert.ok(register.body?.token);
  assert.equal(register.body?.user?.email, email);

  const login = await requestJson('/api/users/login', {
    method: 'POST',
    body: { email, password },
    headers: { 'x-forwarded-for': '50.0.0.1' }
  });
  assert.equal(login.status, 200);
  assert.ok(login.body?.token);
  const token = login.body.token;

  const me = await requestJson('/api/users/me', {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(me.status, 200);
  assert.equal(me.body?.user?.email, email);

  const createOrder = await requestJson('/api/orders', {
    method: 'POST',
    body: {
      orderId: `ORD-TEST-${Date.now()}`,
      product: { id: '1' },
      customer: {
        name: 'Test User',
        phone: '+21655555555',
        email,
        address: '1 Test Street',
        city: 'Tunis',
        postalCode: '1000'
      },
      quantity: 1,
      notes: 'Test order'
    }
  });
  assert.equal(createOrder.status, 201);
  assert.equal(createOrder.body?.ok, true);

  const myOrders = await requestJson('/api/users/orders', {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(myOrders.status, 200);
  assert.ok(Array.isArray(myOrders.body?.orders));
  assert.ok(myOrders.body.orders.length >= 1);
});

test('admin login succeeds with hashed password config', async () => {
  const response = await requestJson('/api/login', {
    method: 'POST',
    body: { password: adminPassword },
    headers: { 'x-forwarded-for': '60.0.0.1' }
  });
  assert.equal(response.status, 200);
  assert.equal(response.body?.ok, true);
  const setCookie = response.headers.get('set-cookie') || '';
  assert.ok(setCookie.includes('waten_admin_session='));
});

test('admin login is rate-limited after repeated failed attempts', async () => {
  const headers = { 'x-forwarded-for': '70.0.0.1' };
  for (let i = 0; i < 5; i += 1) {
    const response = await requestJson('/api/login', {
      method: 'POST',
      body: { password: 'wrong-password' },
      headers
    });
    assert.equal(response.status, 401);
  }

  const blocked = await requestJson('/api/login', {
    method: 'POST',
    body: { password: 'wrong-password' },
    headers
  });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.body?.retryAfter) > 0);
});

test('user login is rate-limited after repeated failed attempts', async () => {
  const headers = { 'x-forwarded-for': '80.0.0.1' };
  for (let i = 0; i < 10; i += 1) {
    const response = await requestJson('/api/users/login', {
      method: 'POST',
      body: { email: 'missing@example.com', password: 'wrong-password' },
      headers
    });
    assert.equal(response.status, 401);
  }

  const blocked = await requestJson('/api/users/login', {
    method: 'POST',
    body: { email: 'missing@example.com', password: 'wrong-password' },
    headers
  });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.body?.retryAfter) > 0);
});
