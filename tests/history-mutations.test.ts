import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { getPlatformProxy } from 'wrangler';
import { ApiError } from '../lib/server/auth.ts';
import { createWorkspaceService } from '../lib/server/service.ts';
import { emptyNode, type Collection, type Experiment, type Hypothesis } from '../lib/types.ts';

process.env.CLOUDFLARE_CF_FETCH_ENABLED = 'false';
process.env.WRANGLER_SEND_METRICS = 'false';
process.env.WRANGLER_LOG_PATH = '.sites-runtime/tests/wrangler.log';

const stamp = '2026-05-01T00:00:00.000Z';
const historyMarker = 'history-payload-must-stay-in-d1';
const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');

test('history mutations preserve evidence without returning historical bodies to the Worker', async t => {
    const proxy = await getPlatformProxy({ configPath: 'tests/wrangler.test.jsonc', persist: false });
    t.after(() => proxy.dispose());
    const db = proxy.env.DB as D1Database;
    const originalStatements = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
    let returnedBytes = 0, returnedHistoryBody = false;
    let returnedPageSizes: number[] = [];
    let beforeBatch: (() => Promise<void>) | undefined;

    function observeResult(value: unknown) {
        const serialized = JSON.stringify(value) || '';
        returnedBytes += Buffer.byteLength(serialized, 'utf8');
        returnedHistoryBody ||= serialized.includes(historyMarker);
        if (value && typeof value === 'object' && 'results' in value && Array.isArray(value.results)) {
            returnedPageSizes.push(value.results.length);
        }
    }
    function observeStatement(statement: D1PreparedStatement): D1PreparedStatement {
        const wrapped = new Proxy(statement, {
            get(target, property) {
                if (property === 'bind') return (...values: unknown[]) => observeStatement(target.bind(...values));
                const value = Reflect.get(target, property);
                if (['first', 'all', 'raw', 'run'].includes(String(property)) && typeof value === 'function') {
                    return async (...args: unknown[]) => {
                        const result: unknown = await Reflect.apply(value, target, args);
                        observeResult(result);
                        return result;
                    };
                }
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });
        originalStatements.set(wrapped, statement);
        return wrapped;
    }
    const observedDb = new Proxy(db, {
        get(target, property) {
            if (property === 'prepare') return (sql: string) => observeStatement(target.prepare(sql));
            if (property === 'batch') return async (statements: D1PreparedStatement[]) => {
                const hook = beforeBatch;
                beforeBatch = undefined;
                await hook?.();
                // The real binding receives its own statements, not proxy objects.
                const results = await target.batch(statements.map(statement => originalStatements.get(statement) || statement));
                for (const result of results) observeResult(result);
                return results;
            };
            const value = Reflect.get(target, property);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
    const service = createWorkspaceService({ DB: observedDb }, { id: 'writer', scope: 'write' });
    async function bounded<T>(operation: () => Promise<T>): Promise<T> {
        returnedBytes = 0; returnedHistoryBody = false; returnedPageSizes = [];
        try {
            return await operation();
        } finally {
            assert.equal(returnedHistoryBody, false, 'historical evidence must remain inside D1 during mutations');
            assert.ok(returnedBytes < 16000, 'binding results should contain only the small flow, project and bounded history metadata');
            assert.ok(returnedPageSizes.every(size => size <= 25), 'legacy metadata pages must contain at most 25 records');
        }
    }
    async function insert(kind: Collection, document: Record<string, unknown>) {
        await db.prepare('INSERT INTO documents (id,kind,project_id,parent_id,data,revision,updated_at) VALUES (?,?,?,?,?,?,?)')
            .bind(document.id, kind, document.projectId || null, document.hypothesisId || null,
                JSON.stringify(document), document.revision || 1, document.updatedAt || stamp).run();
    }
    async function read(id: string) {
        const row = await db.prepare('SELECT data,revision,updated_at FROM documents WHERE id=?')
            .bind(id).first<{ data: string; revision: number; updated_at: string }>();
        assert.ok(row);
        return { document: JSON.parse(row.data) as Record<string, unknown>, revision: row.revision, updatedAt: row.updated_at };
    }
    async function setup(id: string, nodes = [emptyNode('node', 'Original step')]): Promise<Hypothesis> {
        const projectId = id + '_project';
        await insert('projects', { id: projectId, name: projectId, description: '', revision: 1, updatedAt: stamp });
        const flow: Hypothesis = {
            id, projectId, title: id, description: '', baseline: '', status: 'pending',
            nodes, edges: [], revision: 1, updatedAt: stamp,
        };
        await insert('hypotheses', { ...flow });
        return flow;
    }
    function experiment(id: string, hypothesisId: string, overrides: Partial<Experiment> = {}): Experiment {
        return {
            id, hypothesisId, nodeId: 'node', title: id, status: 'verified', source: 'manual',
            summary: historyMarker, duration: '12 minutes',
            logs: [{ time: stamp, message: historyMarker }], revision: 1, updatedAt: stamp, ...overrides,
        };
    }
    const hasCode = (code: string) => (error: unknown) => error instanceof ApiError && error.code === code;
    for (const name of readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort()) {
        for (const sql of readFileSync('drizzle/' + name, 'utf8').split('--> statement-breakpoint').map(sql => sql.trim()).filter(Boolean)) {
            await db.prepare(sql).run();
        }
    }

    await t.test('renaming, deleting and moving a flow do not read already snapshotted history bodies', async () => {
        let flow = await setup('large_history');
        const originals = [];
        for (let index = 0; index < 12; index++) {
            const item = experiment('large_record_' + index, flow.id, {
                nodeTitle: 'Original snapshot', recordedAt: stamp, recordedAtInferred: false,
                logs: Array.from({ length: 4 }, () => ({ time: stamp, message: historyMarker + 'x'.repeat(15900) })),
            });
            assert.ok(jsonBytes(item) > 63000);
            await insert('experiments', { ...item });
            originals.push(await read(item.id));
        }
        flow = (await bounded(() => service.node('update', {
            hypothesisId: flow.id, revision: flow.revision, nodeId: 'node', patch: { title: 'Renamed step' },
        }))).data;
        flow = (await bounded(() => service.node('delete', {
            hypothesisId: flow.id, revision: flow.revision, nodeId: 'node',
        }))).data;
        assert.equal(flow.nodes.length, 0);
        await insert('projects', { id: 'large_destination', name: 'Destination', description: '', revision: 1, updatedAt: stamp });
        flow = (await bounded(() => service.update('hypotheses', flow.id, {
            revision: flow.revision, projectId: 'large_destination',
        }))).data as Hypothesis;
        assert.equal(flow.projectId, 'large_destination');
        for (let index = 0; index < originals.length; index++) {
            assert.deepEqual(await read('large_record_' + index), originals[index], 'existing snapshots and all evidence remain unchanged');
        }
    });

    await t.test('backfilling a renamed step freezes legacy recording time and preserves evidence', async () => {
        let flow = await setup('legacy_rename', [emptyNode('node', 'Original step'), emptyNode('other', 'Other step')]);
        const firstLog = '2026-04-01T10:15:00.123+08:00';
        const cases = [
            {
                item: experiment('legacy_log', flow.id, {
                    source: 'agent', recordedAt: 'invalid', recordedAtInferred: false, nodeTitle: '',
                    logs: [
                        { time: 'not a date', message: historyMarker },
                        { time: firstLog, message: 'first valid log' },
                        { time: '2026-03-01T00:00:00.000Z', message: 'earlier date, later array entry' },
                    ],
                }),
                recording: { recordedAt: '2026-04-01T02:15:00.123Z', recordedAtInferred: true },
            },
            {
                item: experiment('legacy_fallback', flow.id, { logs: [{ time: 'unknown', message: historyMarker }] }),
                recording: { recordedAt: stamp, recordedAtInferred: true },
            },
            {
                item: experiment('legacy_fixed', flow.id, { recordedAt: '2026-03-04T05:06:07.890Z', recordedAtInferred: false }),
                recording: { recordedAt: '2026-03-04T05:06:07.890Z', recordedAtInferred: false },
            },
            {
                item: experiment('legacy_basic_offset_log', flow.id, {
                    logs: [{ time: '2026-04-01T10:15:00.123+0800', message: historyMarker }],
                }),
                recording: { recordedAt: '2026-04-01T02:15:00.123Z', recordedAtInferred: true },
            },
            {
                item: experiment('legacy_basic_offset_recorded', flow.id, {
                    recordedAt: '2026-03-04T05:06:07.890+0800', recordedAtInferred: false,
                }),
                recording: { recordedAt: '2026-03-04T05:06:07.890+0800', recordedAtInferred: false },
            },
            {
                item: experiment('legacy_fraction', flow.id, {
                    logs: [{ time: '2026-04-01T10:15:00.1236Z', message: historyMarker }],
                }),
                recording: { recordedAt: '2026-04-01T10:15:00.123Z', recordedAtInferred: true },
            },
        ];
        // Cross the 25-record metadata page boundary. Every legacy row must be
        // patched even though the first history UPDATE changes more than one row.
        for (let index = cases.length; index < 30; index++) {
            cases.push({
                item: experiment('legacy_page_' + index, flow.id),
                recording: { recordedAt: stamp, recordedAtInferred: true },
            });
        }
        const untouched = [
            experiment('legacy_existing_snapshot', flow.id, { nodeTitle: 'Historical title', source: 'agent' }),
            experiment('legacy_other_node', flow.id, { nodeId: 'other' }),
        ];
        for (const { item } of cases) await insert('experiments', { ...item });
        for (const item of untouched) await insert('experiments', { ...item });
        const originalUntouched = await Promise.all(untouched.map(item => read(item.id)));
        flow = (await bounded(() => service.node('update', {
            hypothesisId: flow.id, revision: flow.revision, nodeId: 'node', patch: { title: 'New step title' },
        }))).data;
        assert.equal(flow.revision, 2);
        assert.notEqual(flow.updatedAt, stamp);
        assert.ok(returnedPageSizes.filter(size => size > 0).length >= 2, 'the fixture must exercise multiple metadata pages');
        for (const { item, recording } of cases) {
            const saved = await read(item.id);
            assert.deepEqual(saved.document, {
                ...item, ...recording, nodeTitle: 'Original step', revision: 2, updatedAt: flow.updatedAt,
            });
            assert.equal(saved.revision, 2);
            assert.equal(saved.updatedAt, flow.updatedAt);
        }
        for (let index = 0; index < untouched.length; index++) {
            assert.deepEqual(await read(untouched[index].id), originalUntouched[index]);
        }
    });

    await t.test('deleting a step preserves its legacy snapshot and forbids reusing its historical ID', async () => {
        let flow = await setup('legacy_delete');
        const record = experiment('deleted_step_record', flow.id, { source: 'agent' });
        await insert('experiments', { ...record });
        flow = (await bounded(() => service.node('delete', {
            hypothesisId: flow.id, revision: flow.revision, nodeId: 'node',
        }))).data;
        assert.equal(flow.nodes.length, 0);
        const saved = await read(record.id);
        assert.deepEqual(saved.document, {
            ...record, nodeTitle: 'Original step', recordedAt: stamp, recordedAtInferred: true,
            revision: 2, updatedAt: flow.updatedAt,
        });
        assert.equal(saved.revision, 2);
        assert.equal(saved.updatedAt, flow.updatedAt);
        const before = await read(flow.id);
        await assert.rejects(bounded(() => service.node('create', {
            hypothesisId: flow.id, revision: flow.revision, node: emptyNode('node', 'Reused ID'),
        })), hasCode('NODE_ID_REUSED'));
        assert.deepEqual(await read(flow.id), before);
        assert.deepEqual(await read(record.id), saved);
    });

    await t.test('moving a flow validates resources used only by retained history', async () => {
        let flow = await setup('history_resources');
        await insert('projects', { id: 'resource_destination', name: 'Destination', description: '', revision: 1, updatedAt: stamp });
        const resourceId = 'historical_resource';
        await insert('resources', {
            id: resourceId, projectId: flow.projectId, name: 'Historical evidence', type: 'document',
            url: '', description: '', revision: 1, updatedAt: stamp,
        });
        const record = experiment('history_resource_record', flow.id, { nodeTitle: 'Original snapshot', resourceIds: [resourceId] });
        await insert('experiments', { ...record });
        flow = (await bounded(() => service.node('delete', {
            hypothesisId: flow.id, revision: flow.revision, nodeId: 'node',
        }))).data;
        const beforeFlow = await read(flow.id), beforeRecord = await read(record.id);
        await assert.rejects(bounded(() => service.update('hypotheses', flow.id, {
            revision: flow.revision, projectId: 'resource_destination',
        })), hasCode('RESOURCE_PROJECT_MISMATCH'));
        assert.deepEqual(await read(flow.id), beforeFlow);
        assert.deepEqual(await read(record.id), beforeRecord);
        // Remove the historical association directly in this fixture; no body needs
        // to cross the observed binding to validate the next project move.
        await db.prepare("UPDATE documents SET data=json_set(data,'$.resourceIds',json('[]')) WHERE id=?").bind(record.id).run();
        flow = (await bounded(() => service.update('hypotheses', flow.id, {
            revision: flow.revision, projectId: 'resource_destination',
        }))).data as Hypothesis;
        assert.equal(flow.projectId, 'resource_destination');
    });

    await t.test('a failed hypothesis CAS does not backfill history independently', async () => {
        const flow = await setup('history_conflict');
        const records = Array.from({ length: 30 }, (_, index) => experiment('conflict_record_' + index, flow.id));
        for (const record of records) await insert('experiments', { ...record });
        const beforeRecords = await Promise.all(records.map(record => read(record.id)));
        beforeBatch = async () => {
            await db.prepare("UPDATE documents SET revision=revision+1,data=json_set(data,'$.revision',revision+1,'$.title','Concurrent edit') WHERE id=?")
                .bind(flow.id).run();
        };
        await assert.rejects(bounded(() => service.node('update', {
            hypothesisId: flow.id, revision: flow.revision, nodeId: 'node', patch: { title: 'Must not be saved' },
        })), hasCode('REVISION_CONFLICT'));
        assert.equal(beforeBatch, undefined, 'the competing update must run immediately before the real batch');
        assert.ok(returnedPageSizes.filter(size => size > 0).length >= 2);
        for (let index = 0; index < records.length; index++) {
            assert.deepEqual(await read(records[index].id), beforeRecords[index], 'CAS failure must leave every history page unchanged');
        }
        const savedFlow = await read(flow.id);
        assert.equal(savedFlow.document.title, 'Concurrent edit');
        assert.equal(savedFlow.revision, 2);
        assert.deepEqual(savedFlow.document.nodes, flow.nodes);
    });

    await t.test('snapshot growth beyond the document budget rejects the entire mutation', async () => {
        const flow = await setup('history_size');
        const record = experiment('near_limit_record', flow.id, {
            logs: Array.from({ length: 37 }, () => ({ time: stamp, message: 'x'.repeat(16000) })),
        });
        record.logs.push({ time: stamp, message: '' });
        const remaining = 600000 - jsonBytes(record);
        assert.ok(remaining > 0 && remaining <= 16000);
        record.logs.at(-1)!.message = 'x'.repeat(remaining);
        assert.equal(jsonBytes(record), 600000);
        await insert('experiments', { ...record });
        const beforeFlow = await read(flow.id), beforeRecord = await read(record.id);
        await assert.rejects(bounded(() => service.node('update', {
            hypothesisId: flow.id, revision: flow.revision, nodeId: 'node', patch: { title: 'New title' },
        })), hasCode('DOCUMENT_TOO_LARGE'));
        assert.deepEqual(await read(flow.id), beforeFlow);
        assert.deepEqual(await read(record.id), beforeRecord);
    });
});
