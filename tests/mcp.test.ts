import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { getPlatformProxy } from 'wrangler';
import { handleMcp } from '../lib/server/mcp.ts';
import type { Bindings } from '../lib/server/auth.ts';
import { emptyNode } from '../lib/types.ts';

process.env.CLOUDFLARE_CF_FETCH_ENABLED = 'false';
process.env.WRANGLER_SEND_METRICS = 'false';
process.env.WRANGLER_LOG_PATH = '.sites-runtime/tests/wrangler.log';

test('MCP persists research and enforces access, revisions and data integrity', async t => {
    const proxy = await getPlatformProxy({ configPath: 'tests/wrangler.test.jsonc', persist: false });
    t.after(() => proxy.dispose());
    const env: Bindings = { DB: proxy.env.DB as D1Database, ADMIN_TOKEN: 'test-admin-0123456789-0123456789-0123456789', ALLOWED_ORIGINS: 'https://frontend.example' };
    for (const name of readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort()) {
        for (const sql of readFileSync(`drizzle/${name}`, 'utf8').split('--> statement-breakpoint').map(sql => sql.trim()).filter(Boolean)) {
            await env.DB.prepare(sql).run();
        }
    }
    let requestId = 0;
    const call = async (name: string, args: unknown = {}, token = env.ADMIN_TOKEN, headers: Record<string, string> = {}) => {
        const response = await handleMcp(new Request('https://flowmaster.example/mcp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`, ...headers },
            body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method: 'tools/call', params: { name, arguments: args } }),
        }), env);
        const message = await response.json() as any;
        const payload = message.result?.structuredContent;
        return { status: payload?.status ?? (message.result?.isError ? 422 : response.status), data: payload?.data, payload };
    };
    let project: any, hypothesis: any, reader = '', writer = '', writerId = '';

    await t.test('rejects untrusted origins and permits configured frontend preflight', async () => {
        assert.equal((await call('projects_list', {}, env.ADMIN_TOKEN, { Origin: 'https://evil.example' })).status, 403);
        const response = await handleMcp(new Request('https://flowmaster.example/mcp', { method: 'OPTIONS', headers: { Origin: 'https://frontend.example' } }), env);
        assert.equal(response.status, 204);
        assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://frontend.example');
    });
    await t.test('creates records while protecting parent links, DAGs and resource URLs', async () => {
        project = (await call('projects_create', { data: { name: 'Integration research' } })).data;
        assert.ok(project.id);
        const data = { projectId: project.id, title: 'Test hypothesis', status: 'pending', nodes: [emptyNode('a'), emptyNode('b')], edges: [{ source: 'a', target: 'b' }] };
        hypothesis = (await call('hypotheses_create', { data })).data;
        assert.equal((await call('hypotheses_get', { id: hypothesis.id })).data.nodes.length, 2);
        assert.equal((await call('hypotheses_create', { data: { ...data, edges: [...data.edges, { source: 'b', target: 'a' }] } })).status, 422);
        assert.equal((await call('hypotheses_create', { data: { ...data, projectId: 'missing' } })).status, 404);
        assert.equal((await call('projects_delete', { id: project.id })).status, 409);
        assert.equal((await call('resources_create', { data: { projectId: project.id, name: 'unsafe', type: 'document', url: 'javascript:alert(1)' } })).status, 422);
    });
    await t.test('rejects stale revisions without overwriting saved changes', async () => {
        const staleRevision = hypothesis.revision;
        hypothesis = (await call('hypotheses_update', { id: hypothesis.id, data: { title: 'Updated hypothesis', revision: staleRevision } })).data;
        assert.equal(hypothesis.revision, staleRevision + 1);
        assert.equal((await call('hypotheses_update', { id: hypothesis.id, data: { title: 'Stale title', revision: staleRevision } })).status, 409);
        assert.equal((await call('hypotheses_get', { id: hypothesis.id })).data.title, 'Updated hypothesis');
    });
    await t.test('issues one-time token secrets and enforces read/write/admin scopes', async () => {
        reader = (await call('tokens_create', { data: { name: 'reader', scope: 'read', expiresInDays: 7 } })).data.token;
        const issued = (await call('tokens_create', { data: { name: 'writer', scope: 'write', expiresInDays: 30 } })).data;
        writer = issued.token; writerId = issued.id;
        assert.equal((await call('projects_get', { id: project.id }, reader)).data.id, project.id);
        assert.equal((await call('projects_create', { data: { name: 'blocked' } }, reader)).status, 403);
        assert.equal((await call('tokens_list', {}, writer)).status, 403);
        assert.ok((await call('tokens_list')).data.every((token: any) => token.token === undefined));
        const hashes = await env.DB.prepare('SELECT hash FROM access_tokens').all<{ hash: string }>();
        assert.ok(hashes.results.every(row => /^[a-f0-9]{64}$/.test(row.hash)));
    });
    await t.test('records experiment evidence and updates the node atomically', async () => {
        const result = await call('results_create', { hypothesisId: hypothesis.id, data: { nodeId: 'a', title: 'Measured result', status: 'verified', summary: 'Accuracy: 0.91', duration: '12 分钟' } }, writer);
        assert.equal(result.data.duration, '12 分钟');
        hypothesis = (await call('hypotheses_get', { id: hypothesis.id })).data;
        assert.equal(hypothesis.nodes[0].currentResultId, result.data.id);
        assert.equal(hypothesis.nodes[0].status, 'verified');
        assert.equal(hypothesis.nodes[0].summary, 'Accuracy: 0.91');
        assert.equal(result.payload.affectedHypothesis.revision, hypothesis.revision);
        assert.equal((await call('results_create', { hypothesisId: hypothesis.id, data: { nodeId: 'missing', title: 'bad', status: 'verified', summary: 'no' } })).status, 422);
        const records = await call('experiments_list', { hypothesisId: hypothesis.id });
        assert.equal(records.payload.total, 1);
    });
    await t.test('revoked and expired tokens immediately lose access', async () => {
        assert.equal((await call('tokens_revoke', { id: writerId })).status, 200);
        assert.equal((await call('projects_list', {}, writer)).status, 401);
        await env.DB.prepare("UPDATE access_tokens SET expires_at = '2000-01-01T00:00:00.000Z' WHERE name = 'reader'").run();
        assert.equal((await call('projects_list', {}, reader)).status, 401);
    });
    await t.test('deleting a hypothesis cascades its experiments and permits project deletion', async () => {
        assert.equal((await call('hypotheses_delete', { id: hypothesis.id })).status, 200);
        assert.equal((await call('experiments_list', { hypothesisId: hypothesis.id })).payload.total, 0);
        assert.equal((await call('projects_delete', { id: project.id })).status, 200);
        assert.equal((await call('projects_get', { id: project.id })).status, 404);
    });
});
