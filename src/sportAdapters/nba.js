import { getSlates as baseGetSlates, getSlatePlayers as baseGetSlatePlayers, getProjections as baseGetProjections, getOwnership as baseGetOwnership, normalizePlayerRow as baseNormalizePlayerRow } from "../sportsdataioClient.js";

export const getSlates = (sport, slate_type, site, params) => baseGetSlates("nba", slate_type, site, params);
export const getSlatePlayers = (sport, slateId, slate_type, site, params) => baseGetSlatePlayers("nba", slateId, slate_type, site, params);
export const getProjections = (sport, slateId, params) => baseGetProjections("nba", slateId, params);
export const getOwnership = (sport, slateId, params) => baseGetOwnership("nba", slateId, params);

export function normalizePlayerRow(raw, sport = "nba", slate_type = "classic", site = "draftkings") {
  const player = baseNormalizePlayerRow(raw, sport, slate_type, site);
  const minutes = Number(raw.Minutes || raw.ProjectedMinutes || 0);
  const usage = Number(raw.UsageRate || raw.ProjectedUsageRate || 0);
  const fragilePuntPenalty = minutes > 0 && minutes < 18 ? 8 : 0;

  return {
    ...player,
    projection: player.projection + minutes * 0.08 + usage * 0.04,
    floor: Math.max(0, player.floor + minutes * 0.05 - fragilePuntPenalty * 0.15),
    ceiling: player.ceiling + minutes * 0.16 + usage * 0.12,
    bust_pct: Math.min(100, player.bust_pct + fragilePuntPenalty),
    game_script_fit: "Minutes and usage stability",
    raw: { ...player.raw, minutes, usage }
  };
}
