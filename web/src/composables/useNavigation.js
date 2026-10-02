import { computed, onBeforeUnmount, ref } from "vue";

const decode = value => { try { return decodeURIComponent(value || ""); } catch { return ""; } };
function parseHash() {
  const [path, query = ""] = location.hash.slice(1).split("?");
  const parts = path.split("/").filter(Boolean).map(decode);
  const params = new URLSearchParams(query);
  if (["settings", "mcp", "api"].includes(parts[0])) return { page: "settings", docs: parts[0] !== "settings" || params.has("docs") };
  if (parts[0] === "projects" && parts[1]) {
    return { page: "project", projectId: parts[1], tab: ["flows", "records", "resources"].includes(parts[2]) ? parts[2] : "flows", hypothesisId: params.get("flow") || "", nodeId: params.get("step") || "" };
  }
  return { page: "projects", legacyTab: ({ workspace: "flows", experiments: "records", resources: "resources" })[parts[0]] };
}
export function useNavigation() {
  const route = ref(parseHash());
  const read = () => { route.value = parseHash(); };
  window.addEventListener("hashchange", read);
  onBeforeUnmount(() => window.removeEventListener("hashchange", read));
  function go(hash, replace = false) {
    if (replace) history.replaceState(null, "", `#${hash}`);
    else location.hash = hash;
    read();
  }
  function project(id, tab = "flows", hypothesisId = "", nodeId = "", replace = false) {
    const params = new URLSearchParams();
    if (hypothesisId) params.set("flow", hypothesisId);
    if (nodeId) params.set("step", nodeId);
    go(`projects/${encodeURIComponent(id)}/${tab}${params.size ? `?${params}` : ""}`, replace);
  }
  return { route, page: computed(() => route.value.page), go, project };
}
