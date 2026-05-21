const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));
const safeNum = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function calculateShowdownScores(players, slateContext = {}) {
  return players.map((player) => {
    const projection = safeNum(player.projection);
    const ceiling = safeNum(player.ceiling, projection * 1.8);
    const floor = safeNum(player.floor, projection * 0.55);
    const ownership = clamp(player.ownership);
    const upside = safeNum(player.upside_score);
    const leverage = safeNum(player.leverage_score);
    const roleStability = clamp((floor / Math.max(projection, 1)) * 100);
    const rawCeilingScore = normalizeWithinSlate(ceiling, players, "ceiling");
    const salaryRelief = clamp(100 - normalizeWithinSlate(safeNum(player.salary), players, "salary"));

    const captainScore = clamp(
      rawCeilingScore * 0.36 +
      upside * 0.24 +
      leverage * 0.18 +
      roleStability * 0.12 +
      salaryRelief * 0.05 +
      gameScriptScore(player, slateContext) * 0.05 -
      Math.max(0, ownership - 35) * 0.35
    );

    const flexScore = clamp(
      projection * 1.4 +
      roleStability * 0.22 +
      safeNum(player.salary_value_score) * 0.24 +
      upside * 0.18 +
      (100 - ownership) * 0.06
    );

    return {
      ...player,
      showdown_captain_score: Number(captainScore.toFixed(2)),
      showdown_flex_score: Number(flexScore.toFixed(2)),
      captain_ownership_risk: captainOwnershipRisk(ownership, captainScore, leverage),
      duplication_risk: duplicationRisk(player, slateContext),
      game_script_fit: gameScriptFit(player, slateContext),
      contest_fit_tag: showdownTag(player, captainScore, flexScore, ownership, leverage)
    };
  });
}

function normalizeWithinSlate(value, players, key) {
  const values = players.map((player) => safeNum(player[key])).filter((item) => item >= 0);
  const max = Math.max(...values, 1);
  return clamp((safeNum(value) / max) * 100);
}

function captainOwnershipRisk(ownership, captainScore, leverage) {
  if (ownership >= 38 && captainScore < 72) return "High - Too Chalky Captain";
  if (ownership >= 28 && leverage < 55) return "Medium - Popular Captain";
  if (ownership <= 12 && captainScore >= 62) return "Low - Leverage Captain";
  return "Normal";
}

function duplicationRisk(player, slateContext) {
  const ownership = clamp(player.ownership);
  const salary = safeNum(player.salary);
  const salaryCap = safeNum(slateContext.salaryCap, 50000);
  if (ownership >= 32 && salary >= salaryCap * 0.16) return "High";
  if (ownership >= 22 || salary >= salaryCap * 0.18) return "Medium";
  return "Low";
}

function gameScriptScore(player) {
  const raw = JSON.stringify(player.raw || {}).toLowerCase();
  let score = 50;
  if (raw.includes("target") || raw.includes("usage") || raw.includes("minutes") || raw.includes("laps led")) score += 18;
  if (raw.includes("blowout") || raw.includes("limited") || raw.includes("injury")) score -= 16;
  if (raw.includes("pace") || raw.includes("shootout") || raw.includes("stack")) score += 10;
  return clamp(score);
}

function gameScriptFit(player) {
  const position = String(player.position || "").toUpperCase();
  const sport = String(player.sport || "").toLowerCase();
  if (sport === "nfl" && ["QB", "WR", "TE"].includes(position)) return "Pass-heavy or comeback script";
  if (sport === "nfl" && position === "RB") return "Lead or red-zone script";
  if (sport === "nba") return "Close-game minutes and usage script";
  if (sport === "mlb" && position === "P") return "Strikeout/workload script";
  if (sport === "mlb") return "Stack-friendly run environment";
  if (sport === "mma") return "Finish or high-volume decision script";
  if (sport === "golf") return "Birdie streak and weekend scoring script";
  if (sport === "nascar") return "Dominator or place-differential script";
  return "Neutral script";
}

function showdownTag(player, captainScore, flexScore, ownership, leverage) {
  const singleEntry = String(player.single_entry_grade || "").includes("Core") || String(player.single_entry_grade || "").includes("Strong");
  if (ownership >= 35 && captainScore < 72) return "Too Chalky Captain";
  if (singleEntry && captainScore >= 76) return "Single Entry Captain";
  if (captainScore >= 82) return "Captain Core";
  if (captainScore >= 68 && leverage >= 65) return "Captain Leverage";
  if (captainScore >= 58 && ownership <= 10) return "Large-Field Captain Dart";
  if (singleEntry && flexScore >= 72 && ownership <= 32) return "Single Entry Flex";
  if (flexScore >= 82) return "Flex Core";
  if (flexScore >= 64 && safeNum(player.salary_value_score) >= 80 && ownership <= 30) return "Flex Value";
  if (leverage >= 74 && ownership <= 24) return "Tournament Leverage";
  if (safeNum(player.salary) <= 2500 && safeNum(player.projection) >= 12) return "Salary Relief";
  if (flexScore >= 56 && safeNum(player.volatility_score) <= 55) return "Small-Field Flex Safe";
  if (ownership >= 32) return "Popular Flex";
  return "Showdown Pool";
}
