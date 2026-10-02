import { makeMcpClient, type CallOptions, type Connection, type ToolPayload } from './client.ts';
import type { BaseRecord, Experiment, FlowNode, Hypothesis, Project, Resource, Status, Workspace } from './types.ts';

export interface ListQuery {
    limit?: number;
    offset?: number;
    q?: string;
    status?: Status;
    projectId?: string;
    hypothesisId?: string;
    nodeId?: string;
}
export type RecordInput<T extends BaseRecord> = Omit<T, keyof BaseRecord> & Partial<BaseRecord>;
export type RecordUpdate<T extends BaseRecord> = Partial<RecordInput<T>> & { revision: number };
export interface Page<T> extends ToolPayload<T[]> { total: number }
export interface Deleted { deleted: true; id: string; collection?: string }
export interface CollectionClient<T extends BaseRecord> {
    list(query?: ListQuery, options?: CallOptions): Promise<Page<T>>;
    get(id: string, options?: CallOptions): Promise<ToolPayload<T>>;
    create(data: RecordInput<T>, options?: CallOptions): Promise<ToolPayload<T>>;
    update(id: string, data: RecordUpdate<T>, options?: CallOptions): Promise<ToolPayload<T>>;
    delete(id: string, options?: CallOptions): Promise<ToolPayload<Deleted>>;
}
export interface NodePatch extends Partial<Pick<FlowNode, 'title' | 'type' | 'inputs' | 'output' | 'rationale' | 'method' | 'conclusion' | 'nextAction' | 'startedAt'>> {
    progress?: 'pending' | 'in_progress' | 'completed';
    resourceIds?: string[];
}
export interface ResultInput {
    nodeId: string;
    title: string;
    status: Status;
    summary: string;
    duration?: string;
    resourceIds?: string[];
}
export interface AccessToken {
    id: string;
    name: string;
    prefix: string;
    scope: 'read' | 'write' | 'admin';
    createdAt: string;
    expiresAt: string | null;
    lastUsedAt?: string | null;
}
export interface TokenInput { name: string; scope: AccessToken['scope']; expiresInDays: number }
export interface NodePosition { id: string; x: number; y: number }

/** Read every page explicitly; a partial cache is never an export. */
export async function readAllPages<T>(
    list: (query: ListQuery, options?: CallOptions) => Promise<Page<T>>,
    query: ListQuery = {}, options: CallOptions = {},
): Promise<T[]> {
    const result: T[] = [];
    let offset = 0;
    for (;;) {
        options.signal?.throwIfAborted();
        const page = await list({ ...query, offset, limit: 100 }, options);
        options.signal?.throwIfAborted();
        result.push(...page.data);
        offset += page.data.length;
        if (offset >= page.total) return result;
        if (!page.data.length) throw new Error('列表在读取完成前发生变化，请刷新后重试');
    }
}

export function makeWorkspaceClient(connection: Connection, sessionSignal?: AbortSignal) {
    const call = makeMcpClient(connection, sessionSignal);
    function collection<T extends BaseRecord>(name: keyof Workspace): CollectionClient<T> {
        return {
            async list(query = {}, options) {
                const page = await call<T[]>(`${name}_list`, { ...query }, options);
                if (!Array.isArray(page.data) || !Number.isSafeInteger(page.total) || page.total! < 0) throw new Error('服务返回了无效的分页列表');
                return page as Page<T>;
            },
            get: (id, options) => call<T>(`${name}_get`, { id }, options),
            create: (data, options) => call<T>(`${name}_create`, { data }, options),
            update: (id, data, options) => call<T>(`${name}_update`, { id, data }, options),
            delete: (id, options) => call<Deleted>(`${name}_delete`, { id }, options),
        };
    }
    return {
        projects: collection<Project>('projects'),
        hypotheses: collection<Hypothesis>('hypotheses'),
        experiments: collection<Experiment>('experiments'),
        resources: collection<Resource>('resources'),
        nodes: {
            create: (hypothesisId: string, revision: number, node: FlowNode, options?: CallOptions) => call<Hypothesis>('nodes_create', { hypothesisId, revision, node }, options),
            update: (hypothesisId: string, revision: number, nodeId: string, patch: NodePatch, upstream?: string[], options?: CallOptions) => call<Hypothesis>('nodes_update', { hypothesisId, revision, nodeId, patch, ...(upstream ? { upstream } : {}) }, options),
            move: (hypothesisId: string, revision: number, nodeId: string, position: Pick<NodePosition, 'x' | 'y'>, options?: CallOptions) => call<Hypothesis>('nodes_move', { hypothesisId, revision, nodeId, ...position }, options),
            layout: (hypothesisId: string, revision: number, positions: NodePosition[], options?: CallOptions) => call<Hypothesis>('nodes_layout', { hypothesisId, revision, positions }, options),
            delete: (hypothesisId: string, revision: number, nodeId: string, options?: CallOptions) => call<Hypothesis>('nodes_delete', { hypothesisId, revision, nodeId }, options),
            selectResult: (hypothesisId: string, revision: number, nodeId: string, resultId: string | null, options?: CallOptions) => call<Hypothesis>('nodes_select_result', { hypothesisId, revision, nodeId, resultId }, options),
        },
        results: {
            create: (hypothesisId: string, data: ResultInput, options?: CallOptions) => call<Experiment>('results_create', { hypothesisId, data }, options),
        },
        tokens: {
            list: (options?: CallOptions) => call<AccessToken[]>('tokens_list', {}, options),
            create: (data: TokenInput, options?: CallOptions) => call<AccessToken & { token: string }>('tokens_create', { data }, options),
            revoke: (id: string, options?: CallOptions) => call<Deleted>('tokens_revoke', { id }, options),
        },
        seed: (options?: CallOptions) => call<{ imported: number }>('workspace_seed', {}, options),
    };
}
export type WorkspaceClient = ReturnType<typeof makeWorkspaceClient>;
