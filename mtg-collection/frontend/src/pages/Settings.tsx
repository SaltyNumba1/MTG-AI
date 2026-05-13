import { useState } from "react";
import "./Settings.css";
import { useSettings, SETTINGS_DEFAULTS } from "../hooks/useSettings";

const D = SETTINGS_DEFAULTS;

const save = (key: string, value: string | number | boolean) =>
  localStorage.setItem(key, String(value));

export default function Settings() {
  const initial = useSettings();

  // GPU Performance
  const [maxCompact, setMaxCompact] = useState(initial.maxCompactCandidates);
  const [numPredict, setNumPredict] = useState(initial.numPredict);

  // Deck Building Defaults
  const [basicLand, setBasicLand] = useState(initial.defaultBasicLand);
  const [nonbasicLand, setNonbasicLand] = useState(initial.defaultNonbasicLand);
  const [dualLand, setDualLand] = useState(initial.defaultDualLand);
  const [bracket, setBracket] = useState(initial.defaultBracket);
  const [strictMode, setStrictMode] = useState(initial.defaultStrictMode);
  const [tappedLandMax, setTappedLandMax] = useState(initial.defaultTappedLandMax);

  // Display
  const [showPrices, setShowPrices] = useState(initial.showPrices);
  const [defaultSort, setDefaultSort] = useState(initial.defaultSort);

  const handleReset = () => {
    setMaxCompact(D.maxCompactCandidates); save("deepbrew_max_compact_candidates", D.maxCompactCandidates);
    setNumPredict(D.numPredict);           save("deepbrew_num_predict", D.numPredict);
    setBasicLand(D.defaultBasicLand);     save("deepbrew_default_basic_land", D.defaultBasicLand);
    setNonbasicLand(D.defaultNonbasicLand); save("deepbrew_default_nonbasic_land", D.defaultNonbasicLand);
    setDualLand(D.defaultDualLand);       save("deepbrew_default_dual_land", D.defaultDualLand);
    setBracket(D.defaultBracket);         save("deepbrew_default_bracket", D.defaultBracket);
    setStrictMode(D.defaultStrictMode);   save("deepbrew_default_strict_mode", D.defaultStrictMode);
    setTappedLandMax(D.defaultTappedLandMax); save("deepbrew_default_tapped_land_max", D.defaultTappedLandMax);
    setShowPrices(D.showPrices);          save("deepbrew_show_prices", D.showPrices);
    setDefaultSort(D.defaultSort);        save("deepbrew_default_sort", D.defaultSort);
  };

  return (
    <div className="page">
      <h1 className="page-title">Settings</h1>

      {/* ── GPU Performance ──────────────────────────────────── */}
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
            sent to the AI. Lower values reduce VRAM usage; higher values give the model richer context.
            <br />
            <strong>Recommended:</strong> 200 for 4–8 GB · 300 for 10–12 GB · 400+ for 16 GB+
          </p>
          <input
            type="range" min={50} max={500} step={25} value={maxCompact}
            title="Oracle Text Threshold"
            onChange={(e) => { const v = parseInt(e.target.value); setMaxCompact(v); save("deepbrew_max_compact_candidates", v); }}
            className="settings-slider"
          />
          <div className="settings-slider-labels">
            <span>50 — Minimum VRAM</span><span>500 — Maximum Context</span>
          </div>
        </div>

        <div className="settings-field">
          <div className="settings-label-row">
            <label className="settings-label">Max Response Tokens</label>
            <span className="settings-value">{numPredict} tokens</span>
          </div>
          <p className="settings-desc">
            Maximum tokens the AI can generate per deck or analysis. A full 99-card JSON response
            typically needs 1,500–2,500 tokens. Truncated responses fall back to partial parsing.
            <br />
            <strong>Recommended:</strong> 2048 for most setups · 1024 if very slow · 3072+ for large collections
          </p>
          <input
            type="range" min={512} max={4096} step={256} value={numPredict}
            title="Max Response Tokens"
            onChange={(e) => { const v = parseInt(e.target.value); setNumPredict(v); save("deepbrew_num_predict", v); }}
            className="settings-slider"
          />
          <div className="settings-slider-labels">
            <span>512 — Minimal (4 GB GPU)</span><span>4096 — Maximum</span>
          </div>
        </div>
      </div>

      {/* ── Deck Building Defaults ───────────────────────────── */}
      <div className="settings-section">
        <h2 className="settings-section-title">Deck Building Defaults</h2>
        <p className="settings-hint">
          These pre-fill the Deck Builder form every time you open it. You can still override them per build.
        </p>

        <div className="settings-fields-row">
          <div className="settings-field settings-field--compact">
            <div className="settings-label-row">
              <label className="settings-label">Basic Lands</label>
              <span className="settings-value">{basicLand}</span>
            </div>
            <input
              type="range" min={0} max={40} step={1} value={basicLand}
              title="Default Basic Land Count"
              onChange={(e) => { const v = parseInt(e.target.value); setBasicLand(v); save("deepbrew_default_basic_land", v); }}
              className="settings-slider"
            />
            <div className="settings-slider-labels"><span>0</span><span>40</span></div>
          </div>

          <div className="settings-field settings-field--compact">
            <div className="settings-label-row">
              <label className="settings-label">Nonbasic Lands</label>
              <span className="settings-value">{nonbasicLand}</span>
            </div>
            <input
              type="range" min={0} max={30} step={1} value={nonbasicLand}
              title="Default Nonbasic Land Count"
              onChange={(e) => { const v = parseInt(e.target.value); setNonbasicLand(v); save("deepbrew_default_nonbasic_land", v); }}
              className="settings-slider"
            />
            <div className="settings-slider-labels"><span>0</span><span>30</span></div>
          </div>

          <div className="settings-field settings-field--compact">
            <div className="settings-label-row">
              <label className="settings-label">Dual Lands</label>
              <span className="settings-value">{dualLand}</span>
            </div>
            <input
              type="range" min={0} max={20} step={1} value={dualLand}
              title="Default Dual Land Count"
              onChange={(e) => { const v = parseInt(e.target.value); setDualLand(v); save("deepbrew_default_dual_land", v); }}
              className="settings-slider"
            />
            <div className="settings-slider-labels"><span>0</span><span>20</span></div>
          </div>

          <div className="settings-field settings-field--compact">
            <div className="settings-label-row">
              <label className="settings-label">Tapped Land Cap</label>
              <span className="settings-value">{tappedLandMax === 0 ? "Off" : tappedLandMax}</span>
            </div>
            <input
              type="range" min={0} max={15} step={1} value={tappedLandMax}
              title="Default Tapped Land Cap"
              onChange={(e) => { const v = parseInt(e.target.value); setTappedLandMax(v); save("deepbrew_default_tapped_land_max", v); }}
              className="settings-slider"
            />
            <div className="settings-slider-labels"><span>Off</span><span>15</span></div>
          </div>
        </div>

        <div className="settings-field">
          <label className="settings-label">Default Bracket</label>
          <p className="settings-desc">Power level preset applied to every new build.</p>
          <div className="settings-radio-row">
            {[
              { value: 0, label: "None" },
              { value: 1, label: "1 — Casual" },
              { value: 2, label: "2" },
              { value: 3, label: "3 — Mid" },
              { value: 4, label: "4" },
              { value: 5, label: "5 — cEDH" },
            ].map(({ value, label }) => (
              <label key={value} className="settings-radio-label">
                <input
                  type="radio"
                  name="default-bracket"
                  value={value}
                  checked={bracket === value}
                  onChange={() => { setBracket(value); save("deepbrew_default_bracket", value); }}
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="settings-field">
          <label className="settings-toggle-label">
            <input
              type="checkbox"
              checked={strictMode}
              onChange={(e) => { setStrictMode(e.target.checked); save("deepbrew_default_strict_mode", e.target.checked); }}
              className="settings-toggle"
            />
            <span>Strict synergy mode by default</span>
          </label>
          <p className="settings-desc settings-desc--mt">
            When on, the AI prioritises keyword-matching cards over the general pool. Useful for
            players who always build focused tribal or combo decks.
          </p>
        </div>
      </div>

      {/* ── Display ──────────────────────────────────────────── */}
      <div className="settings-section">
        <h2 className="settings-section-title">Display</h2>

        <div className="settings-field">
          <label className="settings-toggle-label">
            <input
              type="checkbox"
              checked={showPrices}
              onChange={(e) => { setShowPrices(e.target.checked); save("deepbrew_show_prices", e.target.checked); }}
              className="settings-toggle"
            />
            <span>Show TCGPlayer prices on cards</span>
          </label>
        </div>

        <div className="settings-field">
          <label className="settings-label">Default card sort in My Decks</label>
          <div className="settings-radio-row settings-radio-row--mt">
            {(["type", "cmc", "name", "price"] as const).map((s) => (
              <label key={s} className="settings-radio-label">
                <input
                  type="radio"
                  name="default-sort"
                  value={s}
                  checked={defaultSort === s}
                  onChange={() => { setDefaultSort(s); save("deepbrew_default_sort", s); }}
                />
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </label>
            ))}
          </div>
        </div>
      </div>

      <button className="btn-secondary" onClick={handleReset}>
        Reset All to Defaults
      </button>
    </div>
  );
}
