import React, { useState, useEffect, useRef } from "react";
import "./LicenseModal.css";

const MODEL_OPTIONS = [
  {
    id: "mtg-commander-nemo-q3_k_m.gguf",
    label: "Nemo 12B Q3",
    size: "~5.7 GB",
    note: "Recommended — best balance of speed and quality",
  },
  {
    id: "mtg-commander-nemo-q4_k_m.gguf",
    label: "Nemo 12B Q4",
    size: "~7.0 GB",
    note: "Highest quality — requires 10 GB+ VRAM",
  },
];

interface Props {
  onActivated?: () => void;
}

type Step = "enter-key" | "select-model" | "downloading" | "done" | "already-active";

export default function LicenseModal({ onActivated }: Props) {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<Step>("enter-key");
  const [licenseKey, setLicenseKey] = useState("");
  const [selectedModel, setSelectedModel] = useState(MODEL_OPTIONS[0].id);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ percent: number; received: number; total: number } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (typeof window.deepbrew === "undefined") return;
    if (window.deepbrew.tier !== "pro") return;

    window.deepbrew.getLicenseStatus().then((rec) => {
      if (!rec) {
        setVisible(true);
      } else {
        setStep("already-active");
        setVisible(false);
        onActivated?.();
      }
    });
  }, []);

  async function handleActivate() {
    setError(null);
    setBusy(true);
    try {
      const result = await window.deepbrew?.activateLicense(licenseKey.trim());
      if (result?.ok) setStep("select-model");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Activation failed. Check your key and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload() {
    setError(null);
    setBusy(true);
    setStep("downloading");
    setProgress({ percent: 0, received: 0, total: 0 });

    cleanupRef.current = window.deepbrew?.onDownloadProgress((d) => {
      setProgress(d);
    }) ?? null;

    try {
      await window.deepbrew?.downloadModel(selectedModel);
      await window.deepbrew?.setActiveModel(selectedModel);
      setStep("done");
      onActivated?.();
    } catch (e: unknown) {
      setStep("select-model");
      setError(e instanceof Error ? e.message : "Download failed. Please try again.");
    } finally {
      setBusy(false);
      cleanupRef.current?.();
      cleanupRef.current = null;
    }
  }

  function formatBytes(bytes: number) {
    if (!bytes) return "";
    const gb = bytes / 1024 ** 3;
    return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  }

  if (!visible) return null;

  return (
    <div className="lm-overlay" role="dialog" aria-modal="true" aria-label="Activate DeepBrew Pro">
      <div className="lm-modal">

        {/* ── Enter key ─────────────────────────────────── */}
        {step === "enter-key" && (
          <>
            <div className="lm-icon">🔑</div>
            <h2 className="lm-title">Activate DeepBrew Pro</h2>
            <p className="lm-intro">
              Enter the license key from your purchase confirmation email.
            </p>
            <input
              className="lm-input"
              type="text"
              placeholder="XXXX-XXXX-XXXX-XXXX"
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && handleActivate()}
              autoFocus
              spellCheck={false}
            />
            {error && <p className="lm-error">{error}</p>}
            <button className="lm-btn-primary" onClick={handleActivate} disabled={busy || !licenseKey.trim()}>
              {busy ? "Activating…" : "Activate License"}
            </button>
            <p className="lm-footer">
              Don't have a license?{" "}
              <a href="https://deepbrewmtg.com/#pricing" target="_blank" rel="noopener noreferrer">
                Get DeepBrew Pro ↗
              </a>
            </p>
          </>
        )}

        {/* ── Select model ──────────────────────────────── */}
        {step === "select-model" && (
          <>
            <div className="lm-icon">✅</div>
            <h2 className="lm-title">License Activated!</h2>
            <p className="lm-intro">Choose your Pro model to download (~6–7 GB).</p>
            <div className="lm-model-list">
              {MODEL_OPTIONS.map((m) => (
                <label key={m.id} className={`lm-model-option${selectedModel === m.id ? " selected" : ""}`}>
                  <input
                    type="radio"
                    name="model"
                    value={m.id}
                    checked={selectedModel === m.id}
                    onChange={() => setSelectedModel(m.id)}
                  />
                  <div className="lm-model-info">
                    <span className="lm-model-name">{m.label}</span>
                    <span className="lm-model-size">{m.size}</span>
                    <span className="lm-model-note">{m.note}</span>
                  </div>
                </label>
              ))}
            </div>
            {error && <p className="lm-error">{error}</p>}
            <button className="lm-btn-primary" onClick={handleDownload} disabled={busy}>
              Download Model
            </button>
          </>
        )}

        {/* ── Downloading ───────────────────────────────── */}
        {step === "downloading" && (
          <>
            <div className="lm-icon">⬇️</div>
            <h2 className="lm-title">Downloading Model</h2>
            <p className="lm-intro">
              {progress && progress.total > 0
                ? `${formatBytes(progress.received)} of ${formatBytes(progress.total)}`
                : "Connecting…"}
            </p>
            <div
              className="lm-progress-bar"
              style={{ "--lm-pct": `${progress?.percent ?? 0}%` } as React.CSSProperties}
            >
              <div className="lm-progress-fill" />
            </div>
            <p className="lm-progress-pct">{progress?.percent ?? 0}%</p>
            <p className="lm-footer lm-small">Do not close the app during download.</p>
          </>
        )}

        {/* ── Done ──────────────────────────────────────── */}
        {step === "done" && (
          <>
            <div className="lm-icon">🎉</div>
            <h2 className="lm-title">Ready to Brew!</h2>
            <p className="lm-intro">
              Your Pro model has been downloaded and activated. The AI engine will reload automatically.
            </p>
            <button className="lm-btn-primary" onClick={() => setVisible(false)}>
              Start Building
            </button>
          </>
        )}

      </div>
    </div>
  );
}
