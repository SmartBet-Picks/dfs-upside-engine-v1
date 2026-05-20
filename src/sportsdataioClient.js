const BASE_URLS = {
  nfl: "https://api.sportsdata.io/v3/nfl",
  mlb: "https://api.sportsdata.io/v3/mlb",
  nba: "https://api.sportsdata.io/v3/nba",
  mma: "https://api.sportsdata.io/v3/mma",
  golf: "https://api.sportsdata.io/golf/v2",
  nascar: "https://api.sportsdata.io/nascar/v2"
};

export const SPORTSDATAIO_ENDPOINTS = {
  nfl: {
    slates: "/scores/json/DfsSlatesByDate/{date}",
    players: "/projections/json/DfsSlatePlayers/{slateId}",
    projections: "/projections/json/PlayerGameProjectionStatsByDate/{date}",
    ownership: "/projections/json/DfsOwnershipProjections/{slateId}"
  },
  mlb: {
    slates: "/projections/json/DfsSlatesByDate/{date}",
    players: "/projections/json/DfsSlatePlayers/{slateId}",
    projections: "/projections/json/PlayerGameProjectionStatsByDate/{date}",
    ownership: "/projections/json/DfsOwnershipProjections/{slateId}"
  },
  nba: {
    slates: "/projections/json/DfsSlatesByDate/{date}",
    players: "/projections/json/DfsSlatePlayers/{slateId}",
    projections: "/projections/json/PlayerGameProjectionStatsByDate/{date}",
    ownership: "/projections/json/DfsOwnershipProjections/{slateId}"
  },
  mma: {
    slates: "/projections/json/DfsSlatesByEvent/{eventId}",
    players: "/projections/json/DfsSlatePlayers/{slateId}",
    projections: "/projections/json/FighterProjectionStatsByEvent/{eventId}",
    ownership: "/projections/json/DfsOwnershipProjections/{slateId}"
  },
  golf: {
    slates: "/projections/json/DfsSlatesByTournament/{tournamentId}",
    players: "/projections/json/DfsSlatePlayers/{slateId}",
    projections: "/projections/json/PlayerTournamentProjectionStats/{tournamentId}",
    ownership: "/projections/json/DfsOwnershipProjections/{slateId}"
  },
  nascar: {
    slates: "/projections/json/DfsSlatesByRace/{raceId}",
    players: "/projections/json/DfsSlatePlayers/{slateId}",
    projections: "/projections/json/DriverRaceProjectionStats/{raceId}",
    ownership: "/projections/json/DfsOwnershipProjections/{slateId}"
  }
};

export function buildSportsDataUrl(sport, endpointKey, params = {}) {
  const apiKey = process.env.SPORTSDATAIO_API_KEY;
  if (!apiKey) throw new Error("SPORTSDATAIO_API_KEY is not configured.");

  const baseUrl = BASE_URLS[sport];
  const endpoint = SPORTSDATAIO_ENDPOINTS[sport]?.[endpointKey];
  if (!baseUrl || !endpoint) throw new Error(`Missing SportsDataIO endpoint for ${sport}.${endpointKey}`);

  const today = new Date().toISOString().slice(0, 10);
  const finalParams = {
    date: params.date || today,
    slateId: params.slateId || params.slate_id || "",
    eventId: params.eventId || params.event_id || params.slateId || params.slate_id || "",
    tournamentId: params.tournamentId || params.tournament_id || params.slateId || params.slate_id || "",
    raceId: params.raceId || params.race_id || params.slateId || params.slate_id || ""
  };

  const path = endpoint.replace(/\{(\w+)\}/g, (_, key) => encodeURIComponent(finalParams[key] ?? ""));
  const url = new URL(`${baseUrl}${path}`);
  url.searchParams.set("key", apiKey);
  return url.toString();
}

export async function fetchSportsData(sport, endpointKey, params = {}) {
  const url = buildSportsDataUrl(sport, endpointKey, params);
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`SportsDataIO ${sport}.${endpointKey} failed: ${response.status} ${response.statusText} ${body.slice(0, 250)}`);
  }
  return response.json();
}

export async function getSlates(sport, slate_type, site, params = {}) {
  const rows = await fetchSportsData(sport, "slates", params);
  return Array.isArray(rows) ? rows.map((row) => normalizeSlateRow(row, sport, slate_type, site)) : [];
}

export async function getSlatePlayers(sport, slateId, slate_type, site, params = {}) {
  const rows = await fetchSportsData(sport, "players", { ...params, slateId });
  return Array.isArray(rows) ? rows.map((row) => normalizePlayerRow(row, sport, slate_type, site)) : [];
}

export async function getProjections(sport, slateId, params = {}) {
  const rows = await fetchSportsData(sport, "projections", { ...params, slateId });
  return Array.isArray(rows) ? rows : [];
}

export async function getOwnership(sport, slateId, params = {}) {
  try {
    const rows = await fetchSportsData(sport, "ownership", { ...params, slateId });
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    console.warn(`Ownership unavailable for ${sport} slate ${slateId}: ${error.message}`);
    return [];
  }
}

