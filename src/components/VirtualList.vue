<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';

const props = defineProps({
  items: { type: Array, required: true },
  keyField: { type: String, default: 'id' },
  itemHeight: { type: Number, default: 68 },
  buffer: { type: Number, default: 6 },
  threshold: { type: Number, default: 80 },
  maxHeight: { type: String, default: '620px' },
  listClass: { type: String, default: '' },
  animName: { type: String, default: 'list-anim' }
});

const containerRef = ref(null);
const scrollTop = ref(0);
const viewportHeight = ref(560);
let rafId = 0;

const isVirtual = computed(() => Array.isArray(props.items) && props.items.length > props.threshold);

const totalHeight = computed(() => props.items.length * props.itemHeight);

const visibleRange = computed(() => {
  if (!isVirtual.value) {
    return { start: 0, end: props.items.length };
  }
  const rawStart = Math.floor(scrollTop.value / props.itemHeight) - props.buffer;
  const visibleCount = Math.ceil(viewportHeight.value / props.itemHeight) + props.buffer * 2;
  const start = Math.max(0, rawStart);
  const end = Math.min(props.items.length, start + visibleCount);
  return { start, end };
});

const visibleItems = computed(() => {
  const { start, end } = visibleRange.value;
  return props.items.slice(start, end).map((item, idx) => ({
    item,
    index: start + idx,
    key: item?.[props.keyField] ?? start + idx
  }));
});

const offsetY = computed(() => visibleRange.value.start * props.itemHeight);

function onScroll(event) {
  const target = event.target;
  if (!target || rafId) return;
  rafId = window.requestAnimationFrame(() => {
    rafId = 0;
    scrollTop.value = target.scrollTop || 0;
    if (target.clientHeight > 0) {
      viewportHeight.value = target.clientHeight;
    }
  });
}

watch(
  () => props.items.length,
  len => {
    if (scrollTop.value > len * props.itemHeight && containerRef.value) {
      containerRef.value.scrollTop = 0;
      scrollTop.value = 0;
    }
  }
);

onBeforeUnmount(() => {
  if (rafId) window.cancelAnimationFrame(rafId);
});
</script>

<template>
  <div
    v-if="isVirtual"
    ref="containerRef"
    class="virtual-scroll-viewport"
    :style="{ maxHeight }"
    @scroll.passive="onScroll"
  >
    <div class="virtual-scroll-spacer" :style="{ height: `${totalHeight}px` }">
      <div class="virtual-scroll-content" :class="listClass" :style="{ transform: `translate3d(0, ${offsetY}px, 0)` }">
        <div
          v-for="entry in visibleItems"
          :key="entry.key"
          class="virtual-scroll-item"
        >
          <slot :item="entry.item" :index="entry.index" />
        </div>
      </div>
    </div>
  </div>

  <TransitionGroup v-else tag="div" :name="animName" class="virtual-flat-list" :class="listClass">
    <div
      v-for="(item, index) in items"
      :key="item?.[keyField] ?? index"
      class="virtual-flat-item"
    >
      <slot :item="item" :index="index" />
    </div>
  </TransitionGroup>
</template>

<style scoped>
.virtual-scroll-viewport {
  overflow-y: auto;
  overflow-x: hidden;
  position: relative;
  -webkit-overflow-scrolling: touch;
  contain: content;
}
.virtual-scroll-spacer {
  position: relative;
  width: 100%;
}
.virtual-scroll-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
  will-change: transform;
}
.virtual-flat-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  position: relative;
}
.virtual-flat-item,
.virtual-scroll-item {
  width: 100%;
}
</style>
