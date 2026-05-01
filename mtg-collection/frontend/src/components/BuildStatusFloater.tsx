import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../api";
import "./BuildStatusFloater.css";

interface BuildThought {
  time: string;
  message: string;
}

interface BuildStatus {
  active: boolean;
  phase: string;
  message: string;
  started_at: string | null;
  finished_at: string | null;
  last_activity_at: string | null;
  thoughts: BuildThought[];
}

export default function BuildStatusFloater() {
  const [status, setStatus] = useState<BuildStatus | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const { data } = await api.get<BuildStatus>("/deck/build-status");
        if (!cancelled) setStatus(data);
      } catch {
        // backend offline; keep last status
      }
    };
    poll();
    const t = window.setInterval(poll, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  // Hide when on the deck builder page (the page already shows the chat)
  // or when there's no active build.
  if (!status || !status.active) return null;
  if (location.pathname.startsWith("/deck") && !location.pathname.startsWith("/deck/")) {
    // Exactly on /deck — let the page own the chat.
    if (location.pathname === "/deck") return null;
  }

  const recent = (status.thoughts || []).slice(-3);

  return (
    <div className={`build-status-floater${collapsed ? " collapsed" : ""}`}>
      <div className="build-status-floater-header">
        <span className="build-status-floater-dot" />
        <span className="build-status-floater-title">AI Deck Build Running</span>
        <button
          type="button"
          className="build-status-floater-btn"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? "▲" : "▼"}
        </button>
        <button
          type="button"
          className="build-status-floater-btn"
          onClick={() => navigate("/deck")}
          title="Open deck builder"
        >
          ↗
        </button>
      </div>
      {!collapsed && (
        <>
          <div className="build-status-floater-msg">{status.message}</div>
          <div className="build-status-floater-thoughts">
            {recent.map((t, i) => (
              <small key={`${t.time}-${i}`}>
                {new Date(t.time).toLocaleTimeString()} — {t.message}
              </small>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
