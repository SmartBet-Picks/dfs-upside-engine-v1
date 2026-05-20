import { getSlates as baseGetSlates, getSlatePlayers as baseGetSlatePlayers, getProjections as baseGetProjections, getOwnership as baseGetOwnership, normalizePlayerRow as baseNormalizePlayerRow } from "../sportsdataioClient.js";

export const getSlates = (sport, slate_type, site, params) => baseGetSlates("golf", slate_type, site, params);
export const getSlatePlayers = (sport, slateId, slate_type, site, params) => baseGetSlatePlayers("golf", slateId, slate_type, site, params);
export const getProjections = (sport, slateId, params) => baseGetProjections("golf", slateId, params);
export const getOwnership = (sport, slateId, params) => baseGetOwnership("golf", slateId, params);

export function normalizePlayerRow(raw, sport = "golf", slate_type = "classic", site = "draftkings") {
  const player = baseNormalizePlayerRow(raw, sport, slate_type, site);
  const cutMadeProxy = Number(raw.CutMadeProbability || raw.MakeCutProbability || 0);
  const birdieUpside = Number(raw.BirdieOrBetterPercentage || raw.BirdieRating || 0);
  const finishingCeiling = Number(raw.Top10Probability || raw.WinProbability || 0);

  return {
    ...player,
    floor: player.floor + cutMadeProxy * 0.08,
    ceiling: player.ceiling + birdieUpside * 0.15 + finishingCeiling * 0.28,
    boom_pct: Math.min(100, player.boom_pct + birdieUpside * 0.08 + finishingCeiling * 0.18),
    bust_pct: Math.max(0, player.bust_pct - cutMadeProxy * 0.08),
    game_script_fit: "Cut-making plus birdie streak path",
    raw: { ...player.raw, cutMadeProxy, birdieUpside, finishingCeiling }
  };
}
