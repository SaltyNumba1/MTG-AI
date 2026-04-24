import { useEffect, useMemo, useRef, useState } from "react";
import api from "../api";
import CardPreview from "../components/CardPreview";
import "./Collection.css";

interface CardEntry {
  id: string;
  name: string;
  quantity: number;
  mana_cost: string;
  cmc: number;
  type_line: string;
  colors: string[];
  color_identity: string[];
  image_uri: string;
  rarity: string;
  set_code: string;
  tcgplayer_price?: string | null;
}

interface ImportStatus {
  active: boolean;
  source: "upload" | "folder" | null;
  message: string;
  current_file: string | null;
  total_files: number;
  processed: number;
  total: number;
  percent: number;
  imported: number;
  updated: number;
  failed: number;
  started_at: string | null;
  finished_at: string | null;
}

interface FailedDetail {
  name: string;
  quantity: number;
  scryfall_id?: string;
  reason: string;
}

interface ImportResponse {
  imported: number;
  updated: number;
  failed: string[];
  failed_details?: FailedDetail[];
  touched_names?: string[];
  detected_source?: string;
  matched_columns?: Record<string, string>;
  total: number;
}

interface BackupEntry {
  filename: string;
  size: number;
  modified_at: string;
}

interface ManualDeckSavePayload {
  name: string;
  prompt: string;
  commander: Partial<CardEntry>;
  deck: Partial<CardEntry>[];
  description: string;
}

const COLOR_SYMBOLS: Record<string, string> = {
  W: "☀️", U: "💧", B: "💀", R: "🔥", G: "🌲",
};

