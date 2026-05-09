import "./BracketBadge.css";

export interface BracketInfo {
  bracket: number;
  label: string;
  description: string;
  game_changers: string[];
  extra_turns: string[];
  mass_land_denial: string[];
  combo_enablers: string[];
  tutor_count: number;
}

interface Props {
  /** Pass either the numeric bracket alone, or a full BracketInfo object. */
  bracket?: number;
  info?: BracketInfo;
  showDetails?: boolean;
}

const FALLBACK_LABELS: Record<number, string> = {
  1: "Exhibition",
  2: "Core",
  3: "Upgraded",
  4: "Optimized",
  5: "cEDH",
};

export default function BracketBadge({ bracket, info, showDetails = false }: Props) {
  const num = bracket ?? info?.bracket;
  if (!num || num < 1 || num > 5) return null;

  const label = info?.label ?? FALLBACK_LABELS[num];

  const sections: Array<{ title: string; cards: string[] }> = [];
  if (info) {
    if (info.game_changers.length > 0)
      sections.push({ title: "Game Changers", cards: info.game_changers });
    if (info.extra_turns.length > 0)
      sections.push({ title: "Extra Turns", cards: info.extra_turns });
    if (info.mass_land_denial.length > 0)
      sections.push({ title: "Mass Land Denial", cards: info.mass_land_denial });
    if (info.combo_enablers.length > 0)
      sections.push({ title: "Combo Enablers", cards: info.combo_enablers });
  }

  return (
    <div className="bracket-badge-wrap">
      <span
        className={`bracket-badge bracket-${num}`}
        title={info?.description}
      >
        Bracket {num} — {label}
      </span>

      {showDetails && info && (
        <div className="bracket-badge-details">
          <small className="bracket-badge-desc">{info.description}</small>
          {sections.map(({ title, cards }) => (
            <div key={title} className="bracket-badge-section">
              <strong>{title}:</strong> {cards.join(", ")}
            </div>
          ))}
          {info.tutor_count > 0 && (
            <div className="bracket-badge-section">
              <strong>Tutors detected:</strong> {info.tutor_count}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
