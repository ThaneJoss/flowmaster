import { computed, onScopeDispose, reactive, ref } from 'vue';
import { isRequestCancelled, McpError, type Connection, type ToolPayload, type ApiPage } from '../../../lib/client.ts';
import { makeWorkspaceClient, type AccessToken, type ListQuery, type NodePatch, type NodePosition, type RecordInput, type RecordUpdate, type ResultInput, type TokenInput, type WorkspaceClient } from '../../../lib/workspace-client.ts';
import type { Collection, Experiment, FlowNode, Hypothesis, Project, Resource } from '../../../lib/types.ts';
import { exportWorkspace as workspaceBlob, exportCollection as collectionBlob } from '../../../lib/workspace-export.ts';

type Domain = 'projects' | 'project' | 'hypotheses' | 'resources' | 'records' | 'nodeHistory' | 'tokens' | 'export';
const domains: Domain[] = ['projects', 'project', 'hypotheses', 'resources', 'records', 'nodeHistory', 'tokens', 'export'];
const cancelled = () => new DOMException('Session or selection changed', 'AbortError');
const message = (error: unknown) => error instanceof Error ? error.message : '加载失败';
const merge = <T extends { id: string }>(items: T[], item: T): T[] => {
    const index = items.findIndex(value => value.id === item.id);
    return index === -1 ? [item, ...items] : items.map(value => value.id === item.id ? item : value);
};