export function normalizeSlateRow(raw, sport, slate_type, site) {
  const slateId = raw.SlateID || raw.SlateId || raw.slate_id || raw.Id || raw.ID;
  return {
    sport,
    slate_type,
    provider: "sportsdataio",
    site,
    slate_id: String(slateId || raw.Name || raw.slate_name || Date.now()),
    slate_name: raw.Name || raw.SlateName || raw.OperatorName || `${sport.toUpperCase()} ${slate_type}`,
    slate_start_time: raw.StartTime || raw.Day || raw.Date || new Date().toISOString(),
    salary_cap: Number(raw.SalaryCap || raw.OperatorSalaryCap || defaultSalaryCap(site)),
    roster_slots: raw.RosterSlots || raw.OperatorRosterSlots || raw.Positions || [],
    game_count: Number(raw.GameCount || raw.NumberOfGames || raw.Games?.length || 0),
    raw
  };
}

export function normalizePlayerRow(raw, sport, slate_type, site) {
  const playerName = raw.Name || raw.PlayerName || raw.FighterName || raw.DriverName || raw.FullName || "Unknown Player";
  const salary = Number(raw.Salary || raw.OperatorSalary || raw.DraftKingsSalary || raw.FanDuelSalary || 0);
  const projection = Number(raw.Projection || raw.FantasyPoints || raw.ProjectedFantasyPoints || raw.Points || raw.AverageDraftPosition || 0);
  const floor = Number(raw.Floor || raw.ProjectedFloor || projection * 0.55 || 0);
  const ceiling = Number(raw.Ceiling || raw.ProjectedCeiling || projection * 1.8 || 0);

  return {
    player_id: String(raw.PlayerID || raw.PlayerId || raw.FighterID || raw.DriverID || raw.ID || playerName),
    player_name: playerName,
    sport,
    slate_type,
    site,
    team: raw.Team || raw.TeamAbbreviation || raw.Country || raw.Manufacturer || null,
    opponent: raw.Opponent || raw.OpponentTeam || raw.OpponentAbbreviation || null,
    position: raw.Position || raw.RosterPosition || raw.OperatorPosition || inferPosition(raw, sport),
    roster_slot: raw.RosterPosition || raw.OperatorRosterSlots || raw.Position || inferPosition(raw, sport),
    salary,
    projection,
    floor,
    ceiling,
    boom_pct: Number(raw.BoomPercentage || raw.BoomPct || raw.UpsidePercentage || estimateBoom(projection, ceiling)),
    bust_pct: Number(raw.BustPercentage || raw.BustPct || estimateBust(projection, floor)),
    ownership: Number(raw.Ownership || raw.ProjectedOwnership || 0),
    ownership_source: raw.Ownership || raw.ProjectedOwnership ? "provider" : "estimated",
    raw
  };
}

export function mergeProjectionRows(players, projectionRows = []) {
  const projectionMap = new Map();
  for (const row of projectionRows) {
    const keys = [
      row.PlayerID,
      row.PlayerId,
      row.FighterID,
      row.DriverID,
      row.ID,
      row.Name,
      row.PlayerName,
      row.FighterName,
      row.DriverName
    ].filter(Boolean);
    for (const key of keys) projectionMap.set(String(key).toLowerCase(), row);
  }

  return players.map((player) => {
    const projection = projectionMap.get(String(player.player_id).toLowerCase()) || projectionMap.get(String(player.player_name).toLowerCase());
    if (!projection) return player;

    const projectedPoints = Number(projection.FantasyPoints || projection.ProjectedFantasyPoints || projection.Projection || player.projection);
    const floor = Number(projection.Floor || projection.ProjectedFloor || player.floor);
    const ceiling = Number(projection.Ceiling || projection.ProjectedCeiling || player.ceiling);
    return {
      ...player,
      projection: Number.isFinite(projectedPoints) ? projectedPoints : player.projection,
      floor: Number.isFinite(floor) ? floor : player.floor,
      ceiling: Number.isFinite(ceiling) ? ceiling : player.ceiling,
      boom_pct: Number(projection.BoomPercentage || projection.BoomPct || player.boom_pct),
      bust_pct: Number(projection.BustPercentage || projection.BustPct || player.bust_pct),
      raw: { slatePlayer: player.raw, projection }
    };
  });
}

function defaultSalaryCap(site) {
  if (site === "fanduel") return 60000;
  return 50000;
}

function inferPosition(raw, sport) {
  if (sport === "golf") return "GOLFER";
  if (sport === "nascar") return "DRIVER";
  if (sport === "mma") return raw.WeightClass || "FIGHTER";
  return "UTIL";
}

function estimateBoom(projection, ceiling) {
  if (!projection || !ceiling) return 12;
  return Math.max(4, Math.min(45, ((ceiling / Math.max(projection, 1)) - 1) * 32));
}

function estimateBust(projection, floor) {
  if (!projection) return 28;
  return Math.max(5, Math.min(70, (1 - (floor / Math.max(projection, 1))) * 65));
}
