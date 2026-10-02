import type { Edge, FlowNode } from './types.ts';
import { MAX_NODE_COORDINATE } from './types.ts';

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 156;
export const CANVAS_PADDING = 28;
export const COLUMN_GAP = 48;
export const ROW_GAP = 64;

function columnCount(availableWidth: number | undefined, maximum: number): number {
    const width = typeof availableWidth === 'number' && Number.isFinite(availableWidth)
        ? availableWidth : NODE_WIDTH + CANVAS_PADDING * 2;
    return Math.min(maximum, Math.max(1,
        Math.floor((width - CANVAS_PADDING * 2 + COLUMN_GAP) / (NODE_WIDTH + COLUMN_GAP))));
}

function gridPosition(index: number, columns: number): { x: number; y: number } {
    const row = Math.floor(index / columns);
    const slot = index % columns;
    const column = row % 2 ? columns - 1 - slot : slot;
    return {
        x: CANVAS_PADDING + column * (NODE_WIDTH + COLUMN_GAP),
        y: CANVAS_PADDING + row * (NODE_HEIGHT + ROW_GAP),
    };
}

/** Find a readable empty slot without moving any existing, possibly hand-placed cards. */
export function newNodePosition(nodes: FlowNode[], availableWidth?: number): { x: number; y: number } {
    const columns = columnCount(availableWidth, nodes.length + 1);
    const rows = Math.floor((MAX_NODE_COORDINATE - CANVAS_PADDING) / (NODE_HEIGHT + ROW_GAP)) + 1;
    for (let row = 0; row < rows; row++) {
        for (let slot = 0; slot < columns; slot++) {
            const position = gridPosition(row * columns + slot, columns);
            if (position.x > MAX_NODE_COORDINATE) continue;
            const clear = nodes.every(node =>
                position.x + NODE_WIDTH + COLUMN_GAP / 2 <= node.x ||
                node.x + NODE_WIDTH + COLUMN_GAP / 2 <= position.x ||
                position.y + NODE_HEIGHT + ROW_GAP / 2 <= node.y ||
                node.y + NODE_HEIGHT + ROW_GAP / 2 <= position.y);
            if (clear) return position;
        }
    }
    throw new Error('画布中没有可放置新节点的空位，请先自动布局后重试。');
}

/** Keep dependencies in reading order while wrapping to the available width. */
export function layoutNodes(nodes: FlowNode[], edges: Edge[], availableWidth: number): FlowNode[] {
    if (!nodes.length) return [];
    const order = new Map(nodes.map((node, index) => [node.id, index]));
    const indegrees = new Map(nodes.map(node => [node.id, 0]));
    const successors = new Map(nodes.map(node => [node.id, new Set<string>()]));
    for (const edge of edges) {
        const children = successors.get(edge.source);
        if (!children || !indegrees.has(edge.target) || children.has(edge.target)) continue;
        children.add(edge.target);
        indegrees.set(edge.target, indegrees.get(edge.target)! + 1);
    }

    const sorted: string[] = [];
    let layer = nodes.filter(node => indegrees.get(node.id) === 0).map(node => node.id);
    while (layer.length) {
        const next: string[] = [];
        for (const id of layer) {
            sorted.push(id);
            for (const child of successors.get(id)!) {
                const remaining = indegrees.get(child)! - 1;
                indegrees.set(child, remaining);
                if (remaining === 0) next.push(child);
            }
        }
        layer = next.sort((a, b) => order.get(a)! - order.get(b)!);
    }
    // Valid server data is acyclic; retain every node if older data is malformed.
    const visited = new Set(sorted);
    for (const node of nodes) if (!visited.has(node.id)) sorted.push(node.id);

    const columns = columnCount(availableWidth, nodes.length);
    const positions = new Map(sorted.map((id, index) => [id, gridPosition(index, columns)]));
    return nodes.map(node => ({ ...node, ...positions.get(node.id)! }));
}

type Point = { x: number; y: number };
const point = (x: number, y: number): Point => ({ x, y });
const path = (points: Point[]) => points.map((p, index) => `${index ? 'L' : 'M'}${p.x},${p.y}`).join(' ');

