import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { effectScope } from 'vue';
import { useWorkspace } from '../web/src/composables/useWorkspace.ts';
import { emptyNode, type Hypothesis, type Project, type Resource, type Experiment } from '../lib/types.ts';

const stamp = '2026-01-01T00:00:00Z';
const project: Project = { id: 'p1', name: 'Project', description: '', revision: 1, updatedAt: stamp };
const hypothesis: Hypothesis = { id: 'h1', projectId: 'p1', title: 'Flow', description: '', baseline: '', status: 'pending', nodes: [emptyNode('n1')], edges: [], revision: 1, updatedAt: stamp };
const resource: Resource = { id: 'r1', projectId: 'p1', name: 'Resource', type: 'code', url: '', description: '', revision: 1, updatedAt: stamp };
const record: Experiment = { id: 'e1', hypothesisId: 'h1', nodeId: 'n1', title: 'Run', summary: '', status: 'pending', source: 'manual', duration: '', logs: [], revision: 1, updatedAt: stamp };
type Reply = { data?: unknown; total?: number; nextOffset?: number | null; error?: { code: string; message: string }; status?: number; affectedHypothesis?: Hypothesis };
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}
function setup(t: TestContext, respond: (name: string, args: Record<string, unknown>) => Reply | Promise<Reply>) {
    for (const name of ['localStorage', 'sessionStorage']) {
        const previous = Object.getOwnPropertyDescriptor(globalThis, name);
        const values = new Map<string, string>();
        Object.defineProperty(globalThis, name, { configurable: true, value: { setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } });
        t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else Reflect.deleteProperty(globalThis, name); });
    }
    t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
        const request = JSON.parse(options.body as string);
        if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
        const result = request.method === 'initialize' ? { protocolVersion: '2025-11-25' } : { structuredContent: await respond(request.params.name, request.params.arguments) };
        return Response.json({ jsonrpc: '2.0', id: request.id, result });
    });
    const scope = effectScope();
    const ws = scope.run(useWorkspace)!;
    t.after(() => scope.stop());
    return ws;
}
const normal = (name: string): Reply => {
    const items: Record<string, unknown> = { projects: project, hypotheses: hypothesis, resources: resource, experiments: record };
    const [kind, action] = name.split('_');
    if (action === 'list') return { data: [items[kind]], total: 1, nextOffset: null };
    if (action === 'get') return { data: items[kind] };
    throw new Error(`Unexpected tool ${name}`);
};
const connect = (ws: ReturnType<typeof useWorkspace>) => ws.connect({ baseUrl: 'https://flowmaster.example', token: 'test-token', remember: false });
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

test('workspace keeps each view bounded, hydrates deep links separately, and exports every server cursor', async t => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const ws = setup(t, (name, args) => {
        calls.push({ name, args });
        const reply = normal(name);
        if (name.endsWith('_get')) return { data: { ...reply.data as object, id: args.id } };
        const first = !(args.offset as number);
        return { data: (reply.data as { id: string }[]).map(item => ({ ...item, id: first ? item.id : `${item.id}-next` })), total: 6001, nextOffset: first ? 4 : null };
    });
    await connect(ws);
    assert.deepEqual(calls.map(call => call.name), ['projects_list']);
    assert.equal(ws.projects.value.length, 1);
    assert.equal(ws.projectsNextOffset.value, 4);
    await ws.selectProject('p1');
    assert.deepEqual(calls.map(call => call.name), ['projects_list', 'hypotheses_list', 'resources_list']);
    assert.equal(ws.hypothesesNextOffset.value, 4);
    assert.equal(ws.resourcesNextOffset.value, 4);
    await ws.getHypothesis('off-page');
    assert.equal(ws.hypotheses.value.length, 1);
    assert.ok(ws.allHypotheses.value.some(item => item.id === 'off-page'));
    await ws.loadRecords({ offset: 4, q: '', status: undefined });
    assert.equal(ws.recordsOffset.value, 4);
    assert.equal(ws.recordsNextOffset.value, null);
    assert.equal('q' in calls.at(-1)!.args, false);
    const exported = await ws.exportWorkspace();
    assert.ok(exported instanceof Blob);
    const data = JSON.parse(await exported.text());
    for (const kind of ['projects', 'hypotheses', 'resources', 'experiments']) {
        assert.equal(data[kind].length, 2);
        assert.deepEqual(calls.filter(call => call.name === `${kind}_list`).slice(-2).map(call => call.args.offset), [0, 4]);
    }
    assert.equal(ws.hypotheses.value.length, 1);
    assert.equal(ws.projects.value.length, 1);
});

