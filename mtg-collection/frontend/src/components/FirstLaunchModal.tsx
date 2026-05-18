import { useEffect, useRef, useState } from "react";
import "./LicenseModal.css";

// Dev/web fallback — shown when running outside Electron (no window.deepbrew)
const HF_7B  = "https://huggingface.co/SaltyNumba1/MTG-Commander-Mistral-7B-Trained";
const HF_12B = "https://huggingface.co/SaltyNumba1/Mistral-nemo-12B-MTG-Commander";
const MODELS_PATH = "%APPDATA%\\mtg-collection-frontend\\models\\";

interface Props {
  onActivated?: () => void;
}

type Step = "enter-key" | "downloading" | "done";

export default function FirstLaunchModal({ onActivated }: Props) {
  const [visible, setVisible] = useState(false);
  const [devFallback, setDevFallback] = useState(false);
  const [step, setStep] = useState<Step>("enter-key");
  const [licenseKey, setLicenseKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ percent: number; received: number; total: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (typeof window.deepbrew === "undefined") {
      // Dev mode or web: show old static-link fallback
      if (localStorage.getItem("mtg.firstLaunch") === "1") {
        setDevFallback(true);
        setVisible(true);
      }
      return;
    }

    // Pro tier is handled entirely by LicenseModal — do nothing here
    if (window.deepbrew.tier !== "starter") return;

    // Show if no license record exists yet
    window.deepbrew.getLicenseStatus().then((rec) => {
      if (!rec) {
        setVisible(true);
      } else {
        onActivated?.();
      }
    });
  }, []);

  async function handleActivate() {
    setError(null);
    setBusy(true);
    try {
      const result = await window.deepbrew?.activateLicense(licenseKey.trim());
      if (!result?.ok) throw new Error("Activation failed.");
      // Immediately start downloading the Starter model — no choice needed
      setStep("downloading");
      setProgress({ percent: 0, received: 0, total: 0 });

      cleanupRef.current = window.deepbrew?.onDownloadProgress((d) => {
        setProgress(d);
      }) ?? null;

      await window.deepbrew?.downloadModel("mistral-commander-q4.gguf");
      await window.deepbrew?.setActiveModel("mistral-commander-q4.gguf");
      setStep("done");
      onActivated?.();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Something went wrong. Please try again.";
      setError(msg);
      if (step === "downloading") setStep("enter-key");
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

  function dismissDevFallback() {
    localStorage.removeItem("mtg.firstLaunch");
    setVisible(false);
  }

  function copyPath() {
    navigator.clipboard.writeText(MODELS_PATH).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  if (!visible) return null;

  // ── Dev / web fallback (no Electron bridge) ───────────────────────────────
  if (devFallback) {
    return (
      <div className="lm-overlay" role="dialog" aria-modal="true" aria-label="Welcome — model setup">
        <div className="lm-modal" style={{ maxWidth: 640, maxHeight: "90vh", overflowY: "auto", alignItems: "flex-start" }}>
          <div className="lm-icon" style={{ alignSelf: "center" }}>🃏</div>
          <h2 className="lm-title" style={{ alignSelf: "center" }}>Welcome — Get Your AI Model</h2>
          <p className="lm-intro" style={{ textAlign: "left" }}>
            Download a <strong>.gguf</strong> model file from Hugging Face and place it in your AppData folder.
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", marginBottom: "1rem" }}>
            <thead>
              <tr>
                {["Model", "File", "Size", "Best For", "Download"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #333", color: "#888" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { name: "Mistral 7B", badge: "Recommended", file: "mistral-commander-q4.gguf", size: "~4.1 GB", best: "Most users / 6 GB+ VRAM", href: HF_7B },
                { name: "Nemo 12B Q3", file: "mtg-commander-nemo-q3_k_m.gguf", size: "~6 GB", best: "8 GB VRAM", href: HF_12B },
                { name: "Nemo 12B Q4", file: "mtg-commander-nemo-q4_k_m.gguf", size: "~7.5 GB", best: "10 GB+ VRAM", href: HF_12B },
              ].map(row => (
                <tr key={row.file}>
                  <td style={{ padding: "7px 8px", borderBottom: "1px solid #1e1e2e", color: "#fff" }}>
                    <strong>{row.name}</strong>
                    {row.badge && <span style={{ background: "#3b2f6e", color: "#c0a0ff", fontSize: "0.66rem", padding: "1px 6px", borderRadius: 10, marginLeft: 5 }}>{row.badge}</span>}
                  </td>
                  <td style={{ padding: "7px 8px", borderBottom: "1px solid #1e1e2e" }}><code style={{ background: "#2a2540", padding: "1px 4px", borderRadius: 3, color: "#d0b0ff" }}>{row.file}</code></td>
                  <td style={{ padding: "7px 8px", borderBottom: "1px solid #1e1e2e", color: "#9ca3af" }}>{row.size}</td>
                  <td style={{ padding: "7px 8px", borderBottom: "1px solid #1e1e2e", color: "#9ca3af" }}>{row.best}</td>
                  <td style={{ padding: "7px 8px", borderBottom: "1px solid #1e1e2e" }}><a href={row.href} target="_blank" rel="noreferrer" style={{ color: "#00ffd1" }}>Hugging Face ↗</a></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="lm-intro" style={{ textAlign: "left" }}>
            Place the file in: <code style={{ background: "#2a2540", padding: "2px 6px", borderRadius: 4, color: "#d0b0ff" }}>{MODELS_PATH}</code>{" "}
            <button onClick={copyPath} style={{ background: "#3b2f6e", color: "#c0a0ff", border: "1px solid #5a4a8e", borderRadius: 6, padding: "3px 10px", fontSize: "0.78rem", cursor: "pointer" }}>
              {copied ? "✓ Copied!" : "Copy Path"}
            </button>
          </p>
          <button className="lm-btn-primary" onClick={dismissDevFallback}>Got it — I'll set this up</button>
        </div>
      </div>
    );
  }

  // ── Electron Starter license flow ─────────────────────────────────────────
  return (
    <div className="lm-overlay" role="dialog" aria-modal="true" aria-label="Activate DeepBrew Starter">
      <div className="lm-modal">

        {/* Enter key */}
        {step === "enter-key" && (
          <>
            <div className="lm-icon">🔑</div>
            <h2 className="lm-title">Activate DeepBrew Starter</h2>
            <p className="lm-intro">
              Enter the license key from your purchase confirmation email. Your AI model (~4.1 GB) will download automatically after activation.
            </p>
            <input
              className="lm-input"
              type="text"
              placeholder="XXXX-XXXX-XXXX-XXXX"
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && licenseKey.trim() && handleActivate()}
              autoFocus
              spellCheck={false}
            />
            {error && <p className="lm-error">{error}</p>}
            <button
              className="lm-btn-primary"
              onClick={handleActivate}
              disabled={busy || !licenseKey.trim()}
            >
              {busy ? "Activating…" : "Activate & Download Model"}
            </button>
            <p className="lm-footer">
              Don't have a license?{" "}
              <a href="https://deepbrewmtg.com/#pricing" target="_blank" rel="noopener noreferrer">
                Get DeepBrew ↗
              </a>
            </p>
          </>
        )}

        {/* Downloading */}
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

        {/* Done */}
        {step === "done" && (
          <>
            <div className="lm-icon">🎉</div>
            <h2 className="lm-title">Ready to Brew!</h2>
            <p className="lm-intro">
              Your model has been downloaded and activated. The AI engine will load automatically.
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
