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
  const [sortBy, setSortBy] = useState<"name" | "cost" | "color" | "type">("name");
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
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

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
          {[...decks].sort((a, b) => {
            if (sortBy === "name") return a.name.localeCompare(b.name);
            if (sortBy === "type") return (a.commander || "").localeCompare(b.commander || "");
            if (sortBy === "color") return (a.commander || "").localeCompare(b.commander || "");
            if (sortBy === "cost") return (b.card_count || 0) - (a.card_count || 0);
            return 0;
          }).map((deck) => (
            <option key={deck.file} value={deck.file}>
              {deck.name} ({deck.card_count} cards)
            </option>
          ))}
        </select>
        <select
          aria-label="Sort decks by"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as any)}
          className="my-decks-select"
          title="Sort decks"
        >
          <option value="name">Sort: Name</option>
          <option value="cost">Sort: Card count</option>
          <option value="color">Sort: Commander</option>
          <option value="type">Sort: Type</option>
        </select>
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
            <p>{detail.description}</p>
            {detail.prompt && (
              <small>Prompt: {detail.prompt}</small>
            )}
          </div>

          <div className="my-decks-commander-card">
            <CardPreview
              name={detail.commander.name}
              imageUri={detail.commander.image_uri}
              subtitle="Commander"
              tcgplayerPrice={detail.commander.tcgplayer_price}
            />
          </div>

          <div className="card-grid">
            {detail.deck.map((card, idx) => (
              <CardPreview
                key={`${card.name}-${idx}`}
                name={card.name}
                imageUri={card.image_uri}
                subtitle={card.type_line || "Deck Card"}
                tcgplayerPrice={card.tcgplayer_price}
              />
            ))}
          </div>

          <div className="my-decks-actions">
            <button className="btn-secondary" onClick={exportDecklist}>
              Export Decklist (.txt)
            </button>
            <button className="btn-primary" onClick={() => { setShowAnalyze(true); handleAnalyze(); }} disabled={analyzeLoading}>
              {analyzeLoading ? "Analyzing..." : "Analyze & Suggest Improvements"}
            </button>
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
