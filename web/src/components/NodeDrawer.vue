<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";

const props = defineProps({ title: { type: String, default: "节点详情" }, contentKey: String, returnFocus: Function });
const emit = defineEmits(["close"]);
const dialog = ref(null), closeButton = ref(null), content = ref(null), modalMode = ref(false);
const titleId = useId();
const deferredDialogs = new Set();
let media, previousFocus, disposed = false;
watch(() => props.contentKey, async () => { await nextTick(); content.value?.scrollTo(0, 0); });

function otherModal() {
  return [...document.querySelectorAll("dialog:modal")].find(element => element !== dialog.value);
}
function afterModalClosed(event) {
  deferredDialogs.delete(event.currentTarget);
  synchronizeMode();
}
function synchronizeMode() {
  const element = dialog.value;
  if (disposed || !element || !media) return;
  const modal = media.matches;
  if (element.open && element.matches(":modal") === modal) return;
  // Do not promote the drawer above an open confirmation when a screen rotates.
  const blocking = otherModal();
  if (blocking) {
    if (!deferredDialogs.has(blocking)) {
      deferredDialogs.add(blocking);
      blocking.addEventListener("close", afterModalClosed, { once: true });
    }
    return;
  }
  const focused = element.contains(document.activeElement) ? document.activeElement : null;
  if (element.open) element.close();
  if (modal) element.showModal(); else element.show();
  modalMode.value = modal;
  const target = focused instanceof HTMLElement && focused.isConnected ? focused : closeButton.value;
  target?.focus({ preventScroll: true });
}
function requestClose() {
  if (!otherModal()) emit("close");
}
function cancel(event) {
  event.preventDefault();
  requestClose();
}
function escape(event) {
  if (event.key !== "Escape" || event.isComposing || event.defaultPrevented || !dialog.value?.open || otherModal()) return;
  event.preventDefault();
  event.stopPropagation();
  emit("close");
}

onMounted(async () => {
  previousFocus = document.activeElement;
  media = window.matchMedia("(max-width: 760px)");
  media.addEventListener("change", synchronizeMode);
  // Capture Escape before page-level shortcuts, including in nonmodal desktop mode.
  document.addEventListener("keydown", escape, true);
  await nextTick();
  synchronizeMode();
});
onBeforeUnmount(() => {
  disposed = true;
  media?.removeEventListener("change", synchronizeMode);
  document.removeEventListener("keydown", escape, true);
  for (const element of deferredDialogs) element.removeEventListener("close", afterModalClosed);
  deferredDialogs.clear();
  dialog.value?.close();
  const target = props.returnFocus?.() || previousFocus;
  nextTick(() => {
    if (target instanceof HTMLElement && target.isConnected && !document.querySelector("dialog:modal")) target.focus({ preventScroll: true });
  });
});
</script>

<template>
  <dialog ref="dialog" class="node-drawer" :aria-labelledby="titleId" :aria-modal="modalMode ? 'true' : undefined" @cancel="cancel">
    <div class="drawer-header">
      <h2 :id="titleId">{{ title }}</h2>
      <button ref="closeButton" type="button" class="drawer-close" aria-label="关闭节点详情" @click="requestClose"><span aria-hidden="true">×</span></button>
    </div>
    <div ref="content" class="drawer-content"><slot /></div>
  </dialog>
</template>

<style scoped>
.node-drawer {
  position: fixed;
  inset: 112px 16px 16px auto;
  z-index: 40;
  box-sizing: border-box;
  width: min(420px, calc(100vw - 32px));
  max-width: none;
  height: calc(100vh - 128px);
  height: calc(100dvh - 128px);
  max-height: calc(100vh - 128px);
  max-height: calc(100dvh - 128px);
  margin: 0;
  padding: 0;
  overflow: hidden;
  color: var(--ink-strong, #182230);
  background: #fff;
  border: 1px solid var(--line, #e2e6ec);
  border-radius: 16px;
  box-shadow: 0 12px 40px #17213a26;
}
.node-drawer[open] { display: flex; flex-direction: column; }
.drawer-header { display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px 12px 20px; border-bottom: 1px solid var(--line, #e2e6ec); }
.drawer-header h2 { margin: 0; font-size: 18px; overflow-wrap: anywhere; }
.drawer-close { flex: 0 0 auto; min-width: 44px; min-height: 44px; font-size: 24px; line-height: 1; }
.drawer-content { flex: 1 1 auto; min-width: 0; min-height: 0; padding: 20px; overflow: auto; overscroll-behavior: contain; }
.node-drawer::backdrop { background: #17213a66; }
@media (max-width: 760px) {
  .node-drawer {
    inset: 12px 12px 12px auto;
    width: calc(100vw - 24px);
    height: calc(100vh - 24px);
    height: calc(100dvh - 24px);
    max-height: calc(100vh - 24px);
    max-height: calc(100dvh - 24px);
    border-radius: 14px;
  }
  .drawer-content { padding: 16px; }
}
</style>
