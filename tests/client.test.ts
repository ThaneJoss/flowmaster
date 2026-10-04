import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClient, type Connection } from '../lib/client.ts';

const connection: Connection = { baseUrl: 'https://flowmaster.example', token: 'test-only-token', remember: false };
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(r => { resolve = r; });
    return { promise, resolve };
}
interface RpcRequest {
    jsonrpc: string;
    id?: number;
    method: string;
    params: { name?: string; arguments?: Record<string, unknown> };
}
function requestFor(url: unknown, options: RequestInit): RpcRequest {
    assert.equal(url, 'https://flowmaster.example/mcp');
    assert.equal(options.method, 'POST');
    const request = JSON.parse(options.body as string) as RpcRequest;
    assert.equal(request.jsonrpc, '2.0');
    return request;
}
function handshake(request: RpcRequest): Response | undefined {
    if (request.method === 'initialize') return Response.json({ jsonrpc: '2.0', id: request.id, result: {
        protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'FlowMaster', version: '2.0.0' },
    } });
    if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
    assert.equal(request.method, 'tools/call');
}
function toolResult(request: RpcRequest, data: unknown, metadata: Record<string, unknown> = {}) {
    const payload = { data, ...metadata };
    return { jsonrpc: '2.0', id: request.id, result: {
        content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload,
    } };
}

// A response can complete after cancellation (for example, while JSON decoding
// or an adapter is pending). Session validity must also be checked after fetch.
test('logout discards a delayed workspace response', async (t) => {
    const response = deferred<Response>();
    const requested = deferred<RpcRequest>();
    const fetchMock = t.mock.method(globalThis, 'fetch', async (url: unknown, options: RequestInit) => {
        const request = requestFor(url, options), initialized = handshake(request);
        if (initialized) return initialized;
        assert.equal(request.params.name, 'workspace_get');
        requested.resolve(request);
        return response.promise;
    });
    const session = new AbortController();
    const api = makeClient(connection, session.signal);
    let workspace = 'empty';
    const pending = api<string>('/workspace').then(value => { workspace = value; });
    const request = await requested.promise;
    session.abort();
    response.resolve(Response.json(toolResult(request, 'private workspace')));
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(workspace, 'empty');
    assert.equal(fetchMock.mock.callCount(), 3);
});

test('logout cancels mutations even when the caller supplies its own signal', async (t) => {
    const body = deferred<ReturnType<typeof toolResult>>();
    const requested = deferred<RpcRequest>();
    const caller = new AbortController();
    const session = new AbortController();
    let requestSignal: AbortSignal | null | undefined;
    t.mock.method(globalThis, 'fetch', async (url: unknown, options: RequestInit) => {
        const request = requestFor(url, options), initialized = handshake(request);
        if (initialized) return initialized;
        assert.deepEqual(request.params, { name: 'projects_update', arguments: { id: 'p1', data: {} } });
        requestSignal = options.signal;
        return { ok: true, status: 200, json: () => { requested.resolve(request); return body.promise; } } as Response;
    });
    const api = makeClient(connection, session.signal);
    const pending = api.mutation('/projects/p1', { method: 'PUT', body: '{}', signal: caller.signal });
    const request = await requested.promise;
    session.abort();
    body.resolve(toolResult(request, 'old account update'));
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(requestSignal?.aborted, true);
    assert.equal(caller.signal.aborted, false);
});

test('switching accounts cannot restore the previous workspace or issue follow-up requests', async (t) => {
    const oldResponse = deferred<Response>();
    const oldRequested = deferred<RpcRequest>();
    const fetchMock = t.mock.method(globalThis, 'fetch', async (url: unknown, options: RequestInit) => {
        const request = requestFor(url, options), initialized = handshake(request);
        if (initialized) return initialized;
        assert.equal(request.params.name, 'workspace_get');
        const token = new Headers(options.headers).get('Authorization');
        if (token === `Bearer ${connection.token}`) { oldRequested.resolve(request); return oldResponse.promise; }
        return Response.json(toolResult(request, 'new workspace'));
    });
    const oldSession = new AbortController();
    const oldApi = makeClient(connection, oldSession.signal);
    const newApi = makeClient({ ...connection, token: 'another-test-token' }, new AbortController().signal);
    let workspace = 'empty';
    const oldPending = oldApi<string>('/workspace').then(value => { workspace = value; });
    const oldRequest = await oldRequested.promise;
    oldSession.abort();
    workspace = await newApi<string>('/workspace');
    oldResponse.resolve(Response.json(toolResult(oldRequest, 'old workspace')));
    await assert.rejects(oldPending, { name: 'AbortError' });
    await assert.rejects(oldApi('/workspace'), { name: 'AbortError' });
    assert.equal(workspace, 'new workspace');
    assert.equal(fetchMock.mock.callCount(), 6);
});

