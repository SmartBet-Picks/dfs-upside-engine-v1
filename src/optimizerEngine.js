const round = (value, places = 2) => Number((Number(value) || 0).toFixed(places));
const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, safeNum(value, min)));
const safeNum = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

const CLASSIC_RULES = {
  nba: ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL"],
  nfl: ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST"],
  mlb: ["P", "P", "C", "1B", "2B", "3B", "SS", "OF", "OF", "OF"],
  mma: ["F", "F", "F", "F", "F", "F"],
  golf: ["G", "G", "G", "G", "G", "G"],
  nascar: ["D", "D", "D", "D", "D", "D"]
};

export function optimizeLineups(players, options = {}) {
  const slateType = String(options.slate_type || options.slateType || "classic").toLowerCase();
  const sport = String(options.sport || "nba").toLowerCase();
  const lineupCount = clampInt(options.lineup_count || options.lineupCount || 20, 1, 150);
  const salaryCap = safeNum(options.salary_cap || options.salaryCap, 50000);
  const objective = String(options.objective || "balanced").toLowerCase();
  const simCount = clampInt(options.simulations || options.sims || 300, 0, 5000);
  const minUniquePlayers = clampInt(options.min_unique_players || options.minUniquePlayers || 3, 0, 6);
  const minProjectedMinutes = sport === "nba"
    ? safeNum(options.min_projected_minutes || options.minProjectedMinutes, 15)
    : safeNum(options.min_projected_minutes || options.minProjectedMinutes, 0);
  const candidates = prepareCandidates(players, options);

  const lineups = slateType === "showdown"
    ? optimizeShowdown(candidates, { lineupCount, salaryCap, objective, minUniquePlayers, minProjectedMinutes })
    : optimizeClassic(candidates, { sport, lineupCount, salaryCap, objective, minUniquePlayers, minProjectedMinutes });

  return attachSimulations(lineups, simCount).map((lineup) => enrichLineupAnalytics(lineup, salaryCap));
}

export function buildEntryPortfolio(lineups = [], options = {}) {
  const contestMaxEntries = clampInt(options.contest_max_entries ?? options.contestMaxEntries ?? options.lineup_count ?? options.lineupCount ?? lineups.length, 1, 150);
  const entriesPlayed = clampInt(options.entries_played ?? options.entriesPlayed ?? contestMaxEntries, 1, Math.max(1, lineups.length || 1));
  const fieldSize = clampInt(options.field_size ?? options.fieldSize ?? 5000, 2, 500000);
  const profile = resolveEntryProfile(entriesPlayed, fieldSize);
  const constraints = resolvePortfolioConstraints(options, entriesPlayed, profile);
  const ranked = [...lineups].sort((a, b) => entryAwareScore(b, profile) - entryAwareScore(a, profile));
  const { selected, constraintNotes } = selectPortfolioLineups(ranked, entriesPlayed, constraints);
  const selectedIds = new Set(selected.map((lineup) => lineup.lineup_id));
  const recommended = selected.map((lineup, index) => ({ ...lineup, submit_rank: index + 1, entry_aware_score: round(entryAwareScore(lineup, profile)) }));
  const alternates = ranked
    .filter((lineup) => !selectedIds.has(lineup.lineup_id))
    .map((lineup) => ({ ...lineup, entry_aware_score: round(entryAwareScore(lineup, profile)) }));

  return {
    entries_played: entriesPlayed,
    contest_max_entries: contestMaxEntries,
    field_size: fieldSize,
    entry_profile: profile.name,
    portfolio_constraints: constraints.public,
    constraint_notes: constraintNotes,
    exposure_report: buildExposureReport(recommended),
    recommended,
    alternates
  };
}

