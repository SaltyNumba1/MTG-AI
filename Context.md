[Update: April 20, 2026]
Resolved Issues: * Successfully implemented streaming (stream: true) for Ollama API requests to act as a TCP heartbeat, preventing 5-minute idle timeouts.

Configured OLLAMA_KEEP_ALIVE=-1 to ensure the Mistral model stays loaded in VRAM between chunked processing tasks.

Migrated network/fetch logic to the Main Process to avoid Electron UI thread throttling.

Current Focus: * Moving from simple "chunk processing" to intelligent deck synthesis.

Implementing a synergy-mapping system where keywords (e.g., "Sacrifice," "Blink") are matched against a JSON synergy database.

Strategy directives are now being injected into prompts to force the model to prioritize synergy partners during the deck-building process.

Next Implementation Steps:

Finalize the synergy_map.json structure.

Create the "Strategy Directive" generator in the backend to ensure keywords from the CSV match the synergy requirements before prompt construction.