// Live-entry limits. Backup schemas deliberately retain their broader legacy bounds.
export const INPUT_RULES = Object.freeze({
  waterGoal: Object.freeze({ min: 250, max: 10_000, integer: true }),
  stepGoal: Object.freeze({ min: 500, max: 50_000, integer: true }),
  water: Object.freeze({ min: 1, max: 5_000, integer: true }),
  steps: Object.freeze({ min: 0, max: 200_000, integer: true }),
  sportMinutes: Object.freeze({ min: 0.01, max: 1_440 }),
  sportDistance: Object.freeze({ min: 0, max: 1_000 })
});

export function inRange(value, rule) {
  return typeof value === 'number' && Number.isFinite(value) && value >= rule.min && value <= rule.max &&
    (!rule.integer || Number.isSafeInteger(value));
}
