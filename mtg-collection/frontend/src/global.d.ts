/// <reference types="vite/client" />
declare module '*.css';

// Injected at build time via vite.config.ts define.
// 'starter' = B1-3 only; 'pro' = full B1-5 with lean pool and thought stream.
declare const __DEEPBREW_TIER__: 'starter' | 'pro';

// Exposed by preload.js via contextBridge.
interface DeepBrewBridge {
  getMachineId:       () => Promise<string>;
  getLicenseStatus:   () => Promise<{ tier: string; activated_at: string; license_key: string } | null>;
  activateLicense:    (key: string) => Promise<{ ok: boolean; tier: string }>;
  downloadModel:      (model: string) => Promise<{ ok: boolean; path: string }>;
  onDownloadProgress: (cb: (d: { received: number; total: number; percent: number }) => void) => () => void;
  setActiveModel:     (filename: string) => Promise<{ ok: boolean }>;
  tier: string;
}

interface Window {
  deepbrew?: DeepBrewBridge;
}
