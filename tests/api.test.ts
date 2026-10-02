import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { getPlatformProxy } from 'wrangler';
import { handleApi, type Bindings } from '../lib/server/api.ts';
import { emptyNode } from '../lib/types.ts';
process.env.CLOUDFLARE_CF_FETCH_ENABLED = 'false';
process.env.WRANGLER_SEND_METRICS = 'false';
process.env.WRANGLER_LOG_PATH = '.sites-runtime/tests/wrangler.log';
test('FlowMaster internal data adapter: D1, authentication, CRUD, tokens and manual results', async (t) => {
    const proxy = await getPlatformProxy({ configPath: 'tests/wrangler.test.jsonc', persist: false });
    const env: Bindings = { DB: proxy.env.DB as D1Database, ADMIN_TOKEN: 'test-admin-0123456789-0123456789-0123456789', ALLOWED_ORIGINS: 'https://frontend.example' };
    for (const name of readdirSync('drizzle').filter(n => n.endsWith('.sql')).sort())
        for (const sql of readFileSync(`drizzle/${name}`, 'utf8').split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean))
            await env.DB.prepare(sql).run();
    const call = async (path: string, method = 'GET', body?: unknown, token = env.ADMIN_TOKEN, headers: Record<string, string> = {}) => { const r = await handleApi(new Request(`https://flowmaster.example/api/v1${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), env); const json = r.status === 204 ? null : await r.json() as any; return { r, status: r.status, data: json?.data, error: json?.error }; };
    let readToken = '', writeToken = '', writeId = '', project: any, hypothesis: any;
    try {
        await t.test('fails closed without credentials and denies untrusted origins', async () => { assert.equal((await call('/workspace', 'GET', undefined, '')).status, 401); assert.equal((await call('/workspace', 'GET', undefined, env.ADMIN_TOKEN, { Origin: 'https://evil.example' })).status, 403); const r = await call('/workspace', 'OPTIONS', undefined, '', { Origin: 'https://frontend.example' }); assert.equal(r.status, 204); assert.equal(r.r.headers.get('Access-Control-Allow-Origin'), 'https://frontend.example'); const bad = await handleApi(new Request('https://flowmaster.example/api/v1/workspace', { headers: { Authorization: `Bearer ${env.ADMIN_TOKEN}` } }), { DB: env.DB }); assert.equal(bad.status, 503); });
        await t.test('imports sample data once, without overwriting existing content', async () => { assert.equal((await call('/seed', 'POST')).status, 201); assert.equal((await call('/workspace')).data.hypotheses.length, 6); assert.equal((await call('/seed', 'POST')).status, 409); });
        await t.test('creates persistent project and hypothesis; validates parent links and DAGs', async () => { let r = await call('/projects', 'POST', { name: 'Integration research', description: 'test' }); assert.equal(r.status, 201); project = r.data; const h = { projectId: project.id, title: 'Test hypothesis', description: 'Evidence', baseline: 'MLP', status: 'pending', nodes: [emptyNode('a'), emptyNode('b', 'B', 250, 220)], edges: [{ source: 'a', target: 'b' }] }; r = await call('/hypotheses', 'POST', h); assert.equal(r.status, 201); hypothesis = r.data; assert.equal((await call(`/hypotheses/${hypothesis.id}`)).data.nodes.length, 2); assert.equal((await call('/hypotheses', 'POST', { ...h, edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'a' }] })).status, 422); assert.equal((await call('/hypotheses', 'POST', { ...h, projectId: 'missing' })).status, 404); assert.equal((await call(`/projects/${project.id}`, 'DELETE')).status, 409); assert.equal((await call('/resources', 'POST', { projectId: project.id, name: 'unsafe', type: 'document', url: 'javascript:alert(1)' })).status, 422); });
        await t.test('enforces optimistic concurrency on updates', async () => { const r = await call(`/hypotheses/${hypothesis.id}`, 'PUT', { ...hypothesis, title: 'Updated hypothesis' }); assert.equal(r.status, 200); assert.equal(r.data.revision, 2); assert.equal((await call(`/hypotheses/${hypothesis.id}`, 'PUT', hypothesis)).status, 409); hypothesis = r.data; });
        await t.test('issues tokens once, stores hashes only, enforces read/write/admin', async () => { let r = await call('/tokens', 'POST', { name: 'reader', scope: 'read', expiresInDays: 7 }); assert.equal(r.status, 201); readToken = r.data.token; r = await call('/tokens', 'POST', { name: 'writer', scope: 'write', expiresInDays: 30 }); assert.equal(r.status, 201); writeToken = r.data.token; writeId = r.data.id; assert.equal((await call('/workspace', 'GET', undefined, readToken)).status, 200); assert.equal((await call('/projects', 'POST', { name: 'blocked' }, readToken)).status, 403); assert.equal((await call('/tokens', 'GET', undefined, writeToken)).status, 403); const listed = await call('/tokens'); assert.equal(listed.data[0].token, undefined); const hashes = await env.DB.prepare('SELECT hash FROM access_tokens').all<{
            hash: string;
        }>(); assert.ok(hashes.results.every(r => r.hash.length === 64 && !r.hash.includes('fm_'))); });
        await t.test('atomically records experiment results and updates a node', async () => { let r = await call(`/hypotheses/${hypothesis.id}/results`, 'POST', { nodeId: 'a', title: 'Measured result', status: 'verified', summary: 'Accuracy: 0.91', duration: '12 分钟' }, writeToken); assert.equal(r.status, 201); assert.equal(r.data.duration, '12 分钟'); r = await call(`/hypotheses/${hypothesis.id}`); assert.equal(r.data.nodes[0].status, 'verified'); assert.equal(r.data.nodes[0].summary, 'Accuracy: 0.91'); hypothesis = r.data; assert.equal((await call(`/hypotheses/${hypothesis.id}/results`, 'POST', { nodeId: 'bad', title: 'bad', status: 'verified', summary: 'no' })).status, 422); });
        await t.test('removed model configuration and execution routes are unavailable', async () => {
            assert.equal((await call('/settings/model')).status, 404);
            assert.equal((await call('/settings/model', 'PUT', { baseUrl: 'https://model.example/v1', model: 'mock', apiKey: 'provider-secret' })).status, 404);
            assert.equal((await call('/settings/model/test', 'POST')).status, 404);
            assert.equal((await call(`/hypotheses/${hypothesis.id}/run`, 'POST', { nodeId: 'b' }, writeToken)).status, 404);
        });
        await t.test('rejects invalid pagination and reports collection totals', async () => {
            assert.equal((await call('/projects?limit=1000')).status, 422);
            assert.equal((await call('/projects?offset=-1')).status, 422);
            const r = await call('/hypotheses?limit=2&offset=0');
            assert.equal(r.status, 200);
            assert.equal(r.data.length, 2);
            assert.ok(Number(r.r.headers.get('X-Total-Count')) >= 7);
        });
        await t.test('revokes tokens immediately and rejects expired tokens', async () => { assert.equal((await call(`/tokens/${writeId}`, 'DELETE')).status, 200); assert.equal((await call('/workspace', 'GET', undefined, writeToken)).status, 401); await env.DB.prepare("UPDATE access_tokens SET expires_at = '2000-01-01T00:00:00.000Z' WHERE name = 'reader'").run(); assert.equal((await call('/workspace', 'GET', undefined, readToken)).status, 401); });
        await t.test('cascades hypothesis deletion and preserves DB integrity', async () => { assert.equal((await call(`/hypotheses/${hypothesis.id}`, 'DELETE')).status, 200); const orphan = await env.DB.prepare("SELECT count(*) AS n FROM documents WHERE parent_id = ?").bind(hypothesis.id).first<{
            n: number;
        }>(); assert.equal(orphan!.n, 0); assert.equal((await call(`/projects/${project.id}`, 'DELETE')).status, 200); assert.equal((await call(`/projects/${project.id}`)).status, 404); });
    }
    finally {
        await proxy.dispose();
    }
});
