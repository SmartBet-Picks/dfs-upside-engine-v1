const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN || "";

const COLUMN_ALIASES = {
  name: ["name", "name_id", "player", "player_name", "athlete", "fighter", "fighter_name"],
  team: ["team", "tm"],
  opponent: ["opponent", "opp", "game_info", "matchup"],
  position: ["position", "pos", "roster_position"],
  salary: ["salary", "sal", "cost"],
  projection: ["projection", "proj", "fpts", "fantasy_points", "avgpointspergame", "avg_points_per_game", "fppg"],
  ceiling: ["ceiling", "ceil", "projected_ceiling", "fantasy_ceiling", "boom_ceiling", "ceiling_projection"],
  floor: ["floor"],
  ownership: ["ownership", "own", "ownership_pct"],
  boom: ["boom", "boom_pct"],
  bust: ["bust", "bust_pct"],
  value: ["value", "val", "pts_per_dollar"],
  captain_projection: ["captain_projection", "captain_proj", "cpt_projection"],
  flex_projection: ["flex_projection", "flex_proj"],
  game: ["game", "matchup"],
  minutes: ["minutes", "mins", "projected_minutes"],
  game_total: ["game_total", "vegas_total", "total", "o_u", "over_under"],
  team_total: ["team_total", "implied_total", "itt"],
  spread: ["spread", "line", "vegas_spread"],
  pace: ["pace", "pace_factor", "game_pace"],
  starter: ["starter", "is_starter", "starting", "start"],
  usage: ["usage", "usage_rate", "usg", "usg_pct"],
  volatility: ["volatility", "std_dev", "stdev", "sigma"]
};

const state = { latest: null };

export function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) return res.status(503).json({ error: true, message: "Admin runner is temporarily unavailable." });
  if (req.headers["x-admin-token"] !== ADMIN_TOKEN) return res.status(401).json({ error: true, message: "Unauthorized admin token." });
  next();
}

export function runPrivateUpsideEngine(req, res) {
  const { csv, date, sport, platform, slateType, contestType, maxEntries, lineupsPlaying, pctPaidToFirst, showRawAdminData = false } = req.body || {};
  if (!csv || !date || !sport || !platform || !slateType || !contestType) return res.status(400).json({ error: true, message: "Missing required fields." });
  const { rows, diagnostics } = parseCsv(csv);
  if (!rows.length) return res.status(400).json({ error: true, message: "CSV contains no data rows." });
  const normalizedSlateType = normalizeSlateType(slateType);
  const normalizedSport = normalizeSport(sport);
  const normalizedPlatform = normalizePlatform(platform);
  const mapped = mapRows(rows);
  const rawTopCeilingPlayers = [...mapped]
    .sort((a, b) => b.ceiling - a.ceiling)
    .slice(0, 8)
    .map((p) => ({ name: p.name, team: p.team, rawCeiling: p.ceiling, projection: p.projection, ownership: p.ownership, bust: p.bust, salary: p.salary }));
  const { eligiblePlayers, excludedPlayers } = splitEligiblePlayers(mapped);
  const scored = scoreRows(eligiblePlayers, { slateType: normalizedSlateType, contestType, maxEntries, lineupsPlaying, pctPaidToFirst });
  const captainDebugTop = [...scored]
    .sort((a, b) => b.ceiling - a.ceiling)
    .slice(0, 8)
    .map((p) => ({
      player: p.name,
      raw_ceiling: round(p.ceiling),
      normalized_ceiling: round(p.ceiling_n),
      leverage: round(p.ownershipLeverageScore),
      captain_bonuses: p.captainBonus,
      final_captain_score: p.captainScore,
      inputs: {
        projection_n: round(p.projection_n),
        boom_n: round(p.boom_n),
        salary_n: round(p.salary_n),
        ownership_n: round(p.ownership_n),
        environment_n: round(p.environmentScore)
      }
    }));
  if (showRawAdminData) {
    console.log("[PRIVATE_UPSIDE] CSV raw ceiling leaders:", rawTopCeilingPlayers);
    console.table(captainDebugTop.map((p) => ({
      player: p.player,
      raw_ceiling: p.raw_ceiling,
      normalized_ceiling: p.normalized_ceiling,
      leverage: p.leverage,
      captain_bonuses: p.captain_bonuses,
      final_captain_score: p.final_captain_score
    })));
  }
  const publicResult = scored.map(toPublicResult);
  const adminResult = scored.map((p) => showRawAdminData ? p : toPublicResult(p));
  const bestPlay = recommendBestPlay(scored, normalizedSlateType);
  const lineups = buildPrivateLineups(scored, { sport: normalizedSport, platform: normalizedPlatform, slateType: normalizedSlateType, lineupsPlaying, maxEntries });

  state.latest = {
    metadata: {
      date,
      sport: normalizedSport,
      platform: normalizedPlatform,
      slateType: normalizedSlateType,
      contestType,
      maxEntries: toNullableNumber(maxEntries),
      lineupsPlaying: toNullableNumber(lineupsPlaying),
      pctPaidToFirst: toNullableNumber(pctPaidToFirst),
      generatedAt: new Date().toISOString(),
      csvDiagnostics: diagnostics,
      bestPlay,
      bestCaptain: normalizedSlateType === "showdown" ? bestPlay : null,
      excludedPlayers: excludedPlayers.map(({ id, name, team, position, projection, minutes, exclusionReason }) => ({ id, name, team, position, projection, minutes, exclusionReason })),
      excludedPlayerCount: excludedPlayers.length,
      ...(showRawAdminData ? {
        rawTopCeilingPlayers,
        captainDebugTop
      } : {})
    },
    publicResult,
    adminResult,
    lineups
  };
  res.json({ ...state.latest, adminRawIncluded: Boolean(showRawAdminData) });
}

