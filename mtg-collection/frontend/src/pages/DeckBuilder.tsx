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

function groupByType(cards: CardEntry[]): Record<string, CardEntry[]> {
  const groups: Record<string, CardEntry[]> = {};
  for (const card of cards) {
    const type = card.type_line?.split("—")[0].trim() || "Other";
    if (!groups[type]) groups[type] = [];
    groups[type].push(card);
  }
  return groups;
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
