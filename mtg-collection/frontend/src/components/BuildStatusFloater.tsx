import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../api";
import { getBrewingPhase } from "../utils/brewingPhase";
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

const SSE_BASE = import.meta.env.DEV ? "" : "http://127.0.0.1:8000";

export default function BuildStatusFloater() {
  const [status, setStatus] = useState<BuildStatus | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [liveLog, setLiveLog] = useState<string[]>([]);
  const esRef = useRef<EventSource | null>(null);
  const timerRef = useRef<number | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  // Polling fallback: detects build start/end and keeps status fresh when SSE is quiet
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
    const t = window.setInterval(poll, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  // SSE connection + elapsed timer — open when active, close when build ends
  useEffect(() => {
    const isActive = status?.active ?? false;

    if (!isActive) {
      esRef.current?.close();
      esRef.current = null;
      if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
      setElapsedSeconds(0);
      setLiveLog([]);
      return;
    }

    if (!esRef.current) {
      const es = new EventSource(`${SSE_BASE}/deck/build-stream`);
      esRef.current = es;
      es.onmessage = (e) => {
        try {
          const data: BuildStatus = JSON.parse(e.data);
          setStatus(data);
          if (data.message) {
            setLiveLog((prev) => [...prev.slice(-19), data.message]);
          }
        } catch { /* ignore malformed frames */ }
      };
      es.onerror = () => { es.close(); esRef.current = null; };
    }

    const startedAt = status?.started_at
      ? new Date(status.started_at + "Z").getTime()
      : Date.now();
    timerRef.current = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => {
      if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    };
  }, [status?.active]);

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => {
      esRef.current?.close();
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, []);

  // Hide when no active build or exactly on the deck builder page (it owns the status UI)
  if (!status || !status.active) return null;
  if (location.pathname === "/deck") return null;

  // Prefer live SSE log lines; fall back to server-side thoughts array
  const recent = liveLog.length > 0
    ? liveLog.slice(-4)
    : (status.thoughts || []).slice(-4).map((t) => t.message);

  const phaseLabel = getBrewingPhase(elapsedSeconds);
  const elapsedStr = elapsedSeconds >= 60
    ? `${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s`
    : `${elapsedSeconds}s`;

  return (
    <div className={`build-status-floater${collapsed ? " collapsed" : ""}`}>
      <div className="build-status-floater-header">
        <span className="build-status-floater-dot" />
        <span className="build-status-floater-title">DeepBrew</span>
        <span className="build-status-floater-elapsed">{elapsedStr}</span>
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
          <div className="build-status-floater-phase">{phaseLabel}</div>
          <div className="build-status-floater-msg">{status.message}</div>
          <div className="build-status-floater-thoughts">
            {recent.map((line, i) => (
              <small key={i}>{line}</small>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
