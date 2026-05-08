import { useEffect, useState } from "react";
import "./FirstLaunchModal.css";

const HF_7B = "https://huggingface.co/SaltyNumba1/MTG-Commander-Mistral-7B-Trained";
const HF_12B = "https://huggingface.co/SaltyNumba1/Mistral-nemo-12B-MTG-Commander";
const MODELS_PATH = "%APPDATA%\\mtg-collection-frontend\\models\\";

export default function FirstLaunchModal() {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (localStorage.getItem("mtg.firstLaunch") === "1") {
      setVisible(true);
    }
  }, []);

  function dismiss() {
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

  return (
    <div className="flm-overlay" role="dialog" aria-modal="true" aria-label="Welcome — model setup">
      <div className="flm-modal">
        <h2 className="flm-title">🃏 Welcome — Get Your AI Model</h2>
        <p className="flm-intro">
          To generate and analyze Commander decks, this app needs a{" "}
          <strong>.gguf</strong> model file downloaded from Hugging Face and
          placed in your AppData folder.
        </p>

        <table className="flm-table">
          <thead>
            <tr>
              <th>Model</th>
              <th>File</th>
              <th>Size</th>
              <th>Best For</th>
              <th>Download</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Mistral 7B</strong>{" "}
                <span className="flm-badge">Recommended</span>
              </td>
              <td><code>mistral-commander-q4.gguf</code></td>
              <td>~4.1 GB</td>
              <td>Most users, laptops, 6 GB+ VRAM</td>
              <td>
                <a href={HF_7B} target="_blank" rel="noreferrer">
                  Hugging Face ↗
                </a>
              </td>
            </tr>
            <tr>
              <td><strong>Nemo 12B Q3</strong></td>
              <td><code>mtg-commander-nemo-q3_k_m.gguf</code></td>
              <td>~6 GB</td>
              <td>Mid-range GPU (8 GB VRAM)</td>
              <td>
                <a href={HF_12B} target="_blank" rel="noreferrer">
                  Hugging Face ↗
                </a>
              </td>
            </tr>
            <tr>
              <td><strong>Nemo 12B Q4</strong></td>
              <td><code>mtg-commander-nemo-q4_k_m.gguf</code></td>
              <td>~7.5 GB</td>
              <td>High-end GPU (10 GB+ VRAM)</td>
              <td>
                <a href={HF_12B} target="_blank" rel="noreferrer">
                  Hugging Face ↗
                </a>
              </td>
            </tr>
          </tbody>
        </table>

        <div className="flm-steps">
          <p>
            <strong>Step 1:</strong> Download your chosen <code>.gguf</code>{" "}
            file from the link above.
          </p>
          <p>
            <strong>Step 2:</strong> Place it (without renaming) in this
            folder:
          </p>
          <div className="flm-path-row">
            <code className="flm-path">{MODELS_PATH}</code>
            <button className="flm-copy-btn" onClick={copyPath}>
              {copied ? "✓ Copied!" : "Copy Path"}
            </button>
          </div>
          <p className="flm-hint">
            Tip: paste this path into Windows Explorer's address bar or the
            Run dialog (Win&nbsp;+&nbsp;R) to open the folder directly.
          </p>
          <p>
            <strong>Step 3:</strong> Open <code>model-select.env</code> in
            that folder (created automatically on first launch) and uncomment
            the line matching your file. Then restart the app.
          </p>
        </div>

        <div className="flm-footer">
          <button className="flm-dismiss-btn" onClick={dismiss}>
            Got it — I'll set this up
          </button>
        </div>
      </div>
    </div>
  );
}
