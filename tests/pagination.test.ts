import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { getPlatformProxy } from 'wrangler';
import { ApiError, type Bindings } from '../lib/server/auth.ts';
import { createWorkspaceService } from '../lib/server/service.ts';
import { emptyNode, type Collection, type Hypothesis } from '../lib/types.ts';

process.env.CLOUDFLARE_CF_FETCH_ENABLED = 'false';
process.env.WRANGLER_SEND_METRICS = 'false';
process.env.WRANGLER_LOG_PATH = '.sites-runtime/tests/wrangler.log';

const stamp = '2026-05-01T00:00:00.000Z';
const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');

test('collection pagination bounds D1 reads and complete UTF-8 responses', async (t) => {
    const proxy = await getPlatformProxy({ configPath: 'tests/wrangler.test.jsonc', persist: false });
    const db = proxy.env.DB as D1Database;
    const pageReads: Record<string, unknown>[][] = [];
    const observedDb = new Proxy(db, {
        get(target, property) {
            if (property === 'batch') return async (statements: D1PreparedStatement[]) => {
                const results = await target.batch(statements);
                pageReads.push(results[0].results as Record<string, unknown>[]);
                return results;
            };
            const value = Reflect.get(target, property);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
    const env: Bindings = { DB: observedDb };
    const service = createWorkspaceService(env, { id: 'reader', scope: 'read' });
    const insert = async (kind: Collection, document: Record<string, unknown>, raw = JSON.stringify(document)) => {
        await db.prepare('INSERT INTO documents (id,kind,project_id,parent_id,data,revision,updated_at) VALUES (?,?,?,?,?,1,?)')
            .bind(document.id, kind, document.projectId || null, document.hypothesisId || null, raw, document.updatedAt || stamp).run();
    };
    const project = async (id: string) => insert('projects', { id, name: id, description: '', revision: 1, updatedAt: stamp });
    const hypothesis = (id: string, projectId: string, nodes = [emptyNode('node', '中文步骤')]): Hypothesis => ({
        id, projectId, title: id, description: '', baseline: '', status: 'pending', nodes, edges: [], revision: 1, updatedAt: stamp,
    });
    try {
        for (const name of readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort()) {
            for (const sql of readFileSync(`drizzle/${name}`, 'utf8').split('--> statement-breakpoint').map(sql => sql.trim()).filter(Boolean)) {
                await db.prepare(sql).run();
            }
        }

        await t.test('short pages preserve full maximum-size records and contiguous offsets', async () => {
            await project('large');
            const expected: Hypothesis[] = [];
            for (let index = 0; index < 4; index++) {
                const item = hypothesis(`large_${index}`, 'large', Array.from({ length: 12 }, (_, node) => ({
                    ...emptyNode(`node_${node}`, `步骤 ${node}`), inputs: '研'.repeat(16000),
                })));
                item.description = 'x'.repeat(10000);
                item.nodes[0].output = 'x'.repeat(600000 - jsonBytes(item));
                assert.equal(jsonBytes(item), 600000);
                assert.ok(item.nodes[0].output.length <= 16000);
                expected.push(item);
                await insert('hypotheses', { ...item });
            }
            const seen: unknown[] = [];
            let offset: number | null = 0;
            do {
                const page = await service.list('hypotheses', { projectId: 'large', limit: 200, offset });
                assert.equal(page.total, expected.length);
                assert.equal(page.data.length, 1);
                assert.ok(jsonBytes(page) <= 1000000);
                // The binding itself only returns the bounded prefix, before
                // application-level JSON parsing or final response trimming.
                assert.equal(pageReads.at(-1)!.length, 1);
                seen.push(...page.data);
                assert.equal(page.nextOffset, seen.length < expected.length ? seen.length : null);
                offset = page.nextOffset;
            } while (offset !== null);
            assert.deepEqual(seen, expected);
            assert.deepEqual(await service.list('hypotheses', { projectId: 'large', offset: 99 }), { data: [], total: 4, nextOffset: null });
        });

        await t.test('experiment enrichment and fixed recording order participate in the budget', async () => {
            await project('experiments');
            const nodes = [emptyNode('node', '\u0000'.repeat(200))];
            const parent = hypothesis('experiment_parent', 'experiments', nodes);
            await insert('hypotheses', { ...parent });
            for (let index = 0; index < 3; index++) {
                const item = {
                    id: `experiment_${index}`, hypothesisId: parent.id, nodeId: 'node', title: `Record ${index}`, status: 'verified',
                    source: 'manual', summary: '实'.repeat(16000), duration: '',
                    logs: Array.from({ length: 9 }, () => ({ time: `2026-05-0${index + 1}T00:00:00.000Z`, message: '研'.repeat(16000) })),
                    revision: 1, updatedAt: `2026-05-0${5 - index}T00:00:00.000Z`,
                };
                item.logs.push({ time: stamp, message: 'x'.repeat(10000) }, { time: stamp, message: '' });
                item.logs.at(-1)!.message = 'x'.repeat(499000 - jsonBytes(item));
                assert.equal(jsonBytes(item), 499000);
                assert.ok(item.logs.at(-1)!.message.length <= 16000);
                await insert('experiments', item);
            }
            const page = await service.list('experiments', { projectId: 'experiments', hypothesisId: parent.id, nodeId: 'node', status: 'verified', limit: 200 });
            // Two raw records fit under 1 MB, but their escaped node title
            // snapshots push the complete records over the budget.
            assert.deepEqual(page.data.map(item => item.id), ['experiment_2']);
            assert.equal(page.nextOffset, 1);
            assert.equal(page.total, 3);
            assert.ok(jsonBytes(page) <= 1000000);
            assert.ok(page.data.every(item => item.nodeTitle === nodes[0].title && item.recordedAtInferred));
            assert.equal(page.data[0].recordedAt, '2026-05-03T00:00:00.000Z');
            assert.equal(pageReads.at(-1)!.length, 1);
            const second = await service.list('experiments', { projectId: 'experiments', limit: 200, offset: page.nextOffset });
            assert.deepEqual(second.data.map(item => item.id), ['experiment_1']);
            assert.equal(second.nextOffset, 2);
            const last = await service.list('experiments', { projectId: 'experiments', limit: 200, offset: second.nextOffset });
            assert.deepEqual(last.data.map(item => item.id), ['experiment_0']);
            assert.equal(last.nextOffset, null);
            assert.equal(last.data[0].logs.length, 11);
        });

        await t.test('filters and tie ordering retain complete totals on regular small pages', async () => {
            await project('small');
            for (const id of ['small_c', 'small_a', 'small_b']) await insert('hypotheses', { ...hypothesis(id, 'small') });
            const page = await service.list('hypotheses', { projectId: 'small', q: 'small_', status: 'pending', limit: 2 });
            assert.deepEqual(page.data.map(item => item.id), ['small_a', 'small_b']);
            assert.equal(page.total, 3);
            assert.equal(page.nextOffset, 2);
            const last = await service.list('hypotheses', { projectId: 'small', q: 'small_', status: 'pending', limit: 2, offset: page.nextOffset });
            assert.deepEqual(last.data.map(item => item.id), ['small_c']);
            assert.equal(last.nextOffset, null);
            assert.deepEqual(await service.list('hypotheses', { projectId: 'small', status: 'rejected' }), { data: [], total: 0, nextOffset: null });
        });

        await t.test('a workspace beyond 5000 records remains completely readable through pages', async () => {
            await db.prepare(`WITH RECURSIVE records(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM records WHERE n < 5000)
                INSERT INTO documents (id,kind,data,revision,updated_at)
                SELECT printf('many_%04d',n), 'projects', json_object('name', printf('Many %04d',n), 'description', ''), 1, ? FROM records`)
                .bind(stamp).run();
            await assert.rejects(service.workspace(), (error: unknown) => error instanceof ApiError && error.code === 'WORKSPACE_TOO_LARGE');
            const ids: string[] = [];
            let offset: number | null = 0;
            do {
                const page = await service.list('projects', { q: 'Many ', limit: 200, offset });
                assert.equal(page.total, 5001);
                assert.ok(page.data.length > 0 && page.data.length <= 200);
                assert.ok(jsonBytes(page) <= 1000000);
                ids.push(...page.data.map(item => item.id));
                assert.equal(page.nextOffset, ids.length < 5001 ? ids.length : null);
                offset = page.nextOffset;
            } while (offset !== null);
            assert.equal(ids.length, 5001);
            assert.equal(new Set(ids).size, 5001);
            assert.equal(ids[0], 'many_0000');
            assert.equal(ids.at(-1), 'many_5000');
        });

        await t.test('oversized legacy rows are reported at their offset without loading or skipping them', async () => {
            await project('legacy');
            await insert('hypotheses', { ...hypothesis('legacy_a', 'legacy') });
            const oversized = { ...hypothesis('legacy_b', 'legacy'), description: 'x'.repeat(1100000) };
            await insert('hypotheses', oversized);
            await insert('hypotheses', { ...hypothesis('legacy_c', 'legacy') });
            const first = await service.list('hypotheses', { projectId: 'legacy', limit: 200 });
            assert.deepEqual(first.data.map(item => item.id), ['legacy_a']);
            assert.equal(first.nextOffset, 1);
            assert.equal(first.total, 3);
            await assert.rejects(service.list('hypotheses', { projectId: 'legacy', offset: first.nextOffset }),
                (error: unknown) => error instanceof ApiError && error.status === 413 && error.code === 'DOCUMENT_TOO_LARGE');
            assert.equal(pageReads.at(-1)!.length, 1);
            assert.equal(pageReads.at(-1)![0].data, null);
        });

        await t.test('final JSON normalization cannot exceed the response budget', async () => {
            await project('numbers');
            const item = { ...hypothesis('numbers_a', 'numbers') };
            // Compact legacy numeric literals expand when JavaScript serializes
            // them. The SQL estimate still bounds the raw binding read.
            const raw = JSON.stringify(item).replace(/}$/, `,"legacyNumbers":[${Array.from({ length: 80000 }, () => '1e9').join(',')}]}`);
            assert.ok(Buffer.byteLength(raw, 'utf8') < 600000);
            await insert('hypotheses', item, raw);
            await insert('hypotheses', { ...item, id: 'numbers_b' }, raw.replaceAll('numbers_a', 'numbers_b'));
            const page = await service.list('hypotheses', { projectId: 'numbers', limit: 200 });
            assert.ok(jsonBytes(page) <= 1000000);
            assert.equal(page.data.length, 1);
            assert.equal(page.nextOffset, 1);
            assert.equal(pageReads.at(-1)!.length, 2);
            assert.equal(page.data[0].legacyNumbers.length, 80000);
            const second = await service.list('hypotheses', { projectId: 'numbers', limit: 200, offset: page.nextOffset });
            assert.equal(second.data[0].id, 'numbers_b');
            assert.equal(second.nextOffset, null);
            const oversized = raw.replaceAll('1e9', '1e19').replaceAll('numbers_a', 'numbers_c');
            await insert('hypotheses', { ...item, id: 'numbers_c' }, oversized);
            await assert.rejects(service.list('hypotheses', { projectId: 'numbers', offset: 2 }),
                (error: unknown) => error instanceof ApiError && error.code === 'DOCUMENT_TOO_LARGE');
        });
    } finally {
        await proxy.dispose();
    }
});
