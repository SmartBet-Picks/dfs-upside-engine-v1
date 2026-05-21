import "dotenv/config";
import express from "express";
import cors from "cors";
import { getSupabase, insertScanLog } from "./src/supabaseClient.js";
import { CONTEST_TYPES, SUPPORTED_SPORTS, contestFitMatches, inferContestType, normalizeSite, normalizeSlateType, normalizeSport } from "./src/contestRules.js";
import { LegalDataSourceError, sourceHealth, mergeProjectionRows, validateLegalDataSources } from "./src/legalDataClient.js";
import { applyOwnership } from "./src/ownershipEngine.js";
import { rankForContest, scorePlayers } from "./src/scoringEngine.js";
import { calculateShowdownScores } from "./src/showdownEngine.js";
import { sportAdapters } from "./src/sportAdapters/index.js";

const app = express();
const port = Number(process.env.PORT || 3000);

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
  const adapter = sportAdapters[sport];
  const supabase = getSupabase();

  console.log(`[scan] Starting ${sport} ${slate_type} ${site}`);
  const adapterParams = { ...req.query, body: req.body };
  const slates = await adapter.getSlates(sport, slate_type, site, adapterParams);
  if (!slates.length) {
    const message = "No slate seed data returned by configured legal data sources. Check Tank01/public salary feeds, request body players, and API keys.";
    console.log(`[scan] ${message}`);
    await insertScanLog({ sport, slate_type, status: "empty", message, players_processed: 0 });
    return res.json({ sport, slate_type, site, status: "empty", message, inserted_slates: 0, upserted_players: 0 });
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

    const adapterParams = { ...req.query, body: req.body, slate, slateRaw: slate.raw, site };
    const rawPlayers = await adapter.getSlatePlayers(sport, slate.slate_id, slate_type, site, adapterParams);
    const adaptedPlayers = rawPlayers.map((player) => adapter.normalizePlayerRow(player.raw || player, sport, slate_type, site));
    const projectionRows = await adapter.getProjections(sport, slate.slate_id, adapterParams);
    const ownershipRows = await adapter.getOwnership(sport, slate.slate_id, adapterParams);

    const projectedPlayers = mergeProjectionRows(adaptedPlayers, projectionRows);
    const ownedPlayers = applyOwnership(projectedPlayers, ownershipRows, { sport, slate_type, site, slateSize: projectedPlayers.length });
    const scoredPlayers = scorePlayers(ownedPlayers, { sport, slate_type, site, slateSize: ownedPlayers.length, salaryCap: slate.salary_cap });
    const finalPlayers = slate_type === "showdown"
      ? calculateShowdownScores(scoredPlayers, { sport, slate_type, site, salaryCap: slate.salary_cap })
      : scoredPlayers;

    const playerRows = finalPlayers.map((player) => ({
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

  res.json({
    sport,
    slate_type,
    site,
    status: "success",
    inserted_or_updated_slates: insertedSlates,
    inserted_or_updated_players: upsertedPlayers,
    results: scanResults
  });
}));

app.get("/players", asyncHandler(async (req, res) => {
  const { sport, slate_type, site } = parseSlateQuery(req.query, false);
  const players = await fetchPlayers({ sport, slate_type, site, limit: req.query.limit });
  res.json({ sport, slate_type, site, count: players.length, players });
}));

app.get("/top-upside", asyncHandler(async (req, res) => {
  const { sport, slate_type, site } = parseSlateQuery(req.query, false);
  const players = await fetchPlayers({ sport, slate_type, site, limit: req.query.limit, orderBy: "upside_score" });
  res.json({ sport, slate_type, site, count: players.length, players });
}));

app.get("/leverage", asyncHandler(async (req, res) => {
  const { sport, slate_type, site } = parseSlateQuery(req.query, false);
  const players = await fetchPlayers({ sport, slate_type, site, limit: req.query.limit, orderBy: "leverage_score" });
  res.json({ sport, slate_type, site, count: players.length, players });
}));

app.get("/fake-chalk", asyncHandler(async (req, res) => {
  const { sport, slate_type, site } = parseSlateQuery(req.query, false);
  const players = await fetchPlayers({ sport, slate_type, site, limit: req.query.limit, filters: { fake_chalk_warning: true }, orderBy: "ownership" });
  res.json({ sport, slate_type, site, count: players.length, players });
}));

app.get("/single-entry", asyncHandler(async (req, res) => {
  const { sport, slate_type, site } = parseSlateQuery(req.query, false);
  const allPlayers = await fetchPlayers({ sport, slate_type, site, limit: 500 });
  const players = rankForContest(allPlayers, "single_entry", 500).filter((player) => !String(player.single_entry_grade || "").includes("Not")).slice(0, readLimit(req.query.limit));
  res.json({ sport, slate_type, site, count: players.length, players });
}));

app.get("/contest-fit", asyncHandler(async (req, res) => {
  const { sport, slate_type, site } = parseSlateQuery(req.query, false);
  const contestType = inferContestType(req.query.contest_type, req.query.contest_size);
  const contestSize = Number(req.query.contest_size || 500);
  const allPlayers = await fetchPlayers({ sport, slate_type, site, limit: 500 });
  const players = rankForContest(allPlayers, contestType, contestSize)
    .filter((player) => contestFitMatches(player, contestType, contestSize))
    .slice(0, readLimit(req.query.limit));

  res.json({ sport, slate_type, site, contest_type: contestType, contest_size: contestSize, count: players.length, players });
}));

app.get("/showdown-captains", asyncHandler(async (req, res) => {
  const { sport, slate_type, site } = parseSlateQuery({ ...req.query, slate_type: req.query.slate_type || "showdown" }, false);
  const players = await fetchPlayers({ sport, slate_type, site, limit: req.query.limit, orderBy: "showdown_captain_score" });
  res.json({ sport, slate_type, site, count: players.length, players });
}));

app.get("/showdown-flex", asyncHandler(async (req, res) => {
  const { sport, slate_type, site } = parseSlateQuery({ ...req.query, slate_type: req.query.slate_type || "showdown" }, false);
  const players = await fetchPlayers({ sport, slate_type, site, limit: req.query.limit, orderBy: "showdown_flex_score" });
  res.json({ sport, slate_type, site, count: players.length, players });
}));

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

  res.status(500).json({
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

async function fetchPlayers({ sport, slate_type, site, limit = 50, filters = {}, orderBy = "upside_score" }) {
  const supabase = getSupabase();
  let query = supabase
    .from("dfs_players")
    .select("*")
    .eq("sport", sport)
    .eq("slate_type", slate_type)
    .eq("site", site)
    .order(orderBy, { ascending: false, nullsFirst: false })
    .limit(readLimit(limit));

  for (const [key, value] of Object.entries(filters)) {
    query = query.eq(key, value);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

function readLimit(limit) {
  const parsed = Number(limit || 50);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(parsed, 500));
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
