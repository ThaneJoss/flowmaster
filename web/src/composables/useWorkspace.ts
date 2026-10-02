import { computed, onScopeDispose, reactive, ref } from 'vue';
import { isRequestCancelled, McpError, type Connection, type ToolPayload } from '../../../lib/client.ts';
import { makeWorkspaceClient, readAllPages, type AccessToken, type ListQuery, type NodePatch, type NodePosition, type RecordInput, type RecordUpdate, type ResultInput, type TokenInput, type WorkspaceClient } from '../../../lib/workspace-client.ts';
import type { Experiment, FlowNode, Hypothesis, Project, Resource, Workspace } from '../../../lib/types.ts';

type Domain = 'projects' | 'project' | 'records' | 'nodeHistory' | 'tokens' | 'export';
const domains: Domain[] = ['projects', 'project', 'records', 'nodeHistory', 'tokens', 'export'];
const cancelled = () => new DOMException('Session or selection changed', 'AbortError');
const message = (error: unknown) => error instanceof Error ? error.message : '加载失败';
const merge = <T extends { id: string }>(items: T[], item: T): T[] => {
    const index = items.findIndex(value => value.id === item.id);
    return index === -1 ? [item, ...items] : items.map(value => value.id === item.id ? item : value);
};

/** Project-scoped views, session-scoped caches and explicitly paginated history. */
export function useWorkspace() {
    const connection = ref<Connection | null>(null), connecting = ref(false);
    const projects = ref<Project[]>([]), allHypotheses = ref<Hypothesis[]>([]), allResources = ref<Resource[]>([]);
    const projectId = ref('');
    const hypotheses = computed(() => allHypotheses.value.filter(item => item.projectId === projectId.value));
    const resources = computed(() => allResources.value.filter(item => item.projectId === projectId.value));
    const records = ref<Experiment[]>([]), recordsTotal = ref(0), nodeHistory = ref<Experiment[]>([]), nodeHistoryTotal = ref(0);
    const tokens = ref<AccessToken[]>([]), resultCache = reactive(new Map<string, Experiment>());
    const loading = reactive(Object.fromEntries(domains.map(key => [key, false])) as Record<Domain, boolean>);
    const errors = reactive(Object.fromEntries(domains.map(key => [key, ''])) as Record<Domain, string>);
    const pending = reactive(new Set<string>());
    const controllers = new Map<Domain, AbortController>();
    const resultLoads = new Map<string, Promise<Experiment>>();
    const resultGenerations = new Map<string, number>();
    const changedHypotheses = new Map<string, number>(), changedResources = new Map<string, number>();
    let mutationSequence = 0;
    let client: WorkspaceClient | null = null, session: AbortController | null = null;
    let recordsQuery: ListQuery | null = null, historyQuery: ListQuery | null = null;

    function requireClient() { if (!client) throw new Error('请先登录工作区'); return client; }
    function assertSession(expected: WorkspaceClient) { if (expected !== client || session?.signal.aborted) throw cancelled(); }
    function stop(domain: Domain) {
        controllers.get(domain)?.abort();
        controllers.delete(domain);
        loading[domain] = false;
    }
    async function load<T>(domain: Domain, fetch: (api: WorkspaceClient, signal: AbortSignal) => Promise<T>, apply: (value: T) => void): Promise<T> {
        const api = requireClient();
        stop(domain);
        const controller = new AbortController();
        controllers.set(domain, controller);
        loading[domain] = true;
        errors[domain] = '';
        try {
            const value = await fetch(api, controller.signal);
            assertSession(api);
            controller.signal.throwIfAborted();
            apply(value);
            return value;
        } catch (error) {
            if (client === api && controllers.get(domain) === controller && !isRequestCancelled(error)) errors[domain] = message(error);
            controller.abort();
            throw error;
        } finally {
            if (controllers.get(domain) === controller) { controllers.delete(domain); loading[domain] = false; }
        }
    }
    function clearPages() {
        stop('records'); stop('nodeHistory');
        recordsQuery = null; historyQuery = null;
        records.value = []; recordsTotal.value = 0;
        nodeHistory.value = []; nodeHistoryTotal.value = 0;
        errors.records = ''; errors.nodeHistory = '';
    }
    function dispose(forget: boolean) {
        session?.abort(); session = null; client = null;
        for (const domain of domains) { stop(domain); errors[domain] = ''; }
        pending.clear(); resultLoads.clear(); resultCache.clear(); resultGenerations.clear();
        changedHypotheses.clear(); changedResources.clear(); mutationSequence = 0;
        connecting.value = false; connection.value = null; projectId.value = '';
        projects.value = []; allHypotheses.value = []; allResources.value = []; tokens.value = [];
        clearPages();
        if (forget) { localStorage.removeItem('flowmaster.connection'); sessionStorage.removeItem('flowmaster.connection'); }
    }
    function disconnect() { dispose(true); }
    async function connect(value: Connection) {
        const nextConnection = { baseUrl: (value.baseUrl || '').trim().replace(/\/+$/, ''), token: value.token.trim(), remember: !!value.remember };
        if (!nextConnection.token) throw new Error('请输入访问 Token');
        const nextSession = new AbortController();
        const nextClient = makeWorkspaceClient(nextConnection, nextSession.signal);
        disconnect(); session = nextSession; client = nextClient; connecting.value = true;
        try {
            await refreshProjects();
            assertSession(nextClient);
            connection.value = nextConnection;
            (nextConnection.remember ? localStorage : sessionStorage).setItem('flowmaster.connection', JSON.stringify(nextConnection));
        } catch (error) {
            if (client === nextClient) disconnect();
            throw error;
        } finally { if (client === nextClient) connecting.value = false; }
    }
    async function refreshProjects() {
        return load('projects', (api, signal) => readAllPages(api.projects.list, {}, { signal }), value => {
            projects.value = value;
            const live = new Set(value.map(item => item.id));
            allHypotheses.value = allHypotheses.value.filter(item => live.has(item.projectId));
            allResources.value = allResources.value.filter(item => live.has(item.projectId));
            if (projectId.value && !live.has(projectId.value)) { projectId.value = ''; stop('project'); clearPages(); }
        });
    }
    async function selectProject(id: string) {
        if (id && !projects.value.some(item => item.id === id)) throw new Error('项目不存在，请刷新项目列表');
        if (projectId.value !== id) { projectId.value = id; clearPages(); }
        stop('project');
        if (!id) return;
        const since = mutationSequence;
        return load('project', async (api, signal) => {
            const [flows, assets] = await Promise.all([
                readAllPages(api.hypotheses.list, { projectId: id }, { signal }),
                readAllPages(api.resources.list, { projectId: id }, { signal }),
            ]);
            return { flows, assets };
        }, ({ flows, assets }) => {
            if (projectId.value !== id) throw cancelled();
            allHypotheses.value = reconcileScope(allHypotheses.value, flows, id, changedHypotheses, since);
            allResources.value = reconcileScope(allResources.value, assets, id, changedResources, since);
        });
    }
    function reconcileScope<T extends { id: string; projectId: string; revision?: number }>(cache: T[], fetched: T[], id: string, changed: Map<string, number>, since: number): T[] {
        const selected = new Map(fetched.filter(item => item.projectId === id).map(item => [item.id, item]));
        const cached = new Map(cache.map(item => [item.id, item]));
        for (const [key, item] of selected) {
            const local = cached.get(key);
            if (local?.projectId === id && (local.revision || 0) > (item.revision || 0)) selected.set(key, local);
        }
        // Preserve writes (including deletions) completed after this read began.
        for (const [key, sequence] of changed) if (sequence > since) {
            const local = cached.get(key);
            if (local?.projectId === id) selected.set(key, local); else selected.delete(key);
        }
        return [...cache.filter(item => item.projectId !== id), ...selected.values()];
    }
    function cacheRecord(item: Experiment) {
        const known = resultCache.get(item.id);
        if (known && (known.revision || 0) > (item.revision || 0)) return known;
        resultCache.set(item.id, item); return item;
    }
    function invalidateResult(id: string) {
        resultGenerations.set(id, (resultGenerations.get(id) || 0) + 1);
        resultLoads.delete(id);
    }
    async function loadRecords(query: ListQuery = {}) {
        if (!projectId.value) { clearPages(); return; }
        const selected = projectId.value;
        const next = { limit: 30, offset: 0, ...query, projectId: selected };
        recordsQuery = next;
        return load('records', (api, signal) => api.experiments.list(next, { signal }), page => {
            if (projectId.value !== selected) throw cancelled();
            records.value = page.data.map(cacheRecord); recordsTotal.value = page.total;
        });
    }
    async function loadNodeHistory(hypothesisId: string, nodeId: string, query: Pick<ListQuery, 'limit' | 'offset'> = {}) {
        const flow = allHypotheses.value.find(item => item.id === hypothesisId && item.projectId === projectId.value);
        if (!flow || !nodeId) {
            stop('nodeHistory'); historyQuery = null; nodeHistory.value = []; nodeHistoryTotal.value = 0; return;
        }
        const selected = projectId.value;
        const next = { limit: 20, offset: 0, ...query, projectId: selected, hypothesisId, nodeId };
        if (historyQuery?.hypothesisId !== hypothesisId || historyQuery.nodeId !== nodeId) {
            nodeHistory.value = []; nodeHistoryTotal.value = 0;
        }
        historyQuery = next;
        return load('nodeHistory', (api, signal) => api.experiments.list(next, { signal }), page => {
            if (projectId.value !== selected) throw cancelled();
            nodeHistory.value = page.data.map(cacheRecord); nodeHistoryTotal.value = page.total;
        });
    }
    async function getResult(id: string): Promise<Experiment> {
        const api = requireClient();
        const existing = resultLoads.get(id);
        if (existing) return existing;
        const generation = resultGenerations.get(id) || 0;
        const request = api.experiments.get(id).then(payload => {
            assertSession(api);
            if ((resultGenerations.get(id) || 0) !== generation) {
                const current = resultCache.get(id);
                if (current) return current;
                throw cancelled();
            }
            return cacheRecord(payload.data);
        }).finally(() => { if (resultLoads.get(id) === request) resultLoads.delete(id); });
        resultLoads.set(id, request);
        return request;
    }
    async function refresh() {
        const api = requireClient();
        await refreshProjects();
        assertSession(api);
        if (projectId.value) await selectProject(projectId.value);
        assertSession(api);
        await refreshPages();
        assertSession(api);
    }
    async function refreshPages() {
        const tasks: Promise<unknown>[] = [];
        if (recordsQuery) tasks.push(loadRecords(recordsQuery));
        if (historyQuery?.hypothesisId && historyQuery.nodeId) tasks.push(loadNodeHistory(historyQuery.hypothesisId, historyQuery.nodeId, historyQuery));
        await Promise.all(tasks);
    }
    async function refreshPagesAfterWrite(selected: string) {
        if (projectId.value !== selected) return;
        // A completed write must not appear to fail because a follow-up read failed.
        // Domain errors remain visible to the UI and can be retried independently.
        await Promise.allSettled([
            ...(recordsQuery ? [loadRecords(recordsQuery)] : []),
            ...(historyQuery?.hypothesisId && historyQuery.nodeId ? [loadNodeHistory(historyQuery.hypothesisId, historyQuery.nodeId, historyQuery)] : []),
        ]);
    }
    async function mutate<T>(keys: string[], action: (api: WorkspaceClient) => Promise<T>): Promise<T> {
        if (keys.some(key => pending.has(key))) throw new Error('此记录正在保存，请稍后重试');
        const api = requireClient();
        for (const key of keys) pending.add(key);
        try { const value = await action(api); assertSession(api); return value; }
        finally { if (client === api) for (const key of keys) pending.delete(key); }
    }
    function mergeHypothesis(item: Hypothesis) {
        const known = allHypotheses.value.find(value => value.id === item.id);
        if (known && (known.revision || 0) > (item.revision || 0)) return;
        changedHypotheses.set(item.id, ++mutationSequence);
        allHypotheses.value = merge(allHypotheses.value, item);
    }
    function mergeResource(item: Resource) {
        changedResources.set(item.id, ++mutationSequence);
        allResources.value = merge(allResources.value, item);
    }
    async function writeWithRecovery<T>(api: WorkspaceClient, domain: Domain, write: () => Promise<T>, recover: () => Promise<void>): Promise<T> {
        try { return await write(); }
        catch (error) {
            assertSession(api);
            if (error instanceof McpError && error.status === 409) {
                try { await recover(); }
                catch (refreshError) {
                    if (isRequestCancelled(refreshError)) throw refreshError;
                    errors[domain] = message(refreshError);
                }
            }
            throw error;
        }
    }
    async function recoverHypothesis(api: WorkspaceClient, id: string) {
        const response = await api.hypotheses.get(id); assertSession(api); mergeHypothesis(response.data);
    }
    function flow(id: string) {
        const item = allHypotheses.value.find(value => value.id === id);
        if (!item || !Number.isInteger(item.revision)) throw new Error('请先加载最新流程');
        return item;
    }
    async function changeNode(id: string, change: (api: WorkspaceClient, revision: number) => Promise<ToolPayload<Hypothesis>>) {
        return mutate([`hypothesis:${id}`], async api => {
            const response = await writeWithRecovery(api, 'project', () => change(api, flow(id).revision!), () => recoverHypothesis(api, id));
            assertSession(api); mergeHypothesis(response.data); return response.data;
        });
    }
    async function applyResult(api: WorkspaceClient, payload: ToolPayload<Experiment>, selected: string) {
        assertSession(api);
        if (payload.affectedHypothesis) mergeHypothesis(payload.affectedHypothesis);
        invalidateResult(payload.data.id); cacheRecord(payload.data);
        records.value = records.value.map(item => item.id === payload.data.id ? payload.data : item);
        nodeHistory.value = nodeHistory.value.map(item => item.id === payload.data.id ? payload.data : item);
        await refreshPagesAfterWrite(selected);
        return payload.data;
    }

    const createProject = (data: RecordInput<Project>) => mutate(['project:new'], async api => {
        const response = await api.projects.create(data); assertSession(api); stop('projects'); projects.value = merge(projects.value, response.data); return response.data;
    });
    const updateProject = (id: string, data: RecordUpdate<Project>) => mutate([`project:${id}`], async api => {
        const response = await writeWithRecovery(api, 'projects', () => api.projects.update(id, data), async () => {
            const fresh = await api.projects.get(id); assertSession(api); stop('projects'); projects.value = merge(projects.value, fresh.data);
        });
        assertSession(api); stop('projects'); projects.value = merge(projects.value, response.data); return response.data;
    });
    const deleteProject = (id: string) => mutate([`project:${id}`], async api => {
        const response = await api.projects.delete(id); assertSession(api); stop('projects');
        projects.value = projects.value.filter(item => item.id !== id);
        allHypotheses.value = allHypotheses.value.filter(item => item.projectId !== id);
        allResources.value = allResources.value.filter(item => item.projectId !== id);
        if (projectId.value === id) { projectId.value = ''; stop('project'); clearPages(); }
        return response.data;
    });
    const createHypothesis = (data: RecordInput<Hypothesis>) => mutate(['hypothesis:new'], async api => {
        const response = await api.hypotheses.create(data); assertSession(api); mergeHypothesis(response.data); return response.data;
    });
    const updateHypothesis = (id: string, data: RecordUpdate<Hypothesis>) => mutate([`hypothesis:${id}`], async api => {
        const response = await writeWithRecovery(api, 'project', () => api.hypotheses.update(id, data), () => recoverHypothesis(api, id));
        assertSession(api); mergeHypothesis(response.data); return response.data;
    });
    const deleteHypothesis = (id: string) => mutate([`hypothesis:${id}`], async api => {
        const selected = projectId.value;
        const response = await api.hypotheses.delete(id); assertSession(api);
        changedHypotheses.set(id, ++mutationSequence);
        allHypotheses.value = allHypotheses.value.filter(item => item.id !== id);
        for (const [key, value] of resultCache) if (value.hypothesisId === id) { invalidateResult(key); resultCache.delete(key); }
        for (const key of response.deletedExperimentIds || []) { invalidateResult(key); resultCache.delete(key); }
        records.value = records.value.filter(item => item.hypothesisId !== id);
        if (historyQuery?.hypothesisId === id) { stop('nodeHistory'); historyQuery = null; nodeHistory.value = []; nodeHistoryTotal.value = 0; }
        await refreshPagesAfterWrite(selected); return response.data;
    });
    const createNode = (id: string, node: FlowNode) => changeNode(id, (api, revision) => api.nodes.create(id, revision, node));
    const updateNode = (id: string, nodeId: string, patch: NodePatch, upstream?: string[]) => changeNode(id, (api, revision) => api.nodes.update(id, revision, nodeId, patch, upstream));
    const moveNode = (id: string, nodeId: string, position: Pick<NodePosition, 'x' | 'y'>) => changeNode(id, (api, revision) => api.nodes.move(id, revision, nodeId, position));
    const layout = (id: string, positions: NodePosition[]) => changeNode(id, (api, revision) => api.nodes.layout(id, revision, positions));
    const deleteNode = (id: string, nodeId: string) => changeNode(id, (api, revision) => api.nodes.delete(id, revision, nodeId));
    const selectResult = (id: string, nodeId: string, resultId: string | null) => changeNode(id, (api, revision) => api.nodes.selectResult(id, revision, nodeId, resultId));
    const createResult = (id: string, data: ResultInput) => mutate([`hypothesis:${id}`, 'record:new'], async api => {
        const selected = projectId.value;
        const response = await writeWithRecovery(api, 'project', () => api.results.create(id, data), () => recoverHypothesis(api, id));
        return applyResult(api, response, selected);
    });
    const updateResult = async (id: string, data: RecordUpdate<Experiment>) => {
        const expected = requireClient();
        const known = resultCache.get(id) || await getResult(id);
        assertSession(expected);
        return mutate([`record:${id}`, `hypothesis:${known.hypothesisId}`], async api => {
            const selected = projectId.value;
            const response = await writeWithRecovery(api, 'records', () => api.experiments.update(id, data), async () => {
                const fresh = await api.experiments.get(id); assertSession(api);
                invalidateResult(id); cacheRecord(fresh.data);
                records.value = records.value.map(item => item.id === id ? fresh.data : item);
                nodeHistory.value = nodeHistory.value.map(item => item.id === id ? fresh.data : item);
                await recoverHypothesis(api, known.hypothesisId);
            });
            return applyResult(api, response, selected);
        });
    };
    const deleteResult = async (id: string) => {
        const expected = requireClient();
        const known = resultCache.get(id) || await getResult(id);
        assertSession(expected);
        return mutate([`record:${id}`, `hypothesis:${known.hypothesisId}`], async api => {
            const selected = projectId.value;
            const response = await api.experiments.delete(id); assertSession(api);
            if (response.affectedHypothesis) mergeHypothesis(response.affectedHypothesis);
            invalidateResult(id); resultCache.delete(id); records.value = records.value.filter(item => item.id !== id); nodeHistory.value = nodeHistory.value.filter(item => item.id !== id);
            await refreshPagesAfterWrite(selected); return response.data;
        });
    };
    const createResource = (data: RecordInput<Resource>) => mutate(['resource:new'], async api => {
        const response = await api.resources.create(data); assertSession(api); mergeResource(response.data); return response.data;
    });
    const updateResource = (id: string, data: RecordUpdate<Resource>) => mutate([`resource:${id}`], async api => {
        const response = await writeWithRecovery(api, 'project', () => api.resources.update(id, data), async () => {
            const fresh = await api.resources.get(id); assertSession(api); mergeResource(fresh.data);
        });
        assertSession(api); mergeResource(response.data); return response.data;
    });
    const deleteResource = (id: string) => mutate([`resource:${id}`], async api => {
        const response = await api.resources.delete(id); assertSession(api);
        changedResources.set(id, ++mutationSequence);
        allResources.value = allResources.value.filter(item => item.id !== id); return response.data;
    });
    const listTokens = () => load('tokens', (api, signal) => api.tokens.list({ signal }), response => { tokens.value = response.data; });
    const createToken = (data: TokenInput) => mutate(['token:new'], async api => {
        const response = await api.tokens.create(data); assertSession(api); stop('tokens');
        const { token: _secret, ...record } = response.data;
        tokens.value = merge(tokens.value, record); return response.data;
    });
    const revokeToken = (id: string) => mutate([`token:${id}`], async api => {
        const response = await api.tokens.revoke(id); assertSession(api); stop('tokens'); tokens.value = tokens.value.filter(item => item.id !== id); return response.data;
    });
    const seed = () => mutate(['workspace:seed'], async api => {
        const response = await api.seed(); assertSession(api); await refreshProjects(); return response.data;
    });
    const exportWorkspace = () => load('export', async (api, signal): Promise<Workspace> => {
        const options = { signal };
        const [projects, hypotheses, experiments, resources] = await Promise.all([
            readAllPages(api.projects.list, {}, options), readAllPages(api.hypotheses.list, {}, options),
            readAllPages(api.experiments.list, {}, options), readAllPages(api.resources.list, {}, options),
        ]);
        return { projects, hypotheses, experiments, resources };
    }, () => {});
    const exportRecords = (query: ListQuery = {}) => {
        if (!projectId.value) throw new Error('请先选择项目');
        const selected = projectId.value;
        return load('export', (api, signal) => readAllPages(api.experiments.list, { ...query, projectId: selected }, { signal }), () => {});
    };

    onScopeDispose(() => dispose(false));
    return {
        connection, connecting, projects, allHypotheses, hypotheses, resources, projectId, records, recordsTotal, nodeHistory, nodeHistoryTotal,
        tokens, resultCache, loading, errors, pending, isPending: (key: string) => pending.has(key),
        connect, disconnect, selectProject, refresh, refreshProjects, loadRecords, loadNodeHistory, getResult,
        createProject, updateProject, deleteProject, createHypothesis, updateHypothesis, deleteHypothesis,
        createNode, updateNode, moveNode, layout, deleteNode, selectResult, createResult, updateResult, deleteResult,
        createResource, updateResource, deleteResource, listTokens, createToken, revokeToken, seed, exportWorkspace, exportRecords,
    };
}
