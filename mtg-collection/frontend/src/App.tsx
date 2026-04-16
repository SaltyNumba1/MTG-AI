import { Routes, Route, NavLink } from "react-router-dom";
import Collection from "./pages/Collection";
import DeckBuilder from "./pages/DeckBuilder";

export default function App() {
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
