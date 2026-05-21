import { useEffect, useMemo, useRef, useState } from "react";
import api from "../api";
import CardPreview from "../components/CardPreview";
import "./Collection.css";

// Types for Archidekt precon data
type ArchidektPreconData = {
  [setName: string]: { deck_name: string; url: string }[];
};

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

interface SavedDeckSummary {
  file: string;
  name: string;
  commander: string;
  card_count: number;
}

const COLOR_SYMBOLS: Record<string, string> = {
  W: "☀️", U: "💧", B: "💀", R: "🔥", G: "🌲",
};

export default function Collection() {
  const [showImportDeck, setShowImportDeck] = useState(false);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef({ active: false, offsetX: 0, offsetY: 0 });
  const [modalPos, setModalPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Initialize modal position to center on first mount
  useEffect(() => {
    const setInitial = () => {
      const w = window.innerWidth || 800;
      const h = window.innerHeight || 600;
      setModalPos({ x: Math.max(20, Math.round(w / 2 - 320)), y: Math.max(20, Math.round(h / 2 - 200)) });
    };
    setInitial();
    window.addEventListener("resize", setInitial);
    return () => window.removeEventListener("resize", setInitial);
  }, []);

  const startDrag = (e: React.MouseEvent) => {
    const el = modalRef.current;
    if (!el) return;
    draggingRef.current.active = true;
    const rect = el.getBoundingClientRect();
    draggingRef.current.offsetX = e.clientX - rect.left;
    draggingRef.current.offsetY = e.clientY - rect.top;

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current.active) return;
      setModalPos({ x: ev.clientX - draggingRef.current.offsetX, y: ev.clientY - draggingRef.current.offsetY });
    };
    const onUp = () => {
      draggingRef.current.active = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const [decklistText, setDecklistText] = useState("");
  const [deckNameInput, setDeckNameInput] = useState("");
  const [deckImporting, setDeckImporting] = useState(false);
  const [deckImportMessage, setDeckImportMessage] = useState<string | null>(null);
  const [showManualSaveDeck, setShowManualSaveDeck] = useState(false);
  const [manualDeckName, setManualDeckName] = useState("");
  const [manualCommanderId, setManualCommanderId] = useState("");
  const [manualSaving, setManualSaving] = useState(false);

  // Add to Deck state
  const [showAddToDeck, setShowAddToDeck] = useState(false);
  const [addToDeckDecks, setAddToDeckDecks] = useState<SavedDeckSummary[]>([]);
  const [addToDeckFile, setAddToDeckFile] = useState("");
  const [addToDeckDest, setAddToDeckDest] = useState<"mainboard" | "sideboard">("mainboard");
  const [addToDeckBusy, setAddToDeckBusy] = useState(false);
  const [addToDeckMessage, setAddToDeckMessage] = useState<string | null>(null);

  const openAddToDeck = async () => {
    if (selectedCards.length === 0) {
      setMessage({ type: "error", text: "Select cards first" });
      return;
    }
    try {
      const { data } = await api.get<SavedDeckSummary[]>("/deck/saved");
      setAddToDeckDecks(data);
      setAddToDeckFile(data[0]?.file || "");
      setAddToDeckDest("mainboard");
      setAddToDeckMessage(null);
      setShowAddToDeck(true);
    } catch {
      setMessage({ type: "error", text: "Could not load saved decks" });
    }
  };

  const handleAddToDeck = async () => {
    if (!addToDeckFile) return;
    setAddToDeckBusy(true);
    setAddToDeckMessage(null);
    try {
      const { data: deck } = await api.get(`/deck/saved/${addToDeckFile}`);
      const newCards = selectedCards.map((c) => ({
        name: c.name,
        image_uri: c.image_uri,
        type_line: c.type_line,
        tcgplayer_price: c.tcgplayer_price,
      }));
      const body: Record<string, unknown> = { deck: deck.deck, sideboard: deck.sideboard || [] };
      if (addToDeckDest === "sideboard") {
        body.sideboard = [...(deck.sideboard || []), ...newCards];
      } else {
        body.deck = [...deck.deck, ...newCards];
      }
      await api.put(`/deck/saved/${addToDeckFile}`, body);
      const destLabel = addToDeckDest === "sideboard" ? "sideboard" : "mainboard";
      setAddToDeckMessage(`Added ${newCards.length} card(s) to ${destLabel}.`);
    } catch (err: any) {
      setAddToDeckMessage(err.response?.data?.detail || "Failed to add cards to deck");
    } finally {
      setAddToDeckBusy(false);
    }
  };

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
  const [message, setMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [search, setSearch] = useState("");
  const [colorFilter, setColorFilter] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [rarityFilter, setRarityFilter] = useState<string>("all");
  const [setFilter, setSetFilter] = useState<string>("all");
  const [manaCostFilter, setManaCostFilter] = useState<number[]>([]);
  const [sortBy, setSortBy] = useState<"name" | "quantity" | "cmc" | "recent" | "price">("name");
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
        setColorFilter(
          Array.isArray(parsed.colorFilter)
            ? parsed.colorFilter.filter((s: any) => typeof s === "string")
            : (parsed.colorFilter && parsed.colorFilter !== "all" ? [parsed.colorFilter] : [])
        );
        setTypeFilter(parsed.typeFilter || "all");
        setRarityFilter(parsed.rarityFilter || "all");
        setSetFilter(parsed.setFilter || "all");
        setSortBy(parsed.sortBy || "name");
        if (Array.isArray(parsed.manaCostFilter)) {
          setManaCostFilter(parsed.manaCostFilter.filter((n: any) => Number.isFinite(n)));
        }
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
      JSON.stringify({ search, colorFilter, typeFilter, rarityFilter, setFilter, sortBy, manaCostFilter })
    );
  }, [search, colorFilter, typeFilter, rarityFilter, setFilter, sortBy, manaCostFilter]);

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

  // Refresh collection when an external action imports cards (e.g., MyDecks -> Add to Collection)
  useEffect(() => {
    const handler = () => {
      fetchCards();
    };
    window.addEventListener("collection-updated", handler);
    return () => window.removeEventListener("collection-updated", handler);
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
    await refreshImportStatus(); // Force status refresh on import start
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
      await refreshImportStatus(); // Force status refresh after import completes
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
      const { data } = await api.post<{ backups: BackupEntry[]; backup_path: string }>("/collection/backup");
      setBackups(data.backups);
      if (data.backups.length > 0) setSelectedBackup(data.backups[0].filename);
      setMessage({ type: "success", text: `Backup saved to: ${data.backup_path}` });
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

  const SUPERTYPES = new Set(["Legendary", "Snow", "Basic", "World", "Ongoing"]);

  const typeOptions = useMemo(() => {
    const roots = new Set<string>();
    const compounds = new Set<string>();
    for (const c of cards) {
      // For DFC cards, type_line is "FaceA — Sub // FaceB — Sub". Use only the primary face.
      const tl = (c.type_line || "").split(" // ")[0];
      const [rootPart, subPart] = tl.split("—");
      const root = (rootPart || "").trim();
      if (!root) continue;
      const rootWords = root.split(/\s+/).filter(Boolean);
      const supertypes = rootWords.filter((w) => SUPERTYPES.has(w));
      const types = rootWords.filter((w) => !SUPERTYPES.has(w));
      const primary = types[types.length - 1] || rootWords[rootWords.length - 1];
      roots.add(primary);
      // Supertype compounds (e.g. "Creature // Legendary")
      for (const sup of supertypes) {
        compounds.add(`${primary} // ${sup}`);
      }
      // Subtype compounds (e.g. "Creature // Wizard")
      const subs = (subPart || "").trim().split(/\s+/).map((s) => s.trim()).filter(Boolean);
      for (const sub of subs) {
        compounds.add(`${primary} // ${sub}`);
      }
    }
    return [
      ...Array.from(roots).sort(),
      ...Array.from(compounds).sort(),
    ];
  }, [cards]);

  const maxCmc = useMemo(() => {
    let m = 0;
    for (const c of cards) {
      const v = Math.floor(Number(c.cmc) || 0);
      if (v > m) m = v;
    }
    return m;
  }, [cards]);

  const hasXCost = (c: CardEntry) => /\{\s*X\s*\}/i.test(c.mana_cost || "");

  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const manaSet = new Set(manaCostFilter);
    const rows = cards.filter((c) => {
      if (normalizedSearch && !c.name.toLowerCase().includes(normalizedSearch)) return false;
      if (colorFilter.length > 0) {
        const wantsColorless = colorFilter.includes("C");
        const wantedColors = colorFilter.filter((x) => x !== "C");
        const ci = c.color_identity || [];
        // Strict identity: card's full color identity must be a subset of the selected colors.
        // Colorless cards (empty ci) are legal in any commander identity, so always include them
        // when color filters are active. If ONLY "C" is selected, show colorless cards only.
        const isColorless = ci.length === 0;
        if (wantedColors.length === 0 && wantsColorless) {
          // Only "C" selected — show colorless cards only
          if (!isColorless) return false;
        } else if (wantedColors.length > 0) {
          // Color(s) selected — card identity must be fully within selected colors
          // Colorless cards are always included (legal in any identity)
          if (!isColorless && !ci.every((col) => wantedColors.includes(col))) return false;
        }
      }
      if (typeFilter !== "all") {
        // Use only the primary face for DFC cards
        const tl = (c.type_line || "").split(" // ")[0];
        const [rootPart, subPart] = tl.split("—");
        const root = (rootPart || "").trim();
        const rootWords = root.split(/\s+/).filter(Boolean);
        const supertypes = rootWords.filter((w) => SUPERTYPES.has(w));
        const types = rootWords.filter((w) => !SUPERTYPES.has(w));
        const primary = types[types.length - 1] || rootWords[rootWords.length - 1];
        const subs = (subPart || "").trim().split(/\s+/).map((s) => s.trim()).filter(Boolean);
        if (typeFilter.includes(" // ")) {
          const [wantPrimary, wantSub] = typeFilter.split(" // ").map((s) => s.trim());
          if (primary !== wantPrimary) return false;
          // Check supertypes (Legendary, Snow, etc.) separately from subtypes
          if (SUPERTYPES.has(wantSub)) {
            if (!supertypes.includes(wantSub)) return false;
          } else {
            if (!subs.includes(wantSub)) return false;
          }
        } else {
          if (primary !== typeFilter) return false;
        }
      }
      if (rarityFilter !== "all" && c.rarity !== rarityFilter) return false;
      if (setFilter !== "all" && c.set_code !== setFilter) return false;
      if (manaSet.size > 0 && !manaSet.has(Math.floor(Number(c.cmc) || 0))) return false;
      return true;
    });

    rows.sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "quantity") return b.quantity - a.quantity || a.name.localeCompare(b.name);
      if (sortBy === "price") return (Number(b.tcgplayer_price) || 0) - (Number(a.tcgplayer_price) || 0) || a.name.localeCompare(b.name);
      if (sortBy === "cmc") {
        const ca = Math.floor(Number(a.cmc) || 0);
        const cb = Math.floor(Number(b.cmc) || 0);
        if (ca !== cb) return ca - cb;
        // Float X-cost cards to the top of each mana-cost bucket
        const ax = hasXCost(a) ? 1 : 0;
        const bx = hasXCost(b) ? 1 : 0;
        if (ax !== bx) return bx - ax;
        return a.name.localeCompare(b.name);
      }
      const ta = lastImportedNames[a.name] || 0;
      const tb = lastImportedNames[b.name] || 0;
      return tb - ta || a.name.localeCompare(b.name);
    });
    return rows;
  }, [cards, search, colorFilter, typeFilter, rarityFilter, setFilter, sortBy, manaCostFilter, lastImportedNames]);

  const filteredQuantitySum = useMemo(
    () => filtered.reduce((sum, c) => sum + (c.quantity || 0), 0),
    [filtered]
  );

  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    if (colorFilter.length > 0) {
      const labels: Record<string, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green", C: "Colorless" };
      parts.push(colorFilter.map((c) => labels[c] || c).join("/"));
    }
    if (typeFilter !== "all") {
      parts.push(typeFilter.endsWith("s") ? typeFilter : `${typeFilter}s`);
    } else {
      parts.push("cards");
    }
    if (rarityFilter !== "all") parts.push(`(${rarityFilter})`);
    if (setFilter !== "all") parts.push(`from ${setFilter.toUpperCase()}`);
    if (manaCostFilter.length > 0) {
      parts.push(`@ MV ${[...manaCostFilter].sort((a, b) => a - b).join(",")}`);
    }
    if (search.trim()) parts.push(`matching "${search.trim()}"`);
    return parts.join(" ");
  }, [colorFilter, typeFilter, rarityFilter, setFilter, manaCostFilter, search]);

  const toggleManaCost = (n: number) => {
    setManaCostFilter((prev) =>
      prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n].sort((a, b) => a - b)
    );
  };

  const toggleColor = (code: string) => {
    setColorFilter((prev) =>
      prev.includes(code) ? prev.filter((x) => x !== code) : [...prev, code]
    );
  };

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
    const commanderName = manualCommanderId.trim();