test('active sessions preserve successful MCP results and structured error details', async (t) => {
    let failure: 'conflict' | 'not_found' | 'http' | null = null;
    t.mock.method(globalThis, 'fetch', async (url: unknown, options: RequestInit) => {
        const request = requestFor(url, options), initialized = handshake(request);
        if (initialized) return initialized;
        assert.deepEqual(request.params, { name: 'projects_get', arguments: { id: 'p1' } });
        if (failure === 'http') return Response.json({ jsonrpc: '2.0', id: request.id, error: { code: -32004, message: 'endpoint not found' } }, { status: 404 });
        if (failure) {
            const payload = failure === 'conflict'
                ? { error: { code: 'REVISION_CONFLICT', message: 'revision conflict' }, status: 409 }
                : { error: { code: 'NOT_FOUND', message: 'record not found' }, status: 404 };
            return Response.json({ jsonrpc: '2.0', id: request.id, result: {
                isError: true, content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload,
            } });
        }
        return Response.json(toolResult(request, { id: 'p1' }));
    });
    const api = makeClient(connection, new AbortController().signal);
    assert.deepEqual(await api('/projects/p1'), { id: 'p1' });
    failure = 'conflict';
    await assert.rejects(api('/projects/p1'), { message: 'revision conflict', status: 409, code: 'REVISION_CONFLICT' });
    failure = 'not_found';
    await assert.rejects(api('/projects/p1'), { message: 'record not found', status: 404, code: 'NOT_FOUND' });
    failure = 'http';
    await assert.rejects(api('/projects/p1'), { message: 'endpoint not found', status: 404, code: -32004 });
});

test('paginated lists preserve filters and authoritative cursors, including short legacy pages', async (t) => {
    let metadata: Record<string, unknown> = { total: 12, nextOffset: 8 };
    let data: unknown[] = [{ id: 'e1' }];
    t.mock.method(globalThis, 'fetch', async (url: unknown, options: RequestInit) => {
        const request = requestFor(url, options), initialized = handshake(request);
        if (initialized) return initialized;
        assert.deepEqual(request.params, { name: 'experiments_list', arguments: {
            limit: 20, offset: 5, q: '研究', projectId: 'p1', status: 'verified', hypothesisId: 'h1', nodeId: 'n1',
        } });
        return Response.json(toolResult(request, data, metadata));
    });
    const api = makeClient(connection);
    const path = '/experiments?limit=20&offset=5&q=研究&projectId=p1&status=verified&hypothesisId=h1&nodeId=n1';
    assert.deepEqual(await api.page(path), { data, total: 12, nextOffset: 8 });
    // The server's scan cursor can advance even if malformed rows produced no records.
    data = [];
    assert.deepEqual(await api.page(path), { data, total: 12, nextOffset: 8 });
    metadata = { total: 12, nextOffset: null };
    assert.deepEqual(await api.page(path), { data, total: 12, nextOffset: null });
    data = [{ id: 'e1' }];
    metadata = { total: 12 };
    assert.deepEqual(await api.page(path), { data, total: 12, nextOffset: 6 });
    metadata = { total: 6 };
    assert.deepEqual(await api.page(path), { data, total: 6, nextOffset: null });
});

