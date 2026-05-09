import { useEffect, useMemo, useRef, useState } from "react";
import MTG_KEYWORDS from "../mtg_keywords";
import api from "../api";
import CardPreview from "../components/CardPreview";
import BracketBadge, { BracketInfo } from "../components/BracketBadge";
import "./DeckBuilder.css";

interface Commander {
  id: string;
  name: string;
  color_identity: string[];
  image_uri: string;
  tcgplayer_price?: string | null;
}

interface CardEntry {
  id: string;
  name: string;
  type_line: string;
  cmc: number;
  image_uri: string;
  color_identity: string[];
  tcgplayer_price?: string | null;
}

interface CollectionCard {
  id: string;
  name: string;
  quantity: number;
  type_line: string;
  color_identity: string[];
  cmc?: number;
}

interface DeckResult {
  commander: CardEntry;
  deck: CardEntry[];
  description: string;
  bracket?: BracketInfo;
}

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

interface DeckConstraint {
  label: string;
  match_field: string; // "type_line" | "oracle_text" | "keywords" | "any"
  match_value: string;
  min_count: number; // 0 = disabled
  max_count?: number; // 0 = no cap
}

interface ConstraintSuggestion extends DeckConstraint {
  suggested_min: number;
  detected_from: string;
  confidence: "high" | "medium";
}

const COLOR_SYMBOLS: Record<string, string> = {
  W: "☀️", U: "💧", B: "💀", R: "🔥", G: "🌲",
};

const COLOR_NAMES: Record<string, string> = {
  W: "Plains",
  U: "Island",
  B: "Swamp",
  R: "Mountain",
  G: "Forest",
};

function groupByType(cards: CardEntry[]): Record<string, CardEntry[]> {
  const groups: Record<string, CardEntry[]> = {};
  for (const card of cards) {
    const type = card.type_line?.split("—")[0].trim() || "Other";
    if (!groups[type]) groups[type] = [];
    groups[type].push(card);
  }
  return groups;
}

function manaCurve(cards: CardEntry[]) {
  const buckets: Record<string, number> = {
    "0": 0,
    "1": 0,
    "2": 0,
    "3": 0,
    "4": 0,
    "5": 0,
    "6": 0,
    "7+": 0,
  };
  for (const card of cards) {
    const cmc = Number(card.cmc || 0);
    if (cmc >= 7) buckets["7+"] += 1;
    else buckets[String(Math.max(0, Math.floor(cmc)))] += 1;
  }
  return buckets;
}

function colorDistribution(cards: CardEntry[]) {
  const dist: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const card of cards) {
    for (const color of card.color_identity || []) {
      if (dist[color] !== undefined) dist[color] += 1;
    }
  }
  return dist;
}

function suggestBasics(dist: Record<string, number>, totalLands = 37) {
  const total = Object.values(dist).reduce((acc, n) => acc + n, 0);
  if (total === 0) return [{ name: "Wastes", count: totalLands }];

  const entries = Object.entries(dist).filter(([, v]) => v > 0);
  const base = entries.map(([c, v]) => ({ color: c, exact: (v / total) * totalLands }));
  const floored = base.map((x) => ({ color: x.color, count: Math.floor(x.exact), frac: x.exact - Math.floor(x.exact) }));
  let used = floored.reduce((acc, x) => acc + x.count, 0);
  let remain = totalLands - used;

  floored.sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < floored.length && remain > 0; i += 1) {
    floored[i].count += 1;
    remain -= 1;
  }

  return floored
    .filter((x) => x.count > 0)
    .map((x) => ({ name: COLOR_NAMES[x.color] || x.color, count: x.count }));
}