if (!commanderName) {
  setMessage({ type: "error", text: "Enter a commander name for this manual deck" });
  return;
}

// Try to find commander card in selectedCards for extra info, fallback to just name
const commanderCard = selectedCards.find((card) => card.name.toLowerCase() === commanderName.toLowerCase());

const deckCards = cards
  .filter((card) => card.name.toLowerCase() !== commanderName.toLowerCase())
  .map((card) => ({
    name: card.name,
    image_uri: card.image_uri,
    type_line: card.type_line,
    tcgplayer_price: card.tcgplayer_price,
  }));

// Ensure all deck cards are present in the collection (add or increment)
for (const card of deckCards) {
  const existing = cards.find((c) => c.name.toLowerCase() === card.name.toLowerCase());
  if (existing) {
    // Increment quantity by 1
    await api.post("/collection/add-card", { name: card.name, quantity: 1 });
  } else {
    // Add new card with quantity 1
    await api.post("/collection/add-card", { name: card.name, quantity: 1 });
  }
}

const payload: ManualDeckSavePayload = {
  name: (manualDeckName || `${commanderName} Manual Deck`).trim(),
  prompt: "Manual deck built from selected collection cards",
  commander: commanderCard
    ? {
        name: commanderCard.name,
        image_uri: commanderCard.image_uri,
        type_line: commanderCard.type_line,
        tcgplayer_price: commanderCard.tcgplayer_price,
      }
    : { name: commanderName },
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

  // Reset import status when the component unmounts (user leaves the page)
  useEffect(() => {
    return () => {
      setImportStatus(null);
    };
  }, []);

  // Also reset import status when the page is shown (on mount)
  useEffect(() => {
    setImportStatus(null);
  }, []);

  // Helper to force import status refresh
  const refreshImportStatus = async () => {
    try {
      const { data } = await api.get<ImportStatus>("/collection/import-status");
      setImportStatus(data);
    } catch {}
  };
  useEffect(() => {
    refreshImportStatus();
    const timer = setInterval(refreshImportStatus, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  // Pause countdown state: when server reports a retry (e.g. "retrying in 60s"), show a countdown
  const [pauseRemaining, setPauseRemaining] = useState<number | null>(null);
  const [pauseUntil, setPauseUntil] = useState<number | null>(null);

  useEffect(() => {
    if (importStatus?.message) {
      const m = importStatus.message.match(/retrying in (\d+)s/i);
      if (m) {
        const secs = parseInt(m[1], 10);
        const until = Date.now() + secs * 1000;
        setPauseUntil(until);
        setPauseRemaining(secs);
        return;
      }
    }
    setPauseUntil(null);
    setPauseRemaining(null);
  }, [importStatus?.message]);

  useEffect(() => {
    if (!pauseUntil) return;
    const timer = setInterval(() => {
      const rem = Math.max(0, Math.ceil((pauseUntil - Date.now()) / 1000));
      setPauseRemaining(rem);
    }, 500);
    return () => clearInterval(timer);
  }, [pauseUntil]);

  return (
     <div className="page">
      <h1 className="page-title">My Collection ({cards.length} unique cards | {totalCardCount} total cards)</h1>

      <div className="collection-toolbar">
        <div className="collection-toolbar-group" title="Add cards to your collection">
          <button className="btn-primary" type="button" onClick={() => { setAddCardMessage(null); setShowAddCard(true); }}>
            Add Card
          </button>
          {/* Removed Add Precon button as requested */}
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
            Import txt
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

        {/* Removed Add deck/Import Deck button as requested */}

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
          <div className="collection-modal" ref={modalRef} style={{ position: 'fixed', left: modalPos.x, top: modalPos.y }}>
            <h2 className="collection-modal-title" onMouseDown={startDrag} style={{ cursor: 'move' }}>Add Single Card</h2>
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
              className="collection-search collection-search-margin"
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

      {/* Removed Add Precon Modal as requested */}

      {/* Add to Deck Modal */}
      {showAddToDeck && (
        <div className="collection-modal-overlay">
          <div className="collection-modal" ref={modalRef} style={{ position: 'fixed', left: modalPos.x, top: modalPos.y }}>
            <h2 className="collection-modal-title" onMouseDown={startDrag} style={{ cursor: 'move' }}>
              Add {selectedCards.length} Card{selectedCards.length !== 1 ? "s" : ""} to Deck
            </h2>
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: 'block', fontWeight: 500, color: 'white', marginBottom: 4 }}>Deck</label>
              {addToDeckDecks.length === 0 ? (
                <p style={{ color: '#9ca3af' }}>No saved decks found. Build or import a deck first.</p>
              ) : (
                <select
                  className="collection-search collection-search-margin"
                  title="Select deck to add cards to"
                  value={addToDeckFile}
                  onChange={(e) => setAddToDeckFile(e.target.value)}
                  disabled={addToDeckBusy}
                  style={{ width: '100%' }}
                >
                  {addToDeckDecks.map((d) => (
                    <option key={d.file} value={d.file}>{d.name}{d.commander ? ` (${d.commander})` : ""}</option>
                  ))}
                </select>
              )}
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontWeight: 500, color: 'white', marginBottom: 4 }}>Destination</label>
              <div style={{ display: 'flex', gap: 12 }}>
                <label style={{ color: 'white', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="radio" name="addToDeckDest" value="mainboard" checked={addToDeckDest === "mainboard"} onChange={() => setAddToDeckDest("mainboard")} disabled={addToDeckBusy} />
                  Mainboard
                </label>
                <label style={{ color: 'white', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="radio" name="addToDeckDest" value="sideboard" checked={addToDeckDest === "sideboard"} onChange={() => setAddToDeckDest("sideboard")} disabled={addToDeckBusy} />
                  Sideboard
                </label>
              </div>
            </div>
            {addToDeckMessage && (
              <div className={addToDeckMessage.startsWith("Added") ? "collection-modal-success" : "collection-modal-error"} style={{ marginBottom: 10 }}>
                {addToDeckMessage}
              </div>
            )}
            <div className="collection-modal-footer">
              <button className="btn-secondary" type="button" onClick={() => { setShowAddToDeck(false); setAddToDeckMessage(null); }} disabled={addToDeckBusy}>
                {addToDeckMessage?.startsWith("Added") ? "Close" : "Cancel"}
              </button>
              {!addToDeckMessage?.startsWith("Added") && (
                <button className="btn-primary" type="button" onClick={handleAddToDeck} disabled={addToDeckBusy || !addToDeckFile || addToDeckDecks.length === 0}>
                  {addToDeckBusy ? "Adding..." : "Add to Deck"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Import Cards from Text Modal with Save as Deck option and Commander field */}
      {showImportText && (
        <div className="collection-modal-overlay">
          <div className="collection-modal" ref={modalRef} style={{ position: 'fixed', left: modalPos.x, top: modalPos.y }}>
            <h2 className="collection-modal-title" onMouseDown={startDrag} style={{ cursor: 'move' }}>Import Cards from Text</h2>
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: 'block', fontWeight: 500, color: 'white', marginBottom: 2 }}></label>
              <input
                className="collection-search collection-search-margin"
                value={manualCommanderId}
                onChange={e => setManualCommanderId(e.target.value)}
                placeholder="Commander name" 
                disabled={!showManualSaveDeck || importTextBusy}
                style={{ background: !showManualSaveDeck ? '#3c424d' : undefined}}
              />
            </div>
               {showManualSaveDeck && (
              <input style={{ marginBottom: 13, fontWeight: 500, color: 'white' }} 
                className="collection-search collection-search-margin"
                value={manualDeckName}
                onChange={e => setManualDeckName(e.target.value)}
                placeholder="Deck Name"
                disabled={importTextBusy}
                autoFocus
              />
            )}
            <textarea
              className="collection-modal-textarea"
              rows={10}
              value={importText}
              onChange={e => setImportText(e.target.value)}
              placeholder={"Paste your decklist here (one card per line, e.g. '1 Sol Ring')"}
              disabled={importTextBusy}
            />
            <div style={{ display: 'inline-flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 11, gap: 10, width: '100%' }}>
              Save as New Deck
              <label>
                 <input 
                  type="checkbox"
                  checked={showManualSaveDeck}
                  onChange={e => setShowManualSaveDeck(e.target.checked)}
                  disabled={importTextBusy}
                />
              </label>
              <div>
                <button style={{ color: 'white', background: '#7c3aed', padding: '4px 10px', fontSize: '0.95em' }}
                  type="button"
                  className="btn-primary"
                  onClick={() => document.getElementById("import-text-file")?.click()}
                  disabled={importTextBusy}
                >
                  Load from .txt
                </button>
                <input 
                  id="import-text-file"
                  type="file"
                  accept=".txt"
                  style={{ display: 'none' }}
                  onChange={handleImportTextFile}
                />
              </div>
            </div>
      
            <div className="collection-modal-footer">
              <button className="btn-secondary" type="button" onClick={() => setShowImportText(false)} disabled={importTextBusy}>Cancel</button>
              <button
                className="btn-primary"
                type="button"
                onClick={async () => {
                  setImportTextBusy(true);
                  setImportTextMessage(null);
                  try {
                    if (showManualSaveDeck && manualDeckName.trim() && manualCommanderId.trim()) {
                      // Save as deck with commander
                      const { data } = await api.post("/deck/import-deck", {
                        decklist: importText,
                        deck_name: manualDeckName.trim(),
                        commander: manualCommanderId.trim(),
                      });
                      setImportTextMessage("Deck imported successfully!");
                    } else if (showManualSaveDeck && manualDeckName.trim()) {
                      setImportTextMessage("Please enter a commander name.");
                    } else {
                      // Normal import
                      const { data } = await api.post("/collection/import-text", {
                        text: importText,
                      });
                      setImportTextMessage("Cards imported successfully!");
                    }
                    await refreshImportStatus(); // Force status refresh after import
                  } catch (err: any) {
                    setImportTextMessage(err?.response?.data?.detail || "Import failed");
                  } finally {
                    setImportTextBusy(false);
                  }
                }}
                disabled={importTextBusy || !importText.trim() || (showManualSaveDeck && (!manualDeckName.trim() || !manualCommanderId.trim()))}
              >
                {importTextBusy ? (showManualSaveDeck ? "Importing Deck..." : "Importing...") : (showManualSaveDeck ? "Import as Deck" : "Import Cards")}
              </button>
              {/* Exit button for after import completes */}
              <button
                className="btn-secondary"
                type="button"
                style={{ marginLeft: 8 }}
                onClick={() => {
                  setShowImportText(false);
                  setImportTextMessage(null);
                  setImportText("");
                  setManualDeckName("");
                  setManualCommanderId("");
                }}
                disabled={importTextBusy}
              >
                Exit
              </button>
            </div>
            {importTextMessage && <div className="collection-modal-error">{importTextMessage}</div>}
          </div>
        </div>
      )}

    
      {message && (
        <div className={`alert alert-${message.type}`}>{message.text}</div>
      )}

      {importStatus && importStatus.active && (
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
                    className="import-progress-circle"
                  />
                  <text x="55" y="58" textAnchor="middle" dominantBaseline="middle" fontSize="18" fontWeight="700" fill="#e2e8f0">
                    {pct}%
                  </text>
                </svg>
              );
            })()}
          </div>
          <div className="import-progress-info-block">
            <div className="import-progress-info-title">
              {importStatus.source === "folder" ? "Startup folder import" : "CSV upload import"}
              {importStatus.current_file ? `: ${importStatus.current_file}` : ""}
            </div>
            <small className="import-progress-info" style={{ color: "orange", fontWeight: "500", fontSize: "0.95em", margin: 2 }}>
              Processed {importStatus.processed}/{importStatus.total} | Imported {importStatus.imported} | Updated {importStatus.updated} | Failed {importStatus.failed}
            </small>
            {importStatus?.message && (
              (/retrying in \d+s/i.test(importStatus.message || "")) ? (
                <div className="import-paused" style={{ padding: 10, borderRadius: 6, background: '#2b2f36' }}>
                  <div style={{ fontWeight: 700, marginBottom: 6, color: '#ffd966' }}>Import paused</div>
                  <div style={{ marginBottom: 6 }}>{importStatus.message}</div>
                  {pauseRemaining !== null && (
                    <div style={{ marginBottom: 8 }}>Resuming in {pauseRemaining}s</div>
                  )}
                  <div>
                    <button className="btn-secondary" type="button" onClick={cancelImport}>Cancel Import</button>
                  </div>
                </div>
              ) : (
                !importStatus.active ? (
                  <small className="import-progress-success">{importStatus.message}</small>
                ) : null
              )
            )}
          </div>
        </div>
      )}



      {failedRows.length > 0 && (
        <div className="alert alert-info collection-alert-margin">
          <div className="collection-alert-failed-rows">Failed rows available: {failedRows.length}</div>
          <div className="collection-alert-btn-row">
            <button className="btn-primary" onClick={retryFailed} disabled={importing}>Retry Failed Only</button>
            <button className="btn-secondary" onClick={downloadFailedCsv}>Download Failed CSV</button>
          </div>
        </div>
      )}

      {/* Removed Save Manual Deck popup/modal from Import Cards from Text flow. Commander field is now only in the import text modal. */}
    
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
          onChange={(e) => setSortBy(e.target.value as "name" | "quantity" | "cmc" | "recent" | "price")}
          className="collection-sort"
        >
          <option value="name">Sort: Name</option>
          <option value="quantity">Sort: Quantity</option>
          <option value="cmc">Sort: CMC</option>
          <option value="price">Sort: Price</option>
          <option value="recent">Sort: Recently Imported</option>
        </select>
      </div>
      <div className="collection-bulk-toolbar">
        <button className="btn-secondary" type="button" onClick={toggleSelectFiltered} disabled={filtered.length === 0}>
          {filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id))
            ? "Unselect Filtered"
            : "Select Filtered"}
        </button>
        <button className="btn-primary" type="button" disabled={selectedCount === 0} onClick={openManualSaveModal}>
          Save Selected as Deck
        </button>
        <button className="btn-secondary" type="button" disabled={selectedCount === 0} onClick={openAddToDeck}>
          Add to Deck
        </button>
        <span className="collection-selected-count">Selected: {selectedCount}</span>
        
        <button className="btn-danger" type="button" disabled={selectedCount === 0} onClick={handleBulkDelete}>
          Bulk Delete
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


      <div className="collection-color-row">
        <span className="collection-color-label">Colors:</span>
        <div className="collection-color-checks">
          {colorOptions.map((opt) => {
            const active = colorFilter.includes(opt.code);
            return (
              <button
                key={opt.code}
                type="button"
                onClick={() => toggleColor(opt.code)}
                className={`collection-color-pip color-${opt.code}${active ? " active" : ""}${colorFilter.length > 0 && !active ? " inactive" : ""}`}
                aria-label={opt.label}
                aria-pressed={active}
              >
                <span className="collection-color-pip-glyph">{opt.label.split(" ")[0]}</span>
              </button>
            );
          })}
          {colorFilter.length > 0 && (
            <button
              type="button"
              className="collection-mana-cost-clear"
              onClick={() => setColorFilter([])}
              title="Clear color filter"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {maxCmc > 0 && (
        <div className="collection-mana-cost-row">
          <span className="collection-mana-cost-label">Mana Cost:</span>
          <div className="collection-mana-cost-checks">
            {Array.from({ length: maxCmc + 1 }, (_, n) => (
              <label key={n} className="collection-mana-cost-check" title={`Mana value ${n}`}>
                <input
                  type="checkbox"
                  checked={manaCostFilter.includes(n)}
                  onChange={() => toggleManaCost(n)}
                />
                <span>{n}</span>
              </label>
            ))}
            {manaCostFilter.length > 0 && (
              <button
                type="button"
                className="collection-mana-cost-clear"
                onClick={() => setManaCostFilter([])}
                title="Clear mana cost filter"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      <div className="collection-filter-summary">
        <strong>({filtered.length})</strong> {filterSummary}
        {filteredQuantitySum !== filtered.length && (
          <span className="collection-filter-summary-qty"> · {filteredQuantitySum} total copies</span>
        )}
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
