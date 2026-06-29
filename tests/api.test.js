/**
 * Community Hero API smoke tests
 * Run: npm test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';

const BASE = process.env.TEST_URL || 'http://localhost:3000';

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

describe('Community Hero API', () => {
  it('GET /api/issues returns array', async () => {
    const res = await fetch(`${BASE}/api/issues`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data));
  });

  it('POST /api/sync stores issues', async () => {
    const mock = [{ id: 'test-1', category: 'pothole', status: 'Reported' }];
    const { status, data } = await post('/api/sync', { issues: mock });
    assert.strictEqual(status, 200);
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.count, 1);
  });

  it('GET /api/issues/:id returns synced issue', async () => {
    const res = await fetch(`${BASE}/api/issues/test-1`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.id, 'test-1');
  });

  it('POST /api/classify rejects missing image', async () => {
    const { status } = await post('/api/classify', {});
    assert.strictEqual(status, 400);
  });

  it('POST /api/escalate returns memo', async () => {
    const { status, data } = await post('/api/escalate', {
      issue: { id: 'x', category: 'pothole', wardId: 'ward-1', severity: 'High', status: 'Reported', description: 'test', createdBy: 'User' },
      overdueHours: 5
    });
    assert.strictEqual(status, 200);
    assert.ok(data.memo);
  });

  it('POST /api/trends returns summary', async () => {
    const { status, data } = await post('/api/trends', {
      issues: [{ category: 'pothole', status: 'Reported', wardId: 'ward-1' }],
      wards: [{ id: 'ward-1', name: 'Greenwood Ward' }]
    });
    assert.strictEqual(status, 200);
    assert.ok(data.summary || data.forecast);
  });
});
