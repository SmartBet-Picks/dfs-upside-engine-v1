import "dotenv/config";
import express from "express";
import cors from "cors";
import { getSupabase, insertScanLog } from "./src/supabaseClient.js";
import { CONTEST_TYPES, SUPPORTED_SPORTS, contestFitMatches, inferContestType, normalizeSite, normalizeSlateType, normalizeSport } from "./src/contestRules.js";
import { LegalDataSourceError, sourceHealth, mergeProjectionRows, validateLegalDataSources } from "./src/legalDataClient.js";
import { applyOwnership } from "./src/ownershipEngine.js";
import { lineupsToCsv, optimizeLineups } from "./src/optimizerEngine.js";
import { rankForContest, scorePlayers } from "./src/scoringEngine.js";
import { calculateShowdownScores } from "./src/showdownEngine.js";
import { sportAdapters } from "./src/sportAdapters/index.js";

const app = express();
const port = Number(process.env.PORT || 3000);
let autoScanRunning = false;
const lineupExports = new Map();

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use("/public", express.static("public"));

app.get("/", (req, res) => {
  res.json({
    name: "DFS Upside Engine V1",
    status: "online",
    mode: "DFS-only",
    provider: "Internal legal-data model",
    sports: SUPPORTED_SPORTS,
    routes: [
      "GET /dashboard",
      "GET /health",
      "GET /sports",
      "GET /slates?sport=mlb&slate_type=classic",
      "POST /scan?sport=mlb&slate_type=classic&site=draftkings",
      "GET /players?sport=mlb&slate_type=classic",
      "GET /api/projections?sport=mlb&slate_type=classic",
      "POST /api/optimize",
      "GET /api/lineups/:id.csv",
      "GET /top-upside?sport=mlb&slate_type=classic",
      "GET /leverage?sport=mlb&slate_type=classic",
      "GET /fake-chalk?sport=mlb&slate_type=classic",
      "GET /single-entry?sport=mlb&slate_type=classic",
      "GET /contest-fit?sport=mlb&slate_type=classic&contest_type=single_entry&contest_size=500",
      "GET /showdown-captains?sport=nfl&slate_type=showdown",
      "GET /showdown-flex?sport=nfl&slate_type=showdown",
      "DELETE /clear-slate?sport=mlb&slate_type=classic"
    ]
  });
});

app.get("/dashboard", (req, res) => {
  res.sendFile("dashboard.html", { root: "public" });
});

app.get("/health", (req, res) => {
  res.json({
    nfl: sourceHealth.nfl === "failed" ? "failed" : "ok",
    mlb: sourceHealth.mlb === "failed" ? "failed" : "ok",
    nba: sourceHealth.nba === "failed" ? "failed" : "ok",
    mma: sourceHealth.mma === "failed" ? "failed" : "ok",
    golf: sourceHealth.golf === "failed" ? "failed" : "ok",
    nascar: sourceHealth.nascar === "failed" ? "failed" : "ok"
  });
});

app.get("/sports", (req, res) => {
  res.json({
    sports: SUPPORTED_SPORTS,
    slate_types: ["classic", "showdown"],
    contest_types: CONTEST_TYPES,
    sites: ["draftkings", "fanduel", "yahoo", "superdraft"]
  });
});

app.get("/slates", asyncHandler(async (req, res) => {
  const { sport, slate_type, site } = parseSlateQuery(req.query);
  const adapter = sportAdapters[sport];
  const slates = await adapter.getSlates(sport, slate_type, site, req.query);
  res.json({ sport, slate_type, site, count: slates.length, slates });
}));

app.post("/scan", asyncHandler(async (req, res) => {
  const { sport, slate_type, site } = parseSlateQuery(req.query);
  const result = await runScan({ sport, slate_type, site, query: req.query, body: req.body });
  res.json(result);
}));

