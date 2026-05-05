import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import "./CardPreview.css";

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
  const [popoutSide, setPopoutSide] = useState<"right" | "left">("right");
  const cardRef = useRef<HTMLDivElement | null>(null);

  const updatePopoutSide = () => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const popoutWidth = 340 + 60; // popout width plus safety margin (accounts for zoom/DPI)
    const viewportWidth = document.documentElement.clientWidth;
    const spaceRight = Math.max(0, viewportWidth - rect.right);
    const spaceLeft = Math.max(0, rect.left);

    // Prefer the side with enough room for the popout. If right side lacks space, show left.
    if (spaceRight < popoutWidth && spaceLeft >= popoutWidth) {
      setPopoutSide("left");
      return;
    }
    if (spaceRight < popoutWidth && spaceLeft < popoutWidth) {
      // neither side has full room: choose the side with more space
      setPopoutSide(spaceLeft > spaceRight ? "left" : "right");
      return;
    }
    setPopoutSide("right");
  };

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const onEnter = () => updatePopoutSide();
    const onMove = () => updatePopoutSide();
    const onResize = () => updatePopoutSide();

    el.addEventListener("mouseenter", onEnter);
    el.addEventListener("mousemove", onMove);
    window.addEventListener("resize", onResize);
    return () => {
      el.removeEventListener("mouseenter", onEnter);
      el.removeEventListener("mousemove", onMove);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const backUri = useMemo(() => getBackFaceUri(imageUri), [imageUri]);
  const displayUri = flipped && backUri ? backUri : imageUri;
  const canRotate = useMemo(() => name.includes("//") && Boolean(backUri), [name, backUri]);

  const [isBg, setIsBg] = useState(false);
  useEffect(() => {
    const check = () => {
      const stored = localStorage.getItem("mtg.bgArt");
      setIsBg(stored !== null && (stored === imageUri || stored === backUri));
    };
    check();
    window.addEventListener("mtg-set-bg", check);
    return () => window.removeEventListener("mtg-set-bg", check);
  }, [imageUri, backUri]);

  const handleSetBg = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newVal = isBg ? null : (displayUri ?? null);
    window.dispatchEvent(new CustomEvent("mtg-set-bg", { detail: newVal }));
  };

  return (
    <div className={`mtg-card popout-${popoutSide}`} ref={cardRef}>
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
              className="card-rotate-btn"
            >
              {flipped ? "▶" : "🔄"}
            </button>
          )}
          <button
            className={`card-set-bg-btn${isBg ? " card-set-bg-btn--active" : ""}`}
            onClick={handleSetBg}
            title={isBg ? "Clear card art background" : "Set card art as background"}
          >
            🖼
          </button>
        </div>
      ) : (
        <div className="card-no-image">No image</div>
      )}
      <div className="card-info">
        <div className="card-name">{name}</div>
        {subtitle && <div className="card-subtitle">{subtitle}</div>}
        <div className="card-meta-row">
          <span className="card-price">{formatPrice(tcgplayerPrice)}</span>
          {typeof quantity === "number" && <span className="card-qty">x{quantity}</span>}
        </div>
        <small className="card-hint">Hover to preview</small>
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
