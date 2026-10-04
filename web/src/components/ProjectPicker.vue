<script setup>
import CollectionPager from "./CollectionPager.vue";
defineProps({modelValue:{type:String,default:""},search:{type:String,default:""},options:{type:Array,default:()=>[]},page:{type:Object,required:true},label:{type:String,default:"筛选项目"},allowAll:{type:Boolean,default:true}});
const emit=defineEmits(["update:modelValue","update:search","more","retry"]);
</script>
<template>
  <div class="project-picker">
    <input type="search" :value="search" @input="emit('update:search',$event.target.value)" maxlength="200" placeholder="查找项目…" :aria-label="label+'：查找项目'">
    <select :value="modelValue" @change="emit('update:modelValue',$event.target.value)" :aria-label="label"><option v-if="allowAll" value="">全部项目</option><option v-for="option in options" :key="option.value" :value="option.value">{{option.label}}</option></select>
    <CollectionPager v-if="page.nextOffset!==null||page.loading||page.error||page.stale||search" :page="page" :count="page.ids.length" label="项目选项分页" @more="emit('more')" @retry="emit('retry')"/>
  </div>
</template>
<style scoped>
.project-picker{display:grid;gap:8px;min-width:0}.project-picker input,.project-picker select{width:100%;min-width:0}.project-picker :deep(.collection-pager){margin:0}
</style>
