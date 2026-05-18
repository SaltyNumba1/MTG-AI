import { useEffect, useRef, useState } from "react";
import api from "../api";
import CardPreview from "../components/CardPreview";
import BracketBadge, { BracketInfo } from "../components/BracketBadge";
import { useSettings } from "../hooks/useSettings";
import "./MyDecks.css";

const ARCHETYPE_TAGS = [
  "Ramp", "Card Draw", "Removal", "Tokens", "Tribal",
  "Graveyard", "Combo", "Aggro", "Control", "Enchantments",
  "Artifacts", "Voltron", "Lifegain", "Sacrifice", "Spellslinger",
  "Blink", "+1/+1 Counters", "Stax", "Infect", "Mill",
];
const PROTECTED_FROM_SWAP = new Set([
  "sol ring", "arcane signet", "commander's sphere",
  "path of ancestry", "command tower",
]);

const CARD_TYPE_FILTERS = ["Creature", "Instant", "Sorcery", "Enchantment", "Artifact", "Planeswalker"];

const COLOR_SYMBOLS: Record<string, string> = {
  W: "☀️", U: "💧", B: "💀", R: "🔥", G: "🌲",
};

interface SavedDeckSummary {
  file: string;
  name: string;
  saved_at: string | null;
  commander: string;
  card_count: number;
  bracket?: number;
  tags?: string[];
  rating?: number;
}

