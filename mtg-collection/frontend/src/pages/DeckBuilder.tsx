import { useEffect, useState } from "react";
import api from "../api";

interface Commander {
  id: string;
  name: string;
  color_identity: string[];
  image_uri: string;
}

interface CardEntry {
  id: string;
  name: string;
  type_line: string;
  cmc: number;
  image_uri: string;
  color_identity: string[];
}

interface DeckResult {
  commander: CardEntry;
  deck: CardEntry[];
  description: string;
}

interface SavedDeckSummary {
  file: string;
  name: string;
  saved_at: string | null;
  commander: string;
  card_count: number;
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
  const [building, setBuilding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<DeckResult | null>(null);
  const [error, setError] = useState("");
  const [saveMessage, setSaveMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [savedDecks, setSavedDecks] = useState<SavedDeckSummary[]>([]);

  const loadSavedDecks = async () => {
    try {
      const { data } = await api.get<SavedDeckSummary[]>("/deck/saved");
      setSavedDecks(data);
    } catch {
      // Ignore saved deck listing errors so builder still works.
    }
  };

  useEffect(() => {
    api.get<Commander[]>("/deck/commanders").then(({ data }) => setCommanders(data));
    loadSavedDecks();
  }, []);

  const handleBuild = async () => {
    if (!selectedCommander || !prompt.trim()) return;
    setBuilding(true);
    setError("");
    setResult(null);
    try {
      const { data } = await api.post<DeckResult>("/deck/build", {
        commander_name: selectedCommander,
        prompt,
      });
      setResult(data);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Deck generation failed");
    } finally {
      setBuilding(false);
    }
  };

  const exportDecklist = () => {
    if (!result) return;
    const lines = [
      `1 ${result.commander.name}`,
      "",
      ...result.deck.map((c) => `1 ${c.name}`),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.commander.name.replace(/\s+/g, "_")}_deck.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveDeckToFolder = async () => {
    if (!result) return;

    const suggestedName = `${result.commander.name} Deck`;
    const deckName = window.prompt("Save deck as:", suggestedName);
    if (deckName === null) return;

    setSaving(true);
    setSaveMessage(null);
    try {
      const { data } = await api.post("/deck/save", {
        name: deckName,
        prompt,
        commander: result.commander,
        deck: result.deck,
        description: result.description,
      });
      setSaveMessage({
        type: "success",
        text: `Saved as ${data.json_file} and ${data.txt_file} in ${data.folder}`,
      });
      await loadSavedDecks();
    } catch (err: any) {
      setSaveMessage({ type: "error", text: err.response?.data?.detail || "Failed to save deck" });
    } finally {
      setSaving(false);
    }
  };

  const groups = result ? groupByType(result.deck) : {};
  const curve = result ? manaCurve(result.deck) : null;
  const colors = result ? colorDistribution(result.deck) : null;
  const basics = colors ? suggestBasics(colors, 37) : [];
  const curveMax = curve ? Math.max(...Object.values(curve), 1) : 1;
  const colorMax = colors ? Math.max(...Object.values(colors), 1) : 1;

  return (
    <div className="page">
      <h1 className="page-title">Build a Commander Deck</h1>

      <div style={{ display: "grid", gap: 16, maxWidth: 600, marginBottom: 24 }}>
        <div>
          <label style={{ display: "block", marginBottom: 6, fontSize: 13, color: "#94a3b8" }}>
            Commander
          </label>
          <select
            aria-label="Commander"
            value={selectedCommander}
            onChange={(e) => setSelectedCommander(e.target.value)}
          >
            <option value="">— Select a commander —</option>
            {commanders.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name} {(c.color_identity || []).map((x) => COLOR_SYMBOLS[x] || x).join("")}
              </option>
            ))}
          </select>
          {commanders.length === 0 && (
            <small style={{ color: "#64748b" }}>
              No legendary creatures found in your collection.
            </small>
          )}
        </div>

        <div>
          <label style={{ display: "block", marginBottom: 6, fontSize: 13, color: "#94a3b8" }}>
            Deck prompt
          </label>
          <textarea
            rows={3}
            placeholder="e.g. Build an aggressive token swarm deck focused on go-wide strategies and anthem effects"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        <button
          className="btn-primary"
          onClick={handleBuild}
          disabled={building || !selectedCommander || !prompt.trim()}
          style={{ width: "fit-content" }}
        >
          {building ? "Building deck... (this may take ~30s)" : "Generate Deck"}
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {saveMessage && <div className={`alert alert-${saveMessage.type}`}>{saveMessage.text}</div>}

      {result && (
        <div>
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap" }}>
            {result.commander.image_uri && (
              <img
                src={result.commander.image_uri}
                alt={result.commander.name}
                style={{ width: 180, borderRadius: 8 }}
              />
            )}
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: "#a78bfa", marginBottom: 8 }}>
                {result.commander.name} Commander Deck
              </h2>
              <p style={{ color: "#94a3b8", marginBottom: 12, maxWidth: 500 }}>
                {result.description}
              </p>
              <button className="btn-secondary" onClick={exportDecklist}>
                Export Decklist (.txt)
              </button>
              <button
                className="btn-primary"
                onClick={saveDeckToFolder}
                disabled={saving}
                style={{ marginLeft: 8 }}
              >
                {saving ? "Saving..." : "Save Deck"}
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", marginBottom: 24 }}>
            <div style={{ border: "1px solid #334155", borderRadius: 8, padding: 12, background: "#16213e" }}>
              <h3 style={{ fontSize: 15, color: "#c4b5fd", marginBottom: 10 }}>Mana Curve</h3>
              {curve && Object.entries(curve).map(([bucket, count]) => (
                <div key={bucket} style={{ display: "grid", gridTemplateColumns: "30px 1fr 26px", gap: 8, alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: "#94a3b8" }}>{bucket}</span>
                  <div style={{ height: 10, borderRadius: 999, background: "#0f172a", overflow: "hidden" }}>
                    <div
                      style={{
                        height: "100%",
                        width: `${(count / curveMax) * 100}%`,
                        background: "linear-gradient(90deg, #22c55e, #14b8a6)",
                      }}
                    />
                  </div>
                  <span style={{ fontSize: 12, color: "#e2e8f0", textAlign: "right" }}>{count}</span>
                </div>
              ))}
            </div>

            <div style={{ border: "1px solid #334155", borderRadius: 8, padding: 12, background: "#16213e" }}>
              <h3 style={{ fontSize: 15, color: "#c4b5fd", marginBottom: 10 }}>Color Distribution</h3>
              {colors && Object.entries(colors).filter(([, v]) => v > 0).map(([color, count]) => (
                <div key={color} style={{ display: "grid", gridTemplateColumns: "30px 1fr 26px", gap: 8, alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: "#94a3b8" }}>{COLOR_SYMBOLS[color] || color}</span>
                  <div style={{ height: 10, borderRadius: 999, background: "#0f172a", overflow: "hidden" }}>
                    <div
                      style={{
                        height: "100%",
                        width: `${(count / colorMax) * 100}%`,
                        background: "linear-gradient(90deg, #f59e0b, #ef4444)",
                      }}
                    />
                  </div>
                  <span style={{ fontSize: 12, color: "#e2e8f0", textAlign: "right" }}>{count}</span>
                </div>
              ))}
            </div>

            <div style={{ border: "1px solid #334155", borderRadius: 8, padding: 12, background: "#16213e" }}>
              <h3 style={{ fontSize: 15, color: "#c4b5fd", marginBottom: 10 }}>Suggested Basic Lands (37)</h3>
              <div style={{ display: "grid", gap: 6 }}>
                {basics.map((b) => (
                  <div key={b.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
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
              <div key={type} style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 15, color: "#c4b5fd", marginBottom: 10 }}>
                  {type} ({cards.length})
                </h3>
                <div className="card-grid">
                  {cards.map((card) => (
                    <div key={card.id + card.name} className="mtg-card">
                      {card.image_uri ? (
                        <img src={card.image_uri} alt={card.name} loading="lazy" />
                      ) : (
                        <div
                          style={{
                            height: 100,
                            background: "#0f172a",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 11,
                            color: "#64748b",
                          }}
                        >
                          No image
                        </div>
                      )}
                      <div className="card-info">
                        <div className="card-name">{card.name}</div>
                        <div style={{ color: "#94a3b8", fontSize: 11 }}>CMC {card.cmc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}

      <div style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 18, color: "#c4b5fd", marginBottom: 10 }}>Saved Decks</h2>
        {savedDecks.length === 0 ? (
          <small style={{ color: "#94a3b8" }}>No saved decks yet.</small>
        ) : (
          <div style={{ display: "grid", gap: 8, maxWidth: 820 }}>
            {savedDecks.map((deck) => (
              <div
                key={deck.file}
                style={{
                  border: "1px solid #334155",
                  borderRadius: 8,
                  padding: "10px 12px",
                  background: "#16213e",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div style={{ fontWeight: 700 }}>{deck.name}</div>
                  <small style={{ color: "#94a3b8" }}>
                    Commander: {deck.commander || "Unknown"} | Cards: {deck.card_count}
                  </small>
                </div>
                <small style={{ color: "#94a3b8" }}>{deck.saved_at || ""}</small>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