export function lineupsToCsv(lineups = []) {
  const headers = [
    "rank",
    "lineup_id",
    "salary",
    "projection",
    "ceiling",
    "ownership",
    "upside",
    "leverage",
    "strategy_score",
    "fake_chalk_count",
    "single_entry_count",
    "sim_avg",
    "sim_p90",
    "sim_top_rate",
    "players",
    "archetype",
    "duplication_risk",
    "ceiling_rating",
    "leverage_rating",
    "stability_rating",
    "volatility_rating",
    "correlation_rating",
    "salary_left",
    "stack_type"
  ];

  const rows = lineups.map((lineup, index) => ({
    rank: index + 1,
    lineup_id: lineup.lineup_id,
    salary: lineup.salary,
    projection: lineup.projection,
    ceiling: lineup.ceiling,
    ownership: lineup.ownership,
    upside: lineup.upside,
    leverage: lineup.leverage,
    strategy_score: lineup.strategy_score,
    fake_chalk_count: lineup.fake_chalk_count,
    single_entry_count: lineup.single_entry_count,
    sim_avg: lineup.simulation?.average || "",
    sim_p90: lineup.simulation?.p90 || "",
    sim_top_rate: lineup.simulation?.top_rate || "",
    players: lineup.players.map((player) => `${player.slot}:${player.player_name}`).join(" | "),
    archetype: lineup.archetype,
    duplication_risk: lineup.duplication_risk,
    ceiling_rating: lineup.ceiling_rating,
    leverage_rating: lineup.leverage_rating,
    stability_rating: lineup.stability_rating,
    volatility_rating: lineup.volatility_rating,
    correlation_rating: lineup.correlation_rating,
    salary_left: lineup.salary_left,
    stack_type: lineup.stack_type
  }));

  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))
  ].join("\n");
}

function prepareCandidates(players, options) {
  const locks = normalizeNameSet(options.locks);
  const excludes = normalizeNameSet(options.excludes);
  const maxPlayerOwnership = safeNum(options.max_player_ownership || options.maxPlayerOwnership, 100);
  const sport = String(options.sport || "").toLowerCase();
  const minProjectedMinutes = sport === "nba"
    ? safeNum(options.min_projected_minutes || options.minProjectedMinutes, 15)
    : safeNum(options.min_projected_minutes || options.minProjectedMinutes, 0);
  const minProjection = sport === "nba"
    ? safeNum(options.min_projection || options.minProjection, 10)
    : safeNum(options.min_projection || options.minProjection, 3);
  const slateType = String(options.slate_type || options.slateType || "").toLowerCase();
  const defaultPoolLimit = slateType === "showdown" ? 42 : 70;
  const poolLimit = clampInt(options.pool_limit || options.poolLimit || defaultPoolLimit, 10, 150);

  return players
    .filter((player) => !excludes.has(normalizeName(player.player_name)))
    .filter((player) => safeNum(player.salary) > 0 && safeNum(player.projection) > 0)
    .filter((player) => safeNum(player.projection) >= minProjection)
    .filter((player) => sport !== "nba" || safeNum(player.projected_minutes) >= minProjectedMinutes)
    .filter((player) => locks.has(normalizeName(player.player_name)) || safeNum(player.ownership) <= maxPlayerOwnership)
    .map((player) => ({
      ...player,
      _name: normalizeName(player.player_name),
      _salary: safeNum(player.salary),
      _minutes: safeNum(player.projected_minutes),
      _projection: safeNum(player.projection),
      _floor: safeNum(player.floor),
      _ceiling: safeNum(player.ceiling, safeNum(player.projection) * 1.6),
      _ownership: safeNum(player.ownership),
      _upside: safeNum(player.upside_score),
      _leverage: safeNum(player.leverage_score),
      _boom: safeNum(player.boom_pct),
      _bust: safeNum(player.bust_pct),
      _fakeChalk: Boolean(player.fake_chalk_warning),
      _singleEntryGrade: String(player.single_entry_grade || ""),
      _contestFitTag: String(player.contest_fit_tag || ""),
      _captainScore: safeNum(player.showdown_captain_score),
      _flexScore: safeNum(player.showdown_flex_score),
      _captainTier: player.captain_tier || deriveCaptainTier(player.showdown_captain_score),
      _captainRisk: String(player.captain_ownership_risk || ""),
      _duplicationRisk: String(player.duplication_risk || "")
    }))
    .sort((a, b) => playerObjective(b, String(options.objective || "balanced").toLowerCase(), null) - playerObjective(a, String(options.objective || "balanced").toLowerCase(), null))
    .slice(0, poolLimit);
}