function normalizeSlateType(value) {
  const normalized = String(value || "classic").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["showdown", "single_game", "single"].includes(normalized)) return "showdown";
  return "classic";
}
function normalizeSport(value) { return String(value || "").trim().toLowerCase(); }
function normalizePlatform(value) { return String(value || "draftkings").trim().toLowerCase(); }
function normalizeContestLabel(value) {
  const raw = String(value || "Classic").trim();
  const key = raw.toLowerCase().replace(/[_-]+/g, " ");
  if (key === "single entry") return "Single Entry";
  if (key === "3 max" || key === "3-max") return "3-Max";
  if (key === "small field") return "Small Field";
  if (key === "large field gpp") return "Large Field GPP";
  if (key === "mini max" || key === "mini-max") return "Mini-MAX";
  return raw || "Classic";
}

export function getLatestPublicUpside(req, res) {
  if (!state.latest) return res.status(404).json({ error: true, message: "No processed slate found." });
  res.json({ metadata: state.latest.metadata, count: state.latest.publicResult.length, players: state.latest.publicResult });
}

function parseCsv(csv) {
  const records = parseCsvRecords(csv);
  if (!records.length) return { rows: [], diagnostics: { required: [], unknownHeaders: [], missingByRow: [], duplicatePlayers: [] } };
  const headers = records[0].map(normalizeKey);
  const required = ["name", "salary", "projection"];
  const requiredDiagnostics = required.map((field) => ({ field, found: hasHeaderAlias(headers, field) }));
  const missingRequired = requiredDiagnostics.filter((entry) => !entry.found).map((entry) => entry.field);
  if (missingRequired.length) {
    throw new Error(`Missing required CSV columns: ${missingRequired.join(", ")}.`);
  }
  const rows = records.slice(1).map((vals) => {
    const row = {};
    headers.forEach((h, i) => (row[h] = vals[i] ?? ""));
    return row;
  }).filter((row) => Object.values(row).some((value) => String(value || "").trim() !== ""));

  const unknownHeaders = headers.filter((header) => !Object.keys(COLUMN_ALIASES).some((canonical) => COLUMN_ALIASES[canonical].some((alias) => header === normalizeKey(alias))));
  const missingByRow = rows.flatMap((row, index) => required.map((field) => ({ field, row: index + 2, missing: !String(findField(row, field) || "").trim() }))).filter((entry) => entry.missing);
  const duplicatePlayers = findDuplicatePlayers(rows);

  const columnMatches = Object.fromEntries(
    Object.keys(COLUMN_ALIASES).map((canonical) => [canonical, detectMatchedHeaders(headers, canonical)])
  );

  return {
    rows,
    diagnostics: {
      required: requiredDiagnostics,
      unknownHeaders,
      columnMatches,
      missingByRow,
      duplicatePlayers
    }
  };
}
function parseCsvRecords(csv) {
  const text = String(csv || "").replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const n = text[i + 1];
    if (c === '"') {
      if (inQuotes && n === '"') {
        value += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && c === ',') {
      row.push(value.trim());
      value = "";
      continue;
    }
    if (!inQuotes && (c === "\n" || c === "\r")) {
      if (c === "\r" && n === "\n") i += 1;
      row.push(value.trim());
      if (row.some((cell) => String(cell).length)) rows.push(row);
      row = [];
      value = "";
      continue;
    }
    value += c;
  }
  if (value.length || row.length) {
    row.push(value.trim());
    if (row.some((cell) => String(cell).length)) rows.push(row);
  }
  return rows;
}
function hasHeaderAlias(headers, canonical) {
  return headers.some((header) => COLUMN_ALIASES[canonical].some((alias) => header === normalizeKey(alias)));
}
function detectMatchedHeaders(headers, canonical) {
  return headers.filter((header) => COLUMN_ALIASES[canonical].some((alias) => header.includes(normalizeKey(alias))));
}
function findDuplicatePlayers(rows) {
  const seen = new Map();
  const duplicates = [];
  rows.forEach((row, index) => {
    const key = [findField(row, "name"), findField(row, "team"), findField(row, "position")].map((v) => normalizeKey(v || "")).join("|");
    if (!key.replace(/\|/g, "")) return;
    const existing = seen.get(key);
    if (existing) {
      duplicates.push({ key, firstRow: existing, duplicateRow: index + 2 });
    } else {
      seen.set(key, index + 2);
    }
  });
  return duplicates;
}
function normalizeKey(key) { return String(key || "").toLowerCase().replace(/[^a-z0-9]+/g, "_"); }
function findField(row, canonical) { const aliases = COLUMN_ALIASES[canonical]; const key = Object.keys(row).find((k) => aliases.some((a) => k.includes(a))); return row[key] ?? ""; }
function mapRows(rows) {
  return rows.map((row, idx) => ({
    id: idx + 1,
    name: findField(row, "name"),
    team: findField(row, "team"),
    opponent: findField(row, "opponent"),
    position: findField(row, "position"),
    salary: num(findField(row, "salary")),
    projection: num(findField(row, "projection")),
    ceiling: num(findField(row, "ceiling")),
    floor: num(findField(row, "floor")),
    ownership: num(findField(row, "ownership")),
    boom: num(findField(row, "boom")),
    bust: num(findField(row, "bust")),
    value: num(findField(row, "value")),
    captain_projection: num(findField(row, "captain_projection")),
    flex_projection: num(findField(row, "flex_projection")),
    minutes: num(findField(row, "minutes")),
    game_total: num(findField(row, "game_total")),
    team_total: num(findField(row, "team_total")),
    spread: num(findField(row, "spread")),
    pace: num(findField(row, "pace")),
    usage: num(findField(row, "usage")),
    volatility: num(findField(row, "volatility")),
    isStarter: bool(findField(row, "starter")),
    raw: row
  }));
}
function num(v){const n=Number(String(v||"").replace(/[%$,]/g,"")); return Number.isFinite(n)?n:0;}
function splitEligiblePlayers(rows) {
  const excludedPlayers = [];
  const eligiblePlayers = [];
  rows.forEach((row) => {
    const noProjection = row.projection <= 0;
    const noMinutes = row.minutes <= 0;
    if (noProjection && noMinutes) {
      excludedPlayers.push({ ...row, exclusionReason: "Excluded: no projected fantasy points and no projected minutes." });
      return;
    }
    eligiblePlayers.push(row);
  });
  return { eligiblePlayers, excludedPlayers };
}
function bool(v){return /^(1|true|yes|y|starter)$/i.test(String(v||"").trim());}
function norm(rows,key,invert=false){
  const vals=rows.map(r=>r[key]).filter((v)=>Number.isFinite(v));
  const min=vals.length?Math.min(...vals):0;
  const max=vals.length?Math.max(...vals):0;
  const hasRange=(max-min)!==0;
  rows.forEach(r=>{
    const raw = Number.isFinite(r[key]) ? r[key] : min;
    const base = hasRange ? ((raw - min) / (max - min)) * 100 : 50;
    const n = invert ? 100 - base : base;
    r[`${key}_n`]=Math.max(0,Math.min(100,n));
  });
}
function scoreRows(rows,{slateType,contestType,maxEntries,lineupsPlaying,pctPaidToFirst}){const settings = buildContestSettings({ maxEntries, lineupsPlaying, pctPaidToFirst });["projection","ceiling","value","ownership","boom","bust","salary","minutes","floor","game_total","team_total","pace"].forEach(k=>norm(rows,k,k==="ownership"||k==="salary"||k==="bust"));
norm(rows,"usage");
norm(rows,"volatility",true);
const spreadVals = rows.map(r=>Math.abs(r.spread));
const hasSpread = spreadVals.some(v=>v>0);
if (hasSpread) {
  const min = Math.min(...spreadVals);
  const max = Math.max(...spreadVals);
  const d = max - min || 1;
  rows.forEach((r, i) => {
    const closeness = ((spreadVals[i] - min) / d) * 100;
    r.spread_n = Math.max(0, Math.min(100, 100 - closeness));
  });
} else {
  rows.forEach((r)=>{r.spread_n=50;});
}
const rankedCeilingRows = [...rows]
  .filter((r)=>r.ceiling>0)
  .sort((a,b)=>b.ceiling-a.ceiling);
const topCeilingThreshold = rankedCeilingRows[2]?.ceiling ?? Number.POSITIVE_INFINITY;
const top5CeilingThreshold = rankedCeilingRows[4]?.ceiling ?? Number.POSITIVE_INFINITY;
const top2Projection = new Set([...rows]
  .map((r,idx)=>({idx,val:r.projection||0}))
  .sort((a,b)=>b.val-a.val)
  .slice(0,2)
  .map(({idx})=>idx));
const top2Ceiling = new Set([...rows]
  .map((r,idx)=>({idx,val:r.ceiling||0}))
  .sort((a,b)=>b.val-a.val)
  .slice(0,2)
  .map(({idx})=>idx));
const top8Projection = new Set([...rows]
  .map((r,idx)=>({idx,val:r.projection||0}))
  .sort((a,b)=>b.val-a.val)
  .slice(0,8)
  .map(({idx})=>idx));
const top8Ceiling = new Set([...rows]
  .map((r,idx)=>({idx,val:r.ceiling||0}))
  .sort((a,b)=>b.val-a.val)
  .slice(0,8)
  .map(({idx})=>idx));
const top8Boom = new Set([...rows]
  .map((r,idx)=>({idx,val:r.boom||0}))
  .sort((a,b)=>b.val-a.val)
  .slice(0,8)
  .map(({idx})=>idx));
return rows.map((r,idx)=>{const environmentScore=clamp(0.35*r.game_total_n+0.35*r.team_total_n+0.2*r.pace_n+0.1*r.spread_n);const confidence=clamp(0.33*r.projection_n+0.2*r.minutes_n+0.2*r.value_n+0.15*r.floor_n+0.12*environmentScore);const boomScore=clamp(0.3*r.ceiling_n+0.22*r.boom_n+0.18*r.projection_n+0.12*r.salary_n+0.1*environmentScore+0.08*r.usage_n);const bustRiskScore=clamp(0.26*(100-r.floor_n)+0.21*(100-r.value_n)+0.2*(100-r.minutes_n)+0.15*(100-r.salary_n)+0.1*(100-r.ownership_n)+0.08*(100-r.volatility_n));const upsideScore=clamp(0.46*r.ceiling_n+0.28*boomScore+0.16*r.projection_n+0.1*environmentScore);const ownershipDiscount=clamp(100-r.ownership_n);
let leverageScore=clamp(upsideScore*(ownershipDiscount/100)*settings.leverageBoost);
if(upsideScore<50) leverageScore=Math.min(leverageScore,35);
const inferredStarter = r.isStarter || r.minutes >= 26 || (r.salary_n >= 62 && r.projection_n >= 60);
const salaryAdjustedUpside = clamp((0.7*r.ceiling_n)+(0.3*r.salary_n));
let captainScore=clamp(0.48*r.ceiling_n+0.14*r.projection_n+0.18*leverageScore+0.08*salaryAdjustedUpside+0.1*boomScore+0.02*environmentScore+settings.captainBoost);
const topCeilingPlayer = r.ceiling >= topCeilingThreshold && r.ceiling > 0;
const top5CeilingPlayer = r.ceiling >= top5CeilingThreshold && r.ceiling > 0;
const strongLevCeil = leverageScore >= 65 && r.ceiling_n >= 70;
const uniqueBuild = r.salary_n >= 48 && r.salary_n <= 72 && r.ceiling_n >= 60;
const lowUpsidePath = r.minutes > 0 && r.minutes < 18 || r.projection > 0 && r.projection < 12 || r.ceiling > 0 && r.ceiling < 40;
const cheapSaverOnly = r.salary_n >= 76 && r.ceiling_n < 58;
const weakCeilingBust = bustRiskScore >= 72 && r.ceiling_n < 56;
const catastrophicProfile = (bustRiskScore >= 88 && leverageScore < 38) || (r.minutes > 0 && r.minutes < 12);
if (topCeilingPlayer) captainScore += 15;
else if (top5CeilingPlayer) captainScore += 8;
if (strongLevCeil) captainScore += 8;
if (uniqueBuild) captainScore += 5;
if (lowUpsidePath && !top5CeilingPlayer) captainScore -= 8;
if (cheapSaverOnly && !top5CeilingPlayer) captainScore -= 5;
if (weakCeilingBust && !top5CeilingPlayer) captainScore -= 6;
if (topCeilingPlayer && !catastrophicProfile) captainScore = Math.max(captainScore, 60);
if (top5CeilingPlayer && !catastrophicProfile) captainScore = Math.max(captainScore, 52);
const top8CaptainSignal = top8Projection.has(idx) || top8Ceiling.has(idx) || top8Boom.has(idx);
const strongRoleSignal = inferredStarter || r.minutes >= 28 || (r.projection_n >= 62 && r.minutes_n >= 58);
const hasTrueCeilingPath = top8CaptainSignal || strongRoleSignal;
const valueOnlyCaptain = r.value_n >= 74 && r.ceiling_n < 62 && !top8CaptainSignal;
if (!hasTrueCeilingPath) captainScore = Math.min(captainScore, 51);
if (valueOnlyCaptain) captainScore = Math.min(captainScore, 51);
captainScore=clamp(captainScore);
const flexScore=clamp(0.34*r.value_n+0.28*r.projection_n+0.24*(100-bustRiskScore)+0.1*r.salary_n+0.04*r.minutes_n-settings.flexPenalty);
const bustRisk=bustRiskScore>=67?"High":bustRiskScore>=40?"Medium":"Low";
const lowMinuteRisk = r.minutes > 0 && r.minutes < 10;
const lowProjectionRisk = r.projection > 0 && r.projection < 4;
const starterSignal = inferredStarter || r.minutes >= 18 || r.projection_n >= 58 || r.salary_n >= 55;
const severePunt = (r.minutes > 0 && r.minutes < 10) || (r.projection > 0 && r.projection < 3);
const nonViablePunt = severePunt || ((lowMinuteRisk || lowProjectionRisk) && !starterSignal);
const playoffStudSignal = r.salary_n > 68 && r.projection_n > 70;
const environmentFloor = environmentScore >= 62;
const fade= nonViablePunt || (bustRiskScore>70 && boomScore<50 && !environmentFloor && !starterSignal) || (r.ownership<30?false:boomScore<55 && !playoffStudSignal && !environmentFloor && !starterSignal);
const top2RawSignal = top2Projection.has(idx) || top2Ceiling.has(idx);
const isShowdown = slateType === "showdown";
const captainTier = isShowdown ? getCaptainTier(captainScore, top2RawSignal) : "Classic";
const classicTier = getClassicTier(confidence, upsideScore, leverageScore, bustRiskScore);
const role = isShowdown
  ? (fade?"Fade": captainScore>=60?"Captain": flexScore>74?"Flex": confidence>80?"Core": r.salary_n>70&&r.value_n>60?"Value": leverageScore>72?"Leverage":"Flex")
  : (fade?"Fade": confidence>=82?"Core": upsideScore>=72?"Upside": leverageScore>=72?"Leverage": r.value_n>=70?"Value":"Pool");
const tier = isShowdown ? captainTier : classicTier;
const contestFit = isShowdown ? (captainScore>flexScore?"Showdown":"3-Max") : normalizeContestLabel(contestType);
const captainBonus = (topCeilingPlayer ? 15 : top5CeilingPlayer ? 8 : 0) + (strongLevCeil ? 8 : 0) + (uniqueBuild ? 5 : 0) - ((lowUpsidePath && !top5CeilingPlayer) ? 8 : 0) - ((cheapSaverOnly && !top5CeilingPlayer) ? 5 : 0) - ((weakCeilingBust && !top5CeilingPlayer) ? 6 : 0);
const explanation = isShowdown
  ? buildShowdownExplanation({ captainTier, captainScore: round(captainScore), ceilingScore: round(r.ceiling_n), leverageScore: round(leverageScore), lowUpsidePath, cheapSaverOnly, weakCeilingBust, top8CaptainSignal, strongRoleSignal, valueOnlyCaptain, upsideScore: round(upsideScore) })
  : buildClassicExplanation({ tier: classicTier, role, confidence: round(confidence), upsideScore: round(upsideScore), leverageScore: round(leverageScore), bustRisk, valueScore: round(r.value_n) });
return {...r, slateFormat: isShowdown ? "showdown" : "classic", confidenceRating:round(confidence), contestAggression: settings.aggression, environmentScore: round(environmentScore), boomScore:round(boomScore), bustRisk, ownershipLeverageScore:round(leverageScore), captainScore: isShowdown ? round(captainScore) : 0, captainTier, flexScore: isShowdown ? round(flexScore) : 0, topValueTag:r.value_n>75?"Yes":"No", bestRole:role, tier, contestFit, nonViablePunt, captainBonus: isShowdown ? round(captainBonus) : 0, classicScore: round(0.38*confidence+0.32*upsideScore+0.18*leverageScore+0.12*r.value_n), explanation};});}
function toPublicResult(r){return { playerName:r.name, team:r.team, position:r.position, salary:r.salary, slateFormat:r.slateFormat, bestRole:r.bestRole, contestFit:r.contestFit, tier:r.tier, captainTier:r.captainTier, confidenceRating:r.confidenceRating, environmentScore:r.environmentScore, boomScore:r.boomScore, bustRisk:r.bustRisk, ownershipLeverageScore:r.ownershipLeverageScore, captainScore:r.captainScore, flexScore:r.flexScore, classicScore:r.classicScore, topValueTag:r.topValueTag, explanation:r.explanation };}
const clamp=(n)=>Math.max(1,Math.min(100,n)); const round=(n)=>Math.round(clamp(n));
function buildShowdownExplanation({ captainTier, captainScore, ceilingScore, leverageScore, lowUpsidePath, cheapSaverOnly, weakCeilingBust, top8CaptainSignal, strongRoleSignal, valueOnlyCaptain, upsideScore }){ if(captainTier==="Elite Captain") return "Elite ceiling captain: top-tier raw upside with enough role security to justify heavy multiplier exposure."; if(captainTier==="Strong Captain" && leverageScore>=62) return "Leverage captain with real upside: low ownership is supported by true boom/ceiling pathways."; if(captainTier==="Strong Captain") return "Strong captain profile: high-end ceiling and stable role make this more than a flex-only build."; if(captainTier==="Viable Captain" && top8CaptainSignal) return `Viable captain via true-ceiling path (top-8 signal) with playable upside (${upsideScore}).`; if(captainTier==="Viable Captain" && strongRoleSignal) return "Viable captain from strong minutes/role floor, but below elite raw ceiling outcomes."; if(valueOnlyCaptain||cheapSaverOnly) return "Salary saver profile: useful for flex construction, but capped at thin captain without top-tier ceiling."; if(lowUpsidePath||weakCeilingBust) return "Avoid captain: minutes/projection/ceiling risk is too fragile for a winning multiplier build."; return `Thin captain only: modest ceiling (${ceilingScore}) and leverage (${leverageScore}) keep this as a secondary exposure.`; }
function getCaptainTier(captainScore, top2RawSignal=false){if(captainScore>=75) return "Elite Captain"; if(captainScore>=58 || (top2RawSignal && captainScore>=58)) return "Strong Captain"; if(captainScore>=48) return "Viable Captain"; if(captainScore>=35) return "Thin Captain"; return "Avoid Captain";}


