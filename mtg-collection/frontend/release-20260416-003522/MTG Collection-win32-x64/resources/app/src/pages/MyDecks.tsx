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
        </div>
      )}
    </div>
  );
}
