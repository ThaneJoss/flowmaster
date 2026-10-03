<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import UiButton from "./UiButton.vue";
import { CANVAS_PADDING, NODE_HEIGHT, NODE_WIDTH, nodeConnectionPath } from "../../../lib/canvas-layout.ts";
import { MAX_NODE_COORDINATE } from "../../../lib/types.ts";
const props = defineProps({ hypothesis: Object, selectedId: String, busy: Boolean, focused: Boolean });
const emit = defineEmits(["select", "inspect", "move", "add", "layout", "focus"]);
const viewport = ref(null);
const viewportWidth = ref(0);
const zoom = ref(1);
const fitNotice = ref("");
const drag = ref(null);
let resizeObserver;
let suppressInspect = false;
const positions = computed(() => props.hypothesis.nodes.map(n => drag.value?.id === n.id ? { ...n, x: drag.value.x, y: drag.value.y } : n));
const geometry = computed(() => {
  const nodesById = new Map();
  let width = NODE_WIDTH + CANVAS_PADDING * 2, height = 400;
  for (const node of positions.value) {
    nodesById.set(node.id, node);
    width = Math.max(width, node.x + NODE_WIDTH + CANVAS_PADDING);
    height = Math.max(height, node.y + NODE_HEIGHT + CANVAS_PADDING);
  }
  return { nodesById, width, height };
});
const width = computed(() => geometry.value.width);
const height = computed(() => geometry.value.height);
const lines = computed(() => props.hypothesis.edges.map(edge => {
  const source = geometry.value.nodesById.get(edge.source), target = geometry.value.nodesById.get(edge.target);
  if (!source || !target) return null;
  return { id: edge.source+"-"+edge.target, active: edge.source===props.selectedId||edge.target===props.selectedId, d: nodeConnectionPath(source, target, positions.value, width.value) };
}).filter(Boolean));
const statuses={pending:"待验证",running:"验证中",verified:"已验证",rejected:"已丢弃"};
const types={baseline:"基线训练",observation:"结果观察",hypothesis:"研究假设",experiment:"实验验证",conclusion:"研究结论"};
const typeIcons={baseline:"M3 17h18M6 13V8m6 5V3m6 10V6",observation:"M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6",hypothesis:"M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 2H9s0-1-1-2",experiment:"M9 3h6m-5 0v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M8 15h8",conclusion:"M5 3h14v18l-7-4-7 4V3Zm3 7 3 3 5-6"};
function start(event,node) {
  if(props.busy || event.button !== 0) return;
  suppressInspect=false;
  emit("select",node.id);
  drag.value={id:node.id,startX:event.clientX,startY:event.clientY,originalX:node.x,originalY:node.y,x:node.x,y:node.y};
  event.currentTarget.setPointerCapture(event.pointerId);
}
function move(event) {
  if(!drag.value)return;
  if(!suppressInspect&&Math.hypot(event.clientX-drag.value.startX,event.clientY-drag.value.startY)<=4)return;
  suppressInspect=true;
  drag.value.x=Math.max(0,Math.min(MAX_NODE_COORDINATE,Math.round(drag.value.originalX+(event.clientX-drag.value.startX)/zoom.value)));
  drag.value.y=Math.max(0,Math.min(MAX_NODE_COORDINATE,Math.round(drag.value.originalY+(event.clientY-drag.value.startY)/zoom.value)));
}
function inspect(event,node) {
  if(suppressInspect&&event.detail!==0){suppressInspect=false;return;}
  suppressInspect=false;
  emit("select",node.id);
  emit("inspect",node.id);
}
function end(cancel=false) {
  if(!drag.value)return;
  const d=drag.value;drag.value=null;
  if(!cancel && (d.x!==d.originalX||d.y!==d.originalY))emit("move",{id:d.id,x:d.x,y:d.y});
}
function key(event,node) {
  const directions={ArrowLeft:[-10,0],ArrowRight:[10,0],ArrowUp:[0,-10],ArrowDown:[0,10]};
  if(props.busy||!directions[event.key])return;
  event.preventDefault();const [x,y]=directions[event.key];emit("move",{id:node.id,x:Math.max(0,Math.min(MAX_NODE_COORDINATE,node.x+x)),y:Math.max(0,Math.min(MAX_NODE_COORDINATE,node.y+y))});
}
function fit(){
  if(!viewport.value)return;
  const scale=Math.min(1,viewport.value.clientWidth/width.value);
  zoom.value=Math.max(.75,scale);
  fitNotice.value=scale<.75?'当前布局较宽，点击“自动布局”可按画布宽度换行。':"";
  viewport.value.scrollTo(0,0);
}
function changeZoom(delta){zoom.value=Math.max(.25,Math.min(2,Math.round((zoom.value+delta)*100)/100));fitNotice.value="";}
function arrange(){
  if(props.busy||!viewport.value)return;
  end(true);
  emit("layout",{width:viewport.value.clientWidth,complete:async()=>{await nextTick();fit();}});
}
onMounted(()=>{
  viewportWidth.value=viewport.value.clientWidth;
  resizeObserver=new ResizeObserver(()=>{viewportWidth.value=viewport.value?.clientWidth||0;});
  resizeObserver.observe(viewport.value);
});
onBeforeUnmount(()=>{resizeObserver?.disconnect();end(true);});
</script>
<template>
  <section class="panel canvas-shell" :class="{'is-focused':focused}" aria-label="研究流程画布" :style="{'--node-width':NODE_WIDTH+'px','--node-height':NODE_HEIGHT+'px'}">
    <div class="flow-toolbar">
      <div class="canvas-heading">
        <span class="canvas-heading-icon" aria-hidden="true"><svg class="flow-icon" viewBox="0 0 24 24"><path d="M3 3h7v7H3zM14 14h7v7h-7zM14 6h4v8M6 10v8h8"/></svg></span>
        <div><h3>流程画布</h3><p>{{positions.length}} 个节点<span aria-hidden="true"> · </span>{{lines.length}} 条连接</p></div>
      </div>
      <div class="canvas-actions" role="group" aria-label="流程编辑">
        <UiButton class="canvas-add" variant="primary" @click="emit('add',{width:viewportWidth})" :busy="busy"><span aria-hidden="true">＋</span> 添加节点</UiButton>
        <UiButton class="canvas-layout" @click="arrange" :busy="busy"><svg class="flow-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h6v6h-6zM9 6h6M18 9v6M15 18H9"/></svg>自动布局</UiButton>
      </div>
      <div class="canvas-view-actions">
        <div class="canvas-zoom" role="group" aria-label="画布缩放">
          <UiButton @click="changeZoom(-.1)" aria-label="缩小">−</UiButton><output aria-label="当前缩放比例">{{Math.round(zoom*100)}}%</output><UiButton @click="changeZoom(.1)" aria-label="放大">＋</UiButton>
        </div>
        <UiButton class="canvas-fit" @click="fit">适配</UiButton>
        <UiButton class="canvas-focus focus-toggle" :aria-pressed="focused" @click="emit('focus',!focused)"><svg class="flow-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="focused?'M3 8h5V3m13 5h-5V3M3 16h5v5m13-5h-5v5':'M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5'"/></svg>{{focused?'退出专注':'专注画布'}}</UiButton>
      </div>
    </div>
    <div ref="viewport" class="canvas">
      <div v-if="!positions.length" class="canvas-empty"><span class="canvas-empty-icon" aria-hidden="true"><svg class="flow-icon" viewBox="0 0 24 24"><path d="M3 3h7v7H3zM14 14h7v7h-7zM14 6h4v8M6 10v8h8"/></svg></span><h3>从第一个节点开始</h3><p>把研究思路串成流程，让每一步都清晰可见。</p><UiButton variant="primary" :busy="busy" @click="emit('add',{width:viewportWidth})">＋ 添加节点</UiButton></div>
      <div v-else class="canvas-scaled" :style="{width:Math.max(viewportWidth,width*zoom)+'px',height:height*zoom+'px'}"><div class="canvas-space" :style="{width:width+'px',height:height+'px',transform:'scale('+zoom+')'}">
        <svg class="canvas-connections" :width="width" :height="height" aria-hidden="true"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#9bacca"/></marker><marker id="arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#5271e8"/></marker></defs><path v-for="line in lines" :key="line.id" :class="{'is-active':line.active}" :d="line.d" fill="none" stroke="#9bacca" stroke-width="2" stroke-linejoin="round" :marker-end="line.active?'url(#arrow-active)':'url(#arrow)'"/></svg>
        <button v-for="(node,index) in positions" :key="node.id" class="node" :class="['type-'+node.type,{selected:node.id===selectedId,dragging:drag?.id===node.id}]" :data-node-id="node.id" :style="{left:node.x+'px',top:node.y+'px'}" :title="node.title" :aria-pressed="node.id===selectedId" @pointerdown="start($event,node)" @pointermove="move" @pointerup="end()" @pointercancel="end(true)" @click="inspect($event,node)" @keydown="key($event,node)">
          <span class="node-heading"><span class="node-number">{{String(index+1).padStart(2,'0')}}</span><span class="node-type"><svg class="flow-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="typeIcons[node.type]"/></svg>{{types[node.type]}}</span><svg class="flow-icon node-grip" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01"/></svg></span>
          <strong class="node-title">{{node.title}}</strong>
          <span class="node-footer"><span class="node-state" :class="node.status">{{statuses[node.status]}}</span><span class="node-detail" aria-hidden="true">{{node.id===selectedId?'已选中':'详情'}}<svg class="flow-icon" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg></span></span>
        </button>
      </div></div>
    </div>
    <div class="canvas-footer"><small>拖动或方向键调整 · 点击查看详情</small><small><span class="canvas-save-dot" aria-hidden="true"></span>修改后自动保存</small></div>
    <small v-if="fitNotice" class="canvas-notice" role="status">{{fitNotice}}</small>
  </section>
