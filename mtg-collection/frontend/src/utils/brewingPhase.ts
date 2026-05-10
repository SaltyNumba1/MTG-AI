/**
 * Maps elapsed build seconds to a descriptive DeepBrew phase label.
 * Used by BuildStatusFloater to make inference waits feel active.
 */
export function getBrewingPhase(elapsedSeconds: number): string {
  if (elapsedSeconds < 5)   return "Warming up the cauldron…";
  if (elapsedSeconds < 15)  return "Analyzing commander identity…";
  if (elapsedSeconds < 30)  return "Mapping synergy archetypes…";
  if (elapsedSeconds < 50)  return "Filtering candidates from collection…";
  if (elapsedSeconds < 75)  return "Scoring keyword resonance…";
  if (elapsedSeconds < 110) return "Distilling the candidate pool…";
  if (elapsedSeconds < 150) return "Deep brewing — model is thinking…";
  if (elapsedSeconds < 210) return "Refining the 99…";
  if (elapsedSeconds < 300) return "Finalizing land base…";
  return "Still brewing — large collection or complex strategy…";
}
