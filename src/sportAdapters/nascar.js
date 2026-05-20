import { getSlates as baseGetSlates, getSlatePlayers as baseGetSlatePlayers, getProjections as baseGetProjections, getOwnership as baseGetOwnership, normalizePlayerRow as baseNormalizePlayerRow } from "../sportsdataioClient.js";

export const getSlates = (sport, slate_type, site, params) => baseGetSlates("nascar", slate_type, site, params);
export const getSlatePlayers = (sport, slateId, slate_type, site, params) => baseGetSlatePlayers("nascar", slateId, slate_type, site, params);
export const getProjections = (sport, slateId, params) => baseGetProjections("nascar", slateId, params);
export const getOwnership = (sport, slateId, params) => baseGetOwnership("nascar", slateId, params);

export function normalizePlayerRow(raw, sport = "nascar", slate_type = "classic", site = "draftkings") {
  const player = baseNormalizePlayerRow(raw, sport, slate_type, site);
  const dominator = Number(raw.LapsLedProjection || raw.FastestLapsProjection || raw.DominatorRating || 0);
  const placeDifferential = Number(raw.PlaceDifferentialProjection || raw.StartingPositionAdvantage || 0);
  const finishProjection = Number(raw.FinishingPositionProjection || raw.ProjectedFinish || 0);
  const wreckRisk = Number(raw.WreckRisk || raw.DnfProbability || 0);

  return {
    ...player,
    ceiling: player.ceiling + dominator * 0.35 + placeDifferential * 0.8,
    boom_pct: Math.min(100, player.boom_pct + dominator * 0.18 + Math.max(placeDifferential, 0) * 0.55),
    bust_pct: Math.min(100, player.bust_pct + wreckRisk * 0.25 + (finishProjection > 25 ? 5 : 0)),
    game_script_fit: dominator > placeDifferential ? "Dominator path" : "Place-differential path",
    raw: { ...player.raw, dominator, placeDifferential, finishProjection, wreckRisk }
  };
}
