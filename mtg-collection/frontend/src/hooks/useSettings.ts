/**
 * useSettings — global app settings backed by localStorage.
 *
 * All pages read settings through this hook so that every setting defined
 * in Settings.tsx automatically applies everywhere without extra wiring.
 *
 * Usage:
 *   const { showPrices, defaultSort, numPredict, ... } = useSettings();
 *
 * Settings are read once per component mount. They do NOT reactively update
 * if the user changes them on the Settings page during the same session — a
 * page reload (or re-navigation) picks up new values. This matches the
 * documented "changes apply to the next build/analysis" behaviour.
 */

const DEFAULTS = {
  // GPU Performance
  maxCompactCandidates: 200,
  numPredict: 2048,
  maxModelCandidates: 500,
  // Deck Building
  defaultBasicLand: 15,
  defaultNonbasicLand: 12,
  defaultDualLand: 0,
  defaultBracket: 0,
  defaultStrictMode: false,
  defaultTappedLandMax: 0,
  // Display
  showPrices: true,
  defaultSort: "type" as "type" | "name" | "cmc" | "price",
} as const;

function ri(key: string, fallback: number): number {
  const v = localStorage.getItem(key);
  if (v === null) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function rb(key: string, fallback: boolean): boolean {
  const v = localStorage.getItem(key);
  return v === null ? fallback : v === "true";
}

function rs(key: string, fallback: string): string {
  return localStorage.getItem(key) ?? fallback;
}

export interface AppSettings {
  // GPU Performance
  maxCompactCandidates: number;
  numPredict: number;
  maxModelCandidates: number;
  // Deck Building Defaults
  defaultBasicLand: number;
  defaultNonbasicLand: number;
  defaultDualLand: number;
  defaultBracket: number;
  defaultStrictMode: boolean;
  defaultTappedLandMax: number;
  // Display
  showPrices: boolean;
  defaultSort: "type" | "name" | "cmc" | "price";
}

/** Read all settings from localStorage synchronously (no re-renders on change). */
export function readSettings(): AppSettings {
  return {
    maxCompactCandidates: ri("deepbrew_max_compact_candidates", DEFAULTS.maxCompactCandidates),
    numPredict: ri("deepbrew_num_predict", DEFAULTS.numPredict),
    maxModelCandidates: ri("deepbrew_max_model_candidates", DEFAULTS.maxModelCandidates),
    defaultBasicLand: ri("deepbrew_default_basic_land", DEFAULTS.defaultBasicLand),
    defaultNonbasicLand: ri("deepbrew_default_nonbasic_land", DEFAULTS.defaultNonbasicLand),
    defaultDualLand: ri("deepbrew_default_dual_land", DEFAULTS.defaultDualLand),
    defaultBracket: ri("deepbrew_default_bracket", DEFAULTS.defaultBracket),
    defaultStrictMode: rb("deepbrew_default_strict_mode", DEFAULTS.defaultStrictMode),
    defaultTappedLandMax: ri("deepbrew_default_tapped_land_max", DEFAULTS.defaultTappedLandMax),
    showPrices: rb("deepbrew_show_prices", DEFAULTS.showPrices),
    defaultSort: rs("deepbrew_default_sort", DEFAULTS.defaultSort) as AppSettings["defaultSort"],
  };
}

export { DEFAULTS as SETTINGS_DEFAULTS };

/**
 * React hook — returns a snapshot of all settings.
 * Reads once on mount; stays stable for the component's lifetime.
 */
export function useSettings(): AppSettings {
  // Intentionally not useState/useEffect — we want a simple synchronous
  // read with no re-render overhead. Settings changes take effect on next
  // page navigation, which is the documented behaviour.
  return readSettings();
}
