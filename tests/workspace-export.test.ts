import { test } from "node:test";
import assert from "node:assert/strict";
import { exportCollection, exportWorkspace } from "../lib/workspace-export.ts";
import type { ApiPage } from "../lib/client.ts";

test("explicit exports follow short-page cursors and include all collections and filters", async () => {
    const requests: string[] = [];
    const client = { page: async <T,>(path: string): Promise<ApiPage<T>> => {
        requests.push(path);
        const url = new URL(path, "https://example.test");
        const offset = Number(url.searchParams.get("offset"));
        const data = url.pathname === "/resources" ? [] : [{ id: `${url.pathname}-${offset}`, title: "带引号的\"记录" }];
        return { data: data as T[], total: data.length ? 2 : 0, nextOffset: data.length && offset === 0 ? 1 : null };
    } };
    const workspace = JSON.parse(await (await exportWorkspace(client)).text());
    assert.deepEqual(Object.keys(workspace), ["projects", "hypotheses", "experiments", "resources"]);
    assert.equal(workspace.projects.length, 2);
    assert.equal(workspace.hypotheses.length, 2);
    assert.equal(workspace.experiments.length, 2);
    assert.deepEqual(workspace.resources, []);
    requests.length = 0;
    const filtered = JSON.parse(await (await exportCollection(client, "experiments", { projectId: "p1", status: "verified" })).text());
    assert.equal(filtered.length, 2);
    assert.ok(requests.every(path => path.includes("projectId=p1") && path.includes("status=verified")));
    assert.deepEqual(requests.map(path => new URL(path, "https://example.test").searchParams.get("offset")), ["0", "1"]);
    requests.length = 0;
    await exportCollection(client, "experiments", { projectId: "", status: "", q: "" });
    assert.ok(requests.every(path => ["projectId", "status", "q"].every(key => !new URL(path, "https://example.test").searchParams.has(key))));
});

test("failed or cancelled later export pages never produce a partial download", async () => {
    const client = { page: async <T,>(path: string): Promise<ApiPage<T>> => {
        if (path.includes("offset=1")) throw new DOMException("Session changed", "AbortError");
        return { data: [{ id: "first" }] as T[], total: 2, nextOffset: 1 };
    } };
    await assert.rejects(exportCollection(client, "projects"), { name: "AbortError" });
});
