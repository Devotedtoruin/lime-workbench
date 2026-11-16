<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';

const props = defineProps({
  items: { type: Array, required: true },
  keyField: { type: String, default: 'id' },
  itemHeight: { type: Number, default: 68 },
  buffer: { type: Number, default: 6 },
  threshold: { type: Number, default: 80 },
  maxHeight: { type: [String, Number], default: '620px' },
  tag: { type: String, default: 'div' },
  listClass: { type: String, default: '' },
  rowClass: { type: Function, default: null },
  animName: { type: String, default: 'list-anim' }
});

const containerRef = ref(null);
const flatListRef = ref(null);
const scrollTop = ref(0);
const viewportHeight = ref(560);
let rafId = 0;

const resolvedMaxHeight = computed(() =>
  typeof props.maxHeight === 'number' ? `${props.maxHeight}px` : props.maxHeight
);

const itemTag = computed(() => (props.tag === 'ul' || props.tag === 'ol' ? 'li' : 'div'));

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

function scrollToIndex(index) {
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= props.items.length) return;
  if (isVirtual.value && containerRef.value) {
    const viewport = containerRef.value;
    const itemTop = idx * props.itemHeight;
    const itemBottom = itemTop + props.itemHeight;
    if (itemTop < viewport.scrollTop) {
      viewport.scrollTop = itemTop;
      scrollTop.value = itemTop;
    } else if (itemBottom > viewport.scrollTop + viewport.clientHeight) {
      const nextTop = Math.max(0, itemBottom - viewport.clientHeight);
      viewport.scrollTop = nextTop;
      scrollTop.value = nextTop;
    }
    return;
  }
  const rootEl = flatListRef.value?.$el;
  if (rootEl && typeof rootEl.querySelector === 'function') {
    const target = rootEl.querySelector(`[data-vlist-index="${idx}"]`);
    target?.scrollIntoView?.({ block: 'nearest' });
  }
}

defineExpose({ scrollToIndex });

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
    :style="{ maxHeight: resolvedMaxHeight }"
    @scroll.passive="onScroll"
  >
    <div class="virtual-scroll-spacer" :style="{ height: `${totalHeight}px` }">
      <component
        :is="tag"
        class="virtual-scroll-content"
        :class="listClass"
        :style="{ transform: `translate3d(0, ${offsetY}px, 0)` }"
      >
        <component
          :is="itemTag"
          v-for="entry in visibleItems"
          :key="entry.key"
          :data-vlist-index="entry.index"
          class="virtual-scroll-item"
          :class="rowClass ? rowClass(entry.item, entry.index) : null"
        >
          <slot :item="entry.item" :index="entry.index" />
        </component>
      </component>
    </div>
  </div>

  <TransitionGroup
    v-else
    ref="flatListRef"
    :tag="tag"
    :name="animName"
    class="virtual-flat-list"
    :class="listClass"
  >
    <component
      :is="itemTag"
      v-for="(item, index) in items"
      :key="item?.[keyField] ?? index"
      :data-vlist-index="index"
      class="virtual-flat-item"
      :class="rowClass ? rowClass(item, index) : null"
    >
      <slot :item="item" :index="index" />
    </component>
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
  will-change: transform;
}
.virtual-flat-list {
  display: flex;
  flex-direction: column;
  position: relative;
}
.virtual-flat-item,
.virtual-scroll-item {
  width: 100%;
}
</style>
