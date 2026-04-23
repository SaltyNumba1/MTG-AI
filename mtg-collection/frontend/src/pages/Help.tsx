import "./Help.css";

export default function Help() {
  return (
    <div className="page">
      <h1 className="page-title">Help</h1>

      <div className="alert alert-info help-intro">
        Quick start guide for importing cards, building decks, and exporting to deck sites.
      </div>

      <section className="help-section">
        <h2>1. Import Your Collection</h2>
        <p>
          Go to Collection and use Import CSV. Moxfield, Archidekt, and ManaBox CSV exports are supported.
        </p>
      </section>

      <section className="help-section">
        <h2>2. Build a Deck</h2>
        <p>
          Open Build Deck, pick a commander, add a strategy prompt, and optionally add keyword filters.
          Default land targets are 25 basic and 12 nonbasic.
        </p>
      </section>

      <section className="help-section">
        <h2>3. Save and Export</h2>
        <p>
          Use Save Deck to store builds in My Decks. Exported TXT decklists include a commander marker for better Moxfield import behavior.
        </p>
      </section>

      <section className="help-section">
        <h2>4. Manual Decks from Collection</h2>
        <p>
          In Collection, use checkboxes to select cards, then click Save Selected as Deck.
          Choose a commander from selected cards and save directly to My Decks.
        </p>
      </section>

      <section className="help-section">
        <h2>5. Backup and Restore</h2>
        <p>
          Use Database Safety in Collection to create backups and restore snapshots of your card database.
        </p>
      </section>
    </div>
  );
}
