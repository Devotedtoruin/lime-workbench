import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INPUT_RULES, inRange } from '../js/input-rules.js';
import { defaultState, parseBackup } from '../js/state.js';

test('live input rules reject invalid types, fractions for integer fields and inconsistent boundaries', () => {
  for (const rule of Object.values(INPUT_RULES)) {
    for (const value of [NaN, Infinity, null, undefined, '', '250', true, rule.min - 1, rule.max + 1]) assert.equal(inRange(value, rule), false);
    assert.equal(inRange(rule.min, rule), true); assert.equal(inRange(rule.max, rule), true);
    if (rule.integer) assert.equal(inRange(rule.min + 0.5, rule), false);
  }
});

test('narrower new-entry limits never clamp or reject formerly valid backup records', () => {
  const state = defaultState(); state.settings.waterGoal = 100_000; state.settings.stepGoal = 1_000_000;
  state.water['2026-10-15'] = [{ ml: 100_000, time: 0 }];
  state.sport = [{ id: 1, type: 'run', minutes: 60, distance: 100_000, date: '2026-10-15', startAt: 0 }];
  const restored = parseBackup(JSON.stringify(state));
  assert.equal(restored.settings.waterGoal, 100_000); assert.equal(restored.sport[0].distance, 100_000);
});