app.get("/players", asyncHandler(async (req, res) => {
  const { sport, slate_type, site } = parseSlateQuery(req.query, false);
  const players = await fetchPlayers({ sport, slate_type, site, date: req.query.date, limit: req.query.limit });
  res.json({ sport, slate_type, site, count: players.length, players });
}));

app.get("/api/projections", asyncHandler(async (req, res) => {
  const { sport, slate_type, site } = parseSlateQuery(req.query, false);
  const players = await fetchPlayers({ sport, slate_type, site, date: req.query.date, limit: req.query.limit || 500 });
  const generatedAt = new Date().toISOString();

  res.json({
    sport,
    slate_type,
    site,
    model_version: "internal-dfs-v1",
    generated_at: generatedAt,
    count: players.length,
    projections: players.map((player) => toProjectionFeedRow(player, generatedAt))
  });
}));

app.get("/top-upside", asyncHandler(async (req, res) => {
  const { sport, slate_type, site } = parseSlateQuery(req.query, false);
  const players = await fetchPlayers({ sport, slate_type, site, date: req.query.date, limit: req.query.limit, orderBy: "upside_score" });
  res.json({ sport, slate_type, site, count: players.length, players });
}));

app.get("/leverage", asyncHandler(async (req, res) => {
  const { sport, slate_type, site } = parseSlateQuery(req.query, false);
  const players = await fetchPlayers({ sport, slate_type, site, date: req.query.date, limit: req.query.limit, orderBy: "leverage_score" });
  res.json({ sport, slate_type, site, count: players.length, players });
}));

app.get("/fake-chalk", asyncHandler(async (req, res) => {
  const { sport, slate_type, site } = parseSlateQuery(req.query, false);
  const players = await fetchPlayers({ sport, slate_type, site, date: req.query.date, limit: req.query.limit, filters: { fake_chalk_warning: true }, orderBy: "ownership" });
  res.json({ sport, slate_type, site, count: players.length, players });
}));

app.get("/single-entry", asyncHandler(async (req, res) => {
  const { sport, slate_type, site } = parseSlateQuery(req.query, false);
  const allPlayers = await fetchPlayers({ sport, slate_type, site, date: req.query.date, limit: 500 });
  const players = rankForContest(allPlayers, "single_entry", 500).filter((player) => !String(player.single_entry_grade || "").includes("Not")).slice(0, readLimit(req.query.limit));
  res.json({ sport, slate_type, site, count: players.length, players });
}));

app.get("/contest-fit", asyncHandler(async (req, res) => {
  const { sport, slate_type, site } = parseSlateQuery(req.query, false);
  const contestType = inferContestType(req.query.contest_type, req.query.contest_size);
  const contestSize = Number(req.query.contest_size || 500);
  const allPlayers = await fetchPlayers({ sport, slate_type, site, date: req.query.date, limit: 500 });
  const players = rankForContest(allPlayers, contestType, contestSize)
    .filter((player) => contestFitMatches(player, contestType, contestSize))
    .slice(0, readLimit(req.query.limit));

  res.json({ sport, slate_type, site, contest_type: contestType, contest_size: contestSize, count: players.length, players });
}));

app.get("/showdown-captains", asyncHandler(async (req, res) => {
  const { sport, slate_type, site } = parseSlateQuery({ ...req.query, slate_type: req.query.slate_type || "showdown" }, false);
  const players = await fetchPlayers({ sport, slate_type, site, date: req.query.date, limit: req.query.limit, orderBy: "showdown_captain_score" });
  res.json({ sport, slate_type, site, count: players.length, players });
}));

app.get("/showdown-flex", asyncHandler(async (req, res) => {
  const { sport, slate_type, site } = parseSlateQuery({ ...req.query, slate_type: req.query.slate_type || "showdown" }, false);
  const players = await fetchPlayers({ sport, slate_type, site, date: req.query.date, limit: req.query.limit, orderBy: "showdown_flex_score" });
  res.json({ sport, slate_type, site, count: players.length, players });
}));

