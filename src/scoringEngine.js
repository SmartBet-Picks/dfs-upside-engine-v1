import { getFieldSizeBucket } from "./contestRules.js";

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));
const round = (value, places = 2) => Number(clamp(value, -1000000, 1000000).toFixed(places));
const safeNum = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

const SPORT_CEILING_MARKS = {
  nfl: 28,
  mlb: 18,
  nba: 45,
  mma: 85,
  golf: 85,
  nascar: 75
};

export function calculatePlayerScores(player, slateContext = {}) {
  const sport = String(player.sport || slateContext.sport || "").toLowerCase();
  const projection = safeNum(player.projection);
  const floor = safeNum(player.floor, projection * 0.55);
  const ceiling = safeNum(player.ceiling, projection * 1.8);
  const boomPct = clamp(player.boom_pct);
  const bustPct = clamp(player.bust_pct);
  const ownership = clamp(player.ownership);
  const salary = Math.max(safeNum(player.salary), 1);
  const ceilingMark = SPORT_CEILING_MARKS[sport] || 40;
  const slateSize = Math.max(safeNum(slateContext.slateSize, 100), 1);

  const valuePerDollar = projection / (salary / 1000);
  const ceilingPerDollar = ceiling / (salary / 1000);
  const salaryValueScore = clamp((valuePerDollar / sportValueBenchmark(sport)) * 70 + (ceilingPerDollar / (sportValueBenchmark(sport) * 1.7)) * 30);
  const ceilingScore = clamp((ceiling / ceilingMark) * 100);
  const projectionScore = clamp((projection / (ceilingMark * 0.65)) * 100);
  const volatilityScore = clamp(((ceiling - floor) / Math.max(projection, 1)) * 42 + bustPct * 0.45);
  const ownershipPenalty = ownership <= 18 ? 1 : ownership <= 30 ? 0.9 : ownership <= 45 ? 0.78 : 0.62;
  const largeFieldVolatilityBoost = slateSize >= 80 ? volatilityScore * 0.08 : slateSize >= 40 ? volatilityScore * 0.04 : 0;

  const upsideScore = clamp(
    ceilingScore * 0.34 +
    projectionScore * 0.22 +
    boomPct * 0.18 +
    salaryValueScore * 0.16 +
    (100 - ownership) * 0.06 +
    largeFieldVolatilityBoost
  ) * ownershipPenalty;

  const leverageScore = clamp(
    ceilingScore * 0.31 +
    boomPct * 0.24 +
    projectionScore * 0.18 +
    (100 - ownership) * 0.22 +
    (100 - duplicationRiskProxy(player, slateContext)) * 0.05 -
    Math.max(0, ownership - boomPct) * 0.35
  );

  const fakeChalk = isFakeChalk({ ownership, boomPct, ceilingScore, bustPct, salaryValueScore });
  const singleEntryGrade = gradeSingleEntry({
    projectionScore,
    floor,
    projection,
    ceiling,
    ceilingScore,
    volatilityScore,
    ownership,
    salaryValueScore,
    fakeChalk,
    sport
  });
  const recommendedFieldSize = recommendFieldSize({ upsideScore, leverageScore, volatilityScore, ownership, fakeChalk });
  const contestFitTag = contestFit({ upsideScore, leverageScore, salaryValueScore, ownership, volatilityScore, fakeChalk, singleEntryGrade });

  return {
    ...player,
    salary_value_score: round(salaryValueScore),
    volatility_score: round(volatilityScore),
    upside_score: round(upsideScore),
    leverage_score: round(leverageScore),
    contest_fit_tag: contestFitTag,
    recommended_field_size: recommendedFieldSize,
    single_entry_grade: singleEntryGrade,
    small_field_grade: gradeField(upsideScore, leverageScore, volatilityScore, fakeChalk, "small"),
    large_field_grade: gradeField(upsideScore, leverageScore, volatilityScore, fakeChalk, "large"),
    fake_chalk_warning: fakeChalk.warning,
    fake_chalk_reason: fakeChalk.reason,
    slate_breaker_tag: ceiling >= ceilingMark * 1.35 && boomPct >= 28 && upsideScore >= 72 && leverageScore >= 68
  };
}

export function scorePlayers(players, slateContext = {}) {
  return players.map((player) => calculatePlayerScores(player, { ...slateContext, slateSize: players.length }));
}

function sportValueBenchmark(sport) {
  return {
    nfl: 2.8,
    mlb: 1.8,
    nba: 5.0,
    mma: 9.0,
    golf: 7.2,
    nascar: 6.8
  }[sport] || 4.0;
}

function duplicationRiskProxy(player, slateContext) {
  const ownership = clamp(player.ownership);
  const salary = safeNum(player.salary);
  const salaryCap = safeNum(slateContext.salaryCap, 50000);
  const salaryBucketPopularity = salary >= salaryCap * 0.18 ? 18 : salary <= salaryCap * 0.08 ? 12 : 8;
  return clamp(ownership * 0.75 + salaryBucketPopularity);
}