function getClassicTier(confidence, upsideScore, leverageScore, bustRiskScore) {
  if (confidence >= 82 && upsideScore >= 70) return "Classic Core";
  if (upsideScore >= 76 || leverageScore >= 78) return "Classic Upside";
  if (bustRiskScore <= 38 && confidence >= 62) return "Classic Safe";
  if (confidence >= 52 || upsideScore >= 52) return "Classic Pool";
  return "Classic Thin";
}
function buildClassicExplanation({ tier, role, confidence, upsideScore, leverageScore, bustRisk, valueScore }) {
  if (role === "Fade") return `Classic fade: ${bustRisk.toLowerCase()} bust profile does not offer enough confidence (${confidence}) or upside (${upsideScore}).`;
  if (tier === "Classic Core") return `Classic core play: strong confidence (${confidence}) and slate-winning upside (${upsideScore}) fit six-fighter builds.`;
  if (tier === "Classic Upside") return `Classic tournament play: upside (${upsideScore}) and leverage (${leverageScore}) make this fighter useful in GPP builds.`;
  if (tier === "Classic Safe") return `Classic salary/floor play: lower bust risk with playable confidence (${confidence}) for balanced six-fighter lineups.`;
  if (role === "Value") return `Classic value option: value score (${valueScore}) helps make salary work, but keep exposure tied to lineup construction.`;
  return `Classic pool option: viable secondary exposure with confidence ${confidence}, upside ${upsideScore}, and leverage ${leverageScore}.`;
}

