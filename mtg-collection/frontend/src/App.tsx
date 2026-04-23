import { useEffect, useRef } from "react";
import { Routes, Route, NavLink, Navigate, useLocation, useNavigate } from "react-router-dom";
import Collection from "./pages/Collection";
import DeckBuilder from "./pages/DeckBuilder";
import MyDecks from "./pages/MyDecks";
import Help from "./pages/Help";

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const restoredRoute = useRef(false);

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

  return (
    <>
      <nav>
        <span className="logo">🃏 MTG Deck Builder</span>
        <NavLink to="/collection">Collection</NavLink>
        <NavLink to="/deck">Build Deck</NavLink>
        <NavLink to="/my-decks">My Decks</NavLink>
        <NavLink to="/help">Help</NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<Navigate to="/collection" replace />} />
        <Route path="/collection" element={<Collection />} />
        <Route path="/deck" element={<DeckBuilder />} />
        <Route path="/my-decks" element={<MyDecks />} />
        <Route path="/help" element={<Help />} />
      </Routes>
    </>
  );
}
