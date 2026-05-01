import { useEffect, useState } from "react";
import api from "../api";
import CardPreview from "../components/CardPreview";
import "./MyDecks.css";

interface SavedDeckSummary {
  file: string;
  name: string;
  saved_at: string | null;
  commander: string;
  card_count: number;
}

interface CardEntry {
  id?: string;
  name: string;
  type_line?: string;
  cmc?: number;
  image_uri?: string;
  tcgplayer_price?: string | null;
}

interface SavedDeckDetail {
  name: string;
  prompt: string;
  description: string;
  saved_at: string | null;
  commander: CardEntry;
  deck: CardEntry[];
  card_count: number;
}

interface SwapPair {
  out: CardEntry | null;
  in: any;
}

export default function MyDecks() {
  const [showAnalyze, setShowAnalyze] = useState(false);
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [analyzeResult, setAnalyzeResult] = useState<string | null>(null);
  const [analyzeSuggestions, setAnalyzeSuggestions] = useState<SwapPair[]>([]);
  const [sortBy, setSortBy] = useState<"name" | "cmc" | "type" | "price">("type");
  const handleAnalyze = async () => {
    if (!selectedFile) return;
    setAnalyzeLoading(true);
    setAnalyzeResult(null);
    setAnalyzeSuggestions([]);
    try {
      const { data } = await api.post("/deck/analyze-deck", { deck_file: selectedFile });
      const description = data?.suggestions?.description || "No summary provided.";
      const suggestedDeck: any[] = Array.isArray(data?.suggestions?.deck) ? data.suggestions.deck : [];
      const currentNames = new Set((detail?.deck || []).map((c) => c.name.toLowerCase()));
      const swaps: SwapPair[] = [];
      const currentCards = (detail?.deck || []).slice();
      let cursor = currentCards.length - 1;
      for (const card of suggestedDeck) {
        if (!card?.name) continue;
        if (currentNames.has(card.name.toLowerCase())) continue;
        // Pair with the next current-deck card from the end as a "candidate to swap out".
        let outCard: CardEntry | null = null;
        while (cursor >= 0) {
          const c = currentCards[cursor];
          cursor -= 1;
          const cardIsLand = (card.type_line || "").toLowerCase().includes("land");
          const cIsLand = (c.type_line || "").toLowerCase().includes("land");
          if (cardIsLand === cIsLand) { outCard = c; break; }
        }
        swaps.push({ out: outCard, in: card });
        if (swaps.length >= 12) break;
      }
      setAnalyzeSuggestions(swaps);
      setAnalyzeResult(description);
    } catch (err: any) {
      setAnalyzeResult(err.response?.data?.detail || "Analysis failed");
    } finally {
      setAnalyzeLoading(false);
    }
  };
  const [decks, setDecks] = useState<SavedDeckSummary[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [detail, setDetail] = useState<SavedDeckDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  const loadDecks = async () => {
    try {
      const { data } = await api.get<SavedDeckSummary[]>("/deck/saved");
      setDecks(data);
      if (!selectedFile && data.length > 0) {
        setSelectedFile(data[0].file);
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.response?.data?.detail || "Failed to load saved decks" });
    }
  };

  const loadSelectedDeck = async (file: string) => {
    if (!file) {
      setDetail(null);
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.get<SavedDeckDetail>(`/deck/saved/${file}`);
      setDetail(data);
    } catch (err: any) {
      setMessage({ type: "error", text: err.response?.data?.detail || "Failed to load deck details" });
      setDetail(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDecks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadSelectedDeck(selectedFile);
  }, [selectedFile]);

  const exportDecklist = () => {
    if (!detail) return;
    const lines = [
      `1 ${detail.commander.name} *CMDR*`,
      "",
      ...detail.deck.map((card) => `1 ${card.name}`),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${detail.commander.name.replace(/\s+/g, "_")}_deck.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const deleteDeck = async () => {
    if (!selectedFile) return;
    if (!window.confirm("Delete this saved deck?")) return;
    try {
      await api.delete(`/deck/saved/${selectedFile}`);
      setMessage({ type: "success", text: "Saved deck deleted" });
      setDetail(null);
      setSelectedFile("");
      await loadDecks();
    } catch (err: any) {
      setMessage({ type: "error", text: err.response?.data?.detail || "Failed to delete deck" });
    }
  };

  return (
    <div className="page">
      <h1 className="page-title">My Decks</h1>

      {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}

      <div className="my-decks-toolbar">
        <select
          aria-label="Saved deck selection"
          value={selectedFile}
          onChange={(e) => setSelectedFile(e.target.value)}
          className="my-decks-select"
        >
          <option value="">Select a saved deck</option>
          {[...decks]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((deck) => (
            <option key={deck.file} value={deck.file}>
              {deck.name} ({deck.card_count} cards)
            </option>
          ))}
        </select>
      
      </div>
        <div className="my-decks-actions">
            <button className="btn-secondary" onClick={exportDecklist}>
              Export Decklist (.txt)
            </button>
            <button className="btn-primary" onClick={() => { setShowAnalyze(true); handleAnalyze(); }} disabled={analyzeLoading}>
              {analyzeLoading ? "Analyzing..." : "Analyze & Suggest Improvements"}
            </button>
            <button
              className="btn-primary"
              onClick={async () => {
                if (!selectedFile) return;
                try {
                  await api.post("/collection/add-deck", { filename: selectedFile });
                  // Poll import-status until complete (silent), then refresh collection
                  const deadline = Date.now() + 20000; // 20s timeout
                  while (Date.now() < deadline) {
                    try {
                      const { data } = await api.get("/collection/import-status");
                      if (!data?.active) {
                        // notify collection to refresh
                        window.dispatchEvent(new Event("collection-updated"));
                        setMessage({ type: "success", text: `Deck added: imported ${data.imported ?? 0}, updated ${data.updated ?? 0}` });
                        break;
                      }
                    } catch (e:any) {
                      // ignore transient errors
                    }
                    await new Promise((r) => setTimeout(r, 600));
                  }
                } catch (err:any) {
                  setMessage({ type: "error", text: err.response?.data?.detail || "Failed to add deck to collection" });
                }
              }}
              disabled={!selectedFile}
            >
              Add to Collection
            </button>
            <button className="btn-secondary" onClick={loadDecks}>Refresh</button>
        <button className="btn-danger" onClick={deleteDeck} disabled={!selectedFile}>Delete</button>
          </div>
      {loading ? (
        <p>Loading deck...</p>
      ) : !detail ? (
        <div className="alert alert-info">Select a saved deck to view details.</div>
      ) : (
        <div>
          <div className="my-decks-meta">
            <h2>{detail.name}</h2>
            <small>
              Saved: {detail.saved_at || "Unknown"} | Cards: {detail.card_count}
            </small>
            <h1 style={{ margin: "0.5em 0", color: '#7c3aed' }}>Commander</h1>
              </div>
          <div className="my-decks-commander-card">
            <CardPreview
              name={detail.commander.name}
              imageUri={detail.commander.image_uri}
              subtitle="Commander"
              tcgplayerPrice={detail.commander.tcgplayer_price}
            />
        </div>
        <div className="my-decks-card-toolbar">
            <label className="my-decks-card-sort-label">Sort cards in this deck:</label>
            <select
              aria-label="Sort cards in deck"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="my-decks-select"
              title="Sort cards in this deck"
            >
              <option value="type">Type</option>
              <option value="name">Name</option>
              <option value="cmc">Mana Cost</option>
              <option value="price">Price</option>
            </select>
          </div>


          <div className="card-grid">
            {(() => {
              const buckets = new Map<string, { card: CardEntry; quantity: number }>();
              for (const card of detail.deck) {
                const key = card.name;
                const existing = buckets.get(key);
                if (existing) {
                  existing.quantity += 1;
                } else {
                  buckets.set(key, { card, quantity: 1 });
                }
              }
              const grouped = Array.from(buckets.values());
              grouped.sort((a, b) => {
                if (sortBy === "name") return a.card.name.localeCompare(b.card.name);
                if (sortBy === "cmc") {
                  return (Number(a.card.cmc) || 0) - (Number(b.card.cmc) || 0)
                    || a.card.name.localeCompare(b.card.name);
                }
                if (sortBy === "price") {
                  return (Number(b.card.tcgplayer_price) || 0) - (Number(a.card.tcgplayer_price) || 0)
                    || a.card.name.localeCompare(b.card.name);
                }
                return (a.card.type_line || "").localeCompare(b.card.type_line || "")
                  || a.card.name.localeCompare(b.card.name);
              });
              return grouped.map(({ card, quantity }, idx) => (
                <CardPreview
                  key={`${card.name}-${idx}`}
                  name={card.name}
                  imageUri={card.image_uri}
                  subtitle={card.type_line || "Deck Card"}
                  tcgplayerPrice={card.tcgplayer_price}
                  quantity={quantity > 1 ? quantity : undefined}
                />
              ));
            })()}
          </div>
          {/* Analyze Modal */}
          {showAnalyze && (
            <div className="my-decks-modal-overlay">
              <div className="my-decks-modal my-decks-modal-wide">
                <h2>AI Suggestions</h2>
                <div className="my-decks-modal-body">
                  {analyzeLoading && <p>Analyzing your deck against your collection...</p>}
                  {analyzeResult && <p className="my-decks-modal-summary">{analyzeResult}</p>}
                  {analyzeSuggestions.length > 0 && (
                    <div className="my-decks-swap-list">
                      <h3>Suggested swaps ({analyzeSuggestions.length})</h3>
                      {analyzeSuggestions.map((swap, idx) => (
                        <div key={`swap-${idx}`} className="my-decks-swap-row">
                          <div className="my-decks-swap-tile">
                            {swap.out ? (
                              <CardPreview
                                name={swap.out.name}
                                imageUri={swap.out.image_uri}
                                subtitle="Consider replacing"
                                tcgplayerPrice={swap.out.tcgplayer_price}
                              />
                            ) : (
                              <div className="my-decks-swap-placeholder">Add to deck</div>
                            )}
                          </div>
                          <div className="my-decks-swap-arrow">→</div>
                          <div className="my-decks-swap-tile">
                            <CardPreview
                              name={swap.in.name}
                              imageUri={swap.in.image_uri}
                              subtitle="Suggested"
                              tcgplayerPrice={swap.in.tcgplayer_price}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {!analyzeLoading && !analyzeResult && analyzeSuggestions.length === 0 && (
                    <p>No suggestions yet.</p>
                  )}
                </div>
                <div className="my-decks-modal-footer">
                  <button className="btn-secondary" onClick={() => setShowAnalyze(false)} disabled={analyzeLoading}>Close</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
