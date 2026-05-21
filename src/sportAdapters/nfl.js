import { getSlates as baseGetSlates, getSlatePlayers as baseGetSlatePlayers, getProjections as baseGetProjections, getOwnership as baseGetOwnership, normalizePlayerRow as baseNormalizePlayerRow } from "../legalDataClient.js";

export const stackCorrelationPlaceholders = ["QB-WR", "QB-TE", "QB-pass-catcher bring-back", "RB-defense"];

export const getSlates = (sport, slate_type, site, params) => baseGetSlates("nfl", slate_type, site, params);
export const getSlatePlayers = (sport, slateId, slate_type, site, params) => baseGetSlatePlayers("nfl", slateId, slate_type, site, params);
export const getProjections = (sport, slateId, params) => baseGetProjections("nfl", slateId, params);
export const getOwnership = (sport, slateId, params) => baseGetOwnership("nfl", slateId, params);

export function normalizePlayerRow(raw, sport = "nfl", slate_type = "classic", site = "draftkings") {
  const player = baseNormalizePlayerRow(raw, sport, slate_type, site);
  const targetShare = Number(raw.TargetShare || raw.ProjectedTargetShare || 0);
  const rushShare = Number(raw.RushShare || raw.ProjectedRushShare || 0);
  const roleBoost = Math.max(targetShare, rushShare) * 0.18;

  return {
    ...player,
    projection: player.projection + roleBoost,
    ceiling: player.ceiling + roleBoost * 1.8,
    boom_pct: Math.min(100, player.boom_pct + roleBoost * 0.25),
    game_script_fit: player.position === "QB" ? "Pass-heavy stack anchor" : "Role and touchdown path",
    raw: { ...player.raw, stack_correlation_placeholders: stackCorrelationPlaceholders }
  };
}
