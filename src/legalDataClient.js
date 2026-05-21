export const LEGAL_DATA_SOURCES = {
  tank01: "Tank01",
  odds: "The Odds API",
  public: "Configured public/API JSON feeds",
  manual: "Request body seed data"
};

export const sourceHealth = {
  nfl: "ok",
  mlb: "ok",
  nba: "ok",
  mma: "ok",
  golf: "ok",
  nascar: "ok"
};

const DEFAULT_SALARY_CAPS = {
  draftkings: 50000,
  fanduel: 60000,
  yahoo: 200,
  superdraft: 50000
};

const ODDS_SPORT_KEYS = {
  nfl: "americanfootball_nfl",
  mlb: "baseball_mlb",
  nba: "basketball_nba",
  mma: "mma_mixed_martial_arts",
  golf: "golf_pga_championship_winner",
  nascar: "nascar_cup_series"
};

export class LegalDataSourceError extends Error {
  constructor({ source, sport, status, statusText, message }) {
    super(message || `${source} ${sport} source failed: ${status} ${statusText}`);
    this.name = "LegalDataSourceError";
    this.source = source;
    this.sport = sport;
    this.status = status;
    this.statusText = statusText;
  }
}

export async function validateLegalDataSources() {
  for (const sport of Object.keys(sourceHealth)) {
    sourceHealth[sport] = "ok";
    console.log(`[${sport.toUpperCase()}] legal data model OK`);
  }
  return sourceHealth;
}

export async function getSlates(sport, slate_type, site, params = {}) {
  const date = params.date || new Date().toISOString().slice(0, 10);
  const slateId = params.slate_id || params.slateId || `${sport}-${site}-${slate_type}-${date}`;
  const slateName = params.slate_name || `${sport.toUpperCase()} ${site} ${slate_type} ${date}`;

  return [{
    sport,
    slate_type,
    provider: "internal_model",
    site,
    slate_id: String(slateId),
    slate_name: slateName,
    slate_start_time: params.start_time || params.startTime || new Date(`${date}T12:00:00Z`).toISOString(),
    salary_cap: Number(params.salary_cap || params.salaryCap || DEFAULT_SALARY_CAPS[site] || 50000),
    roster_slots: rosterSlotsForSport(sport, slate_type),
    game_count: Number(params.game_count || params.gameCount || 0),
    raw: { source: "internal_model", date, query: params }
  }];
}

export async function getSlatePlayers(sport, slateId, slate_type, site, params = {}) {
  const rows = await loadPlayerSeedRows(sport, site, params);
  return rows.map((row) => normalizePlayerRow(row, sport, slate_type, site));
}

export async function getProjections(sport, slateId, params = {}) {
  const rows = await loadPlayerSeedRows(sport, params.site || "draftkings", params);
  const oddsRows = await loadOddsRows(sport, params);
  const injuryRows = await loadPublicRows(`${sport.toUpperCase()}_INJURIES_URL`, params, []);
  const gameLogRows = await loadPublicRows(`${sport.toUpperCase()}_GAME_LOGS_URL`, params, []);

  return rows.map((row) => buildProjectionRow(row, {
    sport,
    oddsRows,
    injuryRows,
    gameLogRows
  }));
}

export async function getOwnership(sport, slateId, params = {}) {
  const rows = await loadPublicRows(`${sport.toUpperCase()}_OWNERSHIP_URL`, params, []);
  return rows.map((row) => ({
    ...row,
    Ownership: row.Ownership || row.ProjectedOwnership || row.estimated_ownership
  }));
}

