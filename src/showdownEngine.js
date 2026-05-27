const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));
const safeNum = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

const EXPLANATION_LIBRARY = {
  elite: [
    "Elite Captain profile with true slate-breaking ceiling and enough raw upside to separate from duplicated constructions.",
    "Premium CPT candidate: elite ceiling + usage + tournament paths that can bury the field in competitive scripts.",
    "This is the type of Captain who can decide first place alone when pace, minutes, and efficiency all land together."
  ],
  strong: [
    "Strong Captain profile with legitimate 1.5x payoff and stable role clarity for tournament builds.",
    "High-end CPT option: strong raw projection backed by enough ceiling to anchor aggressive roster construction.",
    "Strong Captain tier with reliable involvement and enough upside to lead optimal paths."
  ],
  leverage: [
    "Leverage captain candidate because ownership discount is paired with real ceiling outcomes.",
    "Tournament leverage path: lower captain popularity without sacrificing the score needed to win large fields.",
    "Ownership-adjusted Captain play with realistic first-place routes if variance tilts correctly."
  ],
  flex: [
    "Better deployed in Flex where salary efficiency helps lineup strength more than the 1.5x multiplier.",
    "Flex-only profile: solid projection utility, but not enough captain separation for large-field GPP priorities.",
    "Prefer as Flex exposure; build quality improves when this salary is used away from CPT."
  ],
  salary: [
    "Salary saver profile that keeps elite-spend builds live while still carrying playable paths.",
    "Cap relief piece for stars-heavy constructions; viable when opportunity holds.",
    "Useful value component that unlocks high-ceiling roster combinations."
  ],
  chalkRisk: [
    "Strong raw projection but chalk ownership introduces captain duplication and leverage drag.",
    "Popular build risk: projection is real, but tournament EV gets thinner at elevated ownership.",
    "Chalk pressure spot where popularity may outweigh upside edge at Captain."
  ],
  thin: [
    "Thin Captain case: requires a specific script and efficiency spike to become optimal.",
    "Low-frequency CPT path; viable only in narrow game-flow outcomes.",
    "Captain volatility is high here, making this more of a portfolio dart than a core path."
  ],
  fade: [
    "Fade candidate in most builds: insufficient upside relative to likely ownership and salary context.",
    "Limited tournament path; exposure should stay light unless game conditions shift.",
    "Below-threshold profile for showdown Captain viability."
  ],
  gameScript: [
    "Game script upside improves materially in competitive, high-tempo environments.",
    "Best utilized in onslaught or comeback constructions where late possessions increase volume.",
    "Strongest path comes from elevated pace and tight spread outcomes."
  ]
};

