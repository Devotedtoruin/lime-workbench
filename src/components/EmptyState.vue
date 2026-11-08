<script setup>
import { asset } from '../lib/assets.js';

defineProps({
  title: { type: String, default: '' },
  text: { type: String, default: '' },
  icon: { type: String, default: 'sparkles' },
  art: { type: String, default: '' },
  actionLabel: { type: String, default: '' }
});
const emit = defineEmits(['action']);
</script>

<template>
  <div class="empty">
    <span class="empty-art" aria-hidden="true">
      <img v-if="icon" :src="asset(`assets/icons/${icon}.svg`)" alt="" />
      <template v-else>{{ art }}</template>
    </span>
    <strong v-if="title">{{ title }}</strong>
    <p v-if="text">{{ text }}</p>
    <slot />
    <button v-if="actionLabel" class="btn btn-soft btn-sm" type="button" @click="emit('action')">{{ actionLabel }}</button>
  </div>
</template>
