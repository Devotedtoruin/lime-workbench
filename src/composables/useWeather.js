// 天气响应式状态与控制层
import { reactive, ref } from 'vue';
import { createWeatherController } from '../../js/weather-ui.js';
import { useWorkbench } from './useWorkbench.js';

let singleton = null;

export function useWeather() {
  if (singleton) return singleton;
  const wb = useWorkbench();

  const busy = ref(false);
  const error = ref('');
  const weatherData = reactive({
    loaded: false,
    place: wb.state.settings.place || '定位城市',
    icon: 'assets/icons/cloud-sun.svg',
    summary: '天气',
    temp: '—°C',
    detail: '定位或搜索城市查看天气',
    updatedAt: '',
    tips: [],
    days: []
  });

  function fmt(v, suffix = '') {
    return Number.isFinite(v) ? `${Math.round(v)}${suffix}` : '—';
  }

  const controller = createWeatherController({
    getState: () => wb.state,
    save: () => wb.save(),
    toast: msg => {
      // "天气已更新" is a success acknowledgement; everything else is an error worth keeping
      // on screen next to the widget instead of a 2.2s toast.
      if (msg !== '天气已更新') error.value = msg;
      wb.showToast(msg);
    },
    setBusy: v => { busy.value = v; },
    renderWeather(w, place, tips) {
      const cur = w.current || {};
      error.value = '';
      weatherData.loaded = true;
      weatherData.place = place || wb.state.settings.place || '未知城市';
      weatherData.icon = `assets/img/${cur.icon || 'sun'}.png`;
      weatherData.summary = cur.txt || '晴';
      weatherData.temp = fmt(cur.temp, '°C');
      weatherData.detail = `体感 ${fmt(cur.feels, '°')} · 湿度 ${fmt(cur.humidity, '%')} · 风速 ${fmt(cur.wind, ' km/h')}`;
      weatherData.updatedAt = `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
      weatherData.tips = Array.isArray(tips) && tips.length
        ? tips
        : [{ icon: 'sun', text: '今天天气平稳，适合按计划推进工作。' }];
      weatherData.days = (w.days || []).slice(0, 5).map((d, idx) => ({
        date: d.date,
        label: idx === 0 ? '今天' : new Date(d.date).toLocaleDateString('zh-CN', { weekday: 'short' }),
        icon: `assets/img/${d.icon || 'cloud'}.png`,
        txt: d.txt || '未知',
        min: fmt(d.min),
        max: fmt(d.max),
        pop: d.pop == null ? '—' : `降水 ${Math.round(d.pop)}%`
      }));
    }
  });

  // 启动时自动刷新已保存的城市天气
  controller.refreshSaved();

  singleton = {
    busy,
    error,
    weatherData,
    locate: () => controller.locate(),
    searchCity: name => controller.city(name),
    retry: () => (wb.state.settings.coord && wb.state.settings.place
      ? controller.refreshSaved()
      : controller.locate())
  };
  return singleton;
}
