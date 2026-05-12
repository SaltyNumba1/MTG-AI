# DeepBrew v1.1.1 Release Notes

## Bug Fixes

### Analyze Suggestions No Longer Time Out
- Removed the wall-clock timeout (previously 900 s) from the LLM generation pipeline.
- The `OLLAMA_MAX_GENERATION_SEC`, `OLLAMA_TIMEOUT`, and `ALLOW_LLM_TIMEOUT_FALLBACK` constants have been deleted entirely.
- The `backendEnv` in the Electron launcher no longer injects those env vars.
- GPU inference is reliable enough that a hard deadline is no longer needed, and the analyze call was consistently hitting the limit before returning suggestions.
- The heartbeat progress reporter (every 8 s) is kept so the UI still shows elapsed time during long generations.
- On failure the backend now raises a clear `ValueError` or re-raises the network exception instead of silently returning an empty deck.
