<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import UiButton from "./UiButton.vue";
import { CANVAS_PADDING, NODE_HEIGHT, NODE_WIDTH, nodeConnectionPath } from "../../../lib/canvas-layout.ts";
import { MAX_NODE_COORDINATE } from "../../../lib/types.ts";
const props = defineProps({ hypothesis: Object, selectedId: String, busy: Boolean });
const emit = defineEmits(["select", "move", "add", "layout"]);
const viewport = ref(null);
const viewportWidth = ref(0);
const zoom = ref(1);
const fitNotice = ref("");
const drag = ref(null);
let resizeObserver;
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
  return { id: edge.source+"-"+edge.target, d: nodeConnectionPath(source, target, positions.value, width.value) };
}).filter(Boolean));
const progressLabels={pending:"待开始",in_progress:"进行中",completed:"已完成"};
const resultLabels={pending:"待判定",running:"判定中",verified:"已验证",rejected:"未通过"};
const types={baseline:"基线",observation:"观察",hypothesis:"假设",experiment:"实验",conclusion:"结论"};
function start(event,node) {
  if(props.busy || event.button !== 0) return;
  emit("select",node.id);
  drag.value={id:node.id,startX:event.clientX,startY:event.clientY,originalX:node.x,originalY:node.y,x:node.x,y:node.y};
  event.currentTarget.setPointerCapture(event.pointerId);
}
function move(event) {
  if(!drag.value)return;
  drag.value.x=Math.max(0,Math.min(MAX_NODE_COORDINATE,Math.round(drag.value.originalX+(event.clientX-drag.value.startX)/zoom.value)));
  drag.value.y=Math.max(0,Math.min(MAX_NODE_COORDINATE,Math.round(drag.value.originalY+(event.clientY-drag.value.startY)/zoom.value)));
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
  <section class="panel canvas-shell" aria-label="研究流程画布" :style="{'--node-width':NODE_WIDTH+'px','--node-height':NODE_HEIGHT+'px'}">
    <div class="row flow-toolbar"><UiButton @click="emit('add',{width:viewportWidth})" :busy="busy">＋ 步骤</UiButton><UiButton @click="arrange" :busy="busy">自动布局</UiButton><UiButton @click="changeZoom(-.1)" aria-label="缩小">−</UiButton><span>{{Math.round(zoom*100)}}%</span><UiButton @click="changeZoom(.1)" aria-label="放大">＋</UiButton><UiButton @click="fit">适配</UiButton></div>
    <div ref="viewport" class="canvas"><div class="canvas-scaled" :style="{width:Math.max(viewportWidth,width*zoom)+'px',height:height*zoom+'px'}"><div class="canvas-space" :style="{width:width+'px',height:height+'px',transform:'scale('+zoom+')'}">
      <svg :width="width" :height="height" aria-hidden="true"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#95a9ca"/></marker></defs><path v-for="line in lines" :key="line.id" :d="line.d" fill="none" stroke="#95a9ca" stroke-width="2" marker-end="url(#arrow)"/></svg>
      <button v-for="node in positions" :key="node.id" class="node" :class="{selected:node.id===selectedId}" :style="{left:node.x+'px',top:node.y+'px'}" :title="node.title" :aria-pressed="node.id===selectedId" @pointerdown="start($event,node)" @pointermove="move" @pointerup="end()" @pointercancel="end(true)" @click="emit('select',node.id)" @keydown="key($event,node)"><small>{{types[node.type]}}</small><strong>{{node.title}}</strong><span class="badge" :class="node.progress||'pending'">{{progressLabels[node.progress||'pending']}}</span></button>
      <div v-if="!positions.length" class="empty">还没有步骤，点击“＋ 步骤”开始</div>
    </div></div></div>
    <small>自动布局按画布宽度换行，沿箭头查看流程；拖动步骤或用方向键调整位置。修改后自动保存</small>
    <small v-if="fitNotice" class="canvas-notice" role="status">{{fitNotice}}</small>
  </section>
</template>
