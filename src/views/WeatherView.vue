<script setup>
import { ref } from 'vue';
import { asset } from '../lib/assets.js';
import { useWorkbench } from '../composables/useWorkbench.js';
import { useWeather } from '../composables/useWeather.js';

const wb = useWorkbench();
const weather = useWeather();

const cityInput = ref('');

function searchCity() {
  const name = cityInput.value.trim();
  if (!name) return;
  weather.searchCity(name);
  cityInput.value = '';
}
</script>

<template>
  <div class="page-shell">
    <header class="page-head">
      <div>
        <h1>天气与通勤</h1>
        <p class="sub">只在需要时读取位置；也可以手动选择城市。</p>
      </div>
      <span class="privacy"><img :src="asset('assets/icons/map-pin.svg')" alt="" />位置只用于天气查询</span>
    </header>

    <p v-if="weather.error.value" class="weather-error" role="alert">
      <span>{{ weather.error.value }}</span>
      <button class="btn btn-soft btn-sm" type="button" @click="weather.retry()">重试</button>
    </p>

    <section class="panel glass rim weather-hero" :aria-busy="weather.busy.value">
      <div class="weather-main">
        <img class="weather-icon" :src="weather.weatherData.icon" alt="" />
        <div class="weather-copy">
          <span class="weather-city">{{ weather.weatherData.place }}</span>
          <strong v-if="!weather.busy.value" class="weather-temp numeric">{{ weather.weatherData.summary }} {{ weather.weatherData.temp }}</strong>
          <span v-else class="skeleton" style="width: 150px; height: 26px"></span>
          <small>{{ weather.weatherData.detail }}</small>
          <small class="updated">{{ weather.weatherData.updatedAt }}</small>
        </div>
      </div>
      <div class="weather-controls">
        <button class="btn btn-soft" type="button" :disabled="weather.busy.value" @click="weather.locate()">
          <img :src="asset('assets/icons/locate.svg')" alt="" />使用当前位置
        </button>
        <form class="city-search" @submit.prevent="searchCity">
          <input v-model="cityInput" class="input" maxlength="100" placeholder="搜索城市，如 杭州" aria-label="搜索城市" />
          <button class="btn btn-primary" type="submit" :disabled="weather.busy.value">查询</button>
        </form>
      </div>
      <p class="tiny">同名城市（例如「白山市」中国和日本各有一个）需要加上省份或国家，如「吉林省 白山市」。</p>
    </section>

    <div class="weather-lower">
      <section class="panel glass rim">
        <div class="panel-head"><h2 class="panel-title">出门前提醒</h2></div>
        <ul v-if="weather.weatherData.tips.length" class="tips">
          <li v-for="(tip, i) in weather.weatherData.tips" :key="i">
            <img :src="asset(`assets/img/${tip.icon || 'sun'}.png`)" alt="" />
            <span>{{ tip.text }}</span>
          </li>
        </ul>
        <div v-else class="empty"><span class="empty-art" aria-hidden="true"><img :src="asset('assets/icons/cloud-sun.svg')" alt="" /></span><p>选择城市后显示天气与通勤建议。</p></div>
      </section>

      <section class="panel glass rim">
        <div class="panel-head"><h2 class="panel-title">接下来几天</h2></div>
        <div v-if="weather.weatherData.days.length" class="forecast">
          <div v-for="d in weather.weatherData.days" :key="d.date" class="forecast-day">
            <span class="day-label">{{ d.label }}</span>
            <img :src="d.icon" alt="" />
            <span class="day-txt">{{ d.txt }}</span>
            <span class="day-temp numeric">{{ d.min }}° ~ {{ d.max }}°</span>
            <span class="day-pop">{{ d.pop }}</span>
          </div>
        </div>
        <div v-else class="empty"><span class="empty-art" aria-hidden="true"><img :src="asset('assets/icons/calendar-days.svg')" alt="" /></span><p>选择城市后显示未来几天预报。</p></div>
      </section>
    </div>

    <p class="attribution">
      天气数据：<a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a>
      （<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>）；
      地点：<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>
      （<a href="https://nominatim.openstreetmap.org/" target="_blank" rel="noopener noreferrer">Nominatim</a>）
    </p>
  </div>
</template>

<style scoped>
.weather-error {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  padding: 10px 14px; border: 1px solid var(--coral); border-radius: var(--radius-control);
  background: var(--coral-pale); color: var(--ink); font-size: var(--text-body);
}
.privacy { display: inline-flex; align-items: center; gap: 7px; padding-right: 4px; font-size: var(--text-meta); color: var(--muted); }
.privacy img { width: 16px; height: 16px; opacity: .6; }
.weather-hero { display: flex; flex-direction: column; gap: 18px; }
.weather-main { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
.weather-icon { width: 84px; height: 84px; object-fit: contain; }
.weather-copy { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.weather-city { font-size: var(--text-body); font-weight: 600; color: var(--brand-deep); }
.weather-temp { font-size: var(--text-hero); font-weight: 800; letter-spacing: -.03em; line-height: 1.15; display: block; }
.weather-copy small { font-size: var(--text-sm); color: var(--muted); }
.weather-copy .updated { font-size: var(--text-2xs); opacity: .8; }
.weather-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.city-search { display: flex; align-items: center; gap: 8px; flex: 1 1 260px; max-width: 420px; }
.city-search .input { flex: 1; min-width: 0; }
.tiny { font-size: var(--text-sm); color: var(--muted); line-height: 1.6; }

.weather-lower { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--shell-gap); align-items: start; }
.tips { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.tips li { display: flex; align-items: flex-start; gap: 10px; padding: 11px 13px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface-soft); font-size: var(--text-body); line-height: 1.6; }
.tips img { width: 22px; height: 22px; object-fit: contain; flex: 0 0 22px; }

.forecast { display: flex; flex-direction: column; }
.forecast-day { display: grid; grid-template-columns: 52px 30px minmax(0, 1fr) auto auto; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--line); font-size: var(--text-sm); }
.forecast-day:last-child { border-bottom: 0; }
.day-label { font-weight: 600; color: var(--ink-soft); }
.forecast-day img { width: 26px; height: 26px; object-fit: contain; }
.day-txt { color: var(--muted); overflow-wrap: anywhere; }
.day-temp { color: var(--ink); font-weight: 600; white-space: nowrap; }
.day-pop { color: var(--muted); font-size: var(--text-2xs); white-space: nowrap; }

.attribution { font-size: var(--text-sm); color: var(--muted); line-height: 1.7; }
.attribution a { color: var(--brand); text-decoration: none; }
.attribution a:hover { text-decoration: underline; }

@media (max-width: 900px) {
  .weather-lower { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 560px) {
  .weather-icon { width: 64px; height: 64px; }
  .weather-temp { font-size: var(--text-h1); }
  .forecast-day { grid-template-columns: 44px 26px minmax(0, 1fr) auto; }
  .day-pop { display: none; }
}
</style>
