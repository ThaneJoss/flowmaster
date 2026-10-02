import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClient, type Connection } from '../lib/client.ts';

const connection: Connection = { baseUrl: 'https://flowmaster.example', token: 'test-only-token', remember: false };
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(r => { resolve = r; });
    return { promise, resolve };
}

// A response can complete after cancellation (for example, while JSON decoding
// or an adapter is pending). Session validity must also be checked after fetch.
test('logout discards a delayed workspace response', async (t) => {
    const response = deferred<Response>();
    const fetchMock = t.mock.method(globalThis, 'fetch', () => response.promise);
    const session = new AbortController();
    const api = makeClient(connection, session.signal);
    let workspace = 'empty';
    const pending = api<string>('/workspace').then(value => { workspace = value; });
    session.abort();
    response.resolve(Response.json({ data: 'private workspace' }));
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(workspace, 'empty');
    assert.equal(fetchMock.mock.callCount(), 1);
});

test('logout cancels mutations even when the caller supplies its own signal', async (t) => {
    const body = deferred<{ data: string }>();
    const caller = new AbortController();
    const session = new AbortController();
    let requestSignal: AbortSignal | null | undefined;
    t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
        requestSignal = options.signal;
        return { ok: true, status: 200, json: () => body.promise } as Response;
    });
    const api = makeClient(connection, session.signal);
    const pending = api('/projects/p1', { method: 'PUT', body: '{}', signal: caller.signal });
    await Promise.resolve();
    session.abort();
    body.resolve({ data: 'old account update' });
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(requestSignal?.aborted, true);
    assert.equal(caller.signal.aborted, false);
});

test('switching accounts cannot restore the previous workspace or issue follow-up requests', async (t) => {
    const oldResponse = deferred<Response>();
    const fetchMock = t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
        const token = new Headers(options.headers).get('Authorization');
        return token === `Bearer ${connection.token}` ? oldResponse.promise : Response.json({ data: 'new workspace' });
    });
    const oldSession = new AbortController();
    const oldApi = makeClient(connection, oldSession.signal);
    const newApi = makeClient({ ...connection, token: 'another-test-token' }, new AbortController().signal);
    let workspace = 'empty';
    const oldPending = oldApi<string>('/workspace').then(value => { workspace = value; });
    oldSession.abort();
    workspace = await newApi<string>('/workspace');
    oldResponse.resolve(Response.json({ data: 'old workspace' }));
    await assert.rejects(oldPending, { name: 'AbortError' });
    await assert.rejects(oldApi('/workspace'), { name: 'AbortError' });
    assert.equal(workspace, 'new workspace');
    assert.equal(fetchMock.mock.callCount(), 2);
});

test('active sessions preserve successful responses and API error messages', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ data: { id: 'p1' } }));
    const api = makeClient(connection, new AbortController().signal);
    assert.deepEqual(await api('/projects/p1'), { id: 'p1' });
    t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { message: 'revision conflict' } }, { status: 409 }));
    await assert.rejects(api('/projects/p1'), /revision conflict/);
});
