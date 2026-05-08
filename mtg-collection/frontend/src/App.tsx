import { useEffect, useRef, useState } from "react";
import { Routes, Route, NavLink, Navigate, useLocation, useNavigate } from "react-router-dom";
import Collection from "./pages/Collection";
import DeckBuilder from "./pages/DeckBuilder";
import MyDecks from "./pages/MyDecks";
import Help from "./pages/Help";
import BuildStatusFloater from "./components/BuildStatusFloater";
import ModelStatus from "./components/ModelStatus";
import FirstLaunchModal from "./components/FirstLaunchModal";

const MANA_SCATTER = [
  { symbol: "☀️", top: "5%",  left: "2%",  size: "7rem",   opacity: 0.07,  rotate: -15 },
  { symbol: "💧", top: "12%", left: "91%", size: "9rem",   opacity: 0.06,  rotate: 20  },
  { symbol: "💀", top: "38%", left: "94%", size: "6.5rem", opacity: 0.055, rotate: -8  },
  { symbol: "🔥", top: "65%", left: "3%",  size: "8rem",   opacity: 0.06,  rotate: 10  },
  { symbol: "🌲", top: "80%", left: "88%", size: "9rem",   opacity: 0.055, rotate: -18 },
  { symbol: "💧", top: "88%", left: "15%", size: "5rem",   opacity: 0.045, rotate: 25  },
  { symbol: "☀️", top: "55%", left: "1%",  size: "5.5rem", opacity: 0.04,  rotate: -28 },
  { symbol: "🔥", top: "92%", left: "60%", size: "6.5rem", opacity: 0.05,  rotate: -5  },
  { symbol: "🌲", top: "3%",  left: "55%", size: "5rem",   opacity: 0.04,  rotate: 15  },
  { symbol: "💀", top: "72%", left: "45%", size: "4rem",   opacity: 0.035, rotate: -35 },
  { symbol: "☀️", top: "25%", left: "0%",  size: "4.5rem", opacity: 0.035, rotate: 40  },
  { symbol: "💧", top: "45%", left: "93%", size: "5.5rem", opacity: 0.045, rotate: 12  },
] as const;

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const restoredRoute = useRef(false);
  const [bgArt, setBgArt] = useState<string | null>(() => localStorage.getItem("mtg.bgArt"));

  useEffect(() => {
    if (restoredRoute.current) return;
    restoredRoute.current = true;

    const saved = localStorage.getItem("mtg.lastRoute");
    if (location.pathname === "/" && saved && saved !== "/") {
      navigate(saved, { replace: true });
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("mtg.lastRoute", location.pathname);
  }, [location.pathname]);

  useEffect(() => {
    const handler = (e: Event) => {
      const url = (e as CustomEvent<string | null>).detail;
      setBgArt(url);
      if (url) localStorage.setItem("mtg.bgArt", url);
      else localStorage.removeItem("mtg.bgArt");
    };
    window.addEventListener("mtg-set-bg", handler);
    return () => window.removeEventListener("mtg-set-bg", handler);
  }, []);

  useEffect(() => {
    if (bgArt) {
      document.body.style.backgroundImage = `linear-gradient(rgba(10,5,25,0.78), rgba(10,5,25,0.78)), url(${bgArt})`;
      document.body.style.backgroundSize = "cover";
      document.body.style.backgroundPosition = "center 25%";
      document.body.style.backgroundAttachment = "fixed";
    } else {
      document.body.style.backgroundImage = "";
      document.body.style.backgroundSize = "";
      document.body.style.backgroundPosition = "";
      document.body.style.backgroundAttachment = "";
    }
  }, [bgArt]);

  return (
    <>
      <div className="bg-mana-overlay" aria-hidden="true">
        {MANA_SCATTER.map((s, i) => (
          <span
            key={i}
            className="bg-mana-symbol"
            style={{ top: s.top, left: s.left, fontSize: s.size, opacity: s.opacity, transform: `rotate(${s.rotate}deg)` }}
          >
            {s.symbol}
          </span>
        ))}
      </div>
      <nav>
        <span className="logo">🃏 MTG Deck Builder</span>
        <NavLink to="/collection">Collection</NavLink>
        <NavLink to="/deck">Build Deck</NavLink>
        <NavLink to="/my-decks">My Decks</NavLink>
        <NavLink to="/help">Help</NavLink>
        <ModelStatus />
      </nav>
      <Routes>
        <Route path="/" element={<Navigate to="/collection" replace />} />
        <Route path="/collection" element={<Collection />} />
        <Route path="/deck" element={<DeckBuilder />} />
        <Route path="/my-decks" element={<MyDecks />} />
        <Route path="/help" element={<Help />} />
      </Routes>
      <BuildStatusFloater />
      <FirstLaunchModal />
    </>
  );
}
