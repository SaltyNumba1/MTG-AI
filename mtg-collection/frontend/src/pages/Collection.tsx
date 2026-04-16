import { useEffect, useMemo, useRef, useState } from "react";
import api from "../api";

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
  reason: string;
}

interface ImportResponse {
  imported: number;
  updated: number;
  failed: string[];
  failed_details?: FailedDetail[];
  touched_names?: string[];
  total: number;
}

interface BackupEntry {
  filename: string;
  size: number;
  modified_at: string;
}

const COLOR_SYMBOLS: Record<string, string> = {
  W: "☀️", U: "💧", B: "💀", R: "🔥", G: "🌲",
};

export default function Collection() {
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
    const fetchImportStatus = async () => {
      try {
        const { data } = await api.get<ImportStatus>("/collection/import-status");
        setImportStatus(data);
      } catch {
        // Keep UI usable if import status polling fails.
      }
    };

    fetchImportStatus();
    const timer = setInterval(fetchImportStatus, 1000);
    return () => clearInterval(timer);
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
        text: `Imported ${data.imported} new cards, updated ${data.updated}. ${
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
      const payload = { items: failedRows.map((x) => ({ name: x.name, quantity: x.quantity })) };
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

  const colorOptions = useMemo(() => {
    const s = new Set<string>();
    for (const c of cards) {
      for (const code of c.color_identity || []) s.add(code);
    }
    return Array.from(s).sort();
  }, [cards]);

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
      if (colorFilter !== "all" && !(c.color_identity || []).includes(colorFilter)) return false;
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
      <h1 className="page-title">My Collection ({cards.length} unique cards)</h1>

      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <input
          placeholder="Search cards..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 300 }}
        />
        <select aria-label="Color filter" title="Color filter" value={colorFilter} onChange={(e) => setColorFilter(e.target.value)} style={{ maxWidth: 120 }}>
          <option value="all">All Colors</option>
          {colorOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select aria-label="Type filter" title="Type filter" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="all">All Types</option>
          {typeOptions.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select aria-label="Rarity filter" title="Rarity filter" value={rarityFilter} onChange={(e) => setRarityFilter(e.target.value)} style={{ maxWidth: 140 }}>
          <option value="all">All Rarity</option>
          {rarityOptions.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select aria-label="Set filter" title="Set filter" value={setFilter} onChange={(e) => setSetFilter(e.target.value)} style={{ maxWidth: 120 }}>
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
          style={{ maxWidth: 180 }}
        >
          <option value="name">Sort: Name</option>
          <option value="quantity">Sort: Quantity</option>
          <option value="cmc">Sort: CMC</option>
          <option value="recent">Sort: Recently Imported</option>
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            className="btn-primary"
            onClick={() => fileRef.current?.click()}
            disabled={importing || importStatus?.active}
          >
            {importing || importStatus?.active ? "Importing..." : "Import CSV"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            style={{ display: "none" }}
            onChange={handleImport}
          />
        </label>
        <button
          className="btn-danger"
          onClick={handleClearCollection}
          disabled={cards.length === 0}
        >
          Delete Collection
        </button>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
        <button className="btn-secondary" onClick={toggleSelectFiltered} disabled={filtered.length === 0}>
          {filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id))
            ? "Unselect Filtered"
            : "Select Filtered"}
        </button>
        <span style={{ color: "#94a3b8", fontSize: 13 }}>Selected: {selectedCount}</span>
        <button className="btn-danger" disabled={selectedCount === 0} onClick={handleBulkDelete}>
          Bulk Delete
        </button>
        <select aria-label="Bulk quantity action" title="Bulk quantity action" value={bulkAction} onChange={(e) => setBulkAction(e.target.value as "set" | "adjust")} style={{ maxWidth: 130 }}>
          <option value="adjust">Adjust Qty</option>
          <option value="set">Set Qty</option>
        </select>
        <input
          type="number"
          aria-label="Bulk quantity value"
          title="Bulk quantity value"
          value={bulkValue}
          onChange={(e) => setBulkValue(Number(e.target.value || 0))}
          style={{ width: 110 }}
        />
        <button className="btn-primary" disabled={selectedCount === 0} onClick={handleBulkQuantity}>
          Apply Qty
        </button>
      </div>

      {message && (
        <div className={`alert alert-${message.type}`}>{message.text}</div>
      )}

      {importStatus && (importStatus.active || importStatus.total > 0) && (
        <div className="import-progress" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13 }}>
            <span>
              {importStatus.source === "folder" ? "Startup folder import" : "CSV upload import"}
              {importStatus.current_file ? `: ${importStatus.current_file}` : ""}
            </span>
            <span>{importStatus.percent}%</span>
          </div>
          <div
            style={{
              width: "100%",
              height: 10,
              background: "#1e293b",
              borderRadius: 999,
              overflow: "hidden",
              border: "1px solid #334155",
            }}
          >
            <div
              style={{
                width: `${importStatus.percent}%`,
                height: "100%",
                background: "linear-gradient(90deg, #22c55e, #14b8a6)",
                transition: "width 0.25s ease",
              }}
            />
          </div>
          <small style={{ color: "#94a3b8", display: "block", marginTop: 6 }}>
            Processed {importStatus.processed}/{importStatus.total} | Imported {importStatus.imported} | Updated {importStatus.updated} | Failed {importStatus.failed}
          </small>
          {!importStatus.active && importStatus.message && (
            <small style={{ color: "#86efac", display: "block", marginTop: 4 }}>{importStatus.message}</small>
          )}
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

      <div style={{ border: "1px solid #334155", borderRadius: 8, padding: 12, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Database Safety</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn-primary" onClick={createBackup} disabled={backupBusy}>Create Backup</button>
          <button className="btn-secondary" onClick={loadBackups} disabled={backupBusy}>Refresh Backups</button>
          <select
            aria-label="Backup selection"
            title="Backup selection"
            value={selectedBackup}
            onChange={(e) => setSelectedBackup(e.target.value)}
            style={{ minWidth: 280 }}
          >
            <option value="">Select backup</option>
            {backups.map((b) => (
              <option key={b.filename} value={b.filename}>{b.filename}</option>
            ))}
          </select>
          <button className="btn-danger" onClick={restoreBackup} disabled={!selectedBackup || backupBusy}>
            Restore Selected Backup
          </button>
        </div>
      </div>

      {loading ? (
        <p>Loading collection...</p>
      ) : filtered.length === 0 ? (
        <div className="alert alert-info">
          No cards yet. Import a CSV to get started.
          <br />
          <small>Supported formats: Moxfield, Archidekt, or any CSV with a "name" column.</small>
        </div>
      ) : (
        <div className="card-grid">
          {filtered.map((card) => (
            <div key={card.id} className="mtg-card">
              {card.image_uri ? (
                <img src={card.image_uri} alt={card.name} loading="lazy" />
              ) : (
                <div
                  style={{
                    height: 120,
                    background: "#0f172a",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    color: "#64748b",
                  }}
                >
                  No image
                </div>
              )}
              <div className="card-info">
                <div className="card-name">{card.name}</div>
                <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>
                  {card.type_line} | {card.rarity || "-"} | {(card.set_code || "-").toUpperCase()}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="card-qty">×{card.quantity}</span>
                  <span>
                    {(card.color_identity || []).map((c) => COLOR_SYMBOLS[c] || c).join("")}
                  </span>
                  <input
                    type="checkbox"
                    aria-label={`Select ${card.name}`}
                    title={`Select ${card.name}`}
                    checked={selectedIds.has(card.id)}
                    onChange={() => toggleSelected(card.id)}
                    style={{ width: 16, height: 16 }}
                  />
                  <button
                    className="btn-danger"
                    style={{ padding: "2px 8px", fontSize: 11 }}
                    onClick={() => handleDelete(card.id)}
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
