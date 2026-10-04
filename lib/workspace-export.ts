import type { ApiClient, ApiPage } from "./client.ts";
import type { Collection } from "./types.ts";

type ExportClient = Pick<ApiClient, "page">;
type Filters = Record<string, string>;

// Fetch complete records only after an explicit export request. Store serialized
// pages directly in the Blob, without populating the browser's working cache.
async function appendCollection(parts: BlobPart[], client: ExportClient, kind: Collection, filters: Filters) {
    parts.push("[");
    let offset: number | null = 0;
    let wroteRecord = false;
    while (offset !== null) {
        const query: URLSearchParams = new URLSearchParams({ limit: "200", offset: String(offset) });
        for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
        const page: ApiPage<unknown> = await client.page<unknown>(`/${kind}?${query}`);
        if (page.data.length) {
            if (wroteRecord) parts.push(",");
            parts.push(JSON.stringify(page.data).slice(1, -1));
            wroteRecord = true;
        }
        offset = page.nextOffset;
    }
    parts.push("]");
}

export async function exportWorkspace(client: ExportClient): Promise<Blob> {
    const parts: BlobPart[] = ["{"];
    const collections: Collection[] = ["projects", "hypotheses", "experiments", "resources"];
    for (const [index, kind] of collections.entries()) {
        if (index) parts.push(",");
        parts.push(JSON.stringify(kind), ":");
        await appendCollection(parts, client, kind, {});
    }
    parts.push("}");
    return new Blob(parts, { type: "application/json" });
}

export async function exportCollection(client: ExportClient, kind: Collection, filters: Filters = {}): Promise<Blob> {
    const parts: BlobPart[] = [];
    await appendCollection(parts, client, kind, filters);
    return new Blob(parts, { type: "application/json" });
}