function isFakeChalk({ ownership, boomPct, ceilingScore, bustPct, salaryValueScore }) {
  const reasons = [];
  if (ownership >= 24 && boomPct < 18) reasons.push("high ownership with weak boom rate");
  if (ownership >= 28 && ceilingScore < 62) reasons.push("ceiling does not justify chalk");
  if (ownership >= 20 && bustPct >= 34) reasons.push("elevated bust risk");
  if (ownership >= 22 && salaryValueScore < 48) reasons.push("weak salary value");

  return {
    warning: reasons.length > 0,
    reason: reasons.length ? reasons.join("; ") : null
  };
}

function gradeSingleEntry(input) {
  const { projectionScore, floor, projection, ceiling, ceilingScore, volatilityScore, ownership, salaryValueScore, fakeChalk, sport } = input;
  const floorRatio = projection > 0 ? floor / projection : 0;
  const sportAdjustedCeilingPath = ceilingScore >= 66 || ceiling >= (SPORT_CEILING_MARKS[sport] || 40);

  if (fakeChalk.warning || floorRatio < 0.42 || (volatilityScore >= 78 && projectionScore < 58)) return "Not For Single Entry";
  if (projectionScore >= 72 && floorRatio >= 0.68 && sportAdjustedCeilingPath) return "Single Entry Core";
  if (projectionScore >= 62 && salaryValueScore >= 58 && sportAdjustedCeilingPath) return "Single Entry Strong Play";
  if (ownership <= 14 && ceilingScore >= 70 && projectionScore >= 50) return "Single Entry Leverage";
  if (volatilityScore >= 65 || floorRatio < 0.55) return "Single Entry Risky";
  return "Single Entry Strong Play";
}

function recommendFieldSize({ upsideScore, leverageScore, volatilityScore, ownership, fakeChalk }) {
  if (fakeChalk.warning && leverageScore < 60) return "10,000-50,000";
  if (upsideScore >= 82 && leverageScore >= 78 && volatilityScore >= 58) return "50k+";
  if (leverageScore >= 72 && upsideScore >= 68) return "10,000-50,000";
  if (upsideScore >= 62 && leverageScore >= 56) return "2,000-10,000";
  if (ownership <= 16 && upsideScore >= 55) return "500-2,000";
  return "50-500";
}

function contestFit({ upsideScore, leverageScore, salaryValueScore, ownership, volatilityScore, fakeChalk, singleEntryGrade }) {
  if (singleEntryGrade === "Single Entry Core") return "Single Entry Core";
  if (singleEntryGrade === "Single Entry Leverage") return "Single Entry Leverage";
  if (fakeChalk.warning) return "Fade or Underweight Chalk";
  if (upsideScore >= 78 && leverageScore >= 72) return "Large-Field GPP Upside";
  if (upsideScore >= 66 && ownership <= 22) return "Small/Mid-Field GPP";
  if (salaryValueScore >= 70 && volatilityScore <= 58) return "Cash/Single Entry Value";
  return ownership >= 30 ? "Chalk With Merit" : "Tournament Viable";
}

function gradeField(upsideScore, leverageScore, volatilityScore, fakeChalk, fieldType) {
  const score = fieldType === "small"
    ? upsideScore * 0.45 + leverageScore * 0.25 + (100 - volatilityScore) * 0.2 + (fakeChalk.warning ? -12 : 8)
    : upsideScore * 0.45 + leverageScore * 0.4 + volatilityScore * 0.1 + (fakeChalk.warning ? -4 : 4);

  if (score >= 82) return "A";
  if (score >= 70) return "B";
  if (score >= 58) return "C";
  if (score >= 45) return "D";
  return "F";
}

export function rankForContest(players, contestType, contestSize) {
  const fieldBucket = getFieldSizeBucket(contestSize);
  return [...players].sort((a, b) => {
    if (contestType === "single_entry") return singleEntryRank(b) - singleEntryRank(a);
    if (contestType === "cash") return cashRank(b) - cashRank(a);
    if (contestType === "winner_take_all" || fieldBucket === "50k+") return largeFieldRank(b) - largeFieldRank(a);
    return balancedRank(b) - balancedRank(a);
  });
}

function singleEntryRank(player) {
  const gradeBonus = String(player.single_entry_grade || "").includes("Core") ? 18 : String(player.single_entry_grade || "").includes("Strong") ? 10 : 0;
  return safeNum(player.upside_score) * 0.35 + safeNum(player.salary_value_score) * 0.2 + safeNum(player.projection) * 0.8 + safeNum(player.floor) * 0.7 + gradeBonus - (player.fake_chalk_warning ? 18 : 0);
}

function cashRank(player) {
  return safeNum(player.projection) * 1.2 + safeNum(player.floor) + safeNum(player.salary_value_score) * 0.4 - safeNum(player.volatility_score) * 0.2;
}

function largeFieldRank(player) {
  return safeNum(player.upside_score) * 0.45 + safeNum(player.leverage_score) * 0.45 + safeNum(player.volatility_score) * 0.08;
}

function balancedRank(player) {
  return safeNum(player.upside_score) * 0.5 + safeNum(player.leverage_score) * 0.25 + safeNum(player.salary_value_score) * 0.25;
}