function toNullableNumber(v){const n=Number(v); return Number.isFinite(n)?n:null;}
function recommendBestPlay(scoredRows, slateType) {
  const isShowdown = String(slateType || "").toLowerCase() === "showdown";
  const captainPool = (scoredRows || []).filter((row) => !row.nonViablePunt);
  if (!captainPool.length) return null;

  const ranked = [...captainPool].sort((a, b) => {
    if (isShowdown) {
      if (b.captainScore !== a.captainScore) return b.captainScore - a.captainScore;
      if (b.boomScore !== a.boomScore) return b.boomScore - a.boomScore;
      return b.ownershipLeverageScore - a.ownershipLeverageScore;
    }
    if (b.projection !== a.projection) return b.projection - a.projection;
    if (b.ceiling !== a.ceiling) return b.ceiling - a.ceiling;
    return b.ownershipLeverageScore - a.ownershipLeverageScore;
  });

  const top = ranked[0];
  return {
    playerName: top.name,
    team: top.team,
    position: top.position,
    salary: top.salary,
    captainScore: top.captainScore,
    boomScore: top.boomScore,
    ownershipLeverageScore: top.ownershipLeverageScore,
    reasoning: isShowdown
      ? "Top showdown captain score among viable players, with tie-breakers on boom score and leverage."
      : "Top classic play by projection among viable players, with tie-breakers on ceiling and leverage."
  };
}
function buildPrivateLineups(scoredRows, { sport, platform, slateType, lineupsPlaying, maxEntries }) {
  const lineupCount = Math.max(1, Math.min(20, toNullableNumber(lineupsPlaying) || toNullableNumber(maxEntries) || 6));
  const salaryCap = salaryCapForPlatform(platform);
  const pool = [...(scoredRows || [])]
    .filter((player) => !player.nonViablePunt && player.salary > 0)
    .sort((a, b) => lineupPlayerScore(b, slateType) - lineupPlayerScore(a, slateType))
    .slice(0, slateType === "showdown" ? 18 : 24);

  if (slateType === "showdown") return buildShowdownLineups(pool, { lineupCount, salaryCap });
  return buildClassicLineups(pool, { sport, lineupCount, salaryCap });
}
function buildClassicLineups(pool, { sport, lineupCount, salaryCap }) {
  const rosterSize = ["mma", "golf", "nascar"].includes(sport) ? 6 : Math.min(6, pool.length);
  const candidates = [];
  forEachCombo(pool, rosterSize, (players) => {
    const salary = sumBy(players, "salary");
    if (salary > salaryCap) return;
    candidates.push(toLineup(players.map((player, index) => ({ ...lineupPublicPlayer(player), slot: classicSlotForSport(sport, index) })), salary, salaryCap, "Classic Build"));
  });
  return rankLineups(candidates, lineupCount);
}
function buildShowdownLineups(pool, { lineupCount, salaryCap }) {
  const candidates = [];
  for (const captain of pool.slice(0, 12)) {
    const flexPool = pool.filter((player) => player.id !== captain.id);
    forEachCombo(flexPool, 5, (flexPlayers) => {
      const salary = captain.salary * 1.5 + sumBy(flexPlayers, "salary");
      if (salary > salaryCap) return;
      const players = [
        { ...lineupPublicPlayer(captain), slot: "CPT", salary: Math.round(captain.salary * 1.5), projection: roundMetric(captain.projection * 1.5) },
        ...flexPlayers.map((player, index) => ({ ...lineupPublicPlayer(player), slot: `FLEX${index + 1}` }))
      ];
      candidates.push(toLineup(players, salary, salaryCap, "Showdown Build"));
    });
  }
  return rankLineups(candidates, lineupCount);
}
function rankLineups(candidates, lineupCount) {
  return candidates
    .sort((a, b) => b.objective_score - a.objective_score)
    .filter((lineup, index, all) => all.findIndex((item) => item.lineup_id === lineup.lineup_id) === index)
    .slice(0, lineupCount)
    .map((lineup, index) => ({ ...lineup, rank: index + 1 }));
}
function toLineup(players, salary, salaryCap, archetype) {
  const projection = roundMetric(sumBy(players, "projection"));
  const ceiling = roundMetric(sumBy(players, "ceiling"));
  const leverage = roundMetric(avgBy(players, "ownershipLeverageScore"));
  const confidence = roundMetric(avgBy(players, "confidenceRating"));
  const objective = roundMetric(projection * 0.44 + ceiling * 0.22 + leverage * 0.18 + confidence * 0.16);
  return {
    lineup_id: players.map((player) => `${player.slot}:${player.playerName}`).join("|"),
    salary: Math.round(salary),
    salary_left: Math.max(0, Math.round(salaryCap - salary)),
    projection,
    ceiling,
    leverage_rating: leverage,
    stability_rating: confidence,
    volatility_rating: roundMetric(avgBy(players, "boomScore")),
    objective_score: objective,
    archetype,
    archetype_reason: archetype === "Classic Build" ? "Six-fighter classic lineup under the salary cap." : "Captain plus five flex lineup under the salary cap.",
    duplication_risk: salaryCap - salary < 500 ? "Medium" : "Low",
    stack_type: archetype === "Classic Build" ? "Classic" : "Showdown",
    players
  };
}
function lineupPublicPlayer(player) {
  return {
    playerName: player.name,
    team: player.team,
    position: player.position,
    salary: player.salary,
    projection: roundMetric(player.projection),
    ceiling: roundMetric(player.ceiling || player.projection),
    confidenceRating: player.confidenceRating,
    boomScore: player.boomScore,
    ownershipLeverageScore: player.ownershipLeverageScore,
    bestRole: player.bestRole,
    tier: player.tier
  };
}
function classicSlotForSport(sport, index) {
  if (sport === "mma") return `F${index + 1}`;
  if (sport === "golf") return `G${index + 1}`;
  if (sport === "nascar") return `D${index + 1}`;
  return `UTIL${index + 1}`;
}
function lineupPlayerScore(player, slateType) {
  if (slateType === "showdown") return (player.captainScore || 0) * 0.35 + (player.flexScore || 0) * 0.25 + player.boomScore * 0.2 + player.ownershipLeverageScore * 0.2;
  return (player.classicScore || 0) * 0.45 + player.projection * 0.25 + player.boomScore * 0.15 + player.ownershipLeverageScore * 0.15;
}
function forEachCombo(items, size, visit, start = 0, combo = []) {
  if (combo.length === size) return visit([...combo]);
  for (let i = start; i <= items.length - (size - combo.length); i += 1) {
    combo.push(items[i]);
    forEachCombo(items, size, visit, i + 1, combo);
    combo.pop();
  }
}
function salaryCapForPlatform(platform) { return platform === "fanduel" ? 60000 : 50000; }
function sumBy(rows, key) { return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0); }
function avgBy(rows, key) { return rows.length ? sumBy(rows, key) / rows.length : 0; }
function roundMetric(value) { return Number((Number(value) || 0).toFixed(2)); }

function buildContestSettings({ maxEntries, lineupsPlaying, pctPaidToFirst }) {
  const max = Math.max(1, toNullableNumber(maxEntries) || 1);
  const lineups = Math.max(1, toNullableNumber(lineupsPlaying) || 1);
  const firstPct = Math.max(0, toNullableNumber(pctPaidToFirst) || 0);
  const entryShare = Math.min(1, lineups / max);
  const topHeavy = Math.max(0, Math.min(1, (firstPct - 12) / 20));
  const underEntered = 1 - entryShare;
  const aggression = Math.max(0, Math.min(1, 0.6 * topHeavy + 0.4 * underEntered));
  return {
    aggression: Math.round(aggression * 100),
    leverageBoost: 1 + aggression * 0.2,
    captainBoost: aggression * 5,
    flexPenalty: aggression * 4
  };
}
