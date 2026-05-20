import { getSlates as baseGetSlates, getSlatePlayers as baseGetSlatePlayers, getProjections as baseGetProjections, getOwnership as baseGetOwnership, normalizePlayerRow as baseNormalizePlayerRow } from "../sportsdataioClient.js";

export const stackCorrelationPlaceholders = ["team stack", "mini stack", "wraparound stack", "pitcher leverage against chalk stack"];

export const getSlates = (sport, slate_type, site, params) => baseGetSlates("mlb", slate_type, site, params);
export const getSlatePlayers = (sport, slateId, slate_type, site, params) => baseGetSlatePlayers("mlb", slateId, slate_type, site, params);
export const getProjections = (sport, slateId, params) => baseGetProjections("mlb", slateId, params);
export const getOwnership = (sport, slateId, params) => baseGetOwnership("mlb", slateId, params);

export function normalizePlayerRow(raw, sport = "mlb", slate_type = "classic", site = "draftkings") {
  const player = baseNormalizePlayerRow(raw, sport, slate_type, site);
  const isPitcher = String(player.position || "").toUpperCase().includes("P");
  const lineupSpot = Number(raw.BattingOrder || raw.LineupSpot || 0);
  const power = Number(raw.HomeRun || raw.HomeRuns || raw.PowerRating || 0);
  const strikeouts = Number(raw.Strikeouts || raw.ProjectedStrikeouts || raw.KProjection || 0);
  const innings = Number(raw.InningsPitched || raw.ProjectedInnings || 0);

  if (isPitcher) {
    return {
      ...player,
      ceiling: player.ceiling + strikeouts * 1.8 + innings * 0.7,
      boom_pct: Math.min(100, player.boom_pct + strikeouts * 1.4),
      bust_pct: Math.max(0, player.bust_pct - innings * 1.2),
      game_script_fit: "Strikeout/workload path",
      raw: { ...player.raw, stack_correlation_placeholders: stackCorrelationPlaceholders }
    };
  }

  const lineupBoost = lineupSpot > 0 && lineupSpot <= 5 ? (6 - lineupSpot) * 0.5 : 0;
  return {
    ...player,
    ceiling: player.ceiling + power * 1.2 + lineupBoost,
    boom_pct: Math.min(100, player.boom_pct + power * 0.8 + lineupBoost),
    game_script_fit: "Power and stack correlation path",
    raw: { ...player.raw, stack_correlation_placeholders: stackCorrelationPlaceholders }
  };
}
