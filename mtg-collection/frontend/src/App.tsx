import { useEffect } from "react";
import { Routes, Route, NavLink, useLocation, useNavigate } from "react-router-dom";
import Collection from "./pages/Collection";
import DeckBuilder from "./pages/DeckBuilder";

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const saved = localStorage.getItem("mtg.lastRoute");
    if (location.pathname === "/" && saved && saved !== "/") {
      navigate(saved, { replace: true });
    }
  }, [location.pathname, navigate]);

  useEffect(() => {
    localStorage.setItem("mtg.lastRoute", location.pathname);
  }, [location.pathname]);

  return (
    <>
      <nav>
        <span className="logo">🃏 MTG Deck Builder</span>
        <NavLink to="/">Collection</NavLink>
        <NavLink to="/deck">Build Deck</NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<Collection />} />
        <Route path="/deck" element={<DeckBuilder />} />
      </Routes>
    </>
  );
}
