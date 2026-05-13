import { useState } from "react";
import "./Settings.css";

const DEFAULT_MAX_COMPACT = 200;
const DEFAULT_NUM_PREDICT = 2048;

export default function Settings() {
  const [maxCompact, setMaxCompact] = useState(() =>
    parseInt(localStorage.getItem("deepbrew_max_compact_candidates") || String(DEFAULT_MAX_COMPACT))
  );
  const [numPredict, setNumPredict] = useState(() =>
    parseInt(localStorage.getItem("deepbrew_num_predict") || String(DEFAULT_NUM_PREDICT))
  );

  const save = (key: string, value: number) => localStorage.setItem(key, String(value));

  return (
    <div className="page">
      <h1 className="page-title">Settings</h1>

      <div className="settings-section">
        <h2 className="settings-section-title">GPU Performance</h2>
        <p className="settings-hint">
          Adjust these based on your GPU's VRAM. Higher values improve AI context and output quality
          but require more GPU memory and increase generation time. Changes apply immediately to
          the next deck build or analysis.
        </p>

        <div className="settings-field">
          <div className="settings-label-row">
            <label className="settings-label">Oracle Text Threshold</label>
            <span className="settings-value">{maxCompact} cards</span>
          </div>
          <p className="settings-desc">
            When the candidate pool exceeds this number, oracle text is removed from card summaries
            sent to the AI. Lower values reduce VRAM usage; higher values give the model richer
            context to make better picks.
            <br />
            <strong>Recommended:</strong> 200 for 4–8 GB GPUs · 300 for 10–12 GB · 400+ for 16 GB+
          </p>
          <input
            type="range"
            min={50}
            max={500}
            step={25}
            value={maxCompact}
            title="Oracle Text Threshold"
            onChange={(e) => {
              const v = parseInt(e.target.value);
              setMaxCompact(v);
              save("deepbrew_max_compact_candidates", v);
            }}
            className="settings-slider"
          />
          <div className="settings-slider-labels">
            <span>50 — Minimum VRAM</span>
            <span>500 — Maximum Context</span>
          </div>
        </div>

        <div className="settings-field">
          <div className="settings-label-row">
            <label className="settings-label">Max Response Tokens</label>
            <span className="settings-value">{numPredict} tokens</span>
          </div>
          <p className="settings-desc">
            Maximum number of tokens the AI can generate per deck or analysis. Each token is
            roughly one word or symbol. A full 99-card JSON response typically needs 1 500–2 500
            tokens. Truncated responses fall back to partial parsing automatically.
            <br />
            <strong>Recommended:</strong> 2048 for most setups · 1024 if generation is very slow or crashes · 3072+ for large collections
          </p>
          <input
            type="range"
            min={512}
            max={4096}
            step={256}
            value={numPredict}
            title="Max Response Tokens"
            onChange={(e) => {
              const v = parseInt(e.target.value);
              setNumPredict(v);
              save("deepbrew_num_predict", v);
            }}
            className="settings-slider"
          />
          <div className="settings-slider-labels">
            <span>512 — Minimal (4 GB GPU)</span>
            <span>4096 — Maximum</span>
          </div>
        </div>

        <button
          className="btn-secondary"
          onClick={() => {
            setMaxCompact(DEFAULT_MAX_COMPACT);
            setNumPredict(DEFAULT_NUM_PREDICT);
            save("deepbrew_max_compact_candidates", DEFAULT_MAX_COMPACT);
            save("deepbrew_num_predict", DEFAULT_NUM_PREDICT);
          }}
        >
          Reset to Defaults
        </button>
      </div>
    </div>
  );
}