function optimizeShowdown(players, options) {
  const top = new TopLineups(options.lineupCount, options.minUniquePlayers);
  const captainPool = [...players].sort((a, b) => playerObjective(b, options.objective, "CPT") - playerObjective(a, options.objective, "CPT")).slice(0, Math.min(players.length, 24));
  const flexPool = [...players].sort((a, b) => playerObjective(b, options.objective, "FLEX") - playerObjective(a, options.objective, "FLEX")).slice(0, Math.min(players.length, 38));

  for (const captain of captainPool) {
    const flexCandidates = flexPool.filter((player) => player._name !== captain._name);
    forEachCombination(flexCandidates, 5, (flexPlayers) => {
      const salary = captain._salary * 1.5 + sum(flexPlayers, "_salary");
      if (salary > options.salaryCap) return;

      const lineupPlayers = [
        lineupPlayer(captain, "CPT", 1.5, 1.5),
        ...flexPlayers.map((player, index) => lineupPlayer(player, `FLEX${index + 1}`, 1, 1))
      ];
      top.add(scoreLineup(lineupPlayers, salary, options.objective));
    });
  }

  return top.values();
}

function optimizeClassic(players, options) {
  const top = new TopLineups(options.lineupCount, options.minUniquePlayers);
  const roster = CLASSIC_RULES[options.sport] || CLASSIC_RULES.nba;
  const sorted = players.slice(0, Math.min(players.length, 80));
  const attempts = Math.max(options.lineupCount * 300, 3000);

  for (let attempt = 0; attempt < attempts; attempt++) {
    const used = new Set();
    const lineup = [];
    let salary = 0;

    for (const slot of roster) {
      const candidate = pickClassicCandidate(sorted, slot, used, options.objective, attempt);
      if (!candidate) break;
      used.add(candidate._name);
      salary += candidate._salary;
      lineup.push(lineupPlayer(candidate, slot, 1, 1));
    }

    if (lineup.length !== roster.length || salary > options.salaryCap) continue;
    top.add(scoreLineup(lineup, salary, options.objective));
  }

  return top.values();
}

function pickClassicCandidate(players, slot, used, objective, attempt) {
  const eligible = players
    .filter((player) => !used.has(player._name))
    .filter((player) => isEligible(player, slot))
    .sort((a, b) => playerObjective(b, objective, slot) - playerObjective(a, objective, slot));

  if (!eligible.length) return null;
  const jitter = attempt % 7;
  return eligible[Math.min(jitter, eligible.length - 1)];
}

function isEligible(player, slot) {
  const tokens = String(player.position || player.roster_slot || "")
    .toUpperCase()
    .split(/[\/,\s]+/)
    .filter(Boolean);

  if (slot === "UTIL" || slot === "FLEX") return true;
  if (slot === "G") return tokens.some((token) => ["PG", "SG", "G"].includes(token));
  if (slot === "F") return tokens.some((token) => ["SF", "PF", "F"].includes(token));
  if (slot === "DST") return tokens.some((token) => ["DST", "DEF"].includes(token));
  return tokens.includes(slot);
}

function lineupPlayer(player, slot, projectionMultiplier, salaryMultiplier) {
  return {
    slot,
    player_id: player.player_id,
    player_name: player.player_name,
    team: player.team,
    opponent: player.opponent,
    position: player.position,
    salary: round(player._salary * salaryMultiplier),
    projected_minutes: round(player._minutes),
    projection: round(player._projection * projectionMultiplier),
    floor: round(player._floor * projectionMultiplier),
    ceiling: round(player._ceiling * projectionMultiplier),
    ownership: round(player._ownership),
    upside_score: round(player._upside),
    leverage_score: round(player._leverage),
    boom_pct: round(player._boom),
    bust_pct: round(player._bust),
    fake_chalk_warning: player._fakeChalk,
    single_entry_grade: player._singleEntryGrade,
    contest_fit_tag: player._contestFitTag,
    captain_tier: player._captainTier,
    captain_ownership_risk: player._captainRisk,
    duplication_risk: player._duplicationRisk,
    strategy_score: round(playerStrategyScore(player, slot))
  };
}

function scoreLineup(players, salary, objective) {
  const projection = sum(players, "projection");
  const ceiling = sum(players, "ceiling");
  const floor = sum(players, "floor");
  const ownership = sum(players, "ownership");
  const upside = avg(players, "upside_score");
  const leverage = avg(players, "leverage_score");
  const volatility = ceiling - floor;
  const strategy = avg(players, "strategy_score");
  const fakeChalkCount = players.filter((player) => player.fake_chalk_warning).length;
  const singleEntryCount = players.filter((player) => String(player.single_entry_grade || "").includes("Core") || String(player.single_entry_grade || "").includes("Strong")).length;
  const score = lineupObjective({ projection, ceiling, ownership, upside, leverage, volatility, strategy, fakeChalkCount, singleEntryCount }, objective);

  return {
    lineup_id: lineupId(players),
    salary: round(salary),
    projection: round(projection),
    floor: round(floor),
    ceiling: round(ceiling),
    ownership: round(ownership),
    upside: round(upside),
    leverage: round(leverage),
    volatility: round(volatility),
    strategy_score: round(strategy),
    fake_chalk_count: fakeChalkCount,
    single_entry_count: singleEntryCount,
    objective_score: round(score),
    players
  };
}