/** Project-scoped views, session-scoped caches and explicitly paginated history. */
export function useWorkspace() {
    const connection = ref<Connection | null>(null), connecting = ref(false);
    const projects = ref<Project[]>([]), allProjects = ref<Project[]>([]), allHypotheses = ref<Hypothesis[]>([]), allResources = ref<Resource[]>([]);
    const visibleHypotheses = ref<Hypothesis[]>([]), visibleResources = ref<Resource[]>([]);
    const projectsTotal = ref(0), projectsOffset = ref(0), projectsNextOffset = ref<number | null>(null);
    const hypothesesTotal = ref(0), hypothesesOffset = ref(0), hypothesesNextOffset = ref<number | null>(null);
    const resourcesTotal = ref(0), resourcesOffset = ref(0), resourcesNextOffset = ref<number | null>(null);
    const recordsOffset = ref(0), recordsNextOffset = ref<number | null>(null), nodeHistoryOffset = ref(0), nodeHistoryNextOffset = ref<number | null>(null);
    const projectId = ref('');
    const hypotheses = computed(() => visibleHypotheses.value.filter(item => item.projectId === projectId.value));
    const resources = computed(() => visibleResources.value.filter(item => item.projectId === projectId.value));
    const records = ref<Experiment[]>([]), recordsTotal = ref(0), nodeHistory = ref<Experiment[]>([]), nodeHistoryTotal = ref(0);
    const tokens = ref<AccessToken[]>([]), resultCache = reactive(new Map<string, Experiment>());
    const loading = reactive(Object.fromEntries(domains.map(key => [key, false])) as Record<Domain, boolean>);
    const errors = reactive(Object.fromEntries(domains.map(key => [key, ''])) as Record<Domain, string>);
    const pending = reactive(new Set<string>());
    const controllers = new Map<Domain, AbortController>();
    const resultLoads = new Map<string, Promise<Experiment>>();
    const resultGenerations = new Map<string, number>();
    const changedProjects = new Map<string, number>(), changedHypotheses = new Map<string, number>(), changedResources = new Map<string, number>();
    let mutationSequence = 0;
    let client: WorkspaceClient | null = null, session: AbortController | null = null;
    let recordsQuery: ListQuery | null = null, historyQuery: ListQuery | null = null;
    let projectsQuery: ListQuery = {}, hypothesesQuery: ListQuery = {}, resourcesQuery: ListQuery = {};
    let selectionSequence = 0;

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
        records.value = []; recordsTotal.value = 0; recordsOffset.value = 0; recordsNextOffset.value = null;
        nodeHistory.value = []; nodeHistoryTotal.value = 0; nodeHistoryOffset.value = 0; nodeHistoryNextOffset.value = null;
        errors.records = ''; errors.nodeHistory = '';
    }
    function dispose(forget: boolean) {
        session?.abort(); session = null; client = null;
        for (const domain of domains) { stop(domain); errors[domain] = ''; }
        pending.clear(); resultLoads.clear(); resultCache.clear(); resultGenerations.clear();
        changedProjects.clear(); changedHypotheses.clear(); changedResources.clear(); mutationSequence = 0;
        connecting.value = false; connection.value = null; projectId.value = '';
        projects.value = []; allProjects.value = []; allHypotheses.value = []; allResources.value = []; tokens.value = [];
        visibleHypotheses.value = []; visibleResources.value = [];
        projectsTotal.value = 0; hypothesesTotal.value = 0; resourcesTotal.value = 0;
        projectsOffset.value = 0; hypothesesOffset.value = 0; resourcesOffset.value = 0;
        projectsNextOffset.value = null; hypothesesNextOffset.value = null; resourcesNextOffset.value = null;
        projectsQuery = {}; hypothesesQuery = {}; resourcesQuery = {}; ++selectionSequence;
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
    async function loadProjects(query: ListQuery = {}, append = false) {
        const since = mutationSequence;
        const next = { limit: 30, offset: 0, ...query };
        projectsQuery = next;
        return load('projects', (api, signal) => api.projects.list(next, { signal }), page => {
            const values = reconcilePage(allProjects.value, page.data, changedProjects, since);
            for (const item of values) allProjects.value = merge(allProjects.value, item);
            projects.value = append ? [...projects.value.filter(item => !values.some(next => next.id === item.id)), ...values] : values;
            projectsTotal.value = page.total; projectsOffset.value = next.offset; projectsNextOffset.value = page.nextOffset;
        });
    }
    const refreshProjects = loadProjects;
    async function getProject(id: string): Promise<Project> {
        const api = requireClient(), since = mutationSequence, before = allProjects.value.find(item => item.id === id);
        try {
            const { data } = await api.projects.get(id); assertSession(api);
            if ((changedProjects.get(id) || 0) > since && !allProjects.value.some(item => item.id === id)) throw cancelled();
            mergeProject(data); return allProjects.value.find(item => item.id === id)!;
        } catch (error) {
            assertSession(api);
            if (error instanceof McpError && error.status === 404) {
                const current = allProjects.value.find(item => item.id === id);
                // A later successful read or write supersedes this stale absence.
                if ((changedProjects.get(id) || 0) > since || current && current !== before) {
                    if (current) return current;
                    throw cancelled();
                }
                changedProjects.set(id, ++mutationSequence);
                allProjects.value = allProjects.value.filter(item => item.id !== id);
                projects.value = projects.value.filter(item => item.id !== id);
                allHypotheses.value = allHypotheses.value.filter(item => item.projectId !== id);
                allResources.value = allResources.value.filter(item => item.projectId !== id);
                if (projectId.value === id) { projectId.value = ''; stop('project'); stop('hypotheses'); stop('resources'); clearPages(); }
            }
            throw error;
        }
    }
    async function getHypothesis(id: string): Promise<Hypothesis> {
        const api = requireClient(), since = mutationSequence, before = allHypotheses.value.find(item => item.id === id);
        try {
            const { data } = await api.hypotheses.get(id); assertSession(api);
            if ((changedHypotheses.get(id) || 0) > since && !allHypotheses.value.some(item => item.id === id)) throw cancelled();
            mergeHypothesis(data); return allHypotheses.value.find(item => item.id === id)!;
        } catch (error) {
            assertSession(api);
            if (error instanceof McpError && error.status === 404) {
                const current = allHypotheses.value.find(item => item.id === id);
                // A later successful read or write supersedes this stale absence.
                if ((changedHypotheses.get(id) || 0) > since || current && current !== before) {
                    if (current) return current;
                    throw cancelled();
                }
                changedHypotheses.set(id, ++mutationSequence);
                allHypotheses.value = allHypotheses.value.filter(item => item.id !== id);
                visibleHypotheses.value = visibleHypotheses.value.filter(item => item.id !== id);
            }
            throw error;
        }
    }
    async function getResource(id: string): Promise<Resource> {
        const api = requireClient(), since = mutationSequence, before = allResources.value.find(item => item.id === id);
        try {
            const { data } = await api.resources.get(id); assertSession(api); if ((changedResources.get(id) || 0) > since && !allResources.value.some(item => item.id === id)) throw cancelled();
            mergeResource(data); return allResources.value.find(item => item.id === id)!;
        } catch (error) {
            assertSession(api);
            if (error instanceof McpError && error.status === 404) {
                const current = allResources.value.find(item => item.id === id);
                // A later successful read or write supersedes this stale absence.
                if ((changedResources.get(id) || 0) > since || current && current !== before) {
                    if (current) return current;
                    throw cancelled();
                }
                changedResources.set(id, ++mutationSequence);
                allResources.value = allResources.value.filter(item => item.id !== id);
                visibleResources.value = visibleResources.value.filter(item => item.id !== id);
            }
            throw error;
        }
    }
    function reconcilePage<T extends { id: string; revision?: number }>(cache: T[], fetched: T[], changed: Map<string, number>, since: number): T[] {
        const cached = new Map(cache.map(item => [item.id, item]));
        return fetched.flatMap(item => {
            const local = cached.get(item.id);
            if ((changed.get(item.id) || 0) > since && !local) return [];
            return [local && (local.revision || 0) > (item.revision || 0) ? local : item];
        });
    }
    async function loadHypotheses(query: ListQuery = {}, append = false) {
        if (!projectId.value) return;
        const selected = projectId.value, since = mutationSequence;
        const next = { limit: 30, offset: 0, ...query, projectId: selected };
        hypothesesQuery = next;
        return load('hypotheses', (api, signal) => api.hypotheses.list(next, { signal }), page => {
            if (projectId.value !== selected) throw cancelled();
            const values = reconcilePage(allHypotheses.value, page.data, changedHypotheses, since);
            for (const item of values) allHypotheses.value = merge(allHypotheses.value, item);
            visibleHypotheses.value = append ? [...visibleHypotheses.value.filter(item => !values.some(next => next.id === item.id)), ...values] : values;
            hypothesesTotal.value = page.total; hypothesesOffset.value = next.offset; hypothesesNextOffset.value = page.nextOffset;
        });
    }
    async function loadResources(query: ListQuery = {}, append = false) {
        if (!projectId.value) return;
        const selected = projectId.value, since = mutationSequence;
        const next = { limit: 30, offset: 0, ...query, projectId: selected };
        resourcesQuery = next;
        return load('resources', (api, signal) => api.resources.list(next, { signal }), page => {
            if (projectId.value !== selected) throw cancelled();
            const values = reconcilePage(allResources.value, page.data, changedResources, since);
            for (const item of values) allResources.value = merge(allResources.value, item);
            visibleResources.value = append ? [...visibleResources.value.filter(item => !values.some(next => next.id === item.id)), ...values] : values;
            resourcesTotal.value = page.total; resourcesOffset.value = next.offset; resourcesNextOffset.value = page.nextOffset;
        });
    }
    async function selectProject(id: string) {
        const selection = ++selectionSequence, api = requireClient();
        stop('project'); stop('hypotheses'); stop('resources');
        if (id && !allProjects.value.some(item => item.id === id)) await getProject(id);
        assertSession(api);
        if (selection !== selectionSequence) throw cancelled();
        if (projectId.value !== id) {
            projectId.value = id; clearPages(); visibleHypotheses.value = []; visibleResources.value = [];
            hypothesesTotal.value = 0; resourcesTotal.value = 0; hypothesesNextOffset.value = null; resourcesNextOffset.value = null;
            hypothesesQuery = {}; resourcesQuery = {};
        }
        if (!id) return;
        return load('project', async () => {
            await Promise.all([loadHypotheses(hypothesesQuery), loadResources(resourcesQuery)]);
        }, () => {});
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
            records.value = page.data.map(cacheRecord); recordsTotal.value = page.total; recordsOffset.value = next.offset; recordsNextOffset.value = page.nextOffset;
        });
    }
    async function loadNodeHistory(hypothesisId: string, nodeId: string, query: Pick<ListQuery, 'limit' | 'offset'> = {}) {
        const flow = allHypotheses.value.find(item => item.id === hypothesisId && item.projectId === projectId.value);
        if (!flow || !nodeId) {
            stop('nodeHistory'); historyQuery = null; nodeHistory.value = []; nodeHistoryTotal.value = 0; nodeHistoryOffset.value = 0; nodeHistoryNextOffset.value = null; return;
        }
        const selected = projectId.value;
        const next = { limit: 20, offset: 0, ...query, projectId: selected, hypothesisId, nodeId };
        if (historyQuery?.hypothesisId !== hypothesisId || historyQuery.nodeId !== nodeId) {
            nodeHistory.value = []; nodeHistoryTotal.value = 0; nodeHistoryOffset.value = 0; nodeHistoryNextOffset.value = null;
        }
        historyQuery = next;
        return load('nodeHistory', (api, signal) => api.experiments.list(next, { signal }), page => {
            if (projectId.value !== selected) throw cancelled();
            nodeHistory.value = page.data.map(cacheRecord); nodeHistoryTotal.value = page.total; nodeHistoryOffset.value = next.offset; nodeHistoryNextOffset.value = page.nextOffset;
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
        await refreshProjects(projectsQuery);
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
        void Promise.allSettled([
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
    function mergeProject(item: Project) {
        const known = allProjects.value.find(value => value.id === item.id);
        if (known && (known.revision || 0) > (item.revision || 0)) return;
        changedProjects.set(item.id, ++mutationSequence);
        allProjects.value = merge(allProjects.value, item);
        projects.value = projects.value.map(value => value.id === item.id ? item : value);
    }
    function mergeHypothesis(item: Hypothesis) {
        const known = allHypotheses.value.find(value => value.id === item.id);
        if (known && (known.revision || 0) > (item.revision || 0)) return;
        changedHypotheses.set(item.id, ++mutationSequence);
        allHypotheses.value = merge(allHypotheses.value, item);
        visibleHypotheses.value = visibleHypotheses.value.map(value => value.id === item.id ? item : value);
    }
    function mergeResource(item: Resource) {
        const known = allResources.value.find(value => value.id === item.id);
        if (known && (known.revision || 0) > (item.revision || 0)) return;
        changedResources.set(item.id, ++mutationSequence);
        allResources.value = merge(allResources.value, item);
        visibleResources.value = visibleResources.value.map(value => value.id === item.id ? item : value);
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
        const response = await api.projects.create(data); assertSession(api); stop('projects'); mergeProject(response.data);
        void Promise.allSettled([loadProjects(projectsQuery)]); return response.data;
    });
    const updateProject = (id: string, data: RecordUpdate<Project>) => mutate([`project:${id}`], async api => {
        const response = await writeWithRecovery(api, 'projects', () => api.projects.update(id, data), async () => {
            const fresh = await api.projects.get(id); assertSession(api); stop('projects'); mergeProject(fresh.data);
        });
        assertSession(api); stop('projects'); mergeProject(response.data);
        void Promise.allSettled([loadProjects(projectsQuery)]); return response.data;
    });
    const deleteProject = (id: string) => mutate([`project:${id}`], async api => {
        const response = await api.projects.delete(id); assertSession(api); stop('projects');
        changedProjects.set(id, ++mutationSequence);
        if (projects.value.some(item => item.id === id)) projectsTotal.value = Math.max(0, projectsTotal.value - 1);
        projects.value = projects.value.filter(item => item.id !== id);
        allProjects.value = allProjects.value.filter(item => item.id !== id);
        allHypotheses.value = allHypotheses.value.filter(item => item.projectId !== id);
        allResources.value = allResources.value.filter(item => item.projectId !== id);
        if (projectId.value === id) { projectId.value = ''; ++selectionSequence; stop('project'); stop('hypotheses'); stop('resources'); clearPages(); }
        return response.data;
    });
    const createHypothesis = (data: RecordInput<Hypothesis>) => mutate(['hypothesis:new'], async api => {
        const response = await api.hypotheses.create(data); assertSession(api); mergeHypothesis(response.data);
        if (response.data.projectId === projectId.value) void Promise.allSettled([loadHypotheses(hypothesesQuery)]);
        return response.data;
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
        if (visibleHypotheses.value.some(item => item.id === id)) hypothesesTotal.value = Math.max(0, hypothesesTotal.value - 1);
        visibleHypotheses.value = visibleHypotheses.value.filter(item => item.id !== id);
        for (const [key, value] of resultCache) if (value.hypothesisId === id) { invalidateResult(key); resultCache.delete(key); }
        for (const key of response.deletedExperimentIds || []) { invalidateResult(key); resultCache.delete(key); }
        records.value = records.value.filter(item => item.hypothesisId !== id);
        if (historyQuery?.hypothesisId === id) { stop('nodeHistory'); historyQuery = null; nodeHistory.value = []; nodeHistoryTotal.value = 0; nodeHistoryOffset.value = 0; nodeHistoryNextOffset.value = null; }
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
            if (records.value.some(item => item.id === id)) recordsTotal.value = Math.max(0, recordsTotal.value - 1);
            if (nodeHistory.value.some(item => item.id === id)) nodeHistoryTotal.value = Math.max(0, nodeHistoryTotal.value - 1);
            invalidateResult(id); resultCache.delete(id); records.value = records.value.filter(item => item.id !== id); nodeHistory.value = nodeHistory.value.filter(item => item.id !== id);
            await refreshPagesAfterWrite(selected); return response.data;
        });
    };
    const createResource = (data: RecordInput<Resource>) => mutate(['resource:new'], async api => {
        const response = await api.resources.create(data); assertSession(api); mergeResource(response.data);
        if (response.data.projectId === projectId.value) void Promise.allSettled([loadResources(resourcesQuery)]);
        return response.data;
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
        allResources.value = allResources.value.filter(item => item.id !== id);
        if (visibleResources.value.some(item => item.id === id)) resourcesTotal.value = Math.max(0, resourcesTotal.value - 1);
        visibleResources.value = visibleResources.value.filter(item => item.id !== id); return response.data;
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
        const response = await api.seed(); assertSession(api); void Promise.allSettled([refreshProjects()]); return response.data;
    });
    function exportClient(api: WorkspaceClient, signal: AbortSignal) {
        return { page: async <T,>(path: string): Promise<ApiPage<T>> => {
            const [collection, query] = path.slice(1).split('?');
            const args: ListQuery = {};
            for (const [key, value] of new URLSearchParams(query)) Object.assign(args, { [key]: key === 'limit' || key === 'offset' ? Number(value) : value });
            return await api[collection as Collection].list(args, { signal }) as ApiPage<T>;
        } };
    }
    const exportWorkspace = () => load('export', (api, signal) => workspaceBlob(exportClient(api, signal)), () => {});
    const exportRecords = (query: ListQuery = {}) => {
        if (!projectId.value) throw new Error('请先选择项目');
        const filters = Object.fromEntries(Object.entries({ ...query, projectId: projectId.value }).filter(([key, value]) => !['offset', 'limit'].includes(key) && value !== undefined && value !== '').map(([key, value]) => [key, String(value)]));
        return load('export', (api, signal) => collectionBlob(exportClient(api, signal), 'experiments', filters), () => {});
    };

    onScopeDispose(() => dispose(false));
    return {
        connection, connecting, projects, allProjects, allHypotheses, allResources, hypotheses, resources, projectId, records, recordsTotal, nodeHistory, nodeHistoryTotal,
        projectsTotal, projectsOffset, projectsNextOffset, hypothesesTotal, hypothesesOffset, hypothesesNextOffset, resourcesTotal, resourcesOffset, resourcesNextOffset, recordsOffset, recordsNextOffset, nodeHistoryOffset, nodeHistoryNextOffset,
        tokens, resultCache, loading, errors, pending, isPending: (key: string) => pending.has(key),
        connect, disconnect, selectProject, refresh, refreshProjects, loadProjects, loadHypotheses, loadResources, getProject, getHypothesis, getResource, loadRecords, loadNodeHistory, getResult,
        createProject, updateProject, deleteProject, createHypothesis, updateHypothesis, deleteHypothesis,
        createNode, updateNode, moveNode, layout, deleteNode, selectResult, createResult, updateResult, deleteResult,
        createResource, updateResource, deleteResource, listTokens, createToken, revokeToken, seed, exportWorkspace, exportRecords,
    };
}
