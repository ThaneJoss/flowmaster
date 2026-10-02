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
function toolResult(request: RpcRequest, data: unknown) {
    return { jsonrpc: '2.0', id: request.id, result: {
        content: [{ type: 'text', text: JSON.stringify({ data }) }], structuredContent: { data },
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
    const pending = api('/projects/p1', { method: 'PUT', body: '{}', signal: caller.signal });
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

test('active sessions preserve successful MCP results and tool error messages', async (t) => {
    let conflict = false;
    t.mock.method(globalThis, 'fetch', async (url: unknown, options: RequestInit) => {
        const request = requestFor(url, options), initialized = handshake(request);
        if (initialized) return initialized;
        assert.deepEqual(request.params, { name: 'projects_get', arguments: { id: 'p1' } });
        if (conflict) {
            const payload = { error: { code: 'REVISION_CONFLICT', message: 'revision conflict' }, status: 409 };
            return Response.json({ jsonrpc: '2.0', id: request.id, result: {
                isError: true, content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload,
            } });
        }
        return Response.json(toolResult(request, { id: 'p1' }));
    });
    const api = makeClient(connection, new AbortController().signal);
    assert.deepEqual(await api('/projects/p1'), { id: 'p1' });
    conflict = true;
    await assert.rejects(api('/projects/p1'), /revision conflict/);
});