export default function DeckBuilder() {
  const [commanders, setCommanders] = useState<Commander[]>([]);
  const [selectedCommander, setSelectedCommander] = useState("");
  const [prompt, setPrompt] = useState("");
  const [basicLandCount, setBasicLandCount] = useState(25);
  const [nonbasicLandCount, setNonbasicLandCount] = useState(12);
  const [dualLandCount, setDualLandCount] = useState(0);
  const [targetBracket, setTargetBracket] = useState(0);
  const [building, setBuilding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<DeckResult | null>(null);
  const [error, setError] = useState("");
  const [saveMessage, setSaveMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [buildStatus, setBuildStatus] = useState<BuildStatus | null>(null);
  const [keywordFilters, setKeywordFilters] = useState<string[]>([""]);
  const DEFAULT_MUST_INCLUDE = '"Sol Ring" "Arcane Signet" "Commander\'s Sphere" "Path of Ancestry" "Command Tower" "Roaming Throne"';
  const [mustIncludeText, setMustIncludeText] = useState<string>(DEFAULT_MUST_INCLUDE);
  const [isHung, setIsHung] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [collection, setCollection] = useState<CollectionCard[]>([]);
  const hungCheckRef = useRef<number | null>(null);

  // Constraint system
  const [constraints, setConstraints] = useState<ConstraintSuggestion[]>([]);
  const [constraintsPanelOpen, setConstraintsPanelOpen] = useState(true);
  const [customConstraint, setCustomConstraint] = useState<{ match_field: string; match_value: string; min_count: number }>({
    match_field: "type_line", match_value: "", min_count: 1,
  });

  // Card selection + exclusion for re-roll
  const [selectedCardNames, setSelectedCardNames] = useState<Set<string>>(new Set());
  const [excludedCardNames, setExcludedCardNames] = useState<string[]>([]);

  // Card image preview modal
  const [previewCard, setPreviewCard] = useState<CardEntry | null>(null);

  // Tapped land cap + type-specific min/max constraints
  const [tappedLandMax, setTappedLandMax] = useState(0);
  const [artifactMin, setArtifactMin] = useState(0);
  const [artifactMax, setArtifactMax] = useState(0);
  const [sorceryMin, setSorceryMin] = useState(0);
  const [sorceryMax, setSorceryMax] = useState(0);
  const [instantMin, setInstantMin] = useState(0);
  const [instantMax, setInstantMax] = useState(0);
  const [enchantmentMin, setEnchantmentMin] = useState(0);
  const [enchantmentMax, setEnchantmentMax] = useState(0);

  // Mana Curve Controller
  const CMC_BUCKETS = ["0", "1", "2", "3", "4", "5", "6", "7+"] as const;
  type CmcBucket = typeof CMC_BUCKETS[number];
  const [curveLimits, setCurveLimits] = useState<Record<CmcBucket, { min: number; max: number }>>(
    Object.fromEntries(CMC_BUCKETS.map((b) => [b, { min: 0, max: 0 }])) as Record<CmcBucket, { min: number; max: number }>
  );

  // Edit mode: remove/add cards from built deck
  const [deckModified, setDeckModified] = useState(false);
  const [savedFilename, setSavedFilename] = useState<string | null>(null);
  const [showAddFromCollection, setShowAddFromCollection] = useState(false);
  const [addCollectionSearch, setAddCollectionSearch] = useState("");

  // Helper: get selected commander object
  const selectedCommanderObj = useMemo(
    () => commanders.find((c) => c.name === selectedCommander),
    [commanders, selectedCommander]
  );

  // HUNG_THRESHOLD_MS: if build is active and last_activity_at hasn't updated
  // in this many ms, the model is considered hung. Heartbeat fires every 8s,
  // so 45s means 5+ missed heartbeats.
  const HUNG_THRESHOLD_MS = 45_000;

  useEffect(() => {
    api.get<Commander[]>("/deck/commanders").then(({ data }) => setCommanders(data));
    api.get<CollectionCard[]>("/collection/")
      .then(({ data }) => setCollection(data))
      .catch(() => setCollection([]));
  }, []);

  // Fetch commander profile (constraint suggestions) when commander changes
  useEffect(() => {
    if (!selectedCommander) {
      setConstraints([]);
      return;
    }
    api.get<ConstraintSuggestion[]>("/deck/commander-profile", { params: { commander_name: selectedCommander } })
      .then(({ data }) => {
        // Pre-enable high-confidence suggestions; leave medium ones disabled
        setConstraints(data.map((s) => ({
          ...s,
          min_count: s.confidence === "high" ? s.suggested_min : 0,
        })));
      })
      .catch(() => setConstraints([]));
  }, [selectedCommander]);

  // When the user navigates away after a build has finished, clear the chat
  // so re-entering the page starts fresh.
  // (No-op: previously invalid useEffect with JSX was here)

  const commanderColors = new Set(selectedCommanderObj?.color_identity || []);

  const landCounts = useMemo(() => {
    let nonbasic = 0;
    let dual = 0;
    for (const c of collection) {
      const tl = (c.type_line || "").toLowerCase();
      if (!tl.includes("land")) continue;
      if (tl.includes("basic")) continue;
      const ci = c.color_identity || [];
      // Color-identity legality: every land color must be in commander's color identity (if a commander is selected)
      const colorLegal = !selectedCommanderObj
        ? true
        : ci.every((color) => commanderColors.has(color));
      if (!colorLegal) continue;
      const qty = c.quantity || 0;
      nonbasic += qty;
      if (ci.length >= 2) dual += qty;
    }
    return { nonbasic, dual };
  }, [collection, selectedCommander, commanders]);

  const collectionTypeCounts = useMemo(() => {
    const counts: Record<string, number> = { Artifact: 0, Sorcery: 0, Instant: 0, Enchantment: 0 };
    for (const c of collection) {
      const tl = (c.type_line || "").toLowerCase();
      if (tl.includes("artifact")) counts.Artifact += c.quantity || 0;
      if (tl.includes("sorcery")) counts.Sorcery += c.quantity || 0;
      if (tl.includes("instant")) counts.Instant += c.quantity || 0;
      if (tl.includes("enchantment")) counts.Enchantment += c.quantity || 0;
    }
    return counts;
  }, [collection]);

  const collectionCmcCounts = useMemo(() => {
    const counts: Record<string, number> = { "0": 0, "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7+": 0 };
    for (const c of collection) {
      if ((c.type_line || "").toLowerCase().includes("land")) continue;
      const cmc = Math.floor(Number(c.cmc) || 0);
      const key = cmc >= 7 ? "7+" : String(cmc);
      counts[key] = (counts[key] || 0) + (c.quantity || 0);
    }
    return counts;
  }, [collection]);

  const collectionColorCount = useMemo(() => {
    if (!selectedCommanderObj) return null;
    const ci = new Set(selectedCommanderObj.color_identity);
    let total = 0;
    for (const c of collection) {
      const tl = (c.type_line || "").toLowerCase();
      if (tl.includes("land")) continue;
      const cardColors = c.color_identity || [];
      if (cardColors.every((color) => ci.has(color))) {
        total += 1;
      }
    }
    return total;
  }, [collection, selectedCommanderObj]);

  useEffect(() => {
    if (!building) {
      setIsHung(false);
      if (hungCheckRef.current) window.clearInterval(hungCheckRef.current);
      return;
    }

    const pollStatus = async () => {
      try {
        const { data } = await api.get<BuildStatus>("/deck/build-status");
        setBuildStatus(data);

        // Detect hung: active build with stale last_activity_at
        if (data.active && data.last_activity_at) {
          const staleness = Date.now() - new Date(data.last_activity_at + "Z").getTime();
          setIsHung(staleness > HUNG_THRESHOLD_MS);
        } else {
          setIsHung(false);
        }
      } catch {
        // Keep deck build running even if status polling fails.
      }
    };

    pollStatus();
    const timer = window.setInterval(pollStatus, 1200);
    return () => window.clearInterval(timer);
  }, [building]);

  const handleBuild = async (isReroll = false, overrideExcluded?: string[]) => {
    if (!selectedCommander || !prompt.trim()) return;
    setBuilding(true);
    setError("");
    setSaveMessage(null);
    setResult(null);
    setSelectedCardNames(new Set());
    setDeckModified(false);
    setSavedFilename(null);
    if (!isReroll) setExcludedCardNames([]);
    setBuildStatus({
      active: true,
      phase: "starting",
      message: "Preparing deck build",
      started_at: null,
      finished_at: null,
      last_activity_at: null,
      thoughts: [],
    });

    try {
      const mustIncludeCards = Array.from(
        new Set(
          (mustIncludeText.match(/"([^"]+)"/g) || [])
            .map((s) => s.slice(1, -1).trim())
            .filter(Boolean)
        )
      );

      // Synthesize type constraints from dedicated min/max inputs
      const typeConstraintDefs = [
        { key: "Artifact", min: artifactMin, max: artifactMax },
        { key: "Sorcery", min: sorceryMin, max: sorceryMax },
        { key: "Instant", min: instantMin, max: instantMax },
        { key: "Enchantment", min: enchantmentMin, max: enchantmentMax },
      ];
      const typeConstraints: DeckConstraint[] = typeConstraintDefs
        .filter((t) => t.min > 0 || t.max > 0)
        .map((t) => ({
          label: `${t.key} min/max`,
          match_field: "type_line",
          match_value: t.key,
          min_count: t.min,
          max_count: t.max || 0,
        }));

      // Synthesize mana curve constraints
      const cmcConstraints: DeckConstraint[] = CMC_BUCKETS
        .filter((b) => curveLimits[b].min > 0 || curveLimits[b].max > 0)
        .map((b) => ({
          label: `CMC ${b} min/max`,
          match_field: "cmc",
          match_value: b,
          min_count: curveLimits[b].min,
          max_count: curveLimits[b].max || 0,
        }));

      // Merge type-counter constraints with commander constraints.
      // For the same match_field+match_value: take the higher min and the lower non-zero max.
      const activeCommanderConstraints = constraints.filter(
        (c) => (c.min_count > 0) || ((c.max_count ?? 0) > 0)
      );
      const mergedMap = new Map<string, DeckConstraint>();
      for (const c of activeCommanderConstraints) {
        mergedMap.set(`${c.match_field}::${c.match_value}`, { ...c });
      }
      for (const t of [...typeConstraints, ...cmcConstraints]) {
        const key = `${t.match_field}::${t.match_value}`;
        if (mergedMap.has(key)) {
          const existing = mergedMap.get(key)!;
          const mergedMin = Math.max(existing.min_count, t.min_count);
          const existingMax = existing.max_count ?? 0;
          const typeMax = t.max_count ?? 0;
          const mergedMax =
            existingMax > 0 && typeMax > 0
              ? Math.min(existingMax, typeMax)
              : existingMax > 0
              ? existingMax
              : typeMax;
          mergedMap.set(key, { ...existing, min_count: mergedMin, max_count: mergedMax });
        } else {
          mergedMap.set(key, { ...t });
        }
      }
      const allConstraints = Array.from(mergedMap.values());

      const { data } = await api.post<DeckResult>("/deck/build", {
        commander_name: selectedCommander,
        prompt,
        basic_land_count: basicLandCount,
        nonbasic_land_count: nonbasicLandCount,
        dual_land_count: dualLandCount,
        keyword_filters: keywordFilters.filter((k) => k && k.trim()),
        must_include_cards: mustIncludeCards,
        constraints: allConstraints.map(({ label, match_field, match_value, min_count, max_count }) => ({ label, match_field, match_value, min_count, max_count: max_count ?? 0 })),
        excluded_card_names: isReroll ? (overrideExcluded ?? excludedCardNames) : [],
        tapped_land_max: tappedLandMax,
        target_bracket: targetBracket,
      });
      setResult(data);
      setDeckModified(false);
      await saveDeckWithName(data, data.commander.name, true, allConstraints);
      try {
        const status = await api.get<BuildStatus>("/deck/build-status");
        setBuildStatus(status.data);
      } catch {
        // Ignore final status fetch failures.
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || "Deck generation failed");
    } finally {
      setBuilding(false);
      setIsHung(false);
    }
  };

  const handleReset = async () => {
    if (!isHung) return;
    setResetting(true);
    setSelectedCardNames(new Set());
    setExcludedCardNames([]);
    try {
      await api.post("/deck/reset");
      setBuilding(false);
      setIsHung(false);
      setError("Build was force-reset. The model may still be processing in the background — wait a moment before starting a new build.");
    } catch {
      setError("Reset request failed. Try restarting the backend server.");
    } finally {
      setResetting(false);
    }
  };

  const exportDecklist = () => {
    if (!result) return;
    const lines = [
      `1 ${result.commander.name} *CMDR*`,
      "",
      ...result.deck.map((card) => `1 ${card.name}`),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.commander.name.replace(/\s+/g, "_")}_deck.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveDeckWithName = async (
    deckResult: DeckResult,
    deckName: string,
    autoSave = false,
    activeConstraints?: DeckConstraint[],
  ) => {
    setSaving(true);
    setSaveMessage(null);
    try {
      const { data } = await api.post("/deck/save", {
        name: deckName,
        prompt,
        commander: deckResult.commander,
        deck: deckResult.deck,
        description: deckResult.description,
        constraints: (activeConstraints || []).map(({ label, match_field, match_value, min_count }) => ({ label, match_field, match_value, min_count })),
        bracket: deckResult.bracket ?? {},
      });

      setSavedFilename(data.json_file);
      if (autoSave) {
        setSaveMessage({
          type: "success",
          text: `Auto-saved to My Decks as ${deckResult.commander.name}`,
        });
      } else {
        setSaveMessage({
          type: "success",
          text: `Saved as ${data.json_file} and ${data.txt_file} in ${data.folder}`,
        });
      }
    } catch (err: any) {
      if (autoSave) {
        setSaveMessage({
          type: "error",
          text: err.response?.data?.detail || "Deck built, but auto-save failed",
        });
      } else {
        setSaveMessage({
          type: "error",
          text: err.response?.data?.detail || "Failed to save deck",
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const saveDeckToFolder = async () => {
    if (!result) return;

    const suggestedName = result.commander.name;
    const deckName = window.prompt("Save deck as:", suggestedName);
    if (deckName === null) return;
    await saveDeckWithName(result, deckName, false, constraints.filter((c) => c.min_count > 0));
  };

  const handleSaveChanges = async () => {
    if (!result || !savedFilename) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      await api.put(`/deck/saved/${savedFilename}`, { deck: result.deck });
      setDeckModified(false);
      setSaveMessage({ type: "success", text: "Deck changes saved." });
    } catch (err: any) {
      setSaveMessage({ type: "error", text: err.response?.data?.detail || "Failed to save changes" });
    } finally {
      setSaving(false);
    }
  };

  const handleAddCardFromCollection = async (cardName: string) => {
    if (!result) return;
    try {
      const { data: card } = await api.get<CardEntry>(`/deck/card-lookup?name=${encodeURIComponent(cardName)}`);
      setResult((prev) => prev ? { ...prev, deck: [...prev.deck, card] } : prev);
      setDeckModified(true);
      setShowAddFromCollection(false);
      setAddCollectionSearch("");
    } catch (err: any) {
      setSaveMessage({ type: "error", text: err.response?.data?.detail || `Card '${cardName}' not found` });
    }
  };

  const groups = result ? groupByType(result.deck) : {};
  const curve = result ? manaCurve(result.deck) : null;
  const colors = result ? colorDistribution(result.deck) : null;
  const basics = colors ? suggestBasics(colors, basicLandCount) : [];
  const curveMax = curve ? Math.max(...Object.values(curve), 1) : 1;
  const colorMax = colors ? Math.max(...Object.values(colors), 1) : 1;
  const totalGeneratedCount = result ? result.deck.length + 1 : 0;
  const missingCount = Math.max(0, 100 - totalGeneratedCount);
  const estimatedCost = result
    ? [result.commander, ...result.deck].reduce((sum, card) => {
        const value = Number(card?.tcgplayer_price || 0);
        return Number.isFinite(value) ? sum + value : sum;
      }, 0)
    : 0;

  return (
    <div className="page">
      <h1 className="page-title">Build a Commander Deck</h1>

      <div className="deckbuilder-layout">
      <div className="deckbuilder-form">
        <div>
          <label className="deckbuilder-label">
            Commander
          </label>
          <select
            aria-label="Commander"
            value={selectedCommander}
            onChange={(e) => setSelectedCommander(e.target.value)}
          >
            <option value="">- Select a commander -</option>
            {commanders.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name} {(c.color_identity || []).map((x) => COLOR_SYMBOLS[x] || x).join("")}
              </option>
            ))}
          </select>
          {commanders.length === 0 && (
            <small className="deckbuilder-hint">
              No legal legendary commanders found in your collection.
            </small>
          )}
          {selectedCommanderObj && collectionColorCount !== null && (
            <div className="deckbuilder-color-stat">
              <span className="deckbuilder-color-stat-pips">
                {(selectedCommanderObj.color_identity || []).map((c) => (
                  <span key={c}>{COLOR_SYMBOLS[c] || c}</span>
                ))}
              </span>
              <span>
                <strong>{collectionColorCount}</strong> card{collectionColorCount === 1 ? "" : "s"} in your collection match this color identity
              </span>
            </div>
          )}
        </div>

        <div className="deckbuilder-filters-row">
          <div className="deckbuilder-filters-col">
            <label className="deckbuilder-label">
              Filter by MTG Keywords (assist AI synergy)
            </label>
            {keywordFilters.map(function(filter, idx) {
              return (
                <div key={idx} className="deckbuilder-keyword-row">
                  <select
                    aria-label={"Keyword filter " + (idx + 1)}
                    title={"Keyword filter " + (idx + 1)}
                    value={filter}
                    onChange={function(e) {
                      const newFilters = [...keywordFilters];
                      newFilters[idx] = e.target.value;
                      setKeywordFilters(newFilters);
                    }}
                    className="deckbuilder-keyword-select"
                  >
                    <option value="">- Select a keyword -</option>
                    {MTG_KEYWORDS.map(function(kw) {
                      return <option key={kw} value={kw}>{kw}</option>;
                    })}
                  </select>
                  {keywordFilters.length > 1 && (
                    <button
                      type="button"
                      className="deckbuilder-keyword-remove"
                      onClick={function() { setKeywordFilters(keywordFilters.filter(function(_, i) { return i !== idx; })); }}
                    >
                      ✕
                    </button>
                  )}
                  {idx === keywordFilters.length - 1 && (
                    <button
                      type="button"
                      onClick={() => setKeywordFilters([...keywordFilters, ""])}
                      className="deckbuilder-keyword-add"
                    >
                      ＋
                    </button>
                  )}
                </div>
              );
            })}
            <small className="deckbuilder-hint">
              These keywords help the AI suggest synergistic cards, but do not hard-filter the deck.
            </small>
          <div className="deckbuilder-filters-col">
            <label className="deckbuilder-label">
              Must Include Cards
            </label>
            <textarea
              value={mustIncludeText}
              onChange={(e) => setMustIncludeText(e.target.value)}
              rows={5}
              spellCheck={false}
              placeholder={'"Sol Ring" "Arcane Signet" "Command Tower"'}
              className="deckbuilder-must-include"/>
            <small className="deckbuilder-hint">
              Wrap each card name in double quotes. These will be force-included in the deck even if you don't own them
              (fetched from Scryfall). Lands among them count toward the nonbasic land count.
            </small>
          </div>
        </div>
      </div>

        {/* Deck Constraints Panel */}
        <div className="deckbuilder-constraints-panel">
          <button
            className="deckbuilder-constraints-toggle"
            onClick={() => setConstraintsPanelOpen((o) => !o)}
            type="button"
          >
            Deck Constraints {constraints.filter((c) => c.min_count > 0).length > 0 && `(${constraints.filter((c) => c.min_count > 0).length} active)`}
            <span className="deckbuilder-constraints-chevron">{constraintsPanelOpen ? "▲" : "▼"}</span>
          </button>
          {constraintsPanelOpen && (
            <div className="deckbuilder-constraints-body">
              {constraints.length === 0 && (
                <small className="deckbuilder-hint">No constraints auto-detected — add one manually below.</small>
              )}
              {constraints.map((c, idx) => (
                <div key={idx} className={`deckbuilder-constraint-row${c.min_count > 0 ? " enabled" : ""}`}>
                  <input
                    type="checkbox"
                    checked={c.min_count > 0}
                    onChange={(e) => {
                      setConstraints((prev) => prev.map((item, i) =>
                        i === idx ? { ...item, min_count: e.target.checked ? item.suggested_min : 0 } : item
                      ));
                    }}
                    className="deckbuilder-constraint-checkbox"
                  />
                  <span className={`deckbuilder-constraint-label${c.min_count > 0 ? "" : " disabled"}`}>
                    {c.label}
                  </span>
                  {c.confidence === "high" && c.min_count > 0 && (
                    <span className="deckbuilder-confidence-badge" title={`Auto-enabled: ${c.detected_from}`}>
                      ⚡ auto
                    </span>
                  )}
                  {c.confidence === "medium" && (
                    <span className="deckbuilder-confidence-badge medium" title={c.detected_from}>
                      ~ suggested
                    </span>
                  )}
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={c.min_count > 0 ? c.min_count : c.suggested_min}
                    disabled={c.min_count === 0}
                    onChange={(e) => {
                      const val = Math.max(1, Number(e.target.value));
                      setConstraints((prev) => prev.map((item, i) =>
                        i === idx ? { ...item, min_count: val, suggested_min: val } : item
                      ));
                    }}
                    className="deckbuilder-constraint-count"
                    title="Minimum card count for this constraint"
                  />
                  <span className="deckbuilder-constraint-minmax-label">max</span>
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={c.max_count ?? 0}
                    disabled={c.min_count === 0}
                    onChange={(e) => {
                      const val = Math.max(0, Number(e.target.value));
                      setConstraints((prev) => prev.map((item, i) =>
                        i === idx ? { ...item, max_count: val } : item
                      ));
                    }}
                    className="deckbuilder-constraint-count"
                    title="Maximum card count (0 = no cap)"
                  />
                  <span
                    className="deckbuilder-constraint-field-badge"
                    title={`Match field: ${c.match_field} | Value: "${c.match_value}"`}
                  >
                    {c.match_field === "type_line" ? "type" : c.match_field === "oracle_text" ? "text" : c.match_field}
                  </span>
                  <button
                    className="deckbuilder-constraint-remove"
                    onClick={() => setConstraints((prev) => prev.filter((_, i) => i !== idx))}
                    title="Remove constraint"
                    type="button"
                  >×</button>
                </div>
              ))}
              {/* Add custom constraint */}
              <div className="deckbuilder-constraint-add-row">
                <select
                  value={customConstraint.match_field}
                  onChange={(e) => setCustomConstraint((p) => ({ ...p, match_field: e.target.value }))}
                  className="deckbuilder-constraint-field-select"
                  title="Field to search"
                >
                  <option value="type_line">Type Line</option>
                  <option value="oracle_text">Oracle Text</option>
                  <option value="keywords">Keywords</option>
                  <option value="any">Any Field</option>
                </select>
                <input
                  type="text"
                  placeholder='e.g. "Pirate" or "Instant|Sorcery"'
                  value={customConstraint.match_value}
                  onChange={(e) => setCustomConstraint((p) => ({ ...p, match_value: e.target.value }))}
                  className="deckbuilder-constraint-value-input"
                />
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={customConstraint.min_count}
                  onChange={(e) => setCustomConstraint((p) => ({ ...p, min_count: Math.max(1, Number(e.target.value)) }))}
                  className="deckbuilder-constraint-count"
                  title="Minimum count"
                />
                <button
                  type="button"
                  className="btn-secondary deckbuilder-constraint-add-btn"
                  disabled={!customConstraint.match_value.trim()}
                  onClick={() => {
                    if (!customConstraint.match_value.trim()) return;
                    const label = `${customConstraint.match_value} (${customConstraint.match_field})`;
                    setConstraints((prev) => [...prev, {
                      label,
                      match_field: customConstraint.match_field,
                      match_value: customConstraint.match_value.trim(),
                      min_count: customConstraint.min_count,
                      suggested_min: customConstraint.min_count,
                      detected_from: "Custom constraint",
                      confidence: "high",
                    }]);
                    setCustomConstraint({ match_field: "type_line", match_value: "", min_count: 1 });
                  }}
                >
                  + Add
                </button>
              </div>
              <small className="deckbuilder-hint">
                Use <code>|</code> for OR matching (e.g. <code>Instant|Sorcery</code>). Min count = floor enforced after AI picks.
              </small>
            </div>
          )}
        </div>

        <div>
          <label className="deckbuilder-label">
            Deck prompt
          </label>
          <textarea
            rows={3}
            placeholder="e.g. Build an aggressive token swarm deck focused on go-wide strategies and anthem effects"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        <div>
          <label className="deckbuilder-label">Target Bracket (optional)</label>
          <select
            aria-label="Target Bracket"
            value={targetBracket}
            onChange={(e) => setTargetBracket(Number(e.target.value))}
          >
            <option value={0}>No preference</option>
            <option value={1}>1 — Exhibition (ultra-casual, no staples)</option>
            <option value={2}>2 — Core (precon power level)</option>
            <option value={3}>3 — Upgraded (1–3 Game Changers, combos OK)</option>
            <option value={4}>4 — Optimized (high power, any staple)</option>
            <option value={5}>5 — Competitive (cEDH, fastest win)</option>
          </select>
          <small className="deckbuilder-hint">
            Adds power-level guidance to the AI prompt. This is a soft hint — not a hard filter.
          </small>
        </div>

        <div className="deckbuilder-lands-row">
          <div>
            <label className="deckbuilder-label">
              Number of Basic Lands
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={basicLandCount}
              onChange={e => setBasicLandCount(Number(e.target.value))}
              className="deckbuilder-land-input"
            />
          </div>
          <div>
            <label className="deckbuilder-label">
              Number of Nonbasic Lands
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={nonbasicLandCount}
              onChange={e => setNonbasicLandCount(Number(e.target.value))}
              className="deckbuilder-land-input"
            />
            <small className="deckbuilder-land-hint">
              You own <strong>{landCounts.nonbasic}</strong> compatible nonbasic land{landCounts.nonbasic === 1 ? "" : "s"}
              {selectedCommander ? "" : " (select a commander to filter by color identity)"}
            </small>
          </div>
        </div>

        <div className="deckbuilder-lands-row">
          <div>
            <label className="deckbuilder-label">
              Number of Dual Lands
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={dualLandCount}
              onChange={e => setDualLandCount(Number(e.target.value))}
              className="deckbuilder-land-input"
              title="Multicolor lands matching your commander's color identity (e.g. shock lands, fetch lands)."
            />
            <small className="deckbuilder-land-hint">
              You own <strong>{landCounts.dual}</strong> compatible dual land{landCounts.dual === 1 ? "" : "s"}
            </small>
          </div>
          <div>
            <label className="deckbuilder-label">Max Tapped Lands</label>
            <input
              type="number"
              min={0}
              max={37}
              value={tappedLandMax}
              onChange={(e) => setTappedLandMax(Number(e.target.value))}
              className="deckbuilder-land-input"
              title="Limit how many lands enter the battlefield tapped. 0 = no limit."
            />
            <small className="deckbuilder-land-hint">0 = no limit</small>
          </div>
        </div>

        <div className="deckbuilder-type-counters">
          {([
            { key: "Artifact", min: artifactMin, setMin: setArtifactMin, max: artifactMax, setMax: setArtifactMax },
            { key: "Sorcery", min: sorceryMin, setMin: setSorceryMin, max: sorceryMax, setMax: setSorceryMax },
            { key: "Instant", min: instantMin, setMin: setInstantMin, max: instantMax, setMax: setInstantMax },
            { key: "Enchantment", min: enchantmentMin, setMin: setEnchantmentMin, max: enchantmentMax, setMax: setEnchantmentMax },
          ] as { key: string; min: number; setMin: (v: number) => void; max: number; setMax: (v: number) => void }[]).map(({ key, min, setMin, max, setMax }) => (
            <div key={key} className="deckbuilder-type-block">
              <span className="deckbuilder-type-label">{key}</span>
              <small className="deckbuilder-type-avail">{collectionTypeCounts[key] ?? 0} owned</small>
              <div className="deckbuilder-type-minmax">
                <label>Min</label>
                <input
                  type="number"
                  min={0}
                  max={40}
                  value={min}
                  onChange={(e) => setMin(Number(e.target.value))}
                  className="deckbuilder-type-count-input"
                  title={`${key} minimum count`}
                />
                <label>Max</label>
                <input
                  type="number"
                  min={0}
                  max={40}
                  value={max}
                  onChange={(e) => setMax(Number(e.target.value))}
                  className="deckbuilder-type-count-input"
                  title={`${key} maximum count (0 = no cap)`}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="deckbuilder-mana-curve-section">
          <label className="deckbuilder-label">Mana Curve Controller</label>
          <small className="deckbuilder-hint" style={{ display: "block", marginBottom: 8 }}>
            Set min/max card counts per mana value. 0 = no limit. Enforced after AI picks.
          </small>
          <div className="deckbuilder-type-counters">
            {CMC_BUCKETS.map((bucket) => (
              <div key={bucket} className="deckbuilder-type-block">
                <span className="deckbuilder-type-label">MV {bucket}</span>
                <small className="deckbuilder-type-avail">{collectionCmcCounts[bucket] ?? 0} owned</small>
                <div className="deckbuilder-type-minmax">
                  <label>Min</label>
                  <input
                    type="number"
                    min={0}
                    max={40}
                    value={curveLimits[bucket].min}
                    onChange={(e) =>
                      setCurveLimits((prev) => ({ ...prev, [bucket]: { ...prev[bucket], min: Number(e.target.value) } }))
                    }
                    className="deckbuilder-type-count-input"
                    title={`CMC ${bucket} minimum count`}
                  />
                  <label>Max</label>
                  <input
                    type="number"
                    min={0}
                    max={40}
                    value={curveLimits[bucket].max}
                    onChange={(e) =>
                      setCurveLimits((prev) => ({ ...prev, [bucket]: { ...prev[bucket], max: Number(e.target.value) } }))
                    }
                    className="deckbuilder-type-count-input"
                    title={`CMC ${bucket} maximum count (0 = no cap)`}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <button
          className="btn-primary deckbuilder-generate-btn"
          onClick={() => handleBuild(false)}
          disabled={building || !selectedCommander || !prompt.trim()}
        >
          {building ? "Building deck... (this may take ~30s)" : "Generate Deck"}
        </button>

        {excludedCardNames.length > 0 && (
          <div className="deckbuilder-reroll-row">
            <button
              className="btn-secondary deckbuilder-reroll-btn"
              onClick={() => handleBuild(true)}
              disabled={building || !selectedCommander || !prompt.trim()}
            >
              Re-roll ({excludedCardNames.length} excluded)
            </button>
            <div className="deckbuilder-excluded-pills">
              {excludedCardNames.slice(0, 8).map((name) => (
                <span key={name} className="deckbuilder-excluded-pill">
                  {name}
                  <button
                    className="deckbuilder-pill-remove"
                    onClick={() => setExcludedCardNames((prev) => prev.filter((n) => n !== name))}
                    title="Remove from exclusion list"
                  >×</button>
                </span>
              ))}
              {excludedCardNames.length > 8 && (
                <span className="deckbuilder-excluded-more">+{excludedCardNames.length - 8} more</span>
              )}
              <button
                className="deckbuilder-excluded-clear"
                onClick={() => setExcludedCardNames([])}
              >× Clear All</button>
            </div>
          </div>
        )}

        {isHung && (
          <button
            onClick={handleReset}
            disabled={resetting}
            className="deckbuilder-reset-btn"
            title="The model has not responded in 45+ seconds and is considered hung. Click to reset."
          >
            {resetting ? "Resetting..." : "⚠️ Force Reset Model"}
          </button>
        )}
      </div>

      <div className="deckbuilder-commander-preview">
        {selectedCommanderObj ? (
          <CardPreview
            name={selectedCommanderObj.name}
            imageUri={selectedCommanderObj.image_uri}
            subtitle={`Commander ${(selectedCommanderObj.color_identity || []).map((x) => COLOR_SYMBOLS[x] || x).join("")}`}
            tcgplayerPrice={selectedCommanderObj.tcgplayer_price}
          />
        ) : (
          <div className="deckbuilder-commander-placeholder">
            <span>Select a commander to preview it here</span>
          </div>
        )}
      </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {saveMessage && <div className={`alert alert-${saveMessage.type}`}>{saveMessage.text}</div>}

      {(building || (buildStatus?.thoughts?.length ?? 0) > 0) && (
        <div className="alert alert-info deckbuilder-build-progress">
          <div className="deckbuilder-build-progress-title">AI Build Process</div>
          <small className="deckbuilder-build-progress-msg">
            {buildStatus?.message || "Deck builder is working..."}
          </small>
          <div className="deckbuilder-thoughts">
            {(buildStatus?.thoughts || []).map((thought, idx) => (
              <small key={`${thought.time}-${idx}`} className="deckbuilder-thought">
                {new Date(thought.time).toLocaleTimeString()} - {thought.message}
              </small>
            ))}
          </div>
        </div>
      )}

      {result && (
        <div>
          <div className="deckbuilder-result-header">
            <div className="deckbuilder-commander-small">
              <CardPreview
                name={result.commander.name}
                imageUri={result.commander.image_uri}
                subtitle="Commander"
                tcgplayerPrice={result.commander.tcgplayer_price}
              />
            </div>
            <div>
              <h2 className="deckbuilder-result-title">
                {result.commander.name} Commander Deck
              </h2>
              <p className="deckbuilder-result-desc">
                {result.description}
              </p>
              <BracketBadge info={result.bracket} showDetails />
              <div className={missingCount === 0 ? "deckbuilder-result-complete" : "deckbuilder-result-missing"}>
                Total Cards: {totalGeneratedCount}/100
                {missingCount > 0 ? ` (${missingCount} missing)` : " (complete)"}
              </div>
              <div className="deckbuilder-result-cost">
                Estimated Deck Cost (TCG low): ${estimatedCost.toFixed(2)}
              </div>
              <button className="btn-secondary" onClick={exportDecklist}>
                Export Decklist (.txt)
              </button>
              <button
                className="btn-primary deckbuilder-save-btn"
                onClick={saveDeckToFolder}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save Deck"}
              </button>
            </div>
          </div>

          <div className="deckbuilder-stats-row">
            <div className="deckbuilder-stats-card">
              <h3 className="deckbuilder-stats-heading">Mana Curve</h3>
              {curve && Object.entries(curve).map(([bucket, count]) => (
                <div key={bucket} className="deckbuilder-stats-item">
                  <span className="deckbuilder-stats-label">{bucket}</span>
                  <div className="deckbuilder-stats-bar-bg">
                    <div
                      className="deckbuilder-curve-bar"
                    />
                  </div>
                  <span className="deckbuilder-stats-count">{count}</span>
                </div>
              ))}
            </div>

            <div className="deckbuilder-stats-card">
              <h3 className="deckbuilder-stats-heading">Color Distribution</h3>
              {colors && Object.entries(colors).filter(([, v]) => v > 0).map(([color, count]) => (
                <div key={color} className="deckbuilder-stats-item">
                  <span className="deckbuilder-stats-label">{COLOR_SYMBOLS[color] || color}</span>
                  <div className="deckbuilder-stats-bar-bg">
                    <div
                      className="deckbuilder-color-bar"
                    />
                  </div>
                  <span className="deckbuilder-stats-count">{count}</span>
                </div>
              ))}
            </div>

            <div className="deckbuilder-stats-card">
              <h3 className="deckbuilder-stats-heading">Suggested Basic Lands ({basicLandCount})</h3>
              <div className="deckbuilder-basics-list">
                {basics.map((b) => (
                  <div key={b.name} className="deckbuilder-basics-row">
                    <span>{b.name}</span>
                    <strong>{b.count}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Selection action bar */}
          {selectedCardNames.size > 0 && (
            <div className="deckbuilder-selection-bar">
              <span>{selectedCardNames.size} card{selectedCardNames.size > 1 ? "s" : ""} selected</span>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setExcludedCardNames((prev) =>
                    Array.from(new Set([...prev, ...Array.from(selectedCardNames)]))
                  );
                  setSelectedCardNames(new Set());
                }}
              >
                Exclude from Regen
              </button>
              <button
                type="button"
                className="deckbuilder-remove-selected-btn"
                onClick={() => {
                  setResult((prev) => prev
                    ? { ...prev, deck: prev.deck.filter((c) => !selectedCardNames.has(c.name)) }
                    : prev
                  );
                  setDeckModified(true);
                  setSelectedCardNames(new Set());
                }}
              >
                🗑 Remove Selected
              </button>
              <button
                type="button"
                className="deckbuilder-reroll-btn deckbuilder-reroll-btn--inline"
                onClick={() => {
                  const merged = Array.from(new Set([...excludedCardNames, ...Array.from(selectedCardNames)]));
                  setExcludedCardNames(merged);
                  setSelectedCardNames(new Set());
                  handleBuild(true, merged);
                }}
              >
                🎲 Re-Roll Without Selected
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setSelectedCardNames(new Set())}
              >
                Clear Selection
              </button>
            </div>
          )}

          <p className="deckbuilder-select-hint">
            ✓ Check cards below to exclude them from the next re-roll.
          </p>

          {Object.entries(groups)
            .sort(([a], [b]) => {
              const aIsLand = a.toLowerCase().includes("land");
              const bIsLand = b.toLowerCase().includes("land");
              if (aIsLand && !bIsLand) return 1;
              if (!aIsLand && bIsLand) return -1;
              return a.localeCompare(b);
            })
            .map(([type, cards]) => {
              const isLandGroup = type.toLowerCase().includes("land");
              let displayCards: { card: CardEntry; count: number }[] = [];
              if (isLandGroup) {
                // Collapse basic-land duplicates: 1 tile per basic name, with a (N) count badge.
                const basicCounts = new Map<string, { card: CardEntry; count: number }>();
                for (const c of cards) {
                  const isBasic = (c.type_line || "").toLowerCase().includes("basic");
                  if (isBasic) {
                    const key = c.name.toLowerCase();
                    const entry = basicCounts.get(key);
                    if (entry) entry.count += 1;
                    else basicCounts.set(key, { card: c, count: 1 });
                  } else {
                    displayCards.push({ card: c, count: 1 });
                  }
                }
                displayCards = [...displayCards, ...Array.from(basicCounts.values())];
              } else {
                displayCards = cards.map((c) => ({ card: c, count: 1 }));
              }
              return (
                <div key={type} className="deckbuilder-type-group">
                  <h3 className="deckbuilder-stats-heading">
                    {type} ({cards.length})
                  </h3>
                  <div className="card-grid">
                    {displayCards.map(({ card, count }) => (
                      <div key={card.id + card.name} className="deckbuilder-card-tile-wrap">
                        {!isLandGroup && (
                          <input
                            type="checkbox"
                            className="deckbuilder-card-tile-checkbox"
                            checked={selectedCardNames.has(card.name)}
                            onChange={(e) => {
                              const next = new Set(selectedCardNames);
                              if (e.target.checked) next.add(card.name);
                              else next.delete(card.name);
                              setSelectedCardNames(next);
                            }}
                            title={`Select "${card.name}" to exclude from re-roll`}
                          />
                        )}
                        <div
                          className="deckbuilder-result-tile"
                          onClick={() => setPreviewCard(card)}
                          title="Click to preview"
                        >
                          {card.image_uri
                            ? <img src={card.image_uri} alt={card.name} loading="lazy" />
                            : <div className="deckbuilder-result-tile-noimg">{card.name}</div>
                          }
                          <div className="deckbuilder-result-tile-info">
                            <span className="deckbuilder-result-tile-name">{card.name}</span>
                            <span className="deckbuilder-result-tile-meta">CMC {card.cmc}{card.tcgplayer_price ? ` · $${Number(card.tcgplayer_price).toFixed(2)}` : ""}</span>
                          </div>
                        </div>
                        {count > 1 && <span className="deckbuilder-card-count-badge">({count})</span>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {/* Save changes / add-from-collection bar */}
      {result && (
        <div className="deckbuilder-save-changes-bar">
          {deckModified && savedFilename && (
            <>
              <span className="deckbuilder-save-changes-label">
                ⚠ Unsaved changes ({result.deck.length} cards)
              </span>
              <button
                type="button"
                className="btn-primary deckbuilder-save-changes-btn"
                onClick={handleSaveChanges}
                disabled={saving}
              >
                {saving ? "Saving..." : "💾 Save Changes"}
              </button>
            </>
          )}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowAddFromCollection(true)}
          >
            + Add from Collection
          </button>
        </div>
      )}

      {/* Add from Collection modal */}
      {showAddFromCollection && (
        <div className="collection-modal-overlay" onClick={() => setShowAddFromCollection(false)}>
          <div className="deckbuilder-add-collection-modal" onClick={(e) => e.stopPropagation()}>
            <div className="deckbuilder-add-collection-header">
              <h3>Add Card from Collection</h3>
              <button
                type="button"
                className="deckbuilder-card-modal-close"
                onClick={() => setShowAddFromCollection(false)}
                aria-label="Close"
              >✕</button>
            </div>
            <input
              type="text"
              placeholder="Search card name..."
              value={addCollectionSearch}
              onChange={(e) => setAddCollectionSearch(e.target.value)}
              className="deckbuilder-add-collection-search"
              autoFocus
            />
            <div className="deckbuilder-add-collection-list">
              {collection
                .filter((c) => {
                  if (!addCollectionSearch.trim()) return true;
                  return c.name.toLowerCase().includes(addCollectionSearch.toLowerCase());
                })
                .slice(0, 50)
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="deckbuilder-add-collection-item"
                    onClick={() => handleAddCardFromCollection(c.name)}
                  >
                    <span className="deckbuilder-add-collection-name">{c.name}</span>
                    <span className="deckbuilder-add-collection-type">{c.type_line}</span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Card image preview modal */}
      {previewCard && (
        <div className="collection-modal-overlay" onClick={() => setPreviewCard(null)}>
          <div className="deckbuilder-card-modal" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="deckbuilder-card-modal-close"
              onClick={() => setPreviewCard(null)}
              aria-label="Close preview"
            >✕</button>
            {previewCard.image_uri && (
              <img src={previewCard.image_uri} alt={previewCard.name} />
            )}
            <div className="deckbuilder-card-modal-info">
              <span className="deckbuilder-card-modal-name">{previewCard.name}</span>
              <span className="deckbuilder-card-modal-meta">
                CMC {previewCard.cmc}
                {previewCard.tcgplayer_price ? ` · TCG $${Number(previewCard.tcgplayer_price).toFixed(2)}` : ""}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
