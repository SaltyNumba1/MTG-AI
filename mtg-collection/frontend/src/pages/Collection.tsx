import { useEffect, useRef, useState } from "react";
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

const COLOR_SYMBOLS: Record<string, string> = {
  W: "☀️", U: "💧", B: "💀", R: "🔥", G: "🌲",
};

export default function Collection() {
  const [cards, setCards] = useState<CardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null);
  const [search, setSearch] = useState("");
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchCards = async () => {
    setLoading(true);
    try {
      const { data } = await api.get<CardEntry[]>("/collection/");
      setCards(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCards(); }, []);

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
      const { data } = await api.post("/collection/import", form);
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

  const filtered = cards.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="page">
      <h1 className="page-title">My Collection ({cards.length} cards)</h1>

      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <input
          placeholder="Search cards..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 300 }}
        />
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
                  {card.type_line}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="card-qty">×{card.quantity}</span>
                  <span>
                    {(card.color_identity || []).map((c) => COLOR_SYMBOLS[c] || c).join("")}
                  </span>
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
