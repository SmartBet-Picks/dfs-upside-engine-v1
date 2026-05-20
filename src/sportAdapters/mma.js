import { getSlates as baseGetSlates, getSlatePlayers as baseGetSlatePlayers, getProjections as baseGetProjections, getOwnership as baseGetOwnership, normalizePlayerRow as baseNormalizePlayerRow } from "../sportsdataioClient.js";

export const getSlates = (sport, slate_type, site, params) => baseGetSlates("mma", slate_type, site, params);
export const getSlatePlayers = (sport, slateId, slate_type, site, params) => baseGetSlatePlayers("mma", slateId, slate_type, site, params);
export const getProjections = (sport, slateId, params) => baseGetProjections("mma", slateId, params);
export const getOwnership = (sport, slateId, params) => baseGetOwnership("mma", slateId, params);

export function normalizePlayerRow(raw, sport = "mma", slate_type = "classic", site = "draftkings") {
  const player = baseNormalizePlayerRow(raw, sport, slate_type, site);
  const finishOddsProxy = Number(raw.FinishProbability || raw.KOProbability || raw.SubmissionProbability || 0);
  const volumeProxy = Number(raw.StrikesLandedPerMinute || raw.TakedownsAverage || raw.VolumeRating || 0);
  const underdogCeilingBoost = Number(raw.IsUnderdog || raw.Underdog) ? 6 : 0;

  return {
    ...player,
    ceiling: player.ceiling + finishOddsProxy * 0.28 + volumeProxy * 2 + underdogCeilingBoost,
    boom_pct: Math.min(100, player.boom_pct + finishOddsProxy * 0.18 + underdogCeilingBoost * 0.7),
    bust_pct: Math.min(100, player.bust_pct + 8),
    game_script_fit: "Finish or high-volume decision path",
    raw: { ...player.raw, finishOddsProxy, volumeProxy }
  };
}
