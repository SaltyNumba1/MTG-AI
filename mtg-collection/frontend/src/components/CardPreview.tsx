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

/** Derive the back-face image URL from the front-face Scryfall URL.
 *  Scryfall CDN pattern: .../normal/front/X/Y/{id}.jpg  →  .../normal/back/X/Y/{id}.jpg
 *  Returns null if this doesn't look like a transform card URL. */
function getBackFaceUri(frontUri?: string | null): string | null {
  if (!frontUri) return null;
  if (!frontUri.includes("/front/")) return null;
  return frontUri.replace("/front/", "/back/");
}

export default function CardPreview({
  name,
  imageUri,
  subtitle,
  quantity,
  tcgplayerPrice,
  children,
}: CardPreviewProps) {
  const [flipped, setFlipped] = useState(false);

  const backUri = useMemo(() => getBackFaceUri(imageUri), [imageUri]);
  const displayUri = flipped && backUri ? backUri : imageUri;
  const canRotate = useMemo(() => name.includes("//") && Boolean(backUri), [name, backUri]);

  return (
    <div className="mtg-card">
      {displayUri ? (
        <div
          className="card-image-shell"
          title={canRotate ? "Use rotate for back face or hover to pop out" : "Hover to pop out"}
        >
          <img
            src={displayUri}
            alt={flipped ? `${name} (back face)` : name}
            loading="lazy"
          />
          {canRotate && (
            <button
              onClick={() => { setFlipped((f) => !f); }}
              title={flipped ? "Show front face" : "Show back/transform face"}
              style={{
                position: "absolute",
                bottom: 6,
                right: 6,
                background: "rgba(15,23,42,0.85)",
                border: "1px solid #475569",
                borderRadius: 4,
                color: "#c4b5fd",
                cursor: "pointer",
                fontSize: 14,
                lineHeight: 1,
                padding: "3px 6px",
              }}
            >
              {flipped ? "▶" : "🔄"}
            </button>
          )}
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
        <small style={{ color: "#64748b", display: "block", marginBottom: 6 }}>Hover to preview</small>
        {children}
      </div>
      {displayUri && (
        <div className="card-popout" aria-hidden="true">
          <div className="card-popout-frame">
            <img src={displayUri} alt="" loading="lazy" />
            <div className="card-popout-caption">
              <strong>{name}</strong>
              <span>{formatPrice(tcgplayerPrice)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
