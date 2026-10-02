import { computed, ref, watch, type Ref } from 'vue';
import type { FlowNode, Hypothesis } from './types.ts';

// Coordinates belong to the canvas. Only inspector fields are kept as drafts.
const fields = ['title', 'type', 'progress', 'inputs', 'output', 'rationale', 'method', 'conclusion', 'nextAction', 'startedAt', 'resourceIds'] as const;
const cloneNode = (node: FlowNode): FlowNode => ({ ...node, resourceIds: [...(node.resourceIds || [])] });
const sameField = (a: unknown, b: unknown) => Array.isArray(a) && Array.isArray(b) ? sameParents(a, b) : a === b;
const sameParents = (a: string[], b: string[]) => a.length === b.length && a.every(id => b.includes(id));
const key = (hypothesisId: string, nodeId: string) => JSON.stringify([hypothesisId, nodeId]);
interface Draft {
    node: FlowNode;
    upstream: string[];
    baseNode: FlowNode;
    baseUpstream: string[];
    conflicts: string[];
}
const changed = (draft: Draft) => fields.some(field => !sameField(draft.node[field], draft.baseNode[field])) || !sameParents(draft.upstream, draft.baseUpstream);

export function useNodeDrafts(hypotheses: Ref<Hypothesis[]>, current: Ref<Hypothesis | null>, selected: Ref<FlowNode | null>) {
    const drafts = new Map<string, Draft>();
    const active = ref<Draft | null>(null);
    watch([current, selected], ([hypothesis, node]) => {
        // Deleted nodes/hypotheses must not leave drafts that can be resurrected.
        const live = new Set(hypotheses.value.flatMap(h => h.nodes.map(n => key(h.id, n.id))));
        for (const id of drafts.keys()) if (!live.has(id)) drafts.delete(id);
        if (!hypothesis || !node) { active.value = null; return; }
        const id = key(hypothesis.id, node.id);
        const parents = hypothesis.edges.filter(e => e.target === node.id).map(e => e.source);
        const previous = drafts.get(id);
        const next: Draft = { node: cloneNode(node), upstream: [...parents], baseNode: cloneNode(node), baseUpstream: [...parents], conflicts: [] };
        if (previous) {
            for (const field of fields) {
                if (sameField(previous.node[field], previous.baseNode[field])) continue;
                // Preserve only edited fields, including independent copies of resource references.
                const value = previous.node[field];
                Object.assign(next.node, { [field]: Array.isArray(value) ? [...value] : value });
                if (!sameField(previous.node[field], next.baseNode[field]) && (previous.conflicts.includes(field) || !sameField(previous.baseNode[field], next.baseNode[field]))) next.conflicts.push(field);
            }
            if (!sameParents(previous.upstream, previous.baseUpstream)) {
                next.upstream = [...previous.upstream];
                if (!sameParents(next.upstream, parents) && (previous.conflicts.includes('upstream') || !sameParents(previous.baseUpstream, parents))) next.conflicts.push('upstream');
            }
        }
        active.value = next;
        drafts.set(id, active.value);
    }, { immediate: true });
    const nodeDraft = computed(() => active.value?.node || null);
    const upstream = computed({ get: () => active.value?.upstream || [], set: value => { if (active.value) active.value.upstream = value; } });
    const dirty = computed(() => !!active.value && changed(active.value));
    const conflicted = computed(() => !!active.value?.conflicts.length && dirty.value);
    function clear() { drafts.clear(); active.value = null; }
    function acknowledge(hypothesisId: string, submitted: FlowNode, parents: string[], saved: FlowNode = submitted) {
        const draft = drafts.get(key(hypothesisId, submitted.id));
        if (!draft) return;
        // Edits typed while the save was in flight remain unsaved. Server-normalized
        // values replace only the exact submitted values, never newer input.
        const normalized = cloneNode(saved);
        for (const field of fields) if (sameField(draft.node[field], submitted[field])) {
            const value = normalized[field];
            Object.assign(draft.node, { [field]: Array.isArray(value) ? [...value] : value });
        }
        draft.baseNode = cloneNode(normalized);
        draft.baseUpstream = [...parents];
        draft.conflicts = [];
    }
    return { nodeDraft, upstream, dirty, conflicted, clear, acknowledge };
}
