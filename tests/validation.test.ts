import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeSchema, nodePatchSchema, schemas, updateSchemas } from '../lib/server/validation.ts';

const node = { id: 'a', title: 'Measure', type: 'experiment', status: 'pending', x: 0, y: 0 };
const hypothesis = { projectId: 'p', title: 'Hypothesis', status: 'pending', nodes: [node], edges: [] };
const experiment = { hypothesisId: 'h', nodeId: 'a', title: 'Result', status: 'verified' };

test('partial collection updates preserve omitted fields and accept explicit clears', () => {
    const cases = [
        { schema: updateSchemas.projects, changed: { name: 'Renamed' }, cleared: { description: '' } },
        { schema: updateSchemas.hypotheses, changed: { title: 'Renamed' }, cleared: { description: '', baseline: '', nodes: [], edges: [] } },
        { schema: updateSchemas.experiments, changed: { title: 'Renamed' }, cleared: { summary: '', duration: '', logs: [], resourceIds: [] } },
        { schema: updateSchemas.resources, changed: { name: 'Renamed' }, cleared: { url: '', description: '' } },
    ];
    for (const { schema, changed, cleared } of cases) {
        assert.deepEqual(schema.parse({ revision: 2 }), { revision: 2 });
        assert.deepEqual(schema.parse({ revision: 2, ...changed }), { revision: 2, ...changed });
        assert.deepEqual(schema.parse({ revision: 2, ...cleared }), { revision: 2, ...cleared });
        assert.equal(schema.safeParse(changed).success, false, 'updates require a revision');
        assert.equal(schema.safeParse({ revision: 0, ...changed }).success, false);
    }
});

test('node patches preserve untouched evidence and execution fields', () => {
    assert.deepEqual(nodePatchSchema.parse({}), {});
    assert.deepEqual(nodePatchSchema.parse({ title: 'Renamed' }), { title: 'Renamed' });
    const clear = { inputs: '', output: '', rationale: '', method: '', conclusion: '', nextAction: '', startedAt: '', resourceIds: [] };
    assert.deepEqual(nodePatchSchema.parse(clear), clear);
    for (const [protectedField, value] of Object.entries({ id: 'b', x: 1, y: 1, status: 'verified', currentResultId: 'result', summary: '', duration: '' })) {
        assert.equal(nodePatchSchema.safeParse({ [protectedField]: value }).success, false, protectedField);
    }
    assert.equal(nodePatchSchema.safeParse({ inputs: 'x'.repeat(16001) }).success, false);
    assert.equal(nodePatchSchema.safeParse({ resourceIds: ['r', 'r'] }).success, false);
});

test('create schemas and complete nested nodes retain their defaults', () => {
    assert.deepEqual(schemas.projects.parse({ name: 'Project' }), { name: 'Project', description: '' });
    assert.deepEqual(schemas.resources.parse({ projectId: 'p', name: 'Resource', type: 'document' }), {
        projectId: 'p', name: 'Resource', type: 'document', url: '', description: '',
    });
    assert.deepEqual(schemas.experiments.parse(experiment), { ...experiment, summary: '', duration: '', logs: [] });
    const parsedNode = nodeSchema.parse(node);
    assert.deepEqual(parsedNode, {
        ...node, inputs: '', output: '', summary: '', rationale: '', method: '', conclusion: '', nextAction: '', startedAt: '', duration: '',
    });
    assert.deepEqual(schemas.hypotheses.parse(hypothesis), { ...hypothesis, nodes: [parsedNode], description: '', baseline: '' });
    assert.deepEqual(updateSchemas.hypotheses.parse({ revision: 2, nodes: [node] }), { revision: 2, nodes: [parsedNode] });
});

test('flow validation still rejects duplicate nodes, invalid edges and cycles', () => {
    const second = { ...node, id: 'b' };
    const valid = { ...hypothesis, nodes: [node, second], edges: [{ source: 'a', target: 'b' }] };
    assert.equal(schemas.hypotheses.safeParse(valid).success, true);
    for (const invalid of [
        { ...valid, nodes: [node, node] },
        { ...valid, edges: [{ source: 'a', target: 'missing' }] },
        { ...valid, edges: [{ source: 'a', target: 'a' }] },
        { ...valid, edges: [...valid.edges, ...valid.edges] },
        { ...valid, edges: [...valid.edges, { source: 'b', target: 'a' }] },
    ]) assert.equal(schemas.hypotheses.safeParse(invalid).success, false);
    assert.equal(schemas.hypotheses.safeParse({ ...hypothesis, nodes: Array.from({ length: 121 }, (_, i) => ({ ...node, id: `n${i}` })) }).success, false);
});

test('updates retain resource URL and recording-time validation', () => {
    for (const url of ['https://example.com/evidence', 'http://example.com/evidence', '']) {
        assert.equal(updateSchemas.resources.safeParse({ revision: 2, url }).success, true);
    }
    for (const url of ['javascript:alert(1)', 'https://user:secret@example.com', 'not a URL']) {
        assert.equal(updateSchemas.resources.safeParse({ revision: 2, url }).success, false);
    }
    for (const recordedAt of ['2026-11-06T12:34:56Z', '2026-11-06T12:34:56.123456Z']) {
        assert.equal(schemas.experiments.parse({ ...experiment, recordedAt }).recordedAt, recordedAt);
    }
    assert.equal(schemas.experiments.safeParse({ ...experiment, recordedAt: 'not a date' }).success, false);
    const startedAt = '2026-11-06 12:34 +0800';
    assert.deepEqual(nodePatchSchema.parse({ startedAt }), { startedAt });
});

test('oversized collections are rejected before their elements are parsed', () => {
    const cases = [
        { limit: 120, parse: (items: unknown[]) => schemas.hypotheses.safeParse({ ...hypothesis, nodes: items }) },
        { limit: 360, parse: (items: unknown[]) => schemas.hypotheses.safeParse({ ...hypothesis, edges: items }) },
        { limit: 200, parse: (items: unknown[]) => schemas.experiments.safeParse({ ...experiment, logs: items }) },
        { limit: 50, parse: (items: unknown[]) => nodePatchSchema.safeParse({ resourceIds: items }) },
    ];
    for (const { limit, parse } of cases) {
        let elementsRead = 0;
        const oversized = new Array(limit + 1).fill(null);
        Object.defineProperty(oversized, 0, { get() { elementsRead++; return null; } });
        assert.equal(parse(oversized).success, false);
        assert.equal(elementsRead, 0, `reject the ${limit}-item limit before traversal`);
    }
});