test('accepted result edits and seed acknowledge before refresh and preserve refresh errors separately', { timeout: 2000 }, async t => {
    const slowRecords = deferred<Reply>(), slowProjects = deferred<Reply>();
    let afterWrite = false, afterSeed = false;
    const ws = setup(t, (name) => {
        if (name === 'experiments_update') { afterWrite = true; return { data: { ...record, revision: 2, summary: 'saved' }, affectedHypothesis: { ...hypothesis, revision: 2 } }; }
        if (name === 'workspace_seed') { afterSeed = true; return { data: { imported: 4 } }; }
        if (afterWrite && name === 'experiments_list') return slowRecords.promise;
        if (afterSeed && name === 'projects_list') return slowProjects.promise;
        return normal(name);
    });
    await connect(ws); await ws.selectProject('p1'); await ws.loadRecords();
    const saved = await ws.updateResult('e1', { revision: 1, summary: 'saved' });
    assert.equal(saved.revision, 2);
    assert.equal(ws.records.value[0].summary, 'saved');
    assert.equal(ws.allHypotheses.value[0].revision, 2);
    assert.equal(ws.pending.size, 0);
    slowRecords.resolve({ error: { code: 'FAILED', message: 'refresh unavailable' }, status: 503 });
    await flush();
    assert.equal(ws.errors.records, 'refresh unavailable');
    assert.deepEqual(await ws.seed(), { imported: 4 });
    assert.equal(ws.pending.size, 0);
    slowProjects.resolve({ error: { code: 'FAILED', message: 'projects unavailable' }, status: 503 });
    await flush();
    assert.equal(ws.errors.projects, 'projects unavailable');
});

test('late entity reads cannot replace newer revisions or resurrect deleted cache entries', async t => {
    let resourceRevision = 1, listRevision = 1;
    let waiting: { name: string; entered: ReturnType<typeof deferred<void>>; reply: ReturnType<typeof deferred<Reply>> } | undefined;
    const ws = setup(t, async name => {
        if (waiting?.name === name) { waiting.entered.resolve(); return waiting.reply.promise; }
        if (name === 'resources_update') return { data: { ...resource, revision: ++resourceRevision, name: 'Newer resource' } };
        if (name === 'hypotheses_update') return { data: { ...hypothesis, revision: 2 } };
        if (name === 'projects_update') return { data: { ...project, revision: 2 } };
        if (name.endsWith('_list') && listRevision > 1) return { ...normal(name), data: (normal(name).data as object[]).map(item => ({ ...item, revision: listRevision })) };
        if (name.endsWith('_delete')) return { data: { deleted: true } };
        return normal(name);
    });
    await connect(ws); await ws.selectProject('p1');
    const delay = (name: string) => waiting = { name, entered: deferred<void>(), reply: deferred<Reply>() };
    let pending = delay('resources_get');
    const resourceRead = ws.getResource('r1'); await pending.entered.promise;
    await ws.updateResource('r1', { revision: 1, name: 'Newer resource' });
    pending.reply.resolve({ data: resource });
    assert.equal((await resourceRead).revision, 2);
    assert.equal(ws.resources.value[0].revision, 2);
    for (const [name, id, read, update, expectedRevision] of [
        ['resources_get', 'r1', ws.getResource, () => ws.updateResource('r1', { revision: 2 }), 3],
        ['hypotheses_get', 'h1', ws.getHypothesis, () => ws.updateHypothesis('h1', { revision: 1 }), 2],
        ['projects_get', 'p1', ws.getProject, () => ws.updateProject('p1', { revision: 1 }), 2],
    ] as const) {
        pending = delay(name);
        const reading = read(id); await pending.entered.promise;
        await update();
        pending.reply.resolve({ error: { code: 'NOT_FOUND', message: 'stale absence' }, status: 404 });
        assert.equal((await reading).revision, expectedRevision);
    }
    // A later page read also confirms existence without incrementing mutationSequence.
    pending = delay('resources_get');
    const absentResource = ws.getResource('r1'); await pending.entered.promise;
    listRevision = 4;
    await ws.loadResources();
    pending.reply.resolve({ error: { code: 'NOT_FOUND', message: 'stale absence' }, status: 404 });
    assert.equal((await absentResource).revision, 4);
    for (const [name, id, read, remove, cache] of [
        ['resources_get', 'r1', ws.getResource, ws.deleteResource, ws.allResources],
        ['hypotheses_get', 'h1', ws.getHypothesis, ws.deleteHypothesis, ws.allHypotheses],
        ['projects_get', 'p1', ws.getProject, ws.deleteProject, ws.allProjects],
    ] as const) {
        pending = delay(name);
        const reading = read(id); await pending.entered.promise;
        await remove(id);
        pending.reply.resolve(normal(name));
        await assert.rejects(reading, { name: 'AbortError' });
        assert.equal(cache.value.some(item => item.id === id), false);
    }
});
