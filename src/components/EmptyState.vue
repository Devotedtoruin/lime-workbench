<script setup>
import { computed } from 'vue';

const props = defineProps({
  title: { type: String, default: '' },
  text: { type: String, default: '' },
  art: { type: String, default: '✨' },
  actionLabel: { type: String, default: '' }
});
const emit = defineEmits(['action']);
</script>

<template>
  <div class="empty">
    <span class="empty-art" aria-hidden="true">{{ art }}</span>
    <strong v-if="title">{{ title }}</strong>
    <p v-if="text">{{ text }}</p>
    <slot />
    <button v-if="actionLabel" class="btn btn-soft btn-sm" type="button" @click="emit('action')">{{ actionLabel }}</button>
  </div>
</template>
