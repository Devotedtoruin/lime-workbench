<script setup>
import { useAnimatedNumber } from '../composables/useAnimatedNumber.js';

// Renders a KPI value as a counting number. Kept as its own component so each card owns one
// animation loop — calling the composable inside the parent's v-for would need a loop of
// refs keyed by index, which desyncs the moment a card is hidden.
const props = defineProps({
  value: { type: Number, required: true },
  duration: { type: Number, default: 520 }
});

const shown = useAnimatedNumber(() => props.value, { duration: props.duration });
</script>

<template>
  <b>{{ shown }}</b>
</template>
