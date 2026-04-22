import { useEffect, useState } from "react";
import api from "../api";
import CardPreview from "../components/CardPreview";

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

export default function MyDecks() {
  const [showAnalyze, setShowAnalyze] = useState(false);
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [analyzeResult, setAnalyzeResult] = useState<string | null>(null);
  const handleAnalyze = async () => {
    setAnalyzeLoading(true);
    setAnalyzeResult(null);
    try {
      // TODO: Call backend endpoint to analyze deck and get suggestions
      // Example: await api.post("/deck/analyze", { deck_file: selectedFile });
      setAnalyzeResult("AI suggestions will appear here (backend integration needed)");
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
    const groups: Record<string, CardEntry[]> = {};
    for (const card of detail.deck) {
      const type = card.type_line?.split("—")[0].trim() || "Other";
      if (!groups[type]) groups[type] = [];
      groups[type].push(card);
    }
    const sortedTypes = Object.keys(groups).sort((a, b) => a.localeCompare(b));
    const lines = [
      `1 ${detail.commander.name}`,
      "",
      ...sortedTypes.flatMap((type) => [
        `// ${type} (${groups[type].length})`,
        ...groups[type].map((c) => `1 ${c.name}`),
        "",
      ]),
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

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
        <select
          aria-label="Saved deck selection"
          value={selectedFile}
          onChange={(e) => setSelectedFile(e.target.value)}
          style={{ minWidth: 320 }}
        >
          <option value="">Select a saved deck</option>
          {decks.map((deck) => (
            <option key={deck.file} value={deck.file}>
              {deck.name} ({deck.card_count} cards)
            </option>
          ))}
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
          <div style={{ marginBottom: 16 }}>
            <h2 style={{ color: "#c4b5fd", marginBottom: 6 }}>{detail.name}</h2>
            <small style={{ color: "#94a3b8" }}>
              Saved: {detail.saved_at || "Unknown"} | Cards: {detail.card_count}
            </small>
            <p style={{ color: "#cbd5e1", marginTop: 10, marginBottom: 12 }}>{detail.description}</p>
            {detail.prompt && (
              <small style={{ color: "#94a3b8" }}>Prompt: {detail.prompt}</small>
            )}
          </div>

          <div style={{ marginBottom: 18, maxWidth: 260 }}>
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

          <div style={{ marginTop: 24, display: "flex", gap: 10 }}>
            <button className="btn-secondary" onClick={exportDecklist}>
              Export Decklist (.txt)
            </button>
            <button className="btn-primary" onClick={() => { setShowAnalyze(true); handleAnalyze(); }} disabled={analyzeLoading}>
              {analyzeLoading ? "Analyzing..." : "Analyze & Suggest Improvements"}
            </button>
          </div>

          {/* Analyze Modal */}
          {showAnalyze && (
            <div style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ background: "#1e293b", padding: 24, borderRadius: 8, minWidth: 340, maxWidth: 540 }}>
                <h2 style={{ marginBottom: 12 }}>AI Suggestions</h2>
                <div style={{ minHeight: 80, color: "#f1f5f9" }}>
                  {analyzeResult || (analyzeLoading ? "Analyzing..." : "No suggestions yet.")}
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
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
