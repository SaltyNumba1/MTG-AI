import { useEffect, useRef, useState } from "react";
import MTG_KEYWORDS from "../mtg_keywords";
import api from "../api";
import CardPreview from "../components/CardPreview";
import "./DeckBuilder.css";

interface Commander {
  id: string;
  name: string;
  color_identity: string[];
  image_uri: string;
  tcgplayer_price?: string | null;
}

interface CardEntry {
  id: string;
  name: string;
  type_line: string;
  cmc: number;
  image_uri: string;
  color_identity: string[];
  tcgplayer_price?: string | null;
}

interface DeckResult {
  commander: CardEntry;
  deck: CardEntry[];
  description: string;
}

interface BuildThought {
  time: string;
  message: string;
}

interface BuildStatus {
  active: boolean;
  phase: string;
  message: string;
  started_at: string | null;
  finished_at: string | null;
  last_activity_at: string | null;
  thoughts: BuildThought[];
}

const COLOR_SYMBOLS: Record<string, string> = {
  W: "☀️", U: "💧", B: "💀", R: "🔥", G: "🌲",
};

const COLOR_NAMES: Record<string, string> = {
  W: "Plains",
  U: "Island",
  B: "Swamp",
  R: "Mountain",
  G: "Forest",
};

function groupByType(cards: CardEntry[]): Record<string, CardEntry[]> {
  const groups: Record<string, CardEntry[]> = {};
  for (const card of cards) {
    const type = card.type_line?.split("—")[0].trim() || "Other";
    if (!groups[type]) groups[type] = [];
    groups[type].push(card);
  }
  return groups;
}

function manaCurve(cards: CardEntry[]) {
  const buckets: Record<string, number> = {
    "0": 0,
    "1": 0,
    "2": 0,
    "3": 0,
    "4": 0,
    "5": 0,
    "6": 0,
    "7+": 0,
  };
  for (const card of cards) {
    const cmc = Number(card.cmc || 0);
    if (cmc >= 7) buckets["7+"] += 1;
    else buckets[String(Math.max(0, Math.floor(cmc)))] += 1;
  }
  return buckets;
}

function colorDistribution(cards: CardEntry[]) {
  const dist: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const card of cards) {
    for (const color of card.color_identity || []) {
      if (dist[color] !== undefined) dist[color] += 1;
    }
  }
  return dist;
}

function suggestBasics(dist: Record<string, number>, totalLands = 37) {
  const total = Object.values(dist).reduce((acc, n) => acc + n, 0);
  if (total === 0) return [{ name: "Wastes", count: totalLands }];

  const entries = Object.entries(dist).filter(([, v]) => v > 0);
  const base = entries.map(([c, v]) => ({ color: c, exact: (v / total) * totalLands }));
  const floored = base.map((x) => ({ color: x.color, count: Math.floor(x.exact), frac: x.exact - Math.floor(x.exact) }));
  let used = floored.reduce((acc, x) => acc + x.count, 0);
  let remain = totalLands - used;

  floored.sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < floored.length && remain > 0; i += 1) {
    floored[i].count += 1;
    remain -= 1;
  }

  return floored
    .filter((x) => x.count > 0)
    .map((x) => ({ name: COLOR_NAMES[x.color] || x.color, count: x.count }));
}