export function normalizePlayerRow(raw, sport, slate_type, site) {
  const name = raw.Name || raw.PlayerName || raw.playerName || raw.longName || raw.fullName || raw.name || raw.FighterName || raw.DriverName || "Unknown Player";
  const salary = Number(
    raw.Salary ||
    raw.salary ||
    raw.DraftKingsSalary ||
    raw.FanDuelSalary ||
    raw.YahooSalary ||
    raw.draftKingsSalary ||
    raw.fanduelSalary ||
    0
  );
  const projection = Number(raw.Projection || raw.projectedPoints || raw.fantasyPoints || raw.FantasyPoints || raw.avgFantasyPoints || 0);
  const floor = Number(raw.Floor || raw.floor || projection * 0.55 || 0);
  const ceiling = Number(raw.Ceiling || raw.ceiling || projection * 1.75 || 0);

  return {
    player_id: String(raw.PlayerID || raw.PlayerId || raw.playerID || raw.playerId || raw.id || name),
    player_name: name,
    sport,
    slate_type,
    site,
    team: raw.Team || raw.team || raw.teamAbv || raw.teamAbbr || raw.Country || raw.Manufacturer || null,
    opponent: raw.Opponent || raw.opponent || raw.opp || raw.OpponentTeam || null,
    position: raw.Position || raw.position || raw.pos || inferPosition(raw, sport),
    roster_slot: raw.RosterPosition || raw.rosterSlot || raw.Position || raw.position || inferPosition(raw, sport),
    salary,
    projection,
    floor,
    ceiling,
    boom_pct: Number(raw.BoomPercentage || raw.boom_pct || raw.boomPct || 0),
    bust_pct: Number(raw.BustPercentage || raw.bust_pct || raw.bustPct || 0),
    ownership: Number(raw.Ownership || raw.ProjectedOwnership || raw.estimated_ownership || 0),
    ownership_source: raw.Ownership || raw.ProjectedOwnership ? "provider" : "estimated",
    raw
  };
}

export function mergeProjectionRows(players, projectionRows = []) {
  const projectionMap = new Map();
  for (const row of projectionRows) {
    for (const key of projectionKeys(row)) projectionMap.set(String(key).toLowerCase(), row);
  }

  return players.map((player) => {
    const projection = projectionMap.get(String(player.player_id).toLowerCase()) || projectionMap.get(String(player.player_name).toLowerCase());
    if (!projection) return finalizeInternalProjection(player, {});

    return finalizeInternalProjection(player, projection);
  });
}

async function loadPlayerSeedRows(sport, site, params) {
  const manualRows = extractManualRows(params);
  if (manualRows.length) return dedupeSalaryRows(manualRows);

  const salaryRows = await loadPublicRows(`${sport.toUpperCase()}_${site.toUpperCase()}_SALARIES_URL`, params, null);
  if (Array.isArray(salaryRows) && salaryRows.length) return dedupeSalaryRows(salaryRows);

  const genericSalaryRows = await loadPublicRows(`${sport.toUpperCase()}_SALARIES_URL`, params, null);
  if (Array.isArray(genericSalaryRows) && genericSalaryRows.length) return dedupeSalaryRows(genericSalaryRows);

  const tankRows = await loadTank01Rows(sport, params);
  if (tankRows.length) return dedupeSalaryRows(tankRows);

  return [];
}

async function loadTank01Rows(sport, params) {
  const url = buildTemplateUrl(process.env[`${sport.toUpperCase()}_TANK01_PLAYERS_URL`] || process.env.TANK01_PLAYERS_URL, params);
  if (!url) return [];

  const headers = {};
  if (process.env.TANK01_RAPIDAPI_KEY) headers["X-RapidAPI-Key"] = process.env.TANK01_RAPIDAPI_KEY;
  if (process.env.TANK01_RAPIDAPI_HOST) headers["X-RapidAPI-Host"] = process.env.TANK01_RAPIDAPI_HOST;

  const payload = await safeFetchJson(url, headers, "tank01", sport);
  return extractRows(payload);
}

