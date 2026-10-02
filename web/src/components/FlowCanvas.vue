<script setup>
import { computed, onBeforeUnmount, ref } from "vue";
import UiButton from "./UiButton.vue";
const props = defineProps({ hypothesis: Object, selectedId: String, busy: Boolean });
const emit = defineEmits(["select", "move", "add", "layout"]);
const viewport = ref(null);
const zoom = ref(1);
const drag = ref(null);
const positions = computed(() => props.hypothesis.nodes.map(n => drag.value?.id === n.id ? { ...n, x: drag.value.x, y: drag.value.y } : n));
const geometry = computed(() => {
  const nodesById = new Map();
  let width = 700, height = 500;
  for (const node of positions.value) {
    nodesById.set(node.id, node);
    width = Math.max(width, node.x + 240);
    height = Math.max(height, node.y + 170);
  }
  return { nodesById, width, height };
});
const width = computed(() => geometry.value.width);
const height = computed(() => geometry.value.height);
const lines = computed(() => props.hypothesis.edges.map(edge => {
  const source = geometry.value.nodesById.get(edge.source), target = geometry.value.nodesById.get(edge.target);
  if (!source || !target) return null;
  const x1=source.x+185, y1=source.y+52, x2=target.x, y2=target.y+52, bend=Math.max(45, Math.abs(x2-x1)/2);
  return { id: edge.source+"-"+edge.target, d: "M"+x1+","+y1+" C"+(x1+bend)+","+y1+" "+(x2-bend)+","+y2+" "+x2+","+y2 };
}).filter(Boolean));
const statuses={pending:"待验证",running:"验证中",verified:"已验证",rejected:"已丢弃"};
const types={baseline:"基线训练",observation:"结果观察",hypothesis:"研究假设",experiment:"实验验证",conclusion:"研究结论"};
function start(event,node) {
  if(props.busy || event.button !== 0) return;
  emit("select",node.id);
  drag.value={id:node.id,startX:event.clientX,startY:event.clientY,originalX:node.x,originalY:node.y,x:node.x,y:node.y};
  event.currentTarget.setPointerCapture(event.pointerId);
}
function move(event) {
  if(!drag.value)return;
  drag.value.x=Math.max(0,Math.min(10000,Math.round(drag.value.originalX+(event.clientX-drag.value.startX)/zoom.value)));
  drag.value.y=Math.max(0,Math.min(10000,Math.round(drag.value.originalY+(event.clientY-drag.value.startY)/zoom.value)));
}
function end(cancel=false) {
  if(!drag.value)return;
  const d=drag.value;drag.value=null;
  if(!cancel && (d.x!==d.originalX||d.y!==d.originalY))emit("move",{id:d.id,x:d.x,y:d.y});
}
function key(event,node) {
  const directions={ArrowLeft:[-10,0],ArrowRight:[10,0],ArrowUp:[0,-10],ArrowDown:[0,10]};
  if(props.busy||!directions[event.key])return;
  event.preventDefault();const [x,y]=directions[event.key];emit("move",{id:node.id,x:Math.max(0,Math.min(10000,node.x+x)),y:Math.max(0,Math.min(10000,node.y+y))});
}
function fit(){zoom.value=Math.max(.25,Math.min(1,(viewport.value.clientWidth-20)/width.value));viewport.value.scrollTo(0,0);}
onBeforeUnmount(()=>end(true));
</script>
<template>
  <section class="panel canvas-shell" aria-label="研究流程画布">
    <div class="row flow-toolbar"><UiButton @click="emit('add')" :busy="busy">＋ 节点</UiButton><UiButton @click="emit('layout')" :busy="busy">自动布局</UiButton><UiButton @click="zoom=Math.max(.25,zoom-.1)" aria-label="缩小">−</UiButton><span>{{Math.round(zoom*100)}}%</span><UiButton @click="zoom=Math.min(2,zoom+.1)" aria-label="放大">＋</UiButton><UiButton @click="fit">适配</UiButton></div>
    <div ref="viewport" class="canvas"><div :style="{width:width*zoom+'px',height:height*zoom+'px'}"><div class="canvas-space" :style="{width:width+'px',height:height+'px',transform:'scale('+zoom+')'}">
      <svg :width="width" :height="height" aria-hidden="true"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#95a9ca"/></marker></defs><path v-for="line in lines" :key="line.id" :d="line.d" fill="none" stroke="#95a9ca" stroke-width="2" marker-end="url(#arrow)"/></svg>
      <button v-for="node in positions" :key="node.id" class="node" :class="{selected:node.id===selectedId}" :style="{left:node.x+'px',top:node.y+'px'}" :aria-pressed="node.id===selectedId" @pointerdown="start($event,node)" @pointermove="move" @pointerup="end()" @pointercancel="end(true)" @click="emit('select',node.id)" @keydown="key($event,node)"><small>{{types[node.type]}}</small><strong>{{node.title}}</strong><span class="badge" :class="node.status">{{statuses[node.status]}}</span></button>
      <div v-if="!positions.length" class="empty">还没有流程节点，点击“＋ 节点”开始</div>
    </div></div></div>
    <small>拖动节点或用方向键调整位置；滚动画布查看全图。修改后自动保存</small>
  </section>
</template>