export function calculateShowdownScores(players, slateContext = {}) {
  const rankedByCeiling = [...players].map((p, idx) => ({ idx, v: safeNum(p.ceiling, safeNum(p.projection) * 1.8) })).sort((a, b) => b.v - a.v);
  const rankedByProjection = [...players].map((p, idx) => ({ idx, v: safeNum(p.projection) })).sort((a, b) => b.v - a.v);
  const rankedByBoom = [...players].map((p, idx) => ({ idx, v: safeNum(p.boom_pct, safeNum(p.upside_score)) })).sort((a, b) => b.v - a.v);
  const topCeiling = new Set(rankedByCeiling.slice(0, 3).map((x) => x.idx));
  const topProjection = new Set(rankedByProjection.slice(0, 3).map((x) => x.idx));
  const topBoom = new Set(rankedByBoom.slice(0, 3).map((x) => x.idx));

  return players.map((player, idx) => {
    const projection = safeNum(player.projection);
    const ceiling = safeNum(player.ceiling, projection * 1.8);
    const floor = safeNum(player.floor, projection * 0.55);
    const ownership = clamp(player.ownership);
    const upside = safeNum(player.upside_score);
    const leverage = safeNum(player.leverage_score);
    const roleStability = clamp((floor / Math.max(projection, 1)) * 100);
    const rawCeilingScore = normalizeWithinSlate(ceiling, players, "ceiling");
    const projectionStrength = normalizeWithinSlate(projection, players, "projection");
    const salaryRelief = clamp(100 - normalizeWithinSlate(safeNum(player.salary), players, "salary"));
    const salaryAdjustedUpside = clamp(rawCeilingScore * 0.65 + salaryRelief * 0.35);
    const ownershipDiscount = clamp(100 - ownership);
    const environment = calculateGameEnvironmentScore(player, slateContext);

    let captainScore = clamp(rawCeilingScore * 0.34 + projectionStrength * 0.18 + leverage * 0.15 + salaryAdjustedUpside * 0.09 + upside * 0.1 + environment.score * 0.09 + ownershipDiscount * 0.05);
    if (topCeiling.has(idx)) captainScore += 11;
    if (topProjection.has(idx)) captainScore += 7;
    if (topBoom.has(idx)) captainScore += 6;
    if (leverage >= 65 && rawCeilingScore >= 70) captainScore += 7;
    if (projection < 10 || roleStability < 36 || rawCeilingScore < 35) captainScore -= 14;
    if (safeNum(player.salary_value_score) >= 78 && rawCeilingScore < 50) captainScore -= 9;
    captainScore = clamp(captainScore);

    const eliteSignals = countEliteSignals({ idx, topCeiling, topProjection, topBoom, player, leverage, environment: environment.score });
    if (captainScore >= 75 && eliteSignals < 2) captainScore = 74;
    if (captainScore < 75 && eliteSignals >= 2 && rawCeilingScore >= 72) captainScore = Math.max(captainScore, 75);

    const flexScore = clamp(projection * 1.4 + roleStability * 0.22 + safeNum(player.salary_value_score) * 0.24 + upside * 0.18 + (100 - ownership) * 0.06 + environment.score * 0.08);
    const confidenceRating = clamp(captainScore * 0.35 + flexScore * 0.25 + leverage * 0.15 + environment.score * 0.25);

    const explanation = buildPremiumExplanation({ captainScore, flexScore, leverage, ownership, salary: safeNum(player.salary), environmentTag: environment.tag, gameScript: gameScriptFit(player), eliteSignals });

    return {
      ...player,
      showdown_captain_score: Number(captainScore.toFixed(2)),
      showdown_flex_score: Number(flexScore.toFixed(2)),
      showdown_confidence_rating: Number(confidenceRating.toFixed(2)),
      captain_tier: captainTier(captainScore),
      captain_ownership_risk: captainOwnershipRisk(ownership, captainScore, leverage),
      duplication_risk: duplicationRisk(player, slateContext),
      game_script_fit: gameScriptFit(player),
      game_environment_score: environment.score,
      game_environment_tag: environment.tag,
      game_environment_inputs: environment.inputs,
      elite_captain_signals: eliteSignals,
      contest_fit_tag: showdownTag(player, captainScore, flexScore, ownership, leverage),
      premium_explanation: explanation
    };
  });
}

function countEliteSignals({ idx, topCeiling, topProjection, topBoom, player, leverage, environment }) {
  let signals = 0;
  if (topCeiling.has(idx)) signals += 1;
  if (topProjection.has(idx)) signals += 1;
  if (topBoom.has(idx)) signals += 1;
  if (safeNum(player.projected_minutes) >= 34 || safeNum(player.usage_rate) >= 29 || safeNum(player.usage) >= 29) signals += 1;
  if (environment >= 70) signals += 1;
  if (leverage >= 68) signals += 1;
  return signals;
}

function captainTier(captainScore) { if (captainScore >= 75) return "Elite Captain"; if (captainScore >= 58) return "Strong Captain"; if (captainScore >= 48) return "Viable Captain"; if (captainScore >= 35) return "Thin Captain"; return "Avoid Captain"; }
function normalizeWithinSlate(value, players, key) { const values = players.map((p) => safeNum(p[key])).filter((x) => x >= 0); const max = Math.max(...values, 1); return clamp((safeNum(value) / max) * 100); }
function captainOwnershipRisk(ownership, captainScore, leverage) { if (ownership >= 38 && captainScore < 72) return "High - Too Chalky Captain"; if (ownership >= 28 && leverage < 55) return "Medium - Popular Captain"; if (ownership <= 12 && captainScore >= 62) return "Low - Leverage Captain"; return "Normal"; }
function duplicationRisk(player, slateContext) { const ownership = clamp(player.ownership); const salary = safeNum(player.salary); const salaryCap = safeNum(slateContext.salaryCap, 50000); if (ownership >= 32 && salary >= salaryCap * 0.16) return "High"; if (ownership >= 22 || salary >= salaryCap * 0.18) return "Medium"; return "Low"; }

