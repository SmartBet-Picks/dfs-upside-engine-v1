const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));
const safeNum = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function applyOwnership(players, providerOwnershipRows = [], slateContext = {}) {
  const ownershipMap = buildOwnershipMap(providerOwnershipRows);
  const estimated = estimateOwnership(players, slateContext);

  return players.map((player, index) => {
    const key = player.player_id || player.player_name;
    const providerOwnership = ownershipMap.get(String(key).toLowerCase());
    if (Number.isFinite(providerOwnership)) {
      return { ...player, ownership: clamp(providerOwnership), ownership_source: "provider" };
    }

    if (Number.isFinite(Number(player.ownership)) && Number(player.ownership) > 0) {
      return { ...player, ownership: clamp(player.ownership), ownership_source: player.ownership_source || "provider" };
    }

    return { ...player, ownership: estimated[index], estimated_ownership: estimated[index], ownership_source: "estimated" };
  });
}

export function estimateOwnership(players, slateContext = {}) {
  const salaryRanks = rankBy(players, (p) => safeNum(p.salary), "desc");
  const projectionRanks = rankBy(players, (p) => safeNum(p.projection), "desc");
  const valueRanks = rankBy(players, (p) => safeNum(p.projection) / Math.max(safeNum(p.salary) / 1000, 1), "desc");
  const positionCounts = players.reduce((acc, player) => {
    const position = player.position || "UNK";
    acc[position] = (acc[position] || 0) + 1;
    return acc;
  }, {});
  const slateSize = Math.max(players.length, 1);
  const slateType = String(slateContext.slate_type || slateContext.slateType || "").toLowerCase();
  const sport = String(slateContext.sport || "").toLowerCase();

  return players.map((player, index) => {
    const salaryScore = rankScore(salaryRanks.get(index), slateSize);
    const projectionScore = rankScore(projectionRanks.get(index), slateSize);
    const valueScore = rankScore(valueRanks.get(index), slateSize);
    const scarcityScore = 100 / Math.max(positionCounts[player.position || "UNK"] || slateSize, 1);
    const nameProxy = popularityProxy(player.player_name);
    const roleBoost = roleProxy(player);
    const recentScore = recentPerformanceProxy(player);
    const injuryNewsBoost = injuryNewsRoleBoost(player);
    const slateSizeDiscount = slateSize >= 120 ? 0.72 : slateSize >= 70 ? 0.82 : slateSize >= 35 ? 0.92 : 1;
    const composite = (
      salaryScore * 0.18 +
      projectionScore * 0.28 +
      valueScore * 0.20 +
      recentScore * 0.10 +
      scarcityScore * 0.08 +
      nameProxy * 0.06 +
      roleBoost * 0.06 +
      injuryNewsBoost * 0.04
    ) * slateSizeDiscount;
    const baseline = slateType === "showdown" ? 4 : 2;
    const multiplier = slateType === "showdown" ? 0.42 : 0.3;
    const sportCap = sport === "nba" && slateType === "showdown" ? 48 : slateType === "showdown" ? 52 : 38;
    const estimated = baseline + composite * multiplier;

    return Number(clamp(estimated, 1, sportCap).toFixed(2));
  });
}

function buildOwnershipMap(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const playerId = row.PlayerID || row.PlayerId || row.player_id || row.id;
    const name = row.Name || row.PlayerName || row.player_name;
    const ownership = row.Ownership || row.ProjectedOwnership || row.ownership || row.OwnershipPercentage;
    if (playerId) map.set(String(playerId).toLowerCase(), safeNum(ownership));
    if (name) map.set(String(name).toLowerCase(), safeNum(ownership));
  }
  return map;
}

function rankBy(items, selector, direction = "desc") {
  const ranked = items
    .map((item, index) => ({ index, value: selector(item) }))
    .sort((a, b) => direction === "desc" ? b.value - a.value : a.value - b.value);

  const result = new Map();
  ranked.forEach((item, rank) => result.set(item.index, rank + 1));
  return result;
}

function rankScore(rank, total) {
  return clamp(((total - rank + 1) / total) * 100);
}

function popularityProxy(name = "") {
  const cleaned = String(name).toLowerCase();
  const knownSignal = ["jr", "iii", "patrick", "mahomes", "jokic", "judge", "mcgregor", "scheffler", "larson"];
  return knownSignal.some((token) => cleaned.includes(token)) ? 70 : 38;
}

function roleProxy(player) {
  const raw = JSON.stringify(player.raw || {}).toLowerCase();
  let score = 0;
  if (raw.includes("starter") || raw.includes("starting")) score += 35;
  if (raw.includes("questionable") || raw.includes("limited")) score -= 20;
  if (raw.includes("injury") && raw.includes("out")) score -= 40;
  if (raw.includes("lineup") || raw.includes("usage") || raw.includes("minutes")) score += 15;
  return clamp(score + 35);
}

function recentPerformanceProxy(player) {
  const raw = player.raw || {};
  const model = raw.model || raw.projection?.model_inputs || {};
  const recent = model.recent || raw.recent || {};
  const projection = safeNum(player.projection);
  const recentAverage = safeNum(recent.average || raw.recentAverage || raw.last5Average, projection);
  const trend = safeNum(recent.trend || raw.trend, 0);
  if (!projection) return 40;
  return clamp((recentAverage / Math.max(projection, 1)) * 55 + trend * 3 + 35);
}

function injuryNewsRoleBoost(player) {
  const raw = JSON.stringify(player.raw || {}).toLowerCase();
  let score = 35;
  if (raw.includes("out") && (raw.includes("teammate") || raw.includes("role") || raw.includes("usage"))) score += 30;
  if (raw.includes("starting") || raw.includes("promoted") || raw.includes("expected minutes")) score += 20;
  if (raw.includes("questionable") || raw.includes("limited") || raw.includes("minutes limit")) score -= 22;
  if (raw.includes("doubtful") || raw.includes("\"out\"")) score -= 38;
  return clamp(score);
}