export default function DeckBuilder() {
  const [commanders, setCommanders] = useState<Commander[]>([]);
  const [selectedCommander, setSelectedCommander] = useState("");
  const [prompt, setPrompt] = useState("");
  const [basicLandCount, setBasicLandCount] = useState(25);
  const [nonbasicLandCount, setNonbasicLandCount] = useState(12);
  const [building, setBuilding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<DeckResult | null>(null);
  const [error, setError] = useState("");
  const [saveMessage, setSaveMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [buildStatus, setBuildStatus] = useState<BuildStatus | null>(null);
  const [keywordFilters, setKeywordFilters] = useState<string[]>([""]);
  const DEFAULT_MUST_INCLUDE = '"Sol Ring" "Arcane Signet" "Commander\'s Sphere" "Path of Ancestry" "Command Tower"';
  const [mustIncludeText, setMustIncludeText] = useState<string>(DEFAULT_MUST_INCLUDE);
  const [isHung, setIsHung] = useState(false);
  const [resetting, setResetting] = useState(false);
  const hungCheckRef = useRef<number | null>(null);

  // HUNG_THRESHOLD_MS: if build is active and last_activity_at hasn't updated
  // in this many ms, the model is considered hung. Heartbeat fires every 8s,
  // so 45s means 5+ missed heartbeats.
  const HUNG_THRESHOLD_MS = 45_000;

  useEffect(() => {
    api.get<Commander[]>("/deck/commanders").then(({ data }) => setCommanders(data));
  }, []);

  useEffect(() => {
    if (!building) {
      setIsHung(false);
      if (hungCheckRef.current) window.clearInterval(hungCheckRef.current);
      return;
    }

    const pollStatus = async () => {
      try {
        const { data } = await api.get<BuildStatus>("/deck/build-status");
        setBuildStatus(data);

        // Detect hung: active build with stale last_activity_at
        if (data.active && data.last_activity_at) {
          const staleness = Date.now() - new Date(data.last_activity_at + "Z").getTime();
          setIsHung(staleness > HUNG_THRESHOLD_MS);
        } else {
          setIsHung(false);
        }
      } catch {
        // Keep deck build running even if status polling fails.
      }
    };

    pollStatus();
    const timer = window.setInterval(pollStatus, 1200);
    return () => window.clearInterval(timer);
  }, [building]);

  const handleBuild = async () => {
    if (!selectedCommander || !prompt.trim()) return;
    setBuilding(true);
    setError("");
    setSaveMessage(null);
    setResult(null);
    setBuildStatus({
      active: true,
      phase: "starting",
      message: "Preparing deck build",
      started_at: null,
      finished_at: null,
      last_activity_at: null,
      thoughts: [],
    });

    try {
      const mustIncludeCards = Array.from(
        new Set(
          (mustIncludeText.match(/"([^"]+)"/g) || [])
            .map((s) => s.slice(1, -1).trim())
            .filter(Boolean)
        )
      );

      const { data } = await api.post<DeckResult>("/deck/build", {
        commander_name: selectedCommander,
        prompt,
        basic_land_count: basicLandCount,
        nonbasic_land_count: nonbasicLandCount,
        keyword_filters: keywordFilters.filter((k) => k && k.trim()),
        must_include_cards: mustIncludeCards,
      });
      setResult(data);
      await saveDeckWithName(data, data.commander.name, true);
      try {
        const status = await api.get<BuildStatus>("/deck/build-status");
        setBuildStatus(status.data);
      } catch {
        // Ignore final status fetch failures.
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || "Deck generation failed");
    } finally {
      setBuilding(false);
      setIsHung(false);
    }
  };

  const handleReset = async () => {
    if (!isHung) return;
    setResetting(true);
    try {
      await api.post("/deck/reset");
      setBuilding(false);
      setIsHung(false);
      setError("Build was force-reset. The model may still be processing in the background — wait a moment before starting a new build.");
    } catch {
      setError("Reset request failed. Try restarting the backend server.");
    } finally {
      setResetting(false);
    }
  };

  const exportDecklist = () => {
    if (!result) return;
    const lines = [
      `1 ${result.commander.name} *CMDR*`,
      "",
      ...result.deck.map((card) => `1 ${card.name}`),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.commander.name.replace(/\s+/g, "_")}_deck.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveDeckWithName = async (
    deckResult: DeckResult,
    deckName: string,
    autoSave = false,
  ) => {
    setSaving(true);
    setSaveMessage(null);
    try {
      const { data } = await api.post("/deck/save", {
        name: deckName,
        prompt,
        commander: deckResult.commander,
        deck: deckResult.deck,
        description: deckResult.description,
      });

      if (autoSave) {
        setSaveMessage({
          type: "success",
          text: `Auto-saved to My Decks as ${deckResult.commander.name}`,
        });
      } else {
        setSaveMessage({
          type: "success",
          text: `Saved as ${data.json_file} and ${data.txt_file} in ${data.folder}`,
        });
      }
    } catch (err: any) {
      if (autoSave) {
        setSaveMessage({
          type: "error",
          text: err.response?.data?.detail || "Deck built, but auto-save failed",
        });
      } else {
        setSaveMessage({
          type: "error",
          text: err.response?.data?.detail || "Failed to save deck",
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const saveDeckToFolder = async () => {
    if (!result) return;

    const suggestedName = result.commander.name;
    const deckName = window.prompt("Save deck as:", suggestedName);
    if (deckName === null) return;
    await saveDeckWithName(result, deckName, false);
  };

  const groups = result ? groupByType(result.deck) : {};
  const curve = result ? manaCurve(result.deck) : null;
  const colors = result ? colorDistribution(result.deck) : null;
  const basics = colors ? suggestBasics(colors, basicLandCount) : [];
  const curveMax = curve ? Math.max(...Object.values(curve), 1) : 1;
  const colorMax = colors ? Math.max(...Object.values(colors), 1) : 1;
  const totalGeneratedCount = result ? result.deck.length + 1 : 0;
  const missingCount = Math.max(0, 100 - totalGeneratedCount);
  const estimatedCost = result
    ? [result.commander, ...result.deck].reduce((sum, card) => {
        const value = Number(card?.tcgplayer_price || 0);
        return Number.isFinite(value) ? sum + value : sum;
      }, 0)
    : 0;

  return (
    <div className="page">
      <h1 className="page-title">Build a Commander Deck</h1>

      <div className="deckbuilder-form">
        <div className="deckbuilder-filters-row">
          <div className="deckbuilder-filters-col">
            <label className="deckbuilder-label">
              Filter by MTG Keywords (assist AI synergy)
            </label>
            {keywordFilters.map((filter, idx) => (
              <div key={idx} className="deckbuilder-keyword-row">
                <select
                  value={filter}
                  onChange={e => {
                    const newFilters = [...keywordFilters];
                    newFilters[idx] = e.target.value;
                    setKeywordFilters(newFilters);
                  }}
                  className="deckbuilder-keyword-select"
                >
                  <option value="">- Select a keyword -</option>
                  {MTG_KEYWORDS.map((kw) => (
                    <option key={kw} value={kw}>{kw}</option>
                  ))}
                </select>
                {keywordFilters.length > 1 && (
                  <button
                    type="button"
                    className="deckbuilder-keyword-remove"
                    onClick={() => setKeywordFilters(keywordFilters.filter((_, i) => i !== idx))}
                  >
                    ✕
                  </button>
                )}
                {idx === keywordFilters.length - 1 && (
                  <button
                    type="button"
                    onClick={() => setKeywordFilters([...keywordFilters, ""])}
                    className="deckbuilder-keyword-add"
                  >
                    ＋
                  </button>
                )}
              </div>
            ))}
            <small className="deckbuilder-hint">
              These keywords help the AI suggest synergistic cards, but do not hard-filter the deck.
            </small>
          </div>
          <div className="deckbuilder-filters-col">
            <label className="deckbuilder-label">
              Must Include Cards
            </label>
            <textarea
              value={mustIncludeText}
              onChange={(e) => setMustIncludeText(e.target.value)}
              rows={5}
              spellCheck={false}
              placeholder={'"Sol Ring" "Arcane Signet" "Command Tower"'}
              className="deckbuilder-must-include"
            />
            <small className="deckbuilder-hint">
              Wrap each card name in double quotes. These will be force-included in the deck even if you don't own them
              (fetched from Scryfall). Lands among them count toward the nonbasic land count.
            </small>
          </div>
        </div>
        <div>
          <label className="deckbuilder-label">
            Commander
          </label>
          <select
            aria-label="Commander"
            value={selectedCommander}
            onChange={(e) => setSelectedCommander(e.target.value)}
          >
            <option value="">- Select a commander -</option>
            {commanders.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name} {(c.color_identity || []).map((x) => COLOR_SYMBOLS[x] || x).join("")}
              </option>
            ))}
          </select>
          {commanders.length === 0 && (
            <small className="deckbuilder-hint">
              No legal legendary commanders found in your collection.
            </small>
          )}
        </div>

        <div>
          <label className="deckbuilder-label">
            Deck prompt
          </label>
          <textarea
            rows={3}
            placeholder="e.g. Build an aggressive token swarm deck focused on go-wide strategies and anthem effects"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        <div className="deckbuilder-lands-row">
          <div>
            <label className="deckbuilder-label">
              Number of Basic Lands
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={basicLandCount}
              onChange={e => setBasicLandCount(Number(e.target.value))}
              className="deckbuilder-land-input"
            />
          </div>
          <div>
            <label className="deckbuilder-label">
              Number of Nonbasic Lands
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={nonbasicLandCount}
              onChange={e => setNonbasicLandCount(Number(e.target.value))}
              className="deckbuilder-land-input"
            />
          </div>
        </div>

        <button
          className="btn-primary deckbuilder-generate-btn"
          onClick={handleBuild}
          disabled={building || !selectedCommander || !prompt.trim()}
        >
          {building ? "Building deck... (this may take ~30s)" : "Generate Deck"}
        </button>

        {isHung && (
          <button
            onClick={handleReset}
            disabled={resetting}
            className="deckbuilder-reset-btn"
            title="The model has not responded in 45+ seconds and is considered hung. Click to reset."
          >
            {resetting ? "Resetting..." : "⚠️ Force Reset Model"}
          </button>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {saveMessage && <div className={`alert alert-${saveMessage.type}`}>{saveMessage.text}</div>}

      {(building || (buildStatus?.thoughts?.length ?? 0) > 0) && (
        <div className="alert alert-info deckbuilder-build-progress">
          <div className="deckbuilder-build-progress-title">AI Build Process</div>
          <small className="deckbuilder-build-progress-msg">
            {buildStatus?.message || "Deck builder is working..."}
          </small>
          <div className="deckbuilder-thoughts">
            {(buildStatus?.thoughts || []).map((thought, idx) => (
              <small key={`${thought.time}-${idx}`} className="deckbuilder-thought">
                {new Date(thought.time).toLocaleTimeString()} - {thought.message}
              </small>
            ))}
          </div>
        </div>
      )}

      {result && (
        <div>
          <div className="deckbuilder-result-header">
            <CardPreview
              name={result.commander.name}
              imageUri={result.commander.image_uri}
              subtitle="Commander"
              tcgplayerPrice={result.commander.tcgplayer_price}
            />
            <div>
              <h2 className="deckbuilder-result-title">
                {result.commander.name} Commander Deck
              </h2>
              <p className="deckbuilder-result-desc">
                {result.description}
              </p>
              <div style={{ color: missingCount === 0 ? "#86efac" : "#fca5a5", marginBottom: 10, fontSize: 13 }}>
                Total Cards: {totalGeneratedCount}/100
                {missingCount > 0 ? ` (${missingCount} missing)` : " (complete)"}
              </div>
              <div className="deckbuilder-result-cost">
                Estimated Deck Cost (TCG low): ${estimatedCost.toFixed(2)}
              </div>
              <button className="btn-secondary" onClick={exportDecklist}>
                Export Decklist (.txt)
              </button>
              <button
                className="btn-primary deckbuilder-save-btn"
                onClick={saveDeckToFolder}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save Deck"}
              </button>
            </div>
          </div>

          <div className="deckbuilder-stats-row">
            <div className="deckbuilder-stats-card">
              <h3 className="deckbuilder-stats-heading">Mana Curve</h3>
              {curve && Object.entries(curve).map(([bucket, count]) => (
                <div key={bucket} className="deckbuilder-stats-item">
                  <span className="deckbuilder-stats-label">{bucket}</span>
                  <div className="deckbuilder-stats-bar-bg">
                    <div
                      style={{
                        height: "100%",
                        width: `${(count / curveMax) * 100}%`,
                        background: "linear-gradient(90deg, #22c55e, #14b8a6)",
                      }}
                    />
                  </div>
                  <span className="deckbuilder-stats-count">{count}</span>
                </div>
              ))}
            </div>

            <div className="deckbuilder-stats-card">
              <h3 className="deckbuilder-stats-heading">Color Distribution</h3>
              {colors && Object.entries(colors).filter(([, v]) => v > 0).map(([color, count]) => (
                <div key={color} className="deckbuilder-stats-item">
                  <span className="deckbuilder-stats-label">{COLOR_SYMBOLS[color] || color}</span>
                  <div className="deckbuilder-stats-bar-bg">
                    <div
                      style={{
                        height: "100%",
                        width: `${(count / colorMax) * 100}%`,
                        background: "linear-gradient(90deg, #f59e0b, #ef4444)",
                      }}
                    />
                  </div>
                  <span className="deckbuilder-stats-count">{count}</span>
                </div>
              ))}
            </div>

            <div className="deckbuilder-stats-card">
              <h3 className="deckbuilder-stats-heading">Suggested Basic Lands ({basicLandCount})</h3>
              <div className="deckbuilder-basics-list">
                {basics.map((b) => (
                  <div key={b.name} className="deckbuilder-basics-row">
                    <span>{b.name}</span>
                    <strong>{b.count}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {Object.entries(groups)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([type, cards]) => (
              <div key={type} className="deckbuilder-type-group">
                <h3 className="deckbuilder-stats-heading">
                  {type} ({cards.length})
                </h3>
                <div className="card-grid">
                  {cards.map((card) => (
                    <CardPreview
                      key={card.id + card.name}
                      name={card.name}
                      imageUri={card.image_uri}
                      subtitle={`CMC ${card.cmc}`}
                      tcgplayerPrice={card.tcgplayer_price}
                    />
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