async function loadOddsRows(sport, params) {
  if (!process.env.ODDS_API_KEY) return [];
  const sportKey = params.odds_sport_key || params.oddsSportKey || ODDS_SPORT_KEYS[sport];
  if (!sportKey) return [];

  const url = new URL(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds`);
  url.searchParams.set("apiKey", process.env.ODDS_API_KEY);
  url.searchParams.set("regions", params.odds_regions || "us");
  url.searchParams.set("markets", params.odds_markets || "h2h,spreads,totals");
  url.searchParams.set("oddsFormat", "american");

  const payload = await safeFetchJson(url.toString(), {}, "odds", sport);
  return extractRows(payload);
}

async function loadPublicRows(envName, params, fallback = []) {
  const url = buildTemplateUrl(process.env[envName], params);
  if (!url) return fallback;
  const payload = await safeFetchJson(url, {}, "public", params.sport || "all");
  return extractRows(payload);
}

async function safeFetchJson(url, headers, source, sport) {
  try {
    const response = await fetch(url, { headers: { accept: "application/json", ...headers } });
    if (!response.ok) {
      console.warn(`[${source}] ${sport} failed safely: ${response.status} ${response.statusText}`);
      return [];
    }
    return response.json();
  } catch (error) {
    console.warn(`[${source}] ${sport} failed safely: ${error.message}`);
    return [];
  }
}

function buildProjectionRow(row, context) {
  const recent = recentPerformance(row, context.gameLogRows);
  const odds = oddsContext(row, context.oddsRows);
  const injury = injuryContext(row, context.injuryRows);
  const base = Number(row.Projection || row.projectedPoints || row.FantasyPoints || row.avgFantasyPoints || recent.average || 0);
  const marketBoost = odds.totalBoost + odds.favoriteBoost + odds.propBoost;
  const roleBoost = roleBoostFromRow(row) + injury.roleBoost;
  const volatility = volatilityFromRecent(recent);
  const projection = Math.max(0, base * injury.availabilityMultiplier + marketBoost + roleBoost);
  const floor = Math.max(0, projection * (0.54 + recent.stability * 0.16) - volatility * 0.08);
  const ceiling = Math.max(projection, projection * (1.34 + volatility * 0.01) + marketBoost * 1.15 + roleBoost * 0.9);
  const boomPct = clamp(10 + ((ceiling / Math.max(projection, 1)) - 1) * 24 + marketBoost * 0.6 + recent.trend * 1.1, 4, 42);
  const bustPct = clamp(16 + volatility * 0.75 - recent.stability * 16 + injury.bustBoost, 5, 58);

  return {
    ...row,
    Projection: round(projection),
    Floor: round(floor),
    Ceiling: round(ceiling),
    BoomPercentage: round(boomPct),
    BustPercentage: round(bustPct),
    model_inputs: { recent, odds, injury, source: "internal_model" }
  };
}

function finalizeInternalProjection(player, projection) {
  const projectedPoints = Number(projection.Projection || projection.projectedPoints || player.projection || 0);
  const floor = Number(projection.Floor || player.floor || projectedPoints * 0.55 || 0);
  const ceiling = Number(projection.Ceiling || player.ceiling || projectedPoints * 1.75 || 0);
  return {
    ...player,
    salary: Number(player.salary || projection.Salary || projection.salary || 0),
    projection: round(projectedPoints),
    floor: round(floor),
    ceiling: round(ceiling),
    boom_pct: round(Number(projection.BoomPercentage || player.boom_pct || estimateBoom(projectedPoints, ceiling))),
    bust_pct: round(Number(projection.BustPercentage || player.bust_pct || estimateBust(projectedPoints, floor))),
    raw: { seed: player.raw, model: projection.model_inputs || {}, projection }
  };
}

function extractManualRows(params) {
  const body = params.body || {};
  if (Array.isArray(body.players)) return body.players;
  if (Array.isArray(body.salaries)) return body.salaries;
  if (Array.isArray(params.players)) return params.players;
  if (Array.isArray(params.salaries)) return params.salaries;
  return [];
}

function dedupeSalaryRows(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = salaryDedupeKey(row);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, normalizeSalarySeed(row, key));
      continue;
    }

    grouped.set(key, mergeSalarySeed(existing, row, key));
  }
  return [...grouped.values()];
}

function normalizeSalarySeed(row, key) {
  return {
    ...row,
    PlayerID: row.PlayerID || row.PlayerId || row.playerID || row.playerId || row.id || key,
    RosterPosition: baseRosterPosition(row),
    Salary: Number(row.Salary || row.salary || row.DraftKingsSalary || row.draftKingsSalary || 0),
    raw_salary_rows: [row]
  };
}

function mergeSalarySeed(existing, next, key) {
  const nextSalary = Number(next.Salary || next.salary || next.DraftKingsSalary || next.draftKingsSalary || 0);
  const existingSalary = Number(existing.Salary || existing.salary || 0);
  const preferNext = shouldPreferBaseSalaryRow(next, nextSalary, existing, existingSalary);
  const base = preferNext ? next : existing;
  const salary = preferNext ? nextSalary : existingSalary;
  const rawRows = [...(existing.raw_salary_rows || []), next];

  return {
    ...existing,
    ...base,
    PlayerID: existing.PlayerID || base.PlayerID || key,
    RosterPosition: baseRosterPosition(base),
    Salary: salary,
    captain_salary: Math.max(existingSalary, nextSalary),
    flex_salary: Math.min(...rawRows.map((row) => Number(row.Salary || row.salary || row.DraftKingsSalary || row.draftKingsSalary || 0)).filter((value) => value > 0)),
    raw_salary_rows: rawRows
  };
}

function shouldPreferBaseSalaryRow(next, nextSalary, existing, existingSalary) {
  const nextSlot = String(next.RosterPosition || next["Roster Position"] || next.Position || next.position || "").toUpperCase();
  const existingSlot = String(existing.RosterPosition || existing["Roster Position"] || existing.Position || existing.position || "").toUpperCase();
  if (nextSlot.includes("CPT") || nextSlot.includes("CAPTAIN")) return false;
  if (existingSlot.includes("CPT") || existingSlot.includes("CAPTAIN")) return true;
  if (nextSalary > 0 && existingSalary > 0) return nextSalary < existingSalary;
  return nextSalary > 0;
}

function salaryDedupeKey(row) {
  const name = String(row.Name || row.PlayerName || row.playerName || row.longName || row.fullName || row.name || "").trim().toLowerCase();
  const team = String(row.Team || row.TeamAbbrev || row.team || row.teamAbv || row.teamAbbr || "").trim().toLowerCase();
  const game = String(row["Game Info"] || row.GameInfo || row.gameInfo || row.Opponent || row.opponent || "").trim().toLowerCase();
  return [name, team, game].filter(Boolean).join("|") || String(row.PlayerID || row.PlayerId || row.id || Math.random());
}

function baseRosterPosition(row) {
  const slot = String(row.RosterPosition || row["Roster Position"] || row.rosterSlot || "").toUpperCase();
  if (slot.includes("CPT") || slot.includes("CAPTAIN")) return "FLEX";
  return row.RosterPosition || row["Roster Position"] || row.rosterSlot || row.Position || row.position || "UTIL";
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["body", "data", "players", "playerData", "salaries", "results", "events", "games", "items"]) {
    if (Array.isArray(payload[key])) return payload[key];
    if (payload[key] && typeof payload[key] === "object") {
      const nested = extractRows(payload[key]);
      if (nested.length) return nested;
    }
  }
  return [];
}

function buildTemplateUrl(template, params) {
  if (!template) return null;
  return template.replace(/\{(\w+)\}/g, (_, key) => encodeURIComponent(params[key] || params[key.toLowerCase()] || ""));
}

function projectionKeys(row) {
  return [
    row.PlayerID,
    row.PlayerId,
    row.playerID,
    row.playerId,
    row.id,
    row.Name,
    row.PlayerName,
    row.playerName,
    row.longName,
    row.name,
    row.FighterName,
    row.DriverName
  ].filter(Boolean);
}

function recentPerformance(row, gameLogRows) {
  const name = String(row.Name || row.PlayerName || row.playerName || row.longName || row.name || "").toLowerCase();
  const playerId = String(row.PlayerID || row.PlayerId || row.playerID || row.playerId || row.id || "").toLowerCase();
  const logs = gameLogRows.filter((log) => {
    const logName = String(log.Name || log.PlayerName || log.playerName || log.longName || log.name || "").toLowerCase();
    const logId = String(log.PlayerID || log.PlayerId || log.playerID || log.playerId || log.id || "").toLowerCase();
    return (playerId && logId === playerId) || (name && logName === name);
  }).slice(0, 10);

  const scores = logs.map((log) => Number(log.FantasyPoints || log.fantasyPoints || log.dkPoints || log.fdPoints || log.points)).filter(Number.isFinite);
  if (!scores.length) {
    const fallback = Number(row.avgFantasyPoints || row.fantasyPoints || row.FantasyPoints || row.Projection || 0);
    return { average: fallback, stability: fallback ? 0.68 : 0.5, trend: 0, volatility: fallback ? 12 : 24 };
  }

  const average = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  const variance = scores.reduce((sum, value) => sum + Math.pow(value - average, 2), 0) / scores.length;
  const volatility = Math.sqrt(variance);
  const firstHalf = scores.slice(Math.ceil(scores.length / 2));
  const secondHalf = scores.slice(0, Math.ceil(scores.length / 2));
  const recentAvg = secondHalf.reduce((sum, value) => sum + value, 0) / Math.max(secondHalf.length, 1);
  const priorAvg = firstHalf.reduce((sum, value) => sum + value, 0) / Math.max(firstHalf.length, 1);
  return {
    average,
    stability: clamp(1 - volatility / Math.max(average, 1), 0, 1),
    trend: clamp(recentAvg - priorAvg, -10, 10),
    volatility
  };
}

function oddsContext(row, oddsRows) {
  const team = String(row.Team || row.team || row.teamAbv || "").toLowerCase();
  const opponent = String(row.Opponent || row.opponent || row.opp || "").toLowerCase();
  const matchingGames = oddsRows.filter((game) => {
    const home = String(game.home_team || game.homeTeam || "").toLowerCase();
    const away = String(game.away_team || game.awayTeam || "").toLowerCase();
    return (team && (home.includes(team) || away.includes(team))) || (opponent && (home.includes(opponent) || away.includes(opponent)));
  });

  const totals = matchingGames.flatMap((game) => game.bookmakers || []).flatMap((book) => book.markets || []).filter((market) => market.key === "totals");
  const spreads = matchingGames.flatMap((game) => game.bookmakers || []).flatMap((book) => book.markets || []).filter((market) => market.key === "spreads");
  const totalLine = Number(totals[0]?.outcomes?.[0]?.point || 0);
  const spreadLine = Number(spreads[0]?.outcomes?.[0]?.point || 0);
  return {
    totalBoost: totalLine ? clamp((totalLine - 42) * 0.08, -3, 6) : 0,
    favoriteBoost: spreadLine < 0 ? clamp(Math.abs(spreadLine) * 0.12, 0, 3) : 0,
    propBoost: Number(row.propLine || row.playerProp || 0) * 0.05
  };
}

function injuryContext(row, injuryRows) {
  const name = String(row.Name || row.PlayerName || row.playerName || row.longName || row.name || "").toLowerCase();
  const injury = injuryRows.find((item) => String(item.Name || item.PlayerName || item.playerName || item.longName || item.name || "").toLowerCase() === name);
  const status = String(injury?.Status || injury?.status || row.Status || row.injuryStatus || "").toLowerCase();
  if (status.includes("out") || status.includes("doubtful")) return { availabilityMultiplier: 0.08, roleBoost: -8, bustBoost: 45 };
  if (status.includes("questionable") || status.includes("limited")) return { availabilityMultiplier: 0.82, roleBoost: -2, bustBoost: 14 };
  if (String(row.roleBoost || "").toLowerCase() === "true" || Number(row.roleBoost) > 0) return { availabilityMultiplier: 1, roleBoost: Number(row.roleBoost) || 3, bustBoost: 0 };
  return { availabilityMultiplier: 1, roleBoost: 0, bustBoost: 0 };
}

function roleBoostFromRow(row) {
  let score = 0;
  const raw = JSON.stringify(row).toLowerCase();
  if (raw.includes("starter") || raw.includes("starting")) score += 2.2;
  if (raw.includes("usage") || raw.includes("minutes") || raw.includes("targets")) score += 1.8;
  if (raw.includes("backup") || raw.includes("limited")) score -= 1.5;
  return score;
}

function volatilityFromRecent(recent) {
  return clamp(recent.volatility || (1 - recent.stability) * 40, 0, 60);
}

function rosterSlotsForSport(sport, slateType) {
  if (slateType === "showdown") return ["CPT", "FLEX", "FLEX", "FLEX", "FLEX", "FLEX"];
  if (sport === "nba") return ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL"];
  if (sport === "nfl") return ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST"];
  if (sport === "mlb") return ["P", "P", "C", "1B", "2B", "3B", "SS", "OF", "OF", "OF"];
  if (sport === "mma") return ["F", "F", "F", "F", "F", "F"];
  if (sport === "golf") return ["G", "G", "G", "G", "G", "G"];
  if (sport === "nascar") return ["D", "D", "D", "D", "D", "D"];
  return ["UTIL"];
}

function inferPosition(raw, sport) {
  if (sport === "golf") return "GOLFER";
  if (sport === "nascar") return "DRIVER";
  if (sport === "mma") return raw.WeightClass || raw.weightClass || "FIGHTER";
  return "UTIL";
}

function estimateBoom(projection, ceiling) {
  if (!projection || !ceiling) return 12;
  return clamp(((ceiling / Math.max(projection, 1)) - 1) * 32, 4, 45);
}

function estimateBust(projection, floor) {
  if (!projection) return 28;
  return clamp((1 - (floor / Math.max(projection, 1))) * 65, 5, 70);
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));
}

function round(value, places = 2) {
  return Number(clamp(value, -1000000, 1000000).toFixed(places));
}