function attachSimulations(lineups, simCount) {
  if (!simCount) return lineups.map((lineup, index) => ({ ...lineup, rank: index + 1 }));

  const simulated = lineups.map((lineup) => {
    const outcomes = [];
    for (let i = 0; i < simCount; i++) {
      outcomes.push(round(sum(lineup.players.map((player) => ({ outcome: simulatePlayer(player, i) })), "outcome")));
    }
    outcomes.sort((a, b) => a - b);
    return {
      ...lineup,
      simulation: {
        average: round(outcomes.reduce((total, value) => total + value, 0) / outcomes.length),
        p10: percentile(outcomes, 0.1),
        p50: percentile(outcomes, 0.5),
        p90: percentile(outcomes, 0.9),
        top_rate: 0
      }
    };
  });

  for (let i = 0; i < simCount; i++) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    simulated.forEach((lineup, index) => {
      const score = sum(lineup.players.map((player) => ({ outcome: simulatePlayer(player, i + 10000) })), "outcome");
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    simulated[bestIndex].simulation.top_rate += 1;
  }

  return simulated
    .map((lineup) => ({
      ...lineup,
      simulation: {
        ...lineup.simulation,
        top_rate: round((lineup.simulation.top_rate / simCount) * 100)
      }
    }))
    .sort((a, b) => b.objective_score - a.objective_score)
    .map((lineup, index) => ({ ...lineup, rank: index + 1 }));
}

function simulatePlayer(player, seed) {
  const rand = seededRandom(`${player.player_id}:${player.slot}:${seed}`);
  const boom = safeNum(player.boom_pct) / 100;
  const bust = safeNum(player.bust_pct) / 100;

  if (rand < bust) return interpolate(player.floor, player.projection, rand / Math.max(bust, 0.01));
  if (rand > 1 - boom) return interpolate(player.projection, player.ceiling, (rand - (1 - boom)) / Math.max(boom, 0.01));
  return interpolate(player.floor, player.ceiling, rand);
}

function deriveCaptainTier(captainScore) {
  const score = safeNum(captainScore);
  if (score >= 75) return "Elite Captain";
  if (score >= 58) return "Strong Captain";
  if (score >= 48) return "Viable Captain";
  if (score >= 35) return "Thin Captain";
  return "Avoid Captain";
}

function playerObjective(player, objective, slot) {
  const strategy = playerStrategyScore(player, slot);
  if (objective === "projection") return player._projection;
  if (objective === "ceiling") return player._ceiling + strategy * 0.15;
  if (objective === "leverage") return player._leverage * 0.58 + player._upside * 0.24 + strategy * 0.18;
  if (objective === "ownership" || objective === "contrarian") return (100 - player._ownership) * 0.55 + player._leverage * 0.25 + strategy * 0.2;
  if (objective === "single_entry") return player._projection * 0.35 + player._floor * 0.25 + strategy * 0.4;
  if (objective === "contest_fit") return player._projection * 0.25 + player._upside * 0.2 + player._leverage * 0.2 + strategy * 0.35;
  if (objective === "showdown") return (slot === "CPT" ? player._captainScore : player._flexScore) * 0.45 + player._projection * 0.25 + strategy * 0.3;
  return player._projection * 0.34 + player._ceiling * 0.16 + player._upside * 0.18 + player._leverage * 0.14 + strategy * 0.18;
}

function lineupObjective(lineup, objective) {
  if (objective === "projection") return lineup.projection;
  if (objective === "ceiling") return lineup.ceiling * 0.76 + lineup.strategy * 0.24;
  if (objective === "leverage") return lineup.projection * 0.32 + lineup.ceiling * 0.15 + lineup.leverage * 0.32 + lineup.strategy * 0.17 - lineup.ownership * 0.06 - lineup.fakeChalkCount * 4;
  if (objective === "contrarian") return lineup.projection * 0.36 + lineup.leverage * 0.32 + lineup.strategy * 0.24 - lineup.ownership * 0.14 - lineup.fakeChalkCount * 5;
  if (objective === "single_entry") return lineup.projection * 0.36 + lineup.floor * 0.18 + lineup.strategy * 0.34 + lineup.singleEntryCount * 4 - lineup.fakeChalkCount * 8;
  if (objective === "contest_fit") return lineup.projection * 0.3 + lineup.upside * 0.18 + lineup.leverage * 0.18 + lineup.strategy * 0.34 - lineup.fakeChalkCount * 5;
  if (objective === "showdown") return lineup.projection * 0.34 + lineup.ceiling * 0.18 + lineup.strategy * 0.34 + lineup.leverage * 0.14 - lineup.fakeChalkCount * 5;
  return lineup.projection * 0.34 + lineup.ceiling * 0.18 + lineup.upside * 0.15 + lineup.leverage * 0.13 + lineup.strategy * 0.2 - lineup.ownership * 0.04 - lineup.fakeChalkCount * 3;
}

function resolveEntryProfile(entriesPlayed, fieldSize) {
  if (entriesPlayed <= 3) return { name: "tight", volatilityWeight: -0.16, ownershipWeight: -0.08, leverageWeight: 0.12, projectionWeight: 0.42 };
  if (entriesPlayed <= 20) return { name: "balanced", volatilityWeight: -0.04, ownershipWeight: -0.03, leverageWeight: 0.16, projectionWeight: 0.34 };
  if (fieldSize >= 20000) return { name: "max_upside", volatilityWeight: 0.06, ownershipWeight: -0.01, leverageWeight: 0.25, projectionWeight: 0.26 };
  return { name: "portfolio", volatilityWeight: 0.03, ownershipWeight: -0.02, leverageWeight: 0.2, projectionWeight: 0.3 };
}

function resolvePortfolioConstraints(options, entriesPlayed, profile) {
  const maxPlayerExposurePct = clampPct(
    options.max_player_exposure_pct ?? options.maxPlayerExposurePct,
    defaultMaxPlayerExposurePct(entriesPlayed, profile)
  );
  const maxCaptainExposurePct = clampPct(
    options.max_captain_exposure_pct ?? options.maxCaptainExposurePct,
    entriesPlayed <= 3 ? 100 : 45
  );
  const minUniquePlayers = clampInt(
    options.portfolio_min_unique_players ?? options.portfolioMinUniquePlayers,
    entriesPlayed <= 3 ? 0 : 2,
    8
  );
  const lockedPlayers = normalizeNameSet(options.locks);

  return {
    maxPlayerAppearances: pctToAppearances(maxPlayerExposurePct, entriesPlayed),
    maxCaptainAppearances: pctToAppearances(maxCaptainExposurePct, entriesPlayed),
    minUniquePlayers,
    lockedPlayers,
    public: {
      max_player_exposure_pct: maxPlayerExposurePct,
      max_player_appearances: pctToAppearances(maxPlayerExposurePct, entriesPlayed),
      max_captain_exposure_pct: maxCaptainExposurePct,
      max_captain_appearances: pctToAppearances(maxCaptainExposurePct, entriesPlayed),
      min_unique_players: minUniquePlayers,
      locked_players: [...lockedPlayers]
    }
  };
}

function defaultMaxPlayerExposurePct(entriesPlayed, profile) {
  if (entriesPlayed <= 3) return 100;
  if (profile.name === "tight") return 85;
  if (profile.name === "balanced") return 70;
  if (profile.name === "max_upside") return 45;
  return 55;
}

function clampPct(value, fallback) {
  const number = safeNum(value, fallback);
  return Math.max(1, Math.min(100, round(number, 1)));
}

function pctToAppearances(pct, entriesPlayed) {
  return Math.max(1, Math.ceil(entriesPlayed * (pct / 100)));
}

function selectPortfolioLineups(ranked, entriesPlayed, constraints) {
  const selected = [];
  const exposure = new Map();
  const captainExposure = new Map();
  const constraintNotes = [];

  for (const lineup of ranked) {
    if (selected.length >= entriesPlayed) break;
    if (!lineupFitsPortfolio(lineup, selected, exposure, captainExposure, constraints)) continue;
    addPortfolioLineup(lineup, selected, exposure, captainExposure);
  }

  if (selected.length < entriesPlayed) {
    constraintNotes.push(`Exposure/uniqueness guardrails produced ${selected.length} of ${entriesPlayed} requested entries; filling remaining slots by entry-aware rank.`);
    for (const lineup of ranked) {
      if (selected.length >= entriesPlayed) break;
      if (selected.some((selectedLineup) => selectedLineup.lineup_id === lineup.lineup_id)) continue;
      addPortfolioLineup(lineup, selected, exposure, captainExposure);
    }
  }

  return { selected, constraintNotes };
}

function lineupFitsPortfolio(lineup, selected, exposure, captainExposure, constraints) {
  if (constraints.minUniquePlayers && selected.some((selectedLineup) => uniquePlayerDifference(lineup, selectedLineup) < constraints.minUniquePlayers)) return false;

  for (const player of lineup.players || []) {
    const name = normalizeName(player.player_name);
    if (constraints.lockedPlayers.has(name)) continue;
    if ((exposure.get(name) || 0) + 1 > constraints.maxPlayerAppearances) return false;
  }

  const captain = (lineup.players || []).find((player) => player.slot === "CPT");
  if (captain) {
    const captainName = normalizeName(captain.player_name);
    if (!constraints.lockedPlayers.has(captainName) && (captainExposure.get(captainName) || 0) + 1 > constraints.maxCaptainAppearances) return false;
  }

  return true;
}

function addPortfolioLineup(lineup, selected, exposure, captainExposure) {
  selected.push(lineup);
  for (const player of lineup.players || []) {
    const name = normalizeName(player.player_name);
    exposure.set(name, (exposure.get(name) || 0) + 1);
    if (player.slot === "CPT") captainExposure.set(name, (captainExposure.get(name) || 0) + 1);
  }
}

function buildExposureReport(lineups = []) {
  const total = Math.max(1, lineups.length);
  const playerMap = new Map();
  const archetypeCounts = new Map();

  for (const lineup of lineups) {
    archetypeCounts.set(lineup.archetype || "Unclassified", (archetypeCounts.get(lineup.archetype || "Unclassified") || 0) + 1);
    for (const player of lineup.players || []) {
      const key = normalizeName(player.player_name);
      const current = playerMap.get(key) || { player_name: player.player_name, team: player.team, positions: new Set(), count: 0, captain_count: 0, total_salary: 0, total_ownership: 0 };
      current.positions.add(player.position || player.slot || "UTIL");
      current.count += 1;
      current.captain_count += player.slot === "CPT" ? 1 : 0;
      current.total_salary += safeNum(player.salary);
      current.total_ownership += safeNum(player.ownership);
      playerMap.set(key, current);
    }
  }

  const playerExposure = [...playerMap.values()]
    .map((player) => ({
      player_name: player.player_name,
      team: player.team,
      positions: [...player.positions].join("/"),
      lineups: player.count,
      exposure_pct: round((player.count / total) * 100, 1),
      captain_lineups: player.captain_count,
      captain_exposure_pct: round((player.captain_count / total) * 100, 1),
      avg_salary: round(player.total_salary / player.count),
      avg_ownership: round(player.total_ownership / player.count)
    }))
    .sort((a, b) => b.exposure_pct - a.exposure_pct || b.captain_exposure_pct - a.captain_exposure_pct || a.player_name.localeCompare(b.player_name));

  return {
    lineup_count: lineups.length,
    unique_players: playerExposure.length,
    average_projection: round(avg(lineups, "projection")),
    average_ceiling: round(avg(lineups, "ceiling")),
    average_ownership: round(avg(lineups, "ownership")),
    max_player_exposure_pct: playerExposure[0]?.exposure_pct || 0,
    max_captain_exposure_pct: Math.max(0, ...playerExposure.map((player) => player.captain_exposure_pct)),
    archetypes: [...archetypeCounts.entries()].map(([archetype, count]) => ({ archetype, count, pct: round((count / total) * 100, 1) })),
    players: playerExposure
  };
}

function entryAwareScore(lineup, profile) {
  return safeNum(lineup.objective_score) * 0.52
    + safeNum(lineup.projection) * profile.projectionWeight
    + safeNum(lineup.leverage) * profile.leverageWeight
    + safeNum(lineup.ownership) * profile.ownershipWeight
    + safeNum(lineup.volatility) * profile.volatilityWeight
    - safeNum(lineup.fake_chalk_count) * 2.2;
}

function playerStrategyScore(player, slot) {
  let score = 50;
  const grade = player._singleEntryGrade.toLowerCase();
  const tag = player._contestFitTag.toLowerCase();
  const captainRisk = player._captainRisk.toLowerCase();
  const duplicationRisk = player._duplicationRisk.toLowerCase();
  const slotText = String(slot || "").toUpperCase();

  if (grade.includes("core")) score += 18;
  else if (grade.includes("strong")) score += 12;
  else if (grade.includes("leverage")) score += 10;
  else if (grade.includes("risky")) score -= 8;
  else if (grade.includes("not")) score -= 22;

  if (player._fakeChalk) score -= 18;
  if (tag.includes("single entry")) score += 12;
  if (tag.includes("captain leverage")) score += slotText === "CPT" ? 18 : 7;
  if (tag.includes("captain core")) score += slotText === "CPT" ? 16 : 4;
  if (tag.includes("too chalky captain")) score += slotText === "CPT" ? -24 : -4;
  if (tag.includes("flex core")) score += slotText.startsWith("FLEX") || slotText === "FLEX" ? 14 : 5;
  if (tag.includes("flex value")) score += slotText.startsWith("FLEX") || slotText === "FLEX" ? 12 : 3;
  if (tag.includes("salary relief")) score += 8;
  if (tag.includes("leverage")) score += 8;
  if (tag.includes("fade")) score -= 20;
  if (tag.includes("large-field")) score += 5;
  if (tag.includes("cash")) score += 5;

  if (slotText === "CPT") score += player._captainScore * 0.32;
  if (slotText.startsWith("FLEX") || slotText === "FLEX") score += player._flexScore * 0.24;
  if (captainRisk.includes("high") && slotText === "CPT") score -= 15;
  if (duplicationRisk.includes("high")) score -= 8;
  else if (duplicationRisk.includes("medium")) score -= 3;

  return Math.max(0, Math.min(100, score));
}

function forEachCombination(items, size, callback, start = 0, combo = []) {
  if (combo.length === size) {
    callback(combo);
    return;
  }

  for (let i = start; i <= items.length - (size - combo.length); i++) {
    combo.push(items[i]);
    forEachCombination(items, size, callback, i + 1, combo);
    combo.pop();
  }
}

class TopLineups {
  constructor(limit, minUniquePlayers = 0) {
    this.limit = limit;
    this.minUniquePlayers = minUniquePlayers;
    this.items = [];
    this.keys = new Set();
  }

  add(lineup) {
    if (this.keys.has(lineup.lineup_id)) return;
    if (!this.hasEnoughUniquePlayers(lineup)) return;
    this.keys.add(lineup.lineup_id);
    this.items.push(lineup);
    this.items.sort((a, b) => b.objective_score - a.objective_score);
    if (this.items.length > this.limit * 8) {
      const removed = this.items.splice(this.limit * 4);
      removed.forEach((lineup) => this.keys.delete(lineup.lineup_id));
    }
  }

  values() {
    return this.items.slice(0, this.limit);
  }

  hasEnoughUniquePlayers(lineup) {
    if (!this.minUniquePlayers || !this.items.length) return true;
    return this.items.every((existing) => uniquePlayerDifference(lineup, existing) >= this.minUniquePlayers);
  }
}

function lineupId(players) {
  return players.map((player) => `${player.slot}:${player.player_id || player.player_name}`).join("|");
}

function uniquePlayerDifference(lineupA, lineupB) {
  const namesA = new Set(lineupA.players.map((player) => normalizeName(player.player_name)));
  const namesB = new Set(lineupB.players.map((player) => normalizeName(player.player_name)));
  let different = 0;
  namesA.forEach((name) => {
    if (!namesB.has(name)) different++;
  });
  return different;
}

function normalizeNameSet(values = []) {
  if (!Array.isArray(values)) return new Set();
  return new Set(values.map(normalizeName));
}

function normalizeName(name) {
  return String(name || "").trim().toLowerCase();
}

function sum(items, key) {
  return items.reduce((total, item) => total + safeNum(item[key]), 0);
}

function avg(items, key) {
  return items.length ? sum(items, key) / items.length : 0;
}

function percentile(values, pct) {
  if (!values.length) return 0;
  const index = Math.min(values.length - 1, Math.max(0, Math.floor(values.length * pct)));
  return round(values[index]);
}

function interpolate(min, max, amount) {
  return safeNum(min) + (safeNum(max) - safeNum(min)) * Math.max(0, Math.min(1, amount));
}

function seededRandom(input) {
  let hash = 2166136261;
  const text = String(input);
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 100000) / 100000;
}