test('invalid pagination fails instead of silently truncating or issuing a non-progressing loop', async (t) => {
    let data: unknown = [];
    let metadata: Record<string, unknown> = {};
    const fetchMock = t.mock.method(globalThis, 'fetch', async (url: unknown, options: RequestInit) => {
        const request = requestFor(url, options), initialized = handshake(request);
        return initialized || Response.json(toolResult(request, data, metadata));
    });
    const api = makeClient(connection);
    for (const [records, page] of [
        [{}, { total: 20, nextOffset: null }],
        [[], { total: -1, nextOffset: null }],
        [[], { total: 1.5, nextOffset: null }],
        [[], { total: '20', nextOffset: null }],
        [[], { total: 20, nextOffset: 5 }],
        [[], { total: 20, nextOffset: 4 }],
        [[], { total: 20, nextOffset: 6.5 }],
        [[], { total: 20, nextOffset: '6' }],
        [[], { total: 20, nextOffset: Number.MAX_SAFE_INTEGER + 1 }],
        [[], { total: 20 }],
    ] as [unknown, Record<string, unknown>][]) {
        data = records;
        metadata = page;
        await assert.rejects(api.page('/experiments?offset=5'), /MCP 分页结果/);
    }
    const count = fetchMock.mock.callCount();
    for (const query of ['offset=-1', 'offset=1.5', 'offset=NaN', 'offset=Infinity', 'offset=', 'limit=0', 'limit=1.5', 'unsafe=1']) {
        await assert.rejects(api.page(`/experiments?${query}`), /列表参数|分页参数/);
    }
    await assert.rejects(api.page('/experiments', { method: 'POST', body: '{}' }), /分页请求需要集合列表操作/);
    assert.equal(fetchMock.mock.callCount(), count);
});

test('mutation results retain related records while callable clients retain the data-only contract', async (t) => {
    const data = { id: 'e1', revision: 2 };
    const affectedHypothesis = { id: 'h1', projectId: 'p1', title: '研究', description: '', baseline: '', status: 'pending', nodes: [], edges: [], updatedAt: '2026-01-01T00:00:00Z', revision: 3 };
    const metadata = { affectedHypothesis, deletedExperimentIds: ['e2'] };
    let textOnly = false;
    t.mock.method(globalThis, 'fetch', async (url: unknown, options: RequestInit) => {
        const request = requestFor(url, options), initialized = handshake(request);
        if (initialized) return initialized;
        assert.deepEqual(request.params, { name: 'experiments_update', arguments: { id: 'e1', data: { revision: 1 } } });
        const response = toolResult(request, data, metadata);
        return Response.json(textOnly ? { ...response, result: { content: response.result.content } } : response);
    });
    const api = makeClient(connection);
    const options = { method: 'PUT', body: JSON.stringify({ revision: 1 }) };
    assert.deepEqual(await api('/experiments/e1', options), data);
    assert.deepEqual(await api.mutation('/experiments/e1', options), { data, ...metadata });
    textOnly = true;
    assert.deepEqual(await api.mutation('/experiments/e1', options), { data, ...metadata });
});

test('all client APIs keep credentials at the configured endpoint and reject malformed RPC/tool shapes', async (t) => {
    for (const baseUrl of ['http://example.com', 'https://user:secret@example.com', 'https://example.com?token=secret', 'https://example.com#fragment']) {
        assert.throws(() => makeClient({ ...connection, baseUrl }), /服务地址需要 HTTPS/);
    }
    let malformed: unknown;
    let malformedRpc = false;
    t.mock.method(globalThis, 'fetch', async (url: unknown, options: RequestInit) => {
        assert.equal(new Headers(options.headers).get('Authorization'), `Bearer ${connection.token}`);
        assert.equal(options.credentials, 'omit');
        assert.equal(options.redirect, 'error');
        const request = requestFor(url, options), initialized = handshake(request);
        if (initialized) return initialized;
        return Response.json(malformedRpc ? malformed : { jsonrpc: '2.0', id: request.id, result: malformed });
    });
    const api = makeClient(connection);
    const options = { headers: { Authorization: 'attacker' }, credentials: 'include', redirect: 'follow' } as const;
    for (const shape of [null, [], 'invalid', { content: {} }, { content: [null, 4] }, { structuredContent: 'invalid' }, { structuredContent: [] }, { content: [{ type: 'text', text: 'null' }] }]) {
        malformed = shape;
        await assert.rejects(api('/projects', options), /无效的 MCP 工具结果/);
    }
    malformed = { structuredContent: { data: [], total: 0, nextOffset: null } };
    assert.deepEqual(await api.page('/projects', options), { data: [], total: 0, nextOffset: null });
    malformed = { structuredContent: { data: { id: 'p1' } } };
    assert.deepEqual(await api.mutation('/projects', { ...options, method: 'POST', body: '{}' }), { data: { id: 'p1' } });
    malformedRpc = true;
    for (const shape of [null, [], 'invalid', { jsonrpc: '2.0', id: -1, result: {} }]) {
        malformed = shape;
        await assert.rejects(api('/projects'), /无效的 MCP 响应/);
    }
});