</template>

<style scoped>
.canvas-shell{display:flex;flex-direction:column;min-height:0;overflow:hidden;padding:0;border:1px solid #dce4f2;border-radius:18px;background:#fff;box-shadow:0 6px 24px #263e7010}
.flow-icon{display:block;flex:none;width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.flow-toolbar{display:flex;flex:none;align-items:center;gap:10px 12px;flex-wrap:wrap;min-height:60px;margin:0;padding:10px 16px;border-bottom:1px solid #e3e9f3}
.canvas-heading{display:flex;flex:1 1 auto;align-items:center;gap:9px;min-width:0}
.canvas-heading-icon{display:grid;place-items:center;width:36px;height:36px;border-radius:11px;background:#edf1ff;color:#5267d9}
.canvas-heading-icon .flow-icon{width:22px;height:22px}
.canvas-heading h3{margin:0;color:#203252;font-size:14px;font-weight:750;letter-spacing:.01em}
.canvas-heading p{margin:1px 0 0;font-size:11px;color:#7c8aa2;white-space:nowrap}
.canvas-actions,.canvas-view-actions{display:flex;align-items:center;gap:8px}
.canvas-view-actions{margin-left:auto}
.canvas-actions button,.canvas-view-actions button{display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;border-color:#dfe5ef;font-size:12px;font-weight:600;line-height:20px;min-height:34px;padding:6px 10px;border-radius:8px}
.canvas-actions .canvas-add{background:#5267d9;border-color:#5267d9;color:#fff;box-shadow:0 3px 7px #5267d91c}
.canvas-actions .canvas-add:hover{background:#4155c4;border-color:#4155c4}
.canvas-add>span{font-size:17px;font-weight:400;line-height:16px}
.canvas-actions .canvas-layout{color:#5a6982;background:#fff}
.canvas-zoom{display:flex;align-items:center;border:1px solid #dfe5ef;border-radius:8px;background:#fff}
.canvas-zoom button{min-height:30px;width:30px;padding:0;border:0;background:transparent;font-size:17px;color:#667894}
.canvas-zoom output{width:44px;text-align:center;color:#556581;font-size:11px;font-weight:650;font-variant-numeric:tabular-nums}
.canvas-view-actions .canvas-fit{border-color:transparent;background:transparent;color:#697995}
.canvas-view-actions .canvas-focus{color:#5267d9;background:#f0f3ff;border-color:#e1e6ff}
.canvas-view-actions .canvas-focus[aria-pressed="true"]{background:#e4eaff;border-color:#bac7fa}
.canvas{flex:1 1 0;min-height:0;height:auto;border:0;border-radius:0;background-color:#f6f8fd;background-image:radial-gradient(#cdd7e9 .8px,transparent .8px);background-size:22px 22px}
.canvas-connections>path{transition:stroke .15s,stroke-width .15s}
.canvas-connections>path.is-active{stroke:#5271e8;stroke-width:2.5}
.canvas .node{--node-accent:#5a83e9;--node-tint:#edf3ff;--node-ink:#4168b9;position:absolute;display:grid;grid-template-rows:24px minmax(0,1fr) 22px;gap:8px;width:var(--node-width);height:var(--node-height);min-height:0;box-sizing:border-box;align-items:stretch;padding:14px;border:1px solid #dbe3ef;border-radius:13px;background:linear-gradient(180deg,var(--node-tint) 0,var(--node-tint) 49px,#fff 49px);color:#243654;box-shadow:0 3px 8px #263e7009,0 9px 20px #263e7006;overflow:hidden;transition:border-color .15s,box-shadow .15s;cursor:grab}
.canvas .node::before{content:"";position:absolute;inset:0 0 auto;height:4px;background:var(--node-accent)}
.canvas .node.type-baseline{--node-accent:#5a83e9;--node-tint:#edf3ff;--node-ink:#4168b9}
.canvas .node.type-observation{--node-accent:#28a4b3;--node-tint:#ecf8fa;--node-ink:#207b87}
.canvas .node.type-hypothesis{--node-accent:#9870d8;--node-tint:#f4effc;--node-ink:#7950b5}
.canvas .node.type-experiment{--node-accent:#e0a240;--node-tint:#fff7e8;--node-ink:#a57225}
.canvas .node.type-conclusion{--node-accent:#42aa84;--node-tint:#edf8f2;--node-ink:#28815e}
.canvas .node:hover{border-color:var(--node-accent);color:#243654;background:linear-gradient(180deg,var(--node-tint) 0,var(--node-tint) 49px,#fff 49px);box-shadow:0 5px 14px #263e7014,0 0 0 1px var(--node-tint)}
.canvas .node.selected{border:1px solid var(--node-accent);box-shadow:0 0 0 3px var(--node-tint),0 0 0 4px var(--node-accent),0 8px 20px #263e7014}
.canvas .node.dragging{cursor:grabbing;z-index:1}
.canvas .node:focus-visible{outline:3px solid #5267d9;outline-offset:5px}
.node-heading{display:flex;align-items:center;gap:7px;min-width:0}
.node-number{display:grid;place-items:center;flex:none;min-width:25px;height:24px;padding:0 3px;border:1px solid #ffffffb3;border-radius:6px;background:#ffffffc9;color:var(--node-ink);font-size:11px;font-weight:750;font-variant-numeric:tabular-nums;line-height:1}
.node-type{display:flex;align-items:center;gap:4px;color:var(--node-ink);font-size:11px;font-weight:650;white-space:nowrap}
.node .flow-icon,.canvas-empty .flow-icon{position:static;inset:auto;overflow:visible}
.node-type .flow-icon{width:14px;height:14px}
.node .node-grip{margin-left:auto;width:12px;height:16px;stroke-width:3;color:var(--node-accent);opacity:.5}
.canvas .node .node-title{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;max-height:60px;margin:0;overflow:hidden;overflow-wrap:anywhere;color:#283b59;font-size:14px;font-weight:700;line-height:20px;text-align:left;align-self:center}
.node-footer{display:flex;align-items:center;justify-content:space-between;gap:6px;min-width:0}
.node-state{display:inline-flex;align-items:center;gap:5px;padding:2px 6px;border-radius:5px;background:#f1f4f8;color:#718098;font-size:10px;font-weight:600;line-height:17px;white-space:nowrap}
.node-state::before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor;flex:none}
.node-state.running{background:#edf2ff;color:#536fd1}
.node-state.verified{background:#eaf6ee;color:#28825d}
.node-state.rejected{background:#fceef0;color:#b55a6a}
.node-detail{display:flex;align-items:center;gap:2px;color:#97a4b8;font-size:10px;white-space:nowrap}
.node-detail .flow-icon{width:11px;height:11px}
.node.selected .node-detail{color:var(--node-ink);font-weight:650}
.canvas-footer{display:flex;flex:none;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:10px 20px;border-top:1px solid #e5ebf5;background:#fff}
.canvas-footer small{display:flex;align-items:center;gap:6px;color:#8b98ad;font-size:11px}
.canvas-save-dot{width:5px;height:5px;border-radius:50%;background:#63ad92}
.canvas-notice{margin:0;padding:0 20px 12px;background:#fff;font-size:12px;color:#a57225}
.canvas-empty{display:flex;min-height:0;height:100%;padding:32px 24px;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.canvas-empty-icon{display:grid;place-items:center;width:68px;height:68px;margin-bottom:20px;border:1px solid #e1e7f7;border-radius:22px;background:#edf1fb;color:#8395ce;box-shadow:0 6px 18px #5267d909}
.canvas-empty-icon .flow-icon{width:32px;height:32px}
.canvas-empty h3{margin:0;color:#526586;font-size:17px;font-weight:650}
.canvas-empty p{max-width:260px;margin:9px 0 22px;color:#8a98af;font-size:13px;line-height:1.8}
@media(max-width:640px){.flow-toolbar{padding:10px 12px;gap:9px 8px}.canvas-heading-icon{display:none}.canvas-heading h3{font-size:13px}.canvas-heading p{font-size:10px}.canvas-actions{gap:6px}.canvas-actions button{padding:5px 8px;font-size:11px}.canvas-layout .flow-icon{display:none}.canvas-view-actions{width:100%;gap:6px}.canvas-view-actions .canvas-focus{margin-left:auto}.canvas-footer{padding:10px 12px}.canvas-footer small{font-size:10px}}
@media(prefers-reduced-motion:reduce){.canvas .node,.canvas-connections>path{transition:none}}
</style>
