import { useEffect, useRef, useState } from "react";
import api from "../api";
import CardPreview from "../components/CardPreview";
import BracketBadge, { BracketInfo } from "../components/BracketBadge";
import "./MyDecks.css";

interface SavedDeckSummary {
  file: string;
  name: string;
  saved_at: string | null;
  commander: string;
  card_count: number;
  bracket?: number;
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
  bracket?: BracketInfo;
}

interface SwapPair {
  out: CardEntry | null;
  in: any;
}

interface CollectionCard {
  id: string;
  name: string;
  type_line: string;
  color_identity: string[];
  quantity: number;
}

export default function MyDecks() {
  const [showAnalyze, setShowAnalyze] = useState(false);
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [analyzeResult, setAnalyzeResult] = useState<string | null>(null);
  const [analyzeSuggestions, setAnalyzeSuggestions] = useState<SwapPair[]>([]);
  const [selectedSwapIndices, setSelectedSwapIndices] = useState<Set<number>>(new Set());
  const selectAllRef = useRef<HTMLInputElement>(null);
  const analyzeModalRef = useRef<HTMLDivElement | null>(null);
  const analyzeDraggingRef = useRef({ active: false, offsetX: 0, offsetY: 0 });
  const [analyzeModalPos, setAnalyzeModalPos] = useState({ x: 60, y: 40 });
  const [sortBy, setSortBy] = useState<"name" | "cmc" | "type" | "price">("type");
  const handleAnalyze = async () => {
    if (!selectedFile) return;
    setAnalyzeLoading(true);
    setAnalyzeResult(null);
    setAnalyzeSuggestions([]);
    setSelectedSwapIndices(new Set());
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
  const applySelectedSwaps = async () => {
    if (!detail || !selectedFile || selectedSwapIndices.size === 0) return;
    setSaving(true);
    setMessage(null);
    try {
      const newDeck = detail.deck.slice();
      for (const idx of Array.from(selectedSwapIndices).sort((a, b) => b - a)) {
        const swap = analyzeSuggestions[idx];
        if (swap.out) {
          const outIdx = newDeck.findIndex((c) => c.name.toLowerCase() === swap.out!.name.toLowerCase());
          if (outIdx !== -1) newDeck.splice(outIdx, 1);
        }
        newDeck.push(swap.in);
      }
      await api.put(`/deck/saved/${selectedFile}`, { deck: newDeck });
      setDetail((prev) => prev ? { ...prev, deck: newDeck } : prev);
      setDeckModified(false);
      setMessage({ type: "success", text: `Applied ${selectedSwapIndices.size} swap(s) and saved.` });
      setShowAnalyze(false);
      setSelectedSwapIndices(new Set());
    } catch (err: any) {
      setMessage({ type: "error", text: err.response?.data?.detail || "Failed to apply swaps" });
    } finally {
      setSaving(false);
    }
  };
  const [decks, setDecks] = useState<SavedDeckSummary[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [detail, setDetail] = useState<SavedDeckDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [collection, setCollection] = useState<CollectionCard[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [selectedForRemoval, setSelectedForRemoval] = useState<Set<string>>(new Set());
  const [deckModified, setDeckModified] = useState(false);
  const [showAddFromCollection, setShowAddFromCollection] = useState(false);
  const [addCollectionSearch, setAddCollectionSearch] = useState("");

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
    api.get<CollectionCard[]>("/collection/")
      .then(({ data }) => setCollection(data))
      .catch(() => setCollection([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadSelectedDeck(selectedFile);
    setEditMode(false);
    setSelectedForRemoval(new Set());
    setDeckModified(false);
  }, [selectedFile]);

  useEffect(() => {
    if (!selectAllRef.current || analyzeSuggestions.length === 0) return;
    const s = selectedSwapIndices.size;
    const n = analyzeSuggestions.length;
    selectAllRef.current.indeterminate = s > 0 && s < n;
  }, [selectedSwapIndices, analyzeSuggestions]);

  useEffect(() => {
    if (!showAnalyze) return;
    const w = window.innerWidth || 900;
    const h = window.innerHeight || 700;
    setAnalyzeModalPos({ x: Math.max(20, Math.round(w / 2 - 540)), y: Math.max(20, Math.round(h / 2 - 320)) });
  }, [showAnalyze]);

  const startAnalyzeDrag = (e: React.MouseEvent) => {
    const el = analyzeModalRef.current;
    if (!el) return;
    analyzeDraggingRef.current.active = true;
    const rect = el.getBoundingClientRect();
    analyzeDraggingRef.current.offsetX = e.clientX - rect.left;
    analyzeDraggingRef.current.offsetY = e.clientY - rect.top;
    const onMove = (ev: MouseEvent) => {
      if (!analyzeDraggingRef.current.active) return;
      setAnalyzeModalPos({ x: ev.clientX - analyzeDraggingRef.current.offsetX, y: ev.clientY - analyzeDraggingRef.current.offsetY });
    };
    const onUp = () => {
      analyzeDraggingRef.current.active = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const toggleSwapIndex = (idx: number) => {
    setSelectedSwapIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

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

  const handleSaveChanges = async () => {
    if (!detail || !selectedFile) return;
    setSaving(true);
    setMessage(null);
    try {
      await api.put(`/deck/saved/${selectedFile}`, { deck: detail.deck });
      setDeckModified(false);
      setMessage({ type: "success", text: "Deck changes saved." });
    } catch (err: any) {
      setMessage({ type: "error", text: err.response?.data?.detail || "Failed to save changes" });
    } finally {
      setSaving(false);
    }
  };

  const handleAddCardFromCollection = async (cardName: string) => {
    if (!detail) return;
    try {
      const { data: card } = await api.get<CardEntry>(`/deck/card-lookup?name=${encodeURIComponent(cardName)}`);
      setDetail((prev) => prev ? { ...prev, deck: [...prev.deck, card] } : prev);
      setDeckModified(true);
      setShowAddFromCollection(false);
      setAddCollectionSearch("");
    } catch (err: any) {
      setMessage({ type: "error", text: err.response?.data?.detail || `Card '${cardName}' not found` });
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
              {deck.name} ({deck.card_count} cards){deck.bracket ? ` [B${deck.bracket}]` : ""}
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
            <button
              className={editMode ? "btn-primary" : "btn-secondary"}
              onClick={() => { setEditMode((m) => !m); setSelectedForRemoval(new Set()); }}
              disabled={!detail}
            >
              {editMode ? "✎ Editing..." : "✎ Edit Deck"}
            </button>
            {deckModified && (
              <button className="btn-primary" onClick={handleSaveChanges} disabled={saving}>
                {saving ? "Saving..." : "💾 Save Changes"}
              </button>
            )}
            {detail && (
              <button className="btn-secondary" onClick={() => setShowAddFromCollection(true)}>
                + Add Cards
              </button>
            )}
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
            <BracketBadge info={detail.bracket} showDetails />
            <small>
              Saved: {detail.saved_at || "Unknown"} | Cards: {detail.card_count}
              {(() => {
                const total = (detail.deck || []).reduce((s, c) => s + (Number(c.tcgplayer_price) || 0), 0)
                  + (Number(detail.commander?.tcgplayer_price) || 0);
                return total > 0 ? <> | <strong className="my-decks-deck-price">Deck Price: ${total.toFixed(2)}</strong></> : null;
              })()}
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
                editMode ? (
                  <div key={`${card.name}-${idx}`} className="my-decks-edit-tile-wrap">
                    <input
                      type="checkbox"
                      className="my-decks-tile-checkbox"
                      checked={selectedForRemoval.has(card.name)}
                      onChange={(e) => {
                        const next = new Set(selectedForRemoval);
                        if (e.target.checked) next.add(card.name);
                        else next.delete(card.name);
                        setSelectedForRemoval(next);
                      }}
                      title={`Select "${card.name}" to remove`}
                    />
                    <CardPreview
                      name={card.name}
                      imageUri={card.image_uri}
                      subtitle={card.type_line || "Deck Card"}
                      tcgplayerPrice={card.tcgplayer_price}
                      quantity={quantity > 1 ? quantity : undefined}
                    />
                  </div>
                ) : (
                  <CardPreview
                    key={`${card.name}-${idx}`}
                    name={card.name}
                    imageUri={card.image_uri}
                    subtitle={card.type_line || "Deck Card"}
                    tcgplayerPrice={card.tcgplayer_price}
                    quantity={quantity > 1 ? quantity : undefined}
                  />
                )
              ));
            })()}
          </div>

          {/* Remove selected bar */}
          {editMode && selectedForRemoval.size > 0 && (
            <div className="my-decks-remove-bar">
              <span>{selectedForRemoval.size} card{selectedForRemoval.size > 1 ? "s" : ""} selected</span>
              <button
                type="button"
                className="btn-danger"
                onClick={() => {
                  setDetail((prev) => prev
                    ? { ...prev, deck: prev.deck.filter((c) => !selectedForRemoval.has(c.name)) }
                    : prev
                  );
                  setDeckModified(true);
                  setSelectedForRemoval(new Set());
                }}
              >
                🗑 Remove Selected
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setSelectedForRemoval(new Set())}
              >
                Clear Selection
              </button>
            </div>
          )}

          {/* Add from Collection modal */}
          {showAddFromCollection && (
            <div className="my-decks-modal-overlay" onClick={() => setShowAddFromCollection(false)}>
              <div className="my-decks-modal" onClick={(e) => e.stopPropagation()}>
                <h2>Add Card from Collection</h2>
                <div className="my-decks-modal-body">
                  <input
                    type="text"
                    placeholder="Search card name..."
                    value={addCollectionSearch}
                    onChange={(e) => setAddCollectionSearch(e.target.value)}
                    className="my-decks-select"
                    style={{ width: "100%", marginBottom: 8 }}
                    autoFocus
                    title="Search for a card to add"
                  />
                  <div style={{ maxHeight: 320, overflowY: "auto" }}>
                    {collection
                      .filter((c) => {
                        if (!addCollectionSearch.trim()) return true;
                        return c.name.toLowerCase().includes(addCollectionSearch.toLowerCase());
                      })
                      .slice(0, 50)
                      .map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="my-decks-add-collection-item"
                          onClick={() => handleAddCardFromCollection(c.name)}
                        >
                          <span>{c.name}</span>
                          <small>{c.type_line}</small>
                        </button>
                      ))}
                  </div>
                </div>
                <div className="my-decks-modal-footer">
                  <button className="btn-secondary" onClick={() => setShowAddFromCollection(false)}>Close</button>
                </div>
              </div>
            </div>
          )}

          {/* Analyze Modal */}
          {showAnalyze && (
            <div className="my-decks-modal-overlay my-decks-modal-overlay--bare">
              <div
                className="my-decks-modal my-decks-modal-wide"
                ref={analyzeModalRef}
                style={{ left: analyzeModalPos.x, top: analyzeModalPos.y }}>
                <button
                  className="my-decks-analyze-close-btn"
                  onClick={() => setShowAnalyze(false)}
                  title="Close"
                >
                  ✕ Exit
                </button>
                <h2 className="my-decks-analyze-drag-handle" onMouseDown={startAnalyzeDrag}>AI Suggestions</h2>
                <div className="my-decks-modal-body">
                  {analyzeLoading && <p>Analyzing your deck against your collection...</p>}
                  {analyzeResult && <p className="my-decks-modal-summary">{analyzeResult}</p>}
                  {analyzeSuggestions.length > 0 && (
                    <div className="my-decks-swap-list">
                      <div className="my-decks-swap-toolbar">
                        <label className="my-decks-swap-select-all">
                          <input
                            type="checkbox"
                            className="my-decks-swap-checkbox"
                            ref={selectAllRef}
                            checked={analyzeSuggestions.length > 0 && selectedSwapIndices.size === analyzeSuggestions.length}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedSwapIndices(new Set(analyzeSuggestions.map((_, i) => i)));
                              } else {
                                setSelectedSwapIndices(new Set());
                              }
                            }}
                          />
                          Suggested swaps ({analyzeSuggestions.length})
                        </label>
                        <button
                          className="btn-primary"
                          disabled={selectedSwapIndices.size === 0 || analyzeLoading || saving}
                          onClick={applySelectedSwaps}
                        >
                          Apply {selectedSwapIndices.size > 0 ? selectedSwapIndices.size : ""} Selected
                        </button>
                      </div>
                      {analyzeSuggestions.map((swap, idx) => (
                        <div
                          key={`swap-${idx}`}
                          className={`my-decks-swap-row${selectedSwapIndices.has(idx) ? " my-decks-swap-row--selected" : ""}`}
                          onClick={() => setSelectedSwapIndices((prev) => {
                            const next = new Set(prev);
                            if (next.has(idx)) next.delete(idx); else next.add(idx);
                            return next;
                          })}
                        >
                          <input
                            type="checkbox"
                            className="my-decks-swap-checkbox"
                            aria-label={`Select swap ${idx + 1}`}
                            checked={selectedSwapIndices.has(idx)}
                            onChange={() => {}}
                            onClick={(e) => e.stopPropagation()}
                          />
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
