export function captainTierForScore(captainScore) {
  const score = Number(captainScore || 0);
  if (score >= 75) return "Elite Captain";
  if (score >= 58) return "Strong Captain";
  if (score >= 48) return "Viable Captain";
  if (score >= 35) return "Thin Captain";
  return "Avoid Captain";
}

export function captainTierForPlayer(player = {}) {
  if (String(player.slate_type || player.slateType || "").toLowerCase() !== "showdown") return player.captain_tier || null;
  return player.captain_tier || player.captainTier || captainTierForScore(player.showdown_captain_score ?? player.captainScore);
}