app.post("/api/optimize", asyncHandler(async (req, res) => {
  const { sport, slate_type, site } = parseSlateQuery(req.body || {}, false);
  const players = await fetchPlayers({
    sport,
    slate_type,
    site,
    date: req.body?.date,
    limit: req.body?.pool_limit || 500,
    orderBy: slate_type === "showdown" ? "showdown_captain_score" : "upside_score"
  });

  if (!players.length) {
    return res.status(404).json({
      error: true,
      message: "No projection rows found for that sport/slate/site/date. Scan a projection CSV first.",
      sport,
      slate_type,
      site
    });
  }

  const lineups = optimizeLineups(players, {
    ...req.body,
    sport,
    slate_type,
    site
  });
  const exportId = createExportId();
  const csv = lineupsToCsv(lineups);
  lineupExports.set(exportId, { csv, createdAt: Date.now() });
  pruneLineupExports();

  res.json({
    sport,
    slate_type,
    site,
    date: req.body?.date || null,
    objective: req.body?.objective || "balanced",
    lineup_count: lineups.length,
    download_url: `/api/lineups/${exportId}.csv`,
    lineups
  });
}));

app.get("/api/lineups/:id.csv", (req, res) => {
  const item = lineupExports.get(req.params.id);
  if (!item) {
    return res.status(404).send("Lineup export not found or expired. Generate lineups again.");
  }

  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="dfs-lineups-${req.params.id}.csv"`);
  res.send(item.csv);
});

app.delete("/clear-slate", asyncHandler(async (req, res) => {
  const { sport, slate_type, site } = parseSlateQuery(req.query, false);
  const supabase = getSupabase();

  const slateQuery = supabase.from("dfs_slates").select("id").eq("sport", sport).eq("slate_type", slate_type).eq("site", site);
  const { data: slates, error: slateFetchError } = await slateQuery;
  if (slateFetchError) throw new Error(slateFetchError.message);

  const slateIds = slates.map((slate) => slate.id);
  let deletedPlayers = 0;

  if (slateIds.length) {
    const { data: deleted, error: playerDeleteError } = await supabase
      .from("dfs_players")
      .delete()
      .in("slate_id", slateIds)
      .select("id");
    if (playerDeleteError) throw new Error(playerDeleteError.message);
    deletedPlayers = deleted.length;
  }

  const { data: deletedSlates, error: slateDeleteError } = await supabase
    .from("dfs_slates")
    .delete()
    .eq("sport", sport)
    .eq("slate_type", slate_type)
    .eq("site", site)
    .select("id");
  if (slateDeleteError) throw new Error(slateDeleteError.message);

  res.json({ sport, slate_type, site, deleted_slates: deletedSlates.length, deleted_players: deletedPlayers });
}));

app.use((err, req, res, next) => {
  console.error(`[error] ${req.method} ${req.path}`, err);
  if (err instanceof LegalDataSourceError) {
    return res.status(502).json({
      error: true,
      type: "legal_data_source_failed",
      provider: err.source,
      sport: err.sport,
      status: err.status,
      status_text: err.statusText,
      message: err.message,
      path: req.path
    });
  }

  res.status(err.statusCode || 500).json({
    error: true,
    message: err.message || "Unexpected server error",
    path: req.path
  });
});

app.listen(port, () => {
  console.log(`DFS Upside Engine V1 running on port ${port}`);
  validateLegalDataSources().catch((error) => {
    console.warn(`[legal-data] startup validation failed safely: ${error.message}`);
  });
  startAutoScans();
});

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function parseSlateQuery(query, requireSport = true) {
  const sport = requireSport || query.sport ? normalizeSport(query.sport || "mlb") : undefined;
  const slate_type = normalizeSlateType(query.slate_type || "classic");
  const site = normalizeSite(query.site || "draftkings");
  return { sport, slate_type, site };
}

async function runScan({ sport, slate_type, site, query = {}, body = {} }) {
  const adapter = sportAdapters[sport];
  const supabase = getSupabase();

  console.log(`[scan] Starting ${sport} ${slate_type} ${site}`);
  const adapterParams = { ...query, body };
  const slates = await adapter.getSlates(sport, slate_type, site, adapterParams);
  if (!slates.length) {
    const message = "No slate seed data returned by configured legal data sources. Check Tank01/public salary feeds, request body players, and API keys.";
    console.log(`[scan] ${message}`);
    await insertScanLog({ sport, slate_type, status: "empty", message, players_processed: 0 });
    return { sport, slate_type, site, status: "empty", message, inserted_slates: 0, upserted_players: 0 };
  }

  let insertedSlates = 0;
  let upsertedPlayers = 0;
  const scanResults = [];

  for (const slate of slates) {
    console.log(`[scan] Processing slate ${slate.slate_id} - ${slate.slate_name}`);
    const { data: slateRow, error: slateError } = await supabase
      .from("dfs_slates")
      .upsert(stripRaw(slate), { onConflict: "provider,site,sport,slate_type,slate_id" })
      .select()
      .single();

    if (slateError) throw new Error(`Failed to upsert slate ${slate.slate_id}: ${slateError.message}`);
    insertedSlates += 1;

    const adapterParams = { ...query, body, slate, slateRaw: slate.raw, site };
    const rawPlayers = await adapter.getSlatePlayers(sport, slate.slate_id, slate_type, site, adapterParams);
    const adaptedPlayers = rawPlayers.map((player) => adapter.normalizePlayerRow(player.raw || player, sport, slate_type, site));
    assertPlayersMatchSport(adaptedPlayers, sport);
    if (!adaptedPlayers.length) {
      const message = `No players returned for ${sport} ${slate_type} ${site}; keeping existing slate data unchanged. Use the CSV importer or configure a legal salary/projection feed before scanning from the dashboard.`;
      console.log(`[scan] ${message}`);
      await insertScanLog({ sport, slate_type, status: "empty", message, players_processed: 0 });
      return { sport, slate_type, site, status: "empty", message, inserted_slates: insertedSlates, upserted_players: upsertedPlayers, results: scanResults };
    }
    const projectionRows = await adapter.getProjections(sport, slate.slate_id, adapterParams);
    const ownershipRows = await adapter.getOwnership(sport, slate.slate_id, adapterParams);

    const { error: clearPlayersError } = await supabase
      .from("dfs_players")
      .delete()
      .eq("slate_id", slateRow.id);
    if (clearPlayersError) throw new Error(`Failed to clear existing players for slate ${slate.slate_id}: ${clearPlayersError.message}`);

    const projectedPlayers = mergeProjectionRows(adaptedPlayers, projectionRows);
    const ownedPlayers = applyOwnership(projectedPlayers, ownershipRows, { sport, slate_type, site, slateSize: projectedPlayers.length });
    const scoredPlayers = scorePlayers(ownedPlayers, { sport, slate_type, site, slateSize: ownedPlayers.length, salaryCap: slate.salary_cap });
    const finalPlayers = slate_type === "showdown"
      ? calculateShowdownScores(scoredPlayers, { sport, slate_type, site, salaryCap: slate.salary_cap })
      : scoredPlayers;
    const dbReadyPlayers = preserveImportedProjectionValues(finalPlayers, body);

    const playerRows = dbReadyPlayers.map((player) => ({
      ...toDbPlayer(player),
      slate_id: slateRow.id
    }));

    if (playerRows.length) {
      const { error: playerError } = await supabase
        .from("dfs_players")
        .upsert(playerRows, { onConflict: "slate_id,site,player_id,roster_slot" });

      if (playerError) throw new Error(`Failed to upsert players for slate ${slate.slate_id}: ${playerError.message}`);
    }

    upsertedPlayers += playerRows.length;
    scanResults.push({
      slate_id: slate.slate_id,
      slate_name: slate.slate_name,
      players_processed: playerRows.length,
      provider_ownership_rows: ownershipRows.length,
      projection_rows: projectionRows.length
    });
    console.log(`[scan] Finished slate ${slate.slate_id}: ${playerRows.length} players`);
  }

  await insertScanLog({
    sport,
    slate_type,
    status: "success",
    message: `Scanned ${insertedSlates} slates and processed ${upsertedPlayers} players.`,
    players_processed: upsertedPlayers
  });

  return {
    sport,
    slate_type,
    site,
    status: "success",
    inserted_or_updated_slates: insertedSlates,
    inserted_or_updated_players: upsertedPlayers,
    results: scanResults
  };
}

function startAutoScans() {
  if (String(process.env.AUTO_SCAN_ENABLED || "").toLowerCase() !== "true") return;

  const jobs = parseAutoScanJobs();
  if (!jobs.length) {
    console.warn("[auto-scan] AUTO_SCAN_ENABLED=true but no jobs were configured.");
    return;
  }

  const intervalMinutes = Math.max(Number(process.env.AUTO_SCAN_INTERVAL_MINUTES || 30), 5);
  console.log(`[auto-scan] enabled for ${jobs.length} job(s), every ${intervalMinutes} minute(s).`);

  const runAll = () => runAutoScanJobs(jobs).catch((error) => {
    console.warn(`[auto-scan] failed safely: ${error.message}`);
  });

  if (String(process.env.AUTO_SCAN_RUN_ON_START || "true").toLowerCase() !== "false") {
    setTimeout(runAll, 5000);
  }

  setInterval(runAll, intervalMinutes * 60 * 1000);
}

async function runAutoScanJobs(jobs) {
  if (autoScanRunning) {
    console.log("[auto-scan] previous run still active; skipping this interval.");
    return;
  }

  autoScanRunning = true;
  try {
    for (const job of jobs) {
      const date = new Date().toISOString().slice(0, 10);
      const query = { ...job, date };
      console.log(`[auto-scan] ${job.sport} ${job.slate_type} ${job.site}`);
      await runScan({ sport: job.sport, slate_type: job.slate_type, site: job.site, query, body: {} });
    }
  } finally {
    autoScanRunning = false;
  }
}

function parseAutoScanJobs() {
  const rawJobs = process.env.AUTO_SCAN_JOBS;
  if (rawJobs) {
    return rawJobs.split(",").map(parseAutoScanJob).filter(Boolean);
  }

  const sports = splitEnvList(process.env.AUTO_SCAN_SPORTS || "nba");
  const slateType = normalizeSlateType(process.env.AUTO_SCAN_SLATE_TYPE || "classic");
  const site = normalizeSite(process.env.AUTO_SCAN_SITE || "draftkings");
  return sports.map((sport) => ({ sport: normalizeSport(sport), slate_type: slateType, site }));
}

function parseAutoScanJob(rawJob) {
  const parts = String(rawJob || "").trim().split(":");
  if (!parts[0]) return null;
  return {
    sport: normalizeSport(parts[0]),
    slate_type: normalizeSlateType(parts[1] || process.env.AUTO_SCAN_SLATE_TYPE || "classic"),
    site: normalizeSite(parts[2] || process.env.AUTO_SCAN_SITE || "draftkings")
  };
}

function splitEnvList(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function createExportId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function pruneLineupExports() {
  const maxAgeMs = 60 * 60 * 1000;
  const now = Date.now();
  for (const [id, item] of lineupExports.entries()) {
    if (now - item.createdAt > maxAgeMs) lineupExports.delete(id);
  }

  while (lineupExports.size > 50) {
    const oldest = lineupExports.keys().next().value;
    lineupExports.delete(oldest);
  }
}

async function fetchPlayers({ sport, slate_type, site, date, limit = 50, filters = {}, orderBy = "upside_score" }) {
  const supabase = getSupabase();
  const slateIds = await resolveSlateIds({ supabase, sport, slate_type, site, date });
  if (!slateIds.length) return [];

  let query = supabase
    .from("dfs_players")
    .select("*")
    .eq("sport", sport)
    .eq("slate_type", slate_type)
    .eq("site", site)
    .in("slate_id", slateIds)
    .order(orderBy, { ascending: false, nullsFirst: false })
    .limit(readLimit(limit));

  for (const [key, value] of Object.entries(filters)) {
    query = query.eq(key, value);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

async function resolveSlateIds({ supabase, sport, slate_type, site, date }) {
  let query = supabase
    .from("dfs_slates")
    .select("id,slate_id,slate_start_time,created_at")
    .eq("sport", sport)
    .eq("slate_type", slate_type)
    .eq("site", site);

  if (date) {
    query = query.or(`slate_id.ilike.%${date}%,slate_start_time.gte.${date}T00:00:00.000Z`)
      .lt("slate_start_time", `${date}T23:59:59.999Z`);
  }

  query = query.order("created_at", { ascending: false }).limit(date ? 20 : 1);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []).map((slate) => slate.id);
}

function readLimit(limit) {
  const parsed = Number(limit || 50);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(parsed, 500));
}

function assertPlayersMatchSport(players, sport) {
  const mismatches = detectSportMismatches(players, sport);
  if (!mismatches.length) return;

  const details = mismatches.slice(0, 6).map((player) => `${player.player_name} (${player.position || "unknown"})`).join(", ");
  const error = new Error(`Uploaded salary/player data does not look like ${sport.toUpperCase()} data. Examples: ${details}. Use the ${sport.toUpperCase()} DraftKings CSV before scanning this sport.`);
  error.statusCode = 400;
  throw error;
}

function detectSportMismatches(players, sport) {
  const allowedBySport = {
    nba: new Set(["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL", "CPT", "FLEX"]),
    nfl: new Set(["QB", "RB", "WR", "TE", "DST", "DEF", "FLEX", "CPT"]),
    mlb: new Set(["P", "SP", "RP", "C", "1B", "2B", "3B", "SS", "OF", "UTIL", "CPT", "FLEX"]),
    mma: new Set(["F", "FIGHTER", "CPT", "FLEX"]),
    golf: new Set(["G", "GOLFER", "CPT", "FLEX"]),
    nascar: new Set(["D", "DRIVER", "CPT", "FLEX"])
  };
  const allowed = allowedBySport[sport];
  if (!allowed || players.length < 3) return [];

  return players.filter((player) => {
    const tokens = String(player.position || player.roster_slot || "")
      .toUpperCase()
      .split(/[\/,\s]+/)
      .filter(Boolean);
    if (!tokens.length) return false;
    return !tokens.some((token) => allowed.has(token));
  });
}

function stripRaw(row) {
  const { raw, ...clean } = row;
  return clean;
}

function toDbPlayer(player) {
  return {
    sport: player.sport,
    slate_type: player.slate_type,
    site: player.site,
    player_id: player.player_id,
    player_name: player.player_name,
    team: player.team,
    opponent: player.opponent,
    position: player.position,
    roster_slot: Array.isArray(player.roster_slot) ? player.roster_slot.join("/") : player.roster_slot,
    salary: player.salary,
    projected_minutes: player.projected_minutes,
    projection: player.projection,
    floor: player.floor,
    ceiling: player.ceiling,
    boom_pct: player.boom_pct,
    bust_pct: player.bust_pct,
    ownership: player.ownership,
    estimated_ownership: player.estimated_ownership || (player.ownership_source === "estimated" ? player.ownership : null),
    ownership_source: player.ownership_source,
    volatility_score: player.volatility_score,
    salary_value_score: player.salary_value_score,
    upside_score: player.upside_score,
    leverage_score: player.leverage_score,
    contest_fit_tag: player.contest_fit_tag,
    recommended_field_size: player.recommended_field_size,
    single_entry_grade: player.single_entry_grade,
    small_field_grade: player.small_field_grade,
    large_field_grade: player.large_field_grade,
    fake_chalk_warning: player.fake_chalk_warning,
    fake_chalk_reason: player.fake_chalk_reason,
    slate_breaker_tag: player.slate_breaker_tag,
    showdown_captain_score: player.showdown_captain_score,
    showdown_flex_score: player.showdown_flex_score,
    captain_ownership_risk: player.captain_ownership_risk,
    duplication_risk: player.duplication_risk,
    game_script_fit: player.game_script_fit
  };
}

function preserveImportedProjectionValues(players, body = {}) {
  if (!body.preserve_imported_projection) return players;
  const projectionMap = new Map();
  for (const row of [...(body.players || []), ...(body.salaries || [])]) {
    const projection = Number(row.Projection ?? row.projectedPoints);
    if (!Number.isFinite(projection)) continue;
    for (const key of importedProjectionKeys(row)) {
      projectionMap.set(key, projection);
    }
  }

  if (!projectionMap.size) return players;

  return players.map((player) => {
    const projection = projectionMap.get(normalizeProjectionKey(player.player_id)) ||
      projectionMap.get(normalizeProjectionKey(player.player_name));
    if (!Number.isFinite(projection)) return player;
    return {
      ...player,
      projection
    };
  });
}

function importedProjectionKeys(row) {
  return [
    row.PlayerID,
    row.PlayerId,
    row.playerID,
    row.playerId,
    row.id,
    row.PlayerName,
    row.Name,
    row.Player,
    row.playerName,
    row.name
  ].map(normalizeProjectionKey).filter(Boolean);
}

function normalizeProjectionKey(value) {
  return String(value || "").trim().toLowerCase();
}

function toProjectionFeedRow(player, generatedAt) {
  return {
    player_id: player.player_id,
    player_name: player.player_name,
    team: player.team,
    opponent: player.opponent,
    position: player.position,
    roster_slot: player.roster_slot,
    salary: Number(player.salary || 0),
    projected_minutes: Number(player.projected_minutes || 0),
    points: Number(player.projection || 0),
    projection: Number(player.projection || 0),
    floor: Number(player.floor || 0),
    ceiling: Number(player.ceiling || 0),
    boom_pct: Number(player.boom_pct || 0),
    bust_pct: Number(player.bust_pct || 0),
    ownership: Number(player.ownership || 0),
    estimated_ownership: Number(player.estimated_ownership || player.ownership || 0),
    ownership_source: player.ownership_source || "estimated",
    value_score: Number(player.salary_value_score || 0),
    volatility_score: Number(player.volatility_score || 0),
    upside_score: Number(player.upside_score || 0),
    leverage_score: Number(player.leverage_score || 0),
    single_entry_grade: player.single_entry_grade,
    contest_fit_tag: player.contest_fit_tag,
    fake_chalk_warning: Boolean(player.fake_chalk_warning),
    fake_chalk_reason: player.fake_chalk_reason,
    slate_breaker: Boolean(player.slate_breaker_tag),
    showdown_captain_score: Number(player.showdown_captain_score || 0),
    showdown_flex_score: Number(player.showdown_flex_score || 0),
    confidence_score: projectionConfidence(player),
    model_version: "internal-dfs-v1",
    generated_at: generatedAt
  };
}

function projectionConfidence(player) {
  let score = 55;
  if (Number(player.salary) > 0) score += 10;
  if (Number(player.projection) > 0) score += 15;
  if (Number(player.floor) > 0 && Number(player.ceiling) > Number(player.projection || 0)) score += 10;
  if (player.ownership_source === "provider") score += 8;
  if (player.fake_chalk_warning) score -= 6;
  return Math.max(1, Math.min(100, Number(score.toFixed(2))));
}
