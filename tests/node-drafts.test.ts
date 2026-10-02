import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computed, effectScope, nextTick, ref } from 'vue';
import { useNodeDrafts } from '../lib/node-drafts.ts';
import { emptyNode, type Hypothesis } from '../lib/types.ts';

const hypothesis = (id: string): Hypothesis => ({ id, projectId: 'p1', title: id, description: '', baseline: '', status: 'pending', updatedAt: '', revision: 1, nodes: [emptyNode('a', `${id} A`), emptyNode('b', `${id} B`)], edges: [] });
function setup() {
    const scope = effectScope();
    const hypotheses = ref([hypothesis('h1'), hypothesis('h2')]);
    const hypothesisId = ref('h1'), nodeId = ref('a');
    const current = computed(() => hypotheses.value.find(h => h.id === hypothesisId.value) || null);
    const selected = computed(() => current.value?.nodes.find(n => n.id === nodeId.value) || null);
    const drafts = scope.run(() => useNodeDrafts(hypotheses, current, selected))!;
    return { scope, hypotheses, hypothesisId, nodeId, current, selected, ...drafts };
}

test('node and hypothesis switches retain isolated, memory-only drafts without mutating workspace', async () => {
    const s = setup();
    try {
        s.nodeDraft.value!.title = 'Unsaved A'; s.upstream.value = ['b'];
        s.nodeId.value = 'b'; await nextTick();
        s.nodeDraft.value!.summary = 'Unsaved B';
        s.hypothesisId.value = 'h2'; s.nodeId.value = 'a'; await nextTick();
        assert.equal(s.nodeDraft.value!.title, 'h2 A');
        s.nodeDraft.value!.title = 'Other hypothesis A';
        for (let i = 0; i < 4; i++) {
            s.hypothesisId.value = 'h1'; s.nodeId.value = 'a'; await nextTick();
            assert.equal(s.nodeDraft.value!.title, 'Unsaved A'); assert.deepEqual(s.upstream.value, ['b']);
            s.nodeId.value = 'b'; await nextTick(); assert.equal(s.nodeDraft.value!.summary, 'Unsaved B');
            s.hypothesisId.value = 'h2'; s.nodeId.value = 'a'; await nextTick();
            assert.equal(s.nodeDraft.value!.title, 'Other hypothesis A');
        }
        assert.equal(s.hypotheses.value[0].nodes[0].title, 'h1 A');
        assert.deepEqual(s.hypotheses.value[0].edges, []);
    } finally { s.scope.stop(); }
});

test('drag/layout refresh updates coordinates and clean fields without losing dirty inspector fields', async () => {
    const s = setup();
    try {
        s.nodeDraft.value!.summary = 'Keep this';
        const updated = structuredClone(hypothesis('h1'));
        updated.nodes[0].x = 320; updated.nodes[0].y = 90; updated.nodes[0].title = 'Remote clean title';
        updated.edges = [{ source: 'b', target: 'a' }];
        s.hypotheses.value = [updated, hypothesis('h2')]; await nextTick();
        assert.equal(s.nodeDraft.value!.summary, 'Keep this');
        assert.equal(s.nodeDraft.value!.x, 320); assert.equal(s.nodeDraft.value!.y, 90);
        assert.equal(s.nodeDraft.value!.title, 'Remote clean title');
        assert.deepEqual(s.upstream.value, ['b']); assert.equal(s.conflicted.value, false);
    } finally { s.scope.stop(); }
});

test('refresh flags remote edits to dirty fields and dependencies instead of silently replacing them', async () => {
    const s = setup();
    try {
        s.nodeDraft.value!.title = 'Local title';
        const updated = hypothesis('h1'); updated.nodes[0].title = 'Remote title';
        s.hypotheses.value = [updated]; await nextTick();
        assert.equal(s.nodeDraft.value!.title, 'Local title'); assert.equal(s.conflicted.value, true);
        s.nodeId.value = 'b'; await nextTick(); s.nodeId.value = 'a'; await nextTick();
        assert.equal(s.conflicted.value, true);
        s.nodeDraft.value!.title = 'Remote title'; assert.equal(s.dirty.value, false);
    } finally { s.scope.stop(); }
});

test('acknowledging a successful save clears only submitted changes and retains later typing', async () => {
    const s = setup();
    try {
        s.nodeDraft.value!.title = 'Submitted'; s.upstream.value = ['b'];
        const submitted = { ...s.nodeDraft.value! };
        s.nodeDraft.value!.title = 'Typed during request';
        s.acknowledge('h1', submitted, ['b']);
        const updated = hypothesis('h1'); updated.nodes[0] = submitted; updated.edges = [{ source: 'b', target: 'a' }];
        s.hypotheses.value = [updated]; await nextTick();
        assert.equal(s.nodeDraft.value!.title, 'Typed during request');
        assert.equal(s.dirty.value, true); assert.equal(s.conflicted.value, false);
        const latest = { ...s.nodeDraft.value! };
        s.acknowledge('h1', latest, ['b']);
        assert.equal(s.dirty.value, false);
    } finally { s.scope.stop(); }
});

test('save acknowledgement applies to the originating node after navigation', async () => {
    const s = setup();
    try {
        s.nodeDraft.value!.title = 'Saved A'; const submitted = { ...s.nodeDraft.value! };
        s.nodeId.value = 'b'; await nextTick(); s.nodeDraft.value!.title = 'Unsaved B';
        s.acknowledge('h1', submitted, []);
        const updated = hypothesis('h1'); updated.nodes[0] = submitted;
        s.hypotheses.value = [updated]; await nextTick();
        assert.equal(s.nodeDraft.value!.title, 'Unsaved B'); assert.equal(s.dirty.value, true);
        s.nodeId.value = 'a'; await nextTick(); assert.equal(s.nodeDraft.value!.title, 'Saved A'); assert.equal(s.dirty.value, false);
    } finally { s.scope.stop(); }
});

test('logout/workspace change clears drafts even when the next account reuses the same IDs', async () => {
    const s = setup();
    try {
        s.nodeDraft.value!.title = 'Private draft';
        s.nodeId.value = 'b'; await nextTick(); s.nodeDraft.value!.summary = 'Another private draft';
        s.clear(); s.hypotheses.value = []; await nextTick();
        assert.equal(s.nodeDraft.value, null); assert.equal(s.dirty.value, false);
        s.hypotheses.value = [hypothesis('h1')]; s.nodeId.value = 'a'; await nextTick();
        assert.equal(s.nodeDraft.value!.title, 'h1 A');
        s.nodeId.value = 'b'; await nextTick(); assert.equal(s.nodeDraft.value!.summary, '');
    } finally { s.scope.stop(); }
});

test('deleted nodes do not resurrect old drafts', async () => {
    const s = setup();
    try {
        s.nodeDraft.value!.title = 'Deleted draft';
        const updated = hypothesis('h1'); updated.nodes = updated.nodes.filter(n => n.id !== 'a');
        s.hypotheses.value = [updated]; await nextTick(); assert.equal(s.nodeDraft.value, null);
        s.hypotheses.value = [hypothesis('h1')]; await nextTick(); assert.equal(s.nodeDraft.value!.title, 'h1 A');
    } finally { s.scope.stop(); }
});