export default function Collection() {
  const [showImportDeck, setShowImportDeck] = useState(false);
  const [decklistText, setDecklistText] = useState("");
  const [deckNameInput, setDeckNameInput] = useState("");
  const [deckImporting, setDeckImporting] = useState(false);
  const [deckImportMessage, setDeckImportMessage] = useState<string | null>(null);
  const [showManualSaveDeck, setShowManualSaveDeck] = useState(false);
  const [manualDeckName, setManualDeckName] = useState("");
  const [manualCommanderId, setManualCommanderId] = useState("");
  const [manualSaving, setManualSaving] = useState(false);
  const [showAddCard, setShowAddCard] = useState(false);
  const [addCardName, setAddCardName] = useState("");
  const [addCardQty, setAddCardQty] = useState<number>(1);
  const [addCardBusy, setAddCardBusy] = useState(false);
  const [addCardMessage, setAddCardMessage] = useState<string | null>(null);
  const handleAddCard = async () => {
    const name = addCardName.trim();
    if (!name) return;
    setAddCardBusy(true);
    setAddCardMessage(null);
    try {
      const { data } = await api.post("/collection/add-card", {
        name,
        quantity: Math.max(1, Math.floor(addCardQty || 1)),
      });
      const verb = data?.status === "imported" ? "Added" : "Updated";
      setMessage({ type: "success", text: `${verb} ${data?.name || name} (+${data?.quantity || 1})` });
      setAddCardName("");
      setAddCardQty(1);
      setShowAddCard(false);
      await fetchCards();
    } catch (err: any) {
      setAddCardMessage(err.response?.data?.detail || "Failed to add card");
    } finally {
      setAddCardBusy(false);
    }
  };
  const handleImportDeck = async () => {
    setDeckImporting(true);
    setDeckImportMessage(null);
    try {
      await api.post("/deck/import-deck", {
        decklist: decklistText,
        deck_name: deckNameInput.trim() || undefined,
      });
      setDeckImportMessage("Deck imported and saved to My Decks");
      setDecklistText("");
      setDeckNameInput("");
      setShowImportDeck(false);
    } catch (err: any) {
      setDeckImportMessage(err.response?.data?.detail || "Deck import failed");
    } finally {
      setDeckImporting(false);
    }
  };

  const [showImportText, setShowImportText] = useState(false);
  const [importText, setImportText] = useState("");
  const [importTextBusy, setImportTextBusy] = useState(false);
  const [importTextMessage, setImportTextMessage] = useState<string | null>(null);
  const handleImportTextSubmit = async () => {
    const text = importText.trim();
    if (!text) return;
    setImportTextBusy(true);
    setImportTextMessage(null);
    try {
      const { data } = await api.post("/collection/import-text", { text });
      setMessage({
        type: "success",
        text: `Imported ${data?.imported ?? 0} new, updated ${data?.updated ?? 0} existing card(s) from text.`,
      });
      setImportText("");
      setShowImportText(false);
      await fetchCards();
    } catch (err: any) {
      setImportTextMessage(err.response?.data?.detail || "Text import failed");
    } finally {
      setImportTextBusy(false);
    }
  };
  const handleImportTextFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    setImportText(text);
    e.target.value = "";
  };
  const [cards, setCards] = useState<CardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null);
  const [search, setSearch] = useState("");
  const [colorFilter, setColorFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [rarityFilter, setRarityFilter] = useState<string>("all");
  const [setFilter, setSetFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"name" | "quantity" | "cmc" | "recent">("name");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<"set" | "adjust">("adjust");
  const [bulkValue, setBulkValue] = useState<number>(1);
  const [failedRows, setFailedRows] = useState<FailedDetail[]>([]);
  const [lastImportedNames, setLastImportedNames] = useState<Record<string, number>>({});
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [selectedBackup, setSelectedBackup] = useState<string>("");
  const [backupBusy, setBackupBusy] = useState(false);
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const FILTERS_KEY = "mtg.collection.filters";
  const RECENT_KEY = "mtg.collection.recentImported";

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FILTERS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setSearch(parsed.search || "");
        setColorFilter(parsed.colorFilter || "all");
        setTypeFilter(parsed.typeFilter || "all");
        setRarityFilter(parsed.rarityFilter || "all");
        setSetFilter(parsed.setFilter || "all");
        setSortBy(parsed.sortBy || "name");
      }
      const recentRaw = localStorage.getItem(RECENT_KEY);
      if (recentRaw) {
        setLastImportedNames(JSON.parse(recentRaw));
      }
    } catch {
      // keep defaults if local storage is invalid
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      FILTERS_KEY,
      JSON.stringify({ search, colorFilter, typeFilter, rarityFilter, setFilter, sortBy })
    );
  }, [search, colorFilter, typeFilter, rarityFilter, setFilter, sortBy]);

  const loadBackups = async () => {
    try {
      const { data } = await api.get<BackupEntry[]>("/collection/backups");
      setBackups(data);
      if (!selectedBackup && data.length > 0) {
        setSelectedBackup(data[0].filename);
      }
    } catch {
      // ignore backup listing failures
    }
  };

  const fetchCards = async () => {
    setLoading(true);
    try {
      const { data } = await api.get<CardEntry[]>("/collection/");
      setCards(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCards();
    loadBackups();
  }, []);

  useEffect(() => {
    let unmounted = false;
    const fetchImportStatus = async () => {
      try {
        const { data } = await api.get<ImportStatus>("/collection/import-status");
        if (!unmounted) setImportStatus(data);
      } catch {
        // Keep UI usable if import status polling fails.
      }
    };

    fetchImportStatus();
    const timer = setInterval(fetchImportStatus, 1000);
    return () => {
      unmounted = true;
      clearInterval(timer);
      setImportStatus(null); // Clear status on unmount
    };
  }, []);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setMessage(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const { data } = await api.post<ImportResponse>("/collection/import", form);
      setFailedRows(data.failed_details || []);

      if (data.touched_names?.length) {
        const now = Date.now();
        const next = { ...lastImportedNames };
        for (const name of data.touched_names) {
          next[name] = now;
        }
        setLastImportedNames(next);
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      }

      setMessage({
        type: "success",
        text: `${data.detected_source ? `Detected ${data.detected_source} format. ` : ""}Imported ${data.imported} new cards, updated ${data.updated}. ${
          data.failed.length ? `Failed: ${data.failed.join(", ")}` : ""
        }`,
      });
      await fetchCards();
    } catch (err: any) {
      setMessage({ type: "error", text: err.response?.data?.detail || "Import failed" });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const cancelImport = async () => {
    try {
      await api.post("/collection/import-cancel");
      setMessage({ type: "info", text: "Cancel requested. Import will stop shortly." });
    } catch (err: any) {
      try {
        if (err?.response?.status === 405) {
          await api.delete("/collection/import-cancel");
          setMessage({ type: "info", text: "Cancel requested. Import will stop shortly." });
          return;
        }
      } catch {
        // Fall through to generic error message.
      }
      setMessage({ type: "error", text: err.response?.data?.detail || "Failed to cancel import" });
    }
  };

  const handleDelete = async (id: string) => {
    await api.delete(`/collection/${id}`);
    setCards((prev) => prev.filter((c) => c.id !== id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handleClearCollection = async () => {
    if (!confirm("Are you sure you want to delete your entire collection? This cannot be undone.")) {
      return;
    }
    try {
      await api.delete("/collection/");
      setCards([]);
      setMessage({ type: "success", text: "Collection cleared successfully" });
    } catch (err: any) {
      setMessage({ type: "error", text: err.response?.data?.detail || "Failed to clear collection" });
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} selected cards?`)) return;
    await api.post("/collection/bulk-delete", { ids: Array.from(selectedIds) });
    await fetchCards();
    setSelectedIds(new Set());
    setMessage({ type: "success", text: "Selected cards deleted" });
  };

  const handleBulkQuantity = async () => {
    if (selectedIds.size === 0) return;
    await api.post("/collection/bulk-quantity", {
      ids: Array.from(selectedIds),
      action: bulkAction,
      value: bulkValue,
    });
    await fetchCards();
    setMessage({ type: "success", text: "Bulk quantity update applied" });
  };

  const retryFailed = async () => {
    if (failedRows.length === 0) return;
    setImporting(true);
    try {
      const payload = {
        items: failedRows.map((x) => ({ name: x.name, quantity: x.quantity, scryfall_id: x.scryfall_id })),
      };
      const { data } = await api.post<ImportResponse>("/collection/import/retry-failed", payload);
      setFailedRows(data.failed_details || []);
      if (data.touched_names?.length) {
        const now = Date.now();
        const next = { ...lastImportedNames };
        for (const name of data.touched_names) {
          next[name] = now;
        }
        setLastImportedNames(next);
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      }
      await fetchCards();
      setMessage({
        type: "success",
        text: `Retry complete: imported ${data.imported}, updated ${data.updated}, still failed ${data.failed.length}`,
      });
    } catch (err: any) {
      setMessage({ type: "error", text: err.response?.data?.detail || "Retry failed" });
    } finally {
      setImporting(false);
    }
  };

  const downloadFailedCsv = () => {
    if (failedRows.length === 0) return;
    const lines = ["name,quantity,reason"];
    for (const row of failedRows) {
      const safe = (val: string) => `"${val.replace(/"/g, '""')}"`;
      lines.push([safe(row.name), String(row.quantity), safe(row.reason)].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "import-failures.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const createBackup = async () => {
    setBackupBusy(true);
    try {
      await api.post("/collection/backup");
      await loadBackups();
      setMessage({ type: "success", text: "Backup created" });
    } catch (err: any) {
      setMessage({ type: "error", text: err.response?.data?.detail || "Backup failed" });
    } finally {
      setBackupBusy(false);
    }
  };

  const restoreBackup = async () => {
    if (!selectedBackup) return;
    if (!confirm(`Restore backup ${selectedBackup}? This will overwrite current DB.`)) return;
    setBackupBusy(true);
    try {
      await api.post("/collection/restore", { filename: selectedBackup });
      await fetchCards();
      setSelectedIds(new Set());
      setMessage({ type: "success", text: `Restored backup ${selectedBackup}` });
    } catch (err: any) {
      setMessage({ type: "error", text: err.response?.data?.detail || "Restore failed" });
    } finally {
      setBackupBusy(false);
    }
  };

  const colorOptions: { code: string; label: string }[] = [
    { code: "C", label: "◇ Colorless" },
    { code: "W", label: "⚪ White" },
    { code: "U", label: "💧 Blue" },
    { code: "B", label: "💀 Black" },
    { code: "R", label: "🔥 Red" },
    { code: "G", label: "🌲 Green" },
  ];

  const rarityOptions = useMemo(() => {
    const s = new Set(cards.map((c) => c.rarity).filter(Boolean));
    return Array.from(s).sort();
  }, [cards]);

  const setOptions = useMemo(() => {
    const s = new Set(cards.map((c) => c.set_code).filter(Boolean));
    return Array.from(s).sort();
  }, [cards]);

  const typeOptions = useMemo(() => {
    const s = new Set(
      cards
        .map((c) => (c.type_line || "").split("—")[0].trim())
        .filter(Boolean)
    );
    return Array.from(s).sort();
  }, [cards]);

  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const rows = cards.filter((c) => {
      if (normalizedSearch && !c.name.toLowerCase().includes(normalizedSearch)) return false;
      if (colorFilter === "C") {
        if ((c.colors || []).length > 0) return false;
      } else if (colorFilter !== "all" && !(c.color_identity || []).includes(colorFilter)) {
        return false;
      }
      if (typeFilter !== "all") {
        const rootType = (c.type_line || "").split("—")[0].trim();
        if (rootType !== typeFilter) return false;
      }
      if (rarityFilter !== "all" && c.rarity !== rarityFilter) return false;
      if (setFilter !== "all" && c.set_code !== setFilter) return false;
      return true;
    });

    rows.sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "quantity") return b.quantity - a.quantity || a.name.localeCompare(b.name);
      if (sortBy === "cmc") return (b.cmc || 0) - (a.cmc || 0) || a.name.localeCompare(b.name);
      const ta = lastImportedNames[a.name] || 0;
      const tb = lastImportedNames[b.name] || 0;
      return tb - ta || a.name.localeCompare(b.name);
    });
    return rows;
  }, [cards, search, colorFilter, typeFilter, rarityFilter, setFilter, sortBy, lastImportedNames]);

  const selectedCount = selectedIds.size;
  const totalCardCount = cards.reduce((acc, card) => acc + (card.quantity || 0), 0);
  const selectedCards = cards.filter((card) => selectedIds.has(card.id));
  const selectedCommanderCandidates = selectedCards.filter((card) => {
    const typeLine = (card.type_line || "").toLowerCase();
    return typeLine.includes("legendary") && typeLine.includes("creature");
  });

  const openManualSaveModal = () => {
    if (selectedCards.length === 0) {
      setMessage({ type: "error", text: "Select cards first to save a manual deck" });
      return;
    }
    const fallbackCommander = selectedCommanderCandidates[0] || selectedCards[0];
    setManualCommanderId(fallbackCommander?.id || "");
    setManualDeckName(fallbackCommander?.name ? `${fallbackCommander.name} Manual Deck` : "Manual Deck");
    setShowManualSaveDeck(true);
  };

  const saveManualDeck = async () => {
    const commander = selectedCards.find((card) => card.id === manualCommanderId);
    if (!commander) {
      setMessage({ type: "error", text: "Choose a commander for this manual deck" });
      return;
    }

    const deckCards = selectedCards
      .filter((card) => card.id !== commander.id)
      .map((card) => ({
        name: card.name,
        image_uri: card.image_uri,
        type_line: card.type_line,
        tcgplayer_price: card.tcgplayer_price,
      }));

    const payload: ManualDeckSavePayload = {
      name: (manualDeckName || `${commander.name} Manual Deck`).trim(),
      prompt: "Manual deck built from selected collection cards",
      commander: {
        name: commander.name,
        image_uri: commander.image_uri,
        type_line: commander.type_line,
        tcgplayer_price: commander.tcgplayer_price,
      },
      deck: deckCards,
      description: `Manual deck saved from collection selection (${deckCards.length + 1} cards).`,
    };

    setManualSaving(true);
    try {
      await api.post("/deck/save", payload);
      setShowManualSaveDeck(false);
      setMessage({ type: "success", text: "Manual deck saved to My Decks" });
    } catch (err: any) {
      setMessage({ type: "error", text: err.response?.data?.detail || "Failed to save manual deck" });
    } finally {
      setManualSaving(false);
    }
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectFiltered = () => {
    const allFilteredSelected = filtered.every((c) => selectedIds.has(c.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const c of filtered) next.delete(c.id);
      } else {
        for (const c of filtered) next.add(c.id);
      }
      return next;
    });
  };

  return (
    <div className="page">
      <h1 className="page-title">My Collection ({cards.length} unique cards | {totalCardCount} total cards)</h1>

      <div className="collection-toolbar">
        <div className="collection-toolbar-group" title="Add cards to your collection">
          <button className="btn-primary" type="button" onClick={() => { setAddCardMessage(null); setShowAddCard(true); }}>
            Add Card
          </button>
          <label className="collection-import-label">
            <button
              className="btn-primary"
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={importing || importStatus?.active}
            >
              {importing || importStatus?.active ? "Importing..." : "Import CSV"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="collection-import-input"
              onChange={handleImport}
            />
          </label>
          <button className="btn-primary" type="button" onClick={() => { setImportTextMessage(null); setShowImportText(true); }}>
            Import Cards from Text
          </button>
          <button
            className="btn-secondary"
            type="button"
            onClick={cancelImport}
            disabled={!importStatus?.active}
          >
            Cancel Import
          </button>
        </div>

        <div className="collection-toolbar-group" title="Decks">
          <button className="btn-secondary" type="button" onClick={() => setShowImportDeck(true)}>
            Import Deck (saved to My Decks)
          </button>
        </div>

        <div className="collection-toolbar-group" title="Danger zone">
          <button
            className="btn-danger"
            type="button"
            onClick={handleClearCollection}
            disabled={cards.length === 0}
          >
            Delete Collection
          </button>
        </div>
      </div>

      {/* Add Card Modal */}
      {showAddCard && (
        <div className="collection-modal-overlay">
          <div className="collection-modal">
            <h2 className="collection-modal-title">Add Single Card</h2>
            <input
              className="collection-search"
              value={addCardName}
              onChange={(e) => setAddCardName(e.target.value)}
              placeholder="Card name (e.g. 'Sol Ring')"
              disabled={addCardBusy}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && addCardName.trim() && !addCardBusy) handleAddCard();
              }}
            />
            <input
              type="number"
              min={1}
              className="collection-search"
              style={{ marginTop: 10 }}
              value={addCardQty}
              onChange={(e) => setAddCardQty(Number(e.target.value || 1))}
              placeholder="Quantity"
              disabled={addCardBusy}
            />
            <div className="collection-modal-footer">
              <button className="btn-secondary" type="button" onClick={() => setShowAddCard(false)} disabled={addCardBusy}>Cancel</button>
              <button className="btn-primary" type="button" onClick={handleAddCard} disabled={addCardBusy || !addCardName.trim()}>
                {addCardBusy ? "Adding..." : "Add Card"}
              </button>
            </div>
            {addCardMessage && <div className="collection-modal-error">{addCardMessage}</div>}
          </div>
        </div>
      )}

      {/* Import Deck Modal */}
      {showImportDeck && (
        <div className="collection-modal-overlay">
          <div className="collection-modal">
            <h2 className="collection-modal-title">Import Decklist</h2>
            <textarea
              className="collection-modal-textarea"
              rows={10}
              value={decklistText}
              onChange={e => setDecklistText(e.target.value)}
              placeholder={"Paste your decklist here (one card per line, e.g. '1 Sol Ring')"}
              disabled={deckImporting}
            />
            <input
              className="collection-search"
              style={{ marginTop: 10 }}
              value={deckNameInput}
              onChange={(e) => setDeckNameInput(e.target.value)}
              placeholder="Optional deck name (saved in My Decks)"
              disabled={deckImporting}
            />
            <div className="collection-modal-footer">
              <button className="btn-secondary" type="button" onClick={() => setShowImportDeck(false)} disabled={deckImporting}>Cancel</button>
              <button className="btn-primary" type="button" onClick={handleImportDeck} disabled={deckImporting || !decklistText.trim()}>
                {deckImporting ? "Importing..." : "Import Deck"}
              </button>
            </div>
            {deckImportMessage && <div className="collection-modal-error">{deckImportMessage}</div>}
          </div>
        </div>
      )}

      <div className="collection-bulk-toolbar">
        <button className="btn-secondary" type="button" onClick={toggleSelectFiltered} disabled={filtered.length === 0}>
          {filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id))
            ? "Unselect Filtered"
            : "Select Filtered"}
        </button>
        <span style={{ color: "#94a3b8", fontSize: 13 }}>Selected: {selectedCount}</span>
        <button className="btn-danger" type="button" disabled={selectedCount === 0} onClick={handleBulkDelete}>
          Bulk Delete
        </button>
        <button className="btn-primary" type="button" disabled={selectedCount === 0} onClick={openManualSaveModal}>
          Save Selected as Deck
        </button>
        <select aria-label="Bulk quantity action" title="Bulk quantity action" value={bulkAction} onChange={(e) => setBulkAction(e.target.value as "set" | "adjust")} className="collection-bulk-action">
          <option value="adjust">Adjust Qty</option>
          <option value="set">Set Qty</option>
        </select>
        <input
          type="number"
          aria-label="Bulk quantity value"
          title="Bulk quantity value"
          value={bulkValue}
          onChange={(e) => setBulkValue(Number(e.target.value || 0))}
          className="collection-bulk-value"
        />
        <button className="btn-primary" type="button" disabled={selectedCount === 0} onClick={handleBulkQuantity}>
          Apply Qty
        </button>
      </div>

      {message && (
        <div className={`alert alert-${message.type}`}>{message.text}</div>
      )}

      {importStatus && (importStatus.active || importStatus.total > 0) && (
        <div className="import-progress import-progress-circular">
          <div className="import-progress-circular-wrap">
            {(() => {
              const radius = 44;
              const circ = 2 * Math.PI * radius;
              const pct = Math.max(0, Math.min(100, importStatus.percent || 0));
              const offset = circ * (1 - pct / 100);
              return (
                <svg width="110" height="110" viewBox="0 0 110 110" aria-label="Import progress">
                  <circle cx="55" cy="55" r={radius} stroke="rgba(148,163,184,0.25)" strokeWidth="9" fill="none" />
                  <circle
                    cx="55" cy="55" r={radius}
                    stroke="#22c55e" strokeWidth="9" fill="none"
                    strokeLinecap="round"
                    strokeDasharray={circ}
                    strokeDashoffset={offset}
                    transform="rotate(-90 55 55)"
                    style={{ transition: "stroke-dashoffset 200ms ease" }}
                  />
                  <text x="55" y="58" textAnchor="middle" dominantBaseline="middle" fontSize="18" fontWeight="700" fill="#e2e8f0">
                    {pct}%
                  </text>
                </svg>
              );
            })()}
          </div>
          <div className="import-progress-info-block">
            <div style={{ fontSize: 13, marginBottom: 4 }}>
              {importStatus.source === "folder" ? "Startup folder import" : "CSV upload import"}
              {importStatus.current_file ? `: ${importStatus.current_file}` : ""}
            </div>
            <small className="import-progress-info">
              Processed {importStatus.processed}/{importStatus.total} | Imported {importStatus.imported} | Updated {importStatus.updated} | Failed {importStatus.failed}
            </small>
            {!importStatus.active && importStatus.message && (
              <small className="import-progress-success">{importStatus.message}</small>
            )}
          </div>
        </div>
      )}

      {/* Import Cards from Text Modal */}
      {showImportText && (
        <div className="collection-modal-overlay">
          <div className="collection-modal">
            <h2 className="collection-modal-title">Import Cards from Text</h2>
            <small style={{ color: "#94a3b8", display: "block", marginBottom: 8 }}>
              Paste a decklist (one entry per line, e.g. <code>1 Sol Ring</code>). Cards will be added to your collection (existing quantities increment).
            </small>
            <textarea
              className="collection-modal-textarea"
              rows={10}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={"1 Sol Ring\n1 Arcane Signet\n2 Lightning Bolt"}
              disabled={importTextBusy}
            />
            <label className="collection-import-label" style={{ marginTop: 8 }}>
              <button
                className="btn-secondary"
                type="button"
                onClick={() => document.getElementById("import-text-file")?.click()}
                disabled={importTextBusy}
              >
                Load from .txt
              </button>
              <input
                id="import-text-file"
                type="file"
                accept=".txt"
                className="collection-import-input"
                onChange={handleImportTextFile}
              />
            </label>
            <div className="collection-modal-footer">
              <button className="btn-secondary" type="button" onClick={() => setShowImportText(false)} disabled={importTextBusy}>Cancel</button>
              <button className="btn-primary" type="button" onClick={handleImportTextSubmit} disabled={importTextBusy || !importText.trim()}>
                {importTextBusy ? "Adding..." : "Add to Collection"}
              </button>
            </div>
            {importTextMessage && <div className="collection-modal-error">{importTextMessage}</div>}
          </div>
        </div>
      )}

      {failedRows.length > 0 && (
        <div className="alert alert-info" style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8 }}>Failed rows available: {failedRows.length}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn-primary" onClick={retryFailed} disabled={importing}>Retry Failed Only</button>
            <button className="btn-secondary" onClick={downloadFailedCsv}>Download Failed CSV</button>
          </div>
        </div>
      )}

      {showManualSaveDeck && (
        <div className="collection-modal-overlay">
          <div className="collection-modal">
            <h2 className="collection-modal-title">Save Manual Deck</h2>
            <input
              className="collection-search"
              value={manualDeckName}
              onChange={(e) => setManualDeckName(e.target.value)}
              placeholder="Deck name"
              disabled={manualSaving}
            />
            <select
              aria-label="Manual deck commander"
              title="Manual deck commander"
              className="collection-filter"
              value={manualCommanderId}
              onChange={(e) => setManualCommanderId(e.target.value)}
              disabled={manualSaving}
              style={{ marginTop: 10, width: "100%" }}
            >
              {selectedCards.map((card) => (
                <option key={card.id} value={card.id}>{card.name}</option>
              ))}
            </select>
            <small style={{ color: "#94a3b8", marginTop: 8, display: "block" }}>
              Tip: select a legendary creature as commander.
            </small>
            <div className="collection-modal-footer">
              <button className="btn-secondary" type="button" onClick={() => setShowManualSaveDeck(false)} disabled={manualSaving}>Cancel</button>
              <button className="btn-primary" type="button" onClick={saveManualDeck} disabled={manualSaving || !manualCommanderId}>
                {manualSaving ? "Saving..." : "Save to My Decks"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="collection-db-safety">
        <div className="collection-db-title">Database Safety</div>
        <div className="collection-db-toolbar">
          <button className="btn-primary" type="button" onClick={createBackup} disabled={backupBusy}>Create Backup</button>
          <button className="btn-secondary" type="button" onClick={loadBackups} disabled={backupBusy}>Refresh Backups</button>
          <select
            aria-label="Backup selection"
            title="Backup selection"
            value={selectedBackup}
            onChange={(e) => setSelectedBackup(e.target.value)}
            className="collection-db-backup-select"
          >
            <option value="">Select backup</option>
            {backups.map((b) => (
              <option key={b.filename} value={b.filename}>{b.filename}</option>
            ))}
          </select>
          <button className="btn-danger" type="button" onClick={restoreBackup} disabled={!selectedBackup || backupBusy}>
            Restore Selected Backup
          </button>
        </div>
      </div>

      <div className="collection-filter-bar">
        <input
          className="collection-search"
          placeholder="Search cards..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select aria-label="Color filter" title="Color filter" value={colorFilter} onChange={(e) => setColorFilter(e.target.value)} className="collection-filter">
          <option value="all">All Colors</option>
          {colorOptions.map((c) => (
            <option key={c.code} value={c.code}>{c.label}</option>
          ))}
        </select>
        <select aria-label="Type filter" title="Type filter" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="collection-type-filter">
          <option value="all">All Types</option>
          {typeOptions.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select aria-label="Rarity filter" title="Rarity filter" value={rarityFilter} onChange={(e) => setRarityFilter(e.target.value)} className="collection-rarity-filter">
          <option value="all">All Rarity</option>
          {rarityOptions.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select aria-label="Set filter" title="Set filter" value={setFilter} onChange={(e) => setSetFilter(e.target.value)} className="collection-set-filter">
          <option value="all">All Sets</option>
          {setOptions.map((s) => (
            <option key={s} value={s}>{s.toUpperCase()}</option>
          ))}
        </select>
        <select
          aria-label="Sort cards"
          title="Sort cards"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "name" | "quantity" | "cmc" | "recent")}
          className="collection-sort"
        >
          <option value="name">Sort: Name</option>
          <option value="quantity">Sort: Quantity</option>
          <option value="cmc">Sort: CMC</option>
          <option value="recent">Sort: Recently Imported</option>
        </select>
      </div>

      {loading ? (
        <p>Loading collection...</p>
      ) : filtered.length === 0 ? (
        <div className="alert alert-info">
          No cards yet. Import a CSV to get started.
          <br />
          <small>Supported formats: Moxfield, Archidekt, ManaBox, or any CSV with a "name" column.</small>
        </div>
      ) : (
        <div className="card-grid">
          {filtered.map((card) => (
            <CardPreview
              key={card.id}
              name={card.name}
              imageUri={card.image_uri}
              subtitle={`${card.type_line} | ${card.rarity || "-"} | ${(card.set_code || "-").toUpperCase()}`}
              quantity={card.quantity}
              tcgplayerPrice={card.tcgplayer_price}
            >
              <div className="collection-card-row">
                <span>
                  {(card.color_identity || []).map((c) => COLOR_SYMBOLS[c] || c).join("")}
                </span>
                <input
                  type="checkbox"
                  aria-label={`Select ${card.name}`}
                  title={`Select ${card.name}`}
                  checked={selectedIds.has(card.id)}
                  onChange={() => toggleSelected(card.id)}
                  className="collection-card-checkbox"
                />
                <button
                  className="btn-danger collection-card-delete"
                  type="button"
                  onClick={() => handleDelete(card.id)}
                >
                  ✕
                </button>
              </div>
            </CardPreview>
          ))}
        </div>
      )}
    </div>
  );
}
