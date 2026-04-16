import { useMemo, useState, type ReactNode } from "react";

interface CardPreviewProps {
  name: string;
  imageUri?: string | null;
  subtitle?: string;
  quantity?: number;
  tcgplayerPrice?: string | null;
  children?: ReactNode;
}

function formatPrice(raw?: string | null) {
  if (!raw) return "TCG: N/A";
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) return `TCG: $${raw}`;
  return `TCG: $${parsed.toFixed(2)}`;
}

export default function CardPreview({
  name,
  imageUri,
  subtitle,
  quantity,
  tcgplayerPrice,
  children,
}: CardPreviewProps) {
  const [zoom, setZoom] = useState(1);

  const zoomHint = useMemo(() => (zoom > 1 ? `Zoom ${zoom.toFixed(1)}x` : "Alt + Scroll to zoom"), [zoom]);

  return (
    <div className="mtg-card">
      {imageUri ? (
        <div
          className="card-image-shell"
          onWheel={(e) => {
            if (!e.altKey) return;
            e.preventDefault();
            const delta = e.deltaY < 0 ? 0.1 : -0.1;
            setZoom((z) => Math.max(1, Math.min(2.5, Number((z + delta).toFixed(2)))));
          }}
          title="Hold Alt and use scroll wheel to zoom card image"
        >
          <img
            src={imageUri}
            alt={name}
            loading="lazy"
            style={zoom > 1 ? { transform: `scale(${zoom})` } : undefined}
          />
        </div>
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
        <div className="card-name">{name}</div>
        {subtitle && <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>{subtitle}</div>}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <span style={{ color: "#86efac", fontSize: 11 }}>{formatPrice(tcgplayerPrice)}</span>
          {typeof quantity === "number" && <span className="card-qty">x{quantity}</span>}
        </div>
        <small style={{ color: "#64748b", display: "block", marginBottom: 6 }}>{zoomHint}</small>
        {children}
      </div>
    </div>
  );
}