interface CardEntry {
  id?: string;
  name: string;
  type_line?: string;
  cmc?: number;
  color_identity?: string[];
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
  tags?: string[];
  rating?: number;
  sideboard?: CardEntry[];
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

// ── Deck stat helpers ────────────────────────────────────────
function deckManaCurve(cards: CardEntry[]) {
  const b: Record<string, number> = {"0":0,"1":0,"2":0,"3":0,"4":0,"5":0,"6":0,"7+":0};
  for (const card of cards) {
    if ((card.type_line || "").toLowerCase().includes("land")) continue;
    const cmc = Number(card.cmc || 0);
    if (cmc >= 7) b["7+"]++; else b[String(Math.max(0, Math.floor(cmc)))]++;
  }
  return b;
}

function deckColorDist(cards: CardEntry[]) {
  const d: Record<string, number> = {W:0,U:0,B:0,R:0,G:0};
  for (const card of cards)
    for (const c of (card.color_identity || []))
      if (d[c] !== undefined) d[c]++;
  return d;
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
  const settings = useSettings();
  const [sortBy, setSortBy] = useState<"name" | "cmc" | "type" | "price">(settings.defaultSort);
  const handleAnalyze = async (keywordFilters: string[] = [], swapOutNames: string[] = []) => {
    if (!selectedFile) return;
    setShowPreAnalyze(false);
    setShowAnalyze(true);
    setAnalyzeLoading(true);
    setAnalyzeResult(null);
    setAnalyzeSuggestions([]);
    setSelectedSwapIndices(new Set());
    // Clear swap-select mode immediately so the toolbar button reflects the new state
    if (swapOutNames.length > 0) {
      setSwapSelectMode(false);
      setSelectedForSwap(new Set());
    }
    try {
      const { data } = await api.post("/deck/analyze-deck", {
        deck_file: selectedFile,
        keyword_filters: keywordFilters,
        swap_out_names: swapOutNames,
        max_compact_candidates: settings.maxCompactCandidates,
        num_predict: settings.numPredict,
      });
      const description = data?.suggestions?.description || "No summary provided.";
      const suggestedDeck: any[] = Array.isArray(data?.suggestions?.deck) ? data.suggestions.deck : [];
      const currentNames = new Set((detail?.deck || []).map((c) => c.name.toLowerCase()));
      const swaps: SwapPair[] = [];
      if (swapOutNames.length > 0) {
        // Targeted swap: pair suggestions against the specifically selected cards
        const swapOutSet = new Set(swapOutNames.map(n => n.toLowerCase()));
        const targetCards = (detail?.deck || []).filter(c => swapOutSet.has(c.name.toLowerCase()));
        let cursor = 0;
        for (const card of suggestedDeck) {
          if (!card?.name) continue;
          if (currentNames.has(card.name.toLowerCase())) continue;
          swaps.push({ out: targetCards[cursor] || null, in: card });
          cursor++;
          if (swaps.length >= 12) break;
        }
      } else {
        // General improvement: pair by type, excluding protected staples
        const currentCards = (detail?.deck || [])
          .filter((c) => !PROTECTED_FROM_SWAP.has(c.name.toLowerCase()))
          .slice();
        let cursor = currentCards.length - 1;
        for (const card of suggestedDeck) {
          if (!card?.name) continue;
          if (currentNames.has(card.name.toLowerCase())) continue;
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
      await api.put(`/deck/saved/${selectedFile}`, { deck: newDeck, sideboard: detail.sideboard || [] });
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
  const [showPreAnalyze, setShowPreAnalyze] = useState(false);
  const [preAnalyzeTags, setPreAnalyzeTags] = useState<Set<string>>(new Set());
  const [customTagInput, setCustomTagInput] = useState("");
  const [deckRating, setDeckRating] = useState(0);
  const [newTagInput, setNewTagInput] = useState("");
  const [swapSelectMode, setSwapSelectMode] = useState(false);
  const [selectedForSwap, setSelectedForSwap] = useState<Set<string>>(new Set());
  const [preAnalyzeTypes, setPreAnalyzeTypes] = useState<Set<string>>(new Set());
  const [sideboardAddMode, setSideboardAddMode] = useState(false);
  const [renamingDeck, setRenamingDeck] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const showPrices = settings.showPrices;
  const deckCurve = detail ? deckManaCurve(detail.deck) : null;
  const deckColors = detail ? deckColorDist(detail.deck) : null;
  const deckCurveMax = deckCurve ? Math.max(...Object.values(deckCurve), 1) : 1;
  const deckColorMax = deckColors ? Math.max(...Object.values(deckColors), 1) : 1;
  const deckLandCount = detail ? detail.deck.filter(
    c => (c.type_line || "").toLowerCase().includes("land")
  ).length : 0;
  const deckBasicCount = detail ? detail.deck.filter(c => {
    const t = (c.type_line || "").toLowerCase();
    return t.includes("basic") && t.includes("land");
  }).length : 0;

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

  useEffect(() => { setDeckRating(detail?.rating || 0); }, [detail?.rating]);

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
      await api.put(`/deck/saved/${selectedFile}`, { deck: detail.deck, tags: detail.tags || [], sideboard: detail.sideboard || [] });
      setDeckModified(false);
      setMessage({ type: "success", text: "Deck changes saved." });
    } catch (err: any) {
      setMessage({ type: "error", text: err.response?.data?.detail || "Failed to save changes" });
    } finally {
      setSaving(false);
    }
  };

  const handleRename = async () => {
    const trimmed = renameValue.trim();
    if (!trimmed || !selectedFile) { setRenamingDeck(false); return; }
    try {
      await api.patch(`/deck/saved/${selectedFile}`, { name: trimmed });
      setDetail((prev) => prev ? { ...prev, name: trimmed } : prev);
      setDecks((prev) => prev.map((d) => d.file === selectedFile ? { ...d, name: trimmed } : d));
      setMessage({ type: "success", text: `Deck renamed to "${trimmed}".` });
    } catch (err: any) {
      setMessage({ type: "error", text: err.response?.data?.detail || "Failed to rename deck" });
    } finally {
      setRenamingDeck(false);
    }
  };

  const handleStarRating = async (star: number) => {
    if (!selectedFile) return;
    const newRating = deckRating === star ? 0 : star;
    setDeckRating(newRating);
    try {
      await api.put(`/deck/saved/${selectedFile}`, { deck: detail?.deck || [], rating: newRating });
    } catch {}
  };

  const handleAddTag = () => {
    const tag = newTagInput.trim();
    if (!tag || !detail) return;
    if ((detail.tags || []).includes(tag)) { setNewTagInput(""); return; }
    setDetail((prev) => prev ? { ...prev, tags: [...(prev.tags || []), tag] } : prev);
    setDeckModified(true);
    setNewTagInput("");
  };

  const handleRemoveTag = (tag: string) => {
    if (!detail) return;
    setDetail((prev) => prev ? { ...prev, tags: (prev.tags || []).filter((t) => t !== tag) } : prev);
    setDeckModified(true);
  };

  const handleAddCardFromCollection = async (cardName: string) => {
    if (!detail) return;
    try {
      const { data: card } = await api.get<CardEntry>(`/deck/card-lookup?name=${encodeURIComponent(cardName)}`);
      if (sideboardAddMode) {
        setDetail((prev) => prev ? { ...prev, sideboard: [...(prev.sideboard || []), card] } : prev);
      } else {
        setDetail((prev) => prev ? { ...prev, deck: [...prev.deck, card] } : prev);
      }
      setDeckModified(true);
      setShowAddFromCollection(false);
      setSideboardAddMode(false);
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
            <button className="btn-primary" onClick={() => { setPreAnalyzeTags(new Set(detail?.tags || [])); setPreAnalyzeTypes(new Set()); setShowPreAnalyze(true); }} disabled={analyzeLoading || !selectedFile}>
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
              onClick={() => { setEditMode((m) => !m); setSelectedForRemoval(new Set()); setSwapSelectMode(false); setSelectedForSwap(new Set()); }}
              disabled={!detail}
            >
              {editMode ? "✎ Editing..." : "✎ Edit Deck"}
            </button>
            {deckModified && (
              <button className="btn-primary" onClick={handleSaveChanges} disabled={saving}>
                {saving ? "Saving..." : "💾 Save Changes"}
              </button>
            )}
            <button
              className={swapSelectMode ? "btn-primary" : "btn-secondary"}
              onClick={() => {
                if (swapSelectMode) {
                  setSwapSelectMode(false);
                  setSelectedForSwap(new Set());
                } else {
                  setEditMode(false);
                  setSwapSelectMode(true);
                }
              }}
              disabled={!detail}
            >
              {swapSelectMode ? "🔄 Selecting..." : "🔄 Select to Swap"}
            </button>
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
            {renamingDeck ? (
              <div className="deck-rename-row">
                <input
                  type="text"
                  className="deck-rename-input"
                  value={renameValue}
                  autoFocus
                  maxLength={80}
                  title="New deck name"
                  placeholder="Deck name"
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename();
                    if (e.key === "Escape") setRenamingDeck(false);
                  }}
                />
                <button type="button" className="btn-primary" onClick={handleRename}>Save</button>
                <button type="button" className="btn-secondary" onClick={() => setRenamingDeck(false)}>Cancel</button>
              </div>
            ) : (
              <div className="deck-rename-row">
                <h2>{detail.name}</h2>
                <button
                  type="button"
                  className="deck-rename-btn"
                  title="Rename deck"
                  onClick={() => { setRenameValue(detail.name); setRenamingDeck(true); }}
                >✎</button>
              </div>
            )}
            <div className="deck-star-rating">
              {[1, 2, 3, 4, 5].map((star) => (
                <span
                  key={star}
                  className={`deck-star${deckRating >= star ? " deck-star--filled" : ""}`}
                  onClick={() => handleStarRating(star)}
                  title={`Rate ${star} star${star > 1 ? "s" : ""}`}
                >★</span>
              ))}
              <span className="deck-star-label">{deckRating > 0 ? `${deckRating}/5` : "Unrated"}</span>
            </div>
            <BracketBadge info={detail.bracket} showDetails />
            <small>
              Saved: {detail.saved_at || "Unknown"} | Cards: {detail.card_count}
              {(() => {
                const total = (detail.deck || []).reduce((s, c) => s + (Number(c.tcgplayer_price) || 0), 0)
                  + (Number(detail.commander?.tcgplayer_price) || 0);
                return total > 0 ? <> | <strong className="my-decks-deck-price">Deck Price: ${total.toFixed(2)}</strong></> : null;
              })()}
            </small>
            <div className="deck-tag-chips">
              {(detail.tags || []).map((tag) => (
                <span key={tag} className="deck-tag-chip">
                  {tag}
                  {editMode && (
                    <button className="deck-tag-chip-remove" onClick={() => handleRemoveTag(tag)}>×</button>
                  )}
                </span>
              ))}
              {editMode && (
                <input
                  type="text"
                  placeholder="Add tag…"
                  value={newTagInput}
                  onChange={(e) => setNewTagInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddTag(); } }}
                  className="deck-tag-add-input"
                />
              )}
            </div>
            <h1 style={{ margin: "0.5em 0", color: '#7c3aed' }}>Commander</h1>
              </div>
          <div className="my-decks-commander-card">
            <CardPreview
              name={detail.commander.name}
              imageUri={detail.commander.image_uri}
              subtitle="Commander"
              tcgplayerPrice={showPrices ? detail.commander.tcgplayer_price : null}
            />
        </div>
{/* ── Deck stats: mana curve · color distribution · lands ── */}
          {deckCurve && deckColors && (
            <div className="my-decks-stats-row">
              <div className="my-decks-stats-card">
                <h4 className="my-decks-stats-heading">Mana Curve</h4>
                {Object.entries(deckCurve).map(([bucket, count]) => (
                  <div key={bucket} className="my-decks-stats-item">
                    <span className="my-decks-stats-label">{bucket}</span>
                    <div className="my-decks-stats-bar-bg">
                      <div className="my-decks-curve-bar"
                        style={{ width: `${deckCurveMax > 0 ? Math.round((count / deckCurveMax) * 100) : 0}%` }} />
                    </div>
                    <span className="my-decks-stats-count">{count}</span>
                  </div>
                ))}
              </div>
              <div className="my-decks-stats-card">
                <h4 className="my-decks-stats-heading">Colors</h4>
                {Object.entries(deckColors).filter(([, v]) => v > 0).length === 0
                  ? <span className="my-decks-stats-label">Colorless</span>
                  : Object.entries(deckColors).filter(([, v]) => v > 0).map(([color, count]) => (
                    <div key={color} className="my-decks-stats-item">
                      <span className="my-decks-stats-label">{COLOR_SYMBOLS[color] || color}</span>
                      <div className="my-decks-stats-bar-bg">
                        <div className="my-decks-color-bar"
                          style={{ width: `${deckColorMax > 0 ? Math.round((count / deckColorMax) * 100) : 0}%` }} />
                      </div>
                      <span className="my-decks-stats-count">{count}</span>
                    </div>
                  ))
                }
              </div>
              <div className="my-decks-stats-card">
                <h4 className="my-decks-stats-heading">Lands ({deckLandCount})</h4>
                <div className="my-decks-basics-row"><span>Basic</span><strong>{deckBasicCount}</strong></div>
                <div className="my-decks-basics-row"><span>Nonbasic</span><strong>{deckLandCount - deckBasicCount}</strong></div>
              </div>
            </div>
          )}

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
                      tcgplayerPrice={showPrices ? card.tcgplayer_price : null}
                      quantity={quantity > 1 ? quantity : undefined}
                    />
                    <button
                      type="button"
                      className="sideboard-remove-btn"
                      onClick={() => {
                        setDetail((prev) => prev
                          ? { ...prev, deck: prev.deck.filter((c) => c.name !== card.name) }
                          : prev
                        );
                        setSelectedForRemoval((prev) => { const next = new Set(prev); next.delete(card.name); return next; });
                        setDeckModified(true);
                      }}
                    >× Remove</button>
                  </div>
                ) : swapSelectMode ? (
                  <div key={`${card.name}-${idx}`} className={`my-decks-edit-tile-wrap${selectedForSwap.has(card.name) ? " swap-selected" : ""}`}>
                    <input
                      type="checkbox"
                      className="my-decks-tile-checkbox"
                      checked={selectedForSwap.has(card.name)}
                      onChange={(e) => {
                        const next = new Set(selectedForSwap);
                        if (e.target.checked) next.add(card.name);
                        else next.delete(card.name);
                        setSelectedForSwap(next);
                      }}
                      title={`Select "${card.name}" for substitution`}
                    />
                    <CardPreview
                      name={card.name}
                      imageUri={card.image_uri}
                      subtitle={card.type_line || "Deck Card"}
                      tcgplayerPrice={showPrices ? card.tcgplayer_price : null}
                      quantity={quantity > 1 ? quantity : undefined}
                    />
                  </div>
                ) : (
                  <CardPreview
                    key={`${card.name}-${idx}`}
                    name={card.name}
                    imageUri={card.image_uri}
                    subtitle={card.type_line || "Deck Card"}
                    tcgplayerPrice={showPrices ? card.tcgplayer_price : null}
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

          {/* Swap-select sticky bar */}
          {swapSelectMode && selectedForSwap.size === 0 && (
            <div className="swap-hint-bar">
              ☑ Click cards above to select them for substitution, then click <strong>Find Substitutes</strong>.
            </div>
          )}
          {swapSelectMode && selectedForSwap.size > 0 && (
            <div className="swap-select-bar">
              <span>{selectedForSwap.size} card{selectedForSwap.size > 1 ? "s" : ""} selected for substitution</span>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  setPreAnalyzeTags(new Set(detail?.tags || []));
                  setPreAnalyzeTypes(new Set());
                  setShowPreAnalyze(true);
                }}
              >
                Find Substitutes
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => { setSwapSelectMode(false); setSelectedForSwap(new Set()); }}
              >
                Cancel
              </button>
            </div>
          )}

          {/* Add from Collection modal */}
          {showAddFromCollection && (
            <div className="my-decks-modal-overlay" onClick={() => { setShowAddFromCollection(false); setSideboardAddMode(false); }}>
              <div className="my-decks-modal" onClick={(e) => e.stopPropagation()}>
                <h2>{sideboardAddMode ? "Add Card to Sideboard" : "Add Card from Collection"}</h2>
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
                  <button className="btn-secondary" onClick={() => { setShowAddFromCollection(false); setSideboardAddMode(false); }}>Close</button>
                </div>
              </div>
            </div>
          )}

          {/* Pre-analyze tag picker modal */}
          {showPreAnalyze && (
            <div className="my-decks-modal-overlay" onClick={() => setShowPreAnalyze(false)}>
              <div className="my-decks-modal preanalyze-modal" onClick={(e) => e.stopPropagation()}>
                <h2>Analysis Focus <span className="preanalyze-modal-sub">(optional)</span></h2>
                <p className="preanalyze-modal-hint">Select tags to focus the AI's suggestions. Leave all unselected to analyze the full deck without a theme filter.</p>
                <div className="preanalyze-tag-grid">
                  {ARCHETYPE_TAGS.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className={`preanalyze-tag-chip${preAnalyzeTags.has(tag) ? " preanalyze-tag-chip--active" : ""}`}
                      onClick={() => setPreAnalyzeTags((prev) => {
                        const next = new Set(prev);
                        if (next.has(tag)) next.delete(tag); else next.add(tag);
                        return next;
                      })}
                    >{tag}</button>
                  ))}
                </div>
                <div className="preanalyze-type-section">
                  <p className="preanalyze-modal-hint" style={{ marginTop: 14, marginBottom: 6 }}>Prioritize card types:</p>
                  <div className="preanalyze-tag-grid">
                    {CARD_TYPE_FILTERS.map((type) => (
                      <button
                        key={type}
                        type="button"
                        className={`preanalyze-tag-chip${preAnalyzeTypes.has(type) ? " preanalyze-tag-chip--active" : ""}`}
                        onClick={() => setPreAnalyzeTypes((prev) => {
                          const next = new Set(prev);
                          if (next.has(type)) next.delete(type); else next.add(type);
                          return next;
                        })}
                      >{type}</button>
                    ))}
                  </div>
                </div>
                <div className="preanalyze-custom-row">
                  <input
                    type="text"
                    placeholder="Custom tag…"
                    value={customTagInput}
                    onChange={(e) => setCustomTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && customTagInput.trim()) {
                        e.preventDefault();
                        setPreAnalyzeTags((prev) => new Set([...prev, customTagInput.trim()]));
                        setCustomTagInput("");
                      }
                    }}
                    className="my-decks-select"
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={!customTagInput.trim()}
                    onClick={() => { setPreAnalyzeTags((prev) => new Set([...prev, customTagInput.trim()])); setCustomTagInput(""); }}
                  >Add</button>
                </div>
                {preAnalyzeTags.size > 0 && (
                  <div className="preanalyze-selected-tags">
                    <span className="preanalyze-selected-label">Selected:</span>
                    {Array.from(preAnalyzeTags).map((tag) => (
                      <span key={tag} className="deck-tag-chip">
                        {tag}
                        <button className="deck-tag-chip-remove" onClick={() => setPreAnalyzeTags((prev) => { const n = new Set(prev); n.delete(tag); return n; })}>×</button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="my-decks-modal-footer">
                  <button className="btn-secondary" onClick={() => setShowPreAnalyze(false)}>Cancel</button>
                  <button className="btn-secondary" onClick={() => {
                    const swapNames = swapSelectMode ? Array.from(selectedForSwap) : [];
                    handleAnalyze([], swapNames);
                  }}>Analyze without tags</button>
                  <button className="btn-primary" onClick={() => {
                    const allFilters = [...Array.from(preAnalyzeTags), ...Array.from(preAnalyzeTypes)];
                    const swapNames = swapSelectMode ? Array.from(selectedForSwap) : [];
                    handleAnalyze(allFilters, swapNames);
                  }}>
                    {(preAnalyzeTags.size + preAnalyzeTypes.size) > 0
                      ? `Analyze with ${preAnalyzeTags.size + preAnalyzeTypes.size} filter${(preAnalyzeTags.size + preAnalyzeTypes.size) > 1 ? "s" : ""}`
                      : "Start Analysis"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Sideboard */}
          <div className="sideboard-section">
            <div className="sideboard-header">
              <h3>Sideboard <span className="sideboard-count">({(detail.sideboard || []).length})</span></h3>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => { setSideboardAddMode(true); setShowAddFromCollection(true); }}
              >
                + Add to Sideboard
              </button>
            </div>
            {(detail.sideboard || []).length === 0 ? (
              <p className="sideboard-empty">No sideboard cards yet. Add substitutes or tech cards here.</p>
            ) : (
              <div className="card-grid sideboard-grid">
                {(detail.sideboard || []).map((card, idx) => (
                  <div key={`sb-${card.name}-${idx}`} className="sideboard-card-wrap">
                    <CardPreview
                      name={card.name}
                      imageUri={card.image_uri}
                      subtitle={card.type_line || "Sideboard"}
                      tcgplayerPrice={showPrices ? card.tcgplayer_price : null}
                    />
                    {editMode && (
                      <button
                        type="button"
                        className="sideboard-remove-btn"
                        onClick={() => {
                          setDetail((prev) => prev ? {
                            ...prev,
                            sideboard: (prev.sideboard || []).filter((_, i) => i !== idx),
                          } : prev);
                          setDeckModified(true);
                        }}
                      >× Remove</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

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