/** Whether an orthogonal segment crosses a card's interior (its border is safe). */
function crossesNode(a: Point, b: Point, node: FlowNode): boolean {
    if (a.y === b.y) {
        return a.y > node.y && a.y < node.y + NODE_HEIGHT &&
            Math.max(a.x, b.x) > node.x && Math.min(a.x, b.x) < node.x + NODE_WIDTH;
    }
    return a.x > node.x && a.x < node.x + NODE_WIDTH &&
        Math.max(a.y, b.y) > node.y && Math.min(a.y, b.y) < node.y + NODE_HEIGHT;
}

function isClear(points: Point[], nodes: FlowNode[]): boolean {
    return points.slice(1).every((end, index) => !nodes.some(node => crossesNode(points[index], end, node)));
}

/**
 * Route grid connections through the spaces between cards. Manually overlapping
 * cards can leave no unobstructed route; the fallback still uses outward ports.
 * Parallel connections may share a lane; this is not a general graph router.
 */
export function nodeConnectionPath(source: FlowNode, target: FlowNode, nodes: FlowNode[], canvasWidth: number): string {
    const sx = source.x + NODE_WIDTH / 2, sy = source.y + NODE_HEIGHT / 2;
    const tx = target.x + NODE_WIDTH / 2, ty = target.y + NODE_HEIGHT / 2;
    const sourceRight = source.x + NODE_WIDTH, targetRight = target.x + NODE_WIDTH;
    const sourceBottom = source.y + NODE_HEIGHT, targetBottom = target.y + NODE_HEIGHT;

    // Facing horizontal ports handle both directions of the serpentine rows.
    if ((sourceRight <= target.x || targetRight <= source.x) && source.y < targetBottom && target.y < sourceBottom) {
        const rightward = sx < tx;
        const start = point(rightward ? sourceRight : source.x, sy);
        const end = point(rightward ? target.x : targetRight, ty);
        const middle = (start.x + end.x) / 2;
        const direct = [start, point(middle, sy), point(middle, ty), end];
        if (isClear(direct, nodes)) return path(direct);
    }

    if (sourceBottom <= target.y || targetBottom <= source.y) {
        const downward = sy < ty;
        const start = point(sx, downward ? sourceBottom : source.y);
        const end = point(tx, downward ? target.y : targetBottom);
        const middle = (start.y + end.y) / 2;
        const direct = [start, point(sx, middle), point(tx, middle), end];
        if (isClear(direct, nodes)) return path(direct);

        // A skipped row would cross other cards: use the reserved right margin.
        const clearance = Math.min(ROW_GAP / 2, Math.abs(end.y - start.y) / 2);
        const sourceLane = start.y + (downward ? clearance : -clearance);
        const targetLane = end.y + (downward ? -clearance : clearance);
        const outside = Math.max(canvasWidth - CANVAS_PADDING / 2, sourceRight + CANVAS_PADDING / 2, targetRight + CANVAS_PADDING / 2,
            ...nodes.map(node => node.x + NODE_WIDTH + CANVAS_PADDING / 2));
        return path([start, point(sx, sourceLane), point(outside, sourceLane),
            point(outside, targetLane), point(tx, targetLane), end]);
    }

    // A same-row shortcut must go around the intervening cards, not through them.
    const top = Math.min(source.y, target.y);
    const above = Math.max(0, top - Math.min(ROW_GAP / 2, top / 2));
    const upper = [point(sx, source.y), point(sx, above), point(tx, above), point(tx, target.y)];
    if (isClear(upper, nodes)) return path(upper);

    const below = Math.max(sourceBottom, targetBottom) + CANVAS_PADDING / 2;
    const lower = [point(sx, sourceBottom), point(sx, below), point(tx, below), point(tx, targetBottom)];
    if (isClear(lower, nodes)) return path(lower);

    // Hand-positioned cards may overlap or block every nearby lane.
    const outside = Math.max(canvasWidth - CANVAS_PADDING / 2, sourceRight + CANVAS_PADDING / 2, targetRight + CANVAS_PADDING / 2,
        ...nodes.map(node => node.x + NODE_WIDTH + CANVAS_PADDING / 2));
    return path([point(sourceRight, sy), point(outside, sy), point(outside, ty), point(targetRight, ty)]);
}