function clampInt(value, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}


function enrichLineupAnalytics(lineup, salaryCap = 50000) {
  const p = lineup.players || [];
  const captain = p.find((x) => x.slot === "CPT");
  const avgOwn = avg(p, "ownership");
  const avgLev = avg(p, "leverage_score");
  const avgUpside = avg(p, "upside_score");
  const avgVol = avg(p.map((x) => ({ volatility: Math.max(0, safeNum(x.ceiling) - safeNum(x.floor)) })), "volatility");
  const salaryLeft = Math.max(0, round(salaryCap - safeNum(lineup.salary)));
  const teamCounts = p.reduce((acc, pl) => { const team = String(pl.team || "UNK"); acc[team] = (acc[team] || 0) + 1; return acc; }, {});
  const maxTeam = Math.max(...Object.values(teamCounts), 0);
  const stackType = maxTeam >= 5 ? "5-1 Stack" : maxTeam === 4 ? "4-2 Stack" : "Balanced";
  const spendUps = p.filter((x) => safeNum(x.salary) >= 9800).length + (captain && safeNum(captain.salary) >= 12000 ? 1 : 0);
  const punts = p.filter((x) => safeNum(x.salary) <= 3800).length;

  let archetype = "Balanced Build";
  let reason = "Balanced tournament build prioritizing six playable ceilings over hyper-volatile salary punts.";
  if (spendUps >= 2 && punts >= 2) { archetype = "Stars & Scrubs"; reason = "Stars & Scrubs build focused on raw ceiling from elite spend-ups while sacrificing stability for first-place upside."; }
  else if (spendUps >= 2) { archetype = "Double Spend-Up"; reason = "Double Spend-Up construction centered on two premium raw-ceiling anchors."; }
  else if (avgLev >= 68 && avgOwn <= 22) { archetype = "Leverage Stack"; reason = "Leverage Stack built around ownership discounts with tournament-relevant upside."; }
  else if (maxTeam >= 5) { archetype = "Onslaught Build"; reason = "Onslaught construction leaning into concentrated game script outcomes."; }
  else if (avgOwn <= 18) { archetype = "Ownership Fade Build"; reason = "Ownership fade build designed to reduce duplication and gain uniqueness across combinations."; }
  else if (avgUpside >= 72) { archetype = "Ceiling Build"; reason = "Ceiling-focused lineup emphasizing top-end outcomes over median stability."; }

  const duplication = clamp(avgOwn * 1.7 + (captain && safeNum(captain.ownership) >= 20 ? 14 : 0) + (salaryLeft <= 200 ? 12 : salaryLeft >= 800 ? -10 : 0) + (archetype === "Stars & Scrubs" ? 10 : 0));
  const leverageRating = clamp(avgLev * 0.7 + (100 - avgOwn) * 0.3);
  const ceilingRating = clamp(avgUpside * 0.5 + safeNum(lineup.ceiling) / Math.max(1, safeNum(lineup.projection)) * 25 + (captain ? safeNum(captain.upside_score) * 0.2 : 0));
  const stabilityRating = clamp(100 - avgVol * 0.35);
  const volatilityRating = clamp(100 - stabilityRating + (archetype === "Stars & Scrubs" ? 8 : 0));
  const correlationRating = clamp(52 + maxTeam * 8 + (stackType === "5-1 Stack" ? 8 : stackType === "4-2 Stack" ? 5 : 0));

  return { ...lineup, salary_left: salaryLeft, archetype, archetype_reason: reason, stack_type: stackType, game_script: maxTeam >= 4 ? "Onslaught/Concentrated" : "Balanced/Spread", duplication_risk: duplication >= 70 ? "High" : duplication >= 45 ? "Medium" : "Low", duplication_score: round(duplication), leverage_rating: round(leverageRating), ceiling_rating: round(ceilingRating), stability_rating: round(stabilityRating), volatility_rating: round(volatilityRating), correlation_rating: round(correlationRating) };
}