function calculateGameEnvironmentScore(player, slateContext = {}) {
  const input = { ...slateContext, ...(player.environment || {}), ...(player.raw_environment || {}) };
  const vegasTotal = safeNum(input.vegas_total, safeNum(player.vegas_total, 0));
  const spread = Math.abs(safeNum(input.spread, safeNum(player.spread, 0)));
  const pace = safeNum(input.pace, safeNum(player.pace, 0));
  const implied = safeNum(input.implied_team_total, safeNum(player.implied_team_total, 0));
  const backToBack = Boolean(input.back_to_back ?? player.back_to_back);
  const injuryBoost = clamp(safeNum(input.injury_boost, safeNum(player.injury_boost, 0)));
  const playoffRotation = Boolean(input.playoff_rotation ?? player.playoff_rotation);
  const condensedUsage = Boolean(input.condensed_usage ?? player.condensed_usage);

  let score = 50;
  if (vegasTotal) score += vegasTotal >= 236 ? 16 : vegasTotal >= 224 ? 11 : vegasTotal >= 214 ? 4 : -8;
  if (spread) score += spread <= 4 ? 14 : spread <= 7 ? 8 : spread <= 10 ? 2 : -12;
  if (pace) score += pace >= 102 ? 12 : pace >= 99 ? 6 : pace >= 96 ? 0 : -10;
  if (implied) score += implied >= 118 ? 12 : implied >= 111 ? 6 : implied >= 104 ? 0 : -10;
  if (condensedUsage) score += 8;
  if (playoffRotation) score += 6;
  if (injuryBoost) score += injuryBoost * 0.15;
  if (backToBack) score -= 6;

  score = clamp(score);
  let tag = "Neutral Environment";
  if (score >= 80) tag = "Elite Environment";
  else if (score >= 67) tag = "Strong Pace Spot";
  else if (score < 36) tag = "Blowout Risk";
  else if (score < 48) tag = "Slow Spot";

  return { score: Number(score.toFixed(2)), tag, inputs: { vegas_total: vegasTotal || null, spread: spread || null, pace: pace || null, implied_team_total: implied || null, back_to_back: backToBack, injury_boost: injuryBoost || null, playoff_rotation: playoffRotation, condensed_usage: condensedUsage } };
}

function gameScriptFit(player) { const position = String(player.position || "").toUpperCase(); const sport = String(player.sport || "").toLowerCase(); if (sport === "nfl" && ["QB", "WR", "TE"].includes(position)) return "Pass-heavy or comeback script"; if (sport === "nfl" && position === "RB") return "Lead or red-zone script"; if (sport === "nba") return "Close-game minutes and usage script"; return "Neutral script"; }
function showdownTag(player, captainScore, flexScore, ownership, leverage) { if (captainScore >= 75) return "Elite Captain"; if (ownership >= 35 && captainScore < 72) return "Chalk Risk"; if (captainScore >= 68 && leverage >= 65) return "Leverage Captain"; if (flexScore >= 82) return "Flex Core"; if (leverage >= 74 && ownership <= 24) return "Tournament Leverage"; if (safeNum(player.salary) <= 3000 && safeNum(player.projection) >= 12) return "Salary Saver"; return "Showdown Pool"; }

function buildPremiumExplanation(input) {
  const { captainScore, flexScore, leverage, ownership, salary, environmentTag, gameScript, eliteSignals } = input;
  const parts = [];
  if (captainScore >= 75 && eliteSignals >= 2) parts.push(pick(EXPLANATION_LIBRARY.elite, salary));
  else if (captainScore >= 58) parts.push(pick(EXPLANATION_LIBRARY.strong, ownership));
  else if (captainScore >= 35) parts.push(pick(EXPLANATION_LIBRARY.thin, leverage));
  else parts.push(pick(EXPLANATION_LIBRARY.fade, captainScore));
  if (leverage >= 68 && captainScore >= 55) parts.push(pick(EXPLANATION_LIBRARY.leverage, leverage));
  if (ownership >= 30 && captainScore >= 55) parts.push(pick(EXPLANATION_LIBRARY.chalkRisk, ownership));
  if (flexScore > captainScore + 8) parts.push(pick(EXPLANATION_LIBRARY.flex, flexScore));
  if (salary <= 4200) parts.push(pick(EXPLANATION_LIBRARY.salary, salary));
  if (environmentTag === "Elite Environment" || environmentTag === "Strong Pace Spot") parts.push(`${pick(EXPLANATION_LIBRARY.gameScript, captainScore)} (${gameScript}).`);
  return dedupe(parts).join(" ");
}
function pick(list, seed = 0) { return list[Math.abs(Math.floor(seed)) % list.length]; }
function dedupe(parts) { return [...new Set(parts.filter(Boolean))]; }
