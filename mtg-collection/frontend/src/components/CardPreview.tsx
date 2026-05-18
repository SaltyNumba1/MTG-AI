import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./CardPreview.css";

interface CardPreviewProps {
  name: string;
  imageUri?: string | null;
  subtitle?: string;
  quantity?: number;
  tcgplayerPrice?: string | null;
  children?: ReactNode;
}

interface Printing {
  id: string;
  set: string;
  set_name: string;
  collector_number: string;
  image_uri: string | null;
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

/** Extract the front-face image_uri from a raw Scryfall card object. */
function extractScryfallImageUri(card: Record<string, unknown>): string | null {
  const uris = card.image_uris as Record<string, string> | undefined;
  if (uris?.normal) return uris.normal;
  const faces = card.card_faces as Array<Record<string, unknown>> | undefined;
  const faceUris = faces?.[0]?.image_uris as Record<string, string> | undefined;
  if (faceUris?.normal) return faceUris.normal;
  return null;
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

  // Switch-printing state
  const [selectedPrintingUri, setSelectedPrintingUri] = useState<string | null>(null);
  const [printings, setPrintings] = useState<Printing[]>([]);
  const [printingsLoading, setPrintingsLoading] = useState(false);
  const [printingsError, setPrintingsError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

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

  // Active image: prefer user-selected printing, else prop
  const activeImageUri = selectedPrintingUri ?? imageUri;
  const backUri = useMemo(() => getBackFaceUri(activeImageUri), [activeImageUri]);
  const displayUri = flipped && backUri ? backUri : activeImageUri;
  const canRotate = useMemo(() => name.includes("//") && Boolean(backUri), [name, backUri]);

  const [isBg, setIsBg] = useState(false);
  useEffect(() => {
    const check = () => {
      const stored = localStorage.getItem("mtg.bgArt");
      setIsBg(stored !== null && (stored === activeImageUri || stored === backUri));
    };
    check();
    window.addEventListener("mtg-set-bg", check);
    return () => window.removeEventListener("mtg-set-bg", check);
  }, [activeImageUri, backUri]);

  const handleSetBg = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newVal = isBg ? null : (displayUri ?? null);
    window.dispatchEvent(new CustomEvent("mtg-set-bg", { detail: newVal }));
  };

  const handleOpenPicker = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pickerOpen) { setPickerOpen(false); return; }
    setPickerOpen(true);
    if (printings.length > 0) return; // already fetched
    setPrintingsLoading(true);
    setPrintingsError("");
    try {
      const query = encodeURIComponent(`!"${name}"`);
      const url = `https://api.scryfall.com/cards/search?q=${query}&unique=prints&order=released&dir=asc`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`Scryfall ${res.status}`);
      const json = await res.json() as { data: Record<string, unknown>[] };
      const mapped: Printing[] = json.data.map((c) => ({
        id: c.id as string,
        set: (c.set as string).toUpperCase(),
        set_name: c.set_name as string,
        collector_number: c.collector_number as string,
        image_uri: extractScryfallImageUri(c),
      }));
      setPrintings(mapped);
    } catch (err: unknown) {
      setPrintingsError(err instanceof Error ? err.message : "Failed to load printings");
    } finally {
      setPrintingsLoading(false);
    }
  };

  const handleSelectPrinting = (p: Printing) => {
    setSelectedPrintingUri(p.image_uri);
    setFlipped(false);
    setPickerOpen(false);
  };

  const modal = pickerOpen ? createPortal(
    <div className="printing-modal-backdrop" onClick={() => setPickerOpen(false)}>
      <div className="printing-modal" onClick={(e) => e.stopPropagation()}>
        <div className="printing-modal-header">
          <span className="printing-modal-title">🎨 Printings — {name}</span>
          <button className="printing-modal-close" onClick={() => setPickerOpen(false)}>✕</button>
        </div>
        {printingsLoading && <div className="printing-modal-status">Loading printings…</div>}
        {printingsError && <div className="printing-modal-status printing-modal-error">{printingsError}</div>}
        {!printingsLoading && !printingsError && printings.length === 0 && (
          <div className="printing-modal-status">No printings found</div>
        )}
        <div className="printing-modal-grid">
          {printings.map((p) => {
            const isActive = p.image_uri === (selectedPrintingUri ?? imageUri);
            return (
              <button
                key={p.id}
                className={`printing-modal-cell${isActive ? " printing-modal-cell--active" : ""}`}
                onClick={() => handleSelectPrinting(p)}
                title={`${p.set_name} #${p.collector_number}`}
              >
                {p.image_uri
                  ? <img src={p.image_uri} alt={`${p.set_name} #${p.collector_number}`} loading="lazy" />
                  : <div className="printing-modal-no-img">No art</div>
                }
                <span className="printing-modal-cell-label">{p.set} #{p.collector_number}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  ) : null;

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
          <button
            className={`card-printing-btn card-printing-btn--overlay${pickerOpen ? " card-printing-btn--open" : ""}`}
            onClick={handleOpenPicker}
            title="Switch card printing / art"
          >
            {printingsLoading ? "…" : "🎨"}
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
        <div className="card-hint-row">
          <small className="card-hint">Hover to preview</small>
        </div>
        {modal}
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
