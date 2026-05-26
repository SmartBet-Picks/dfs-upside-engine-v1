const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN || "";

const COLUMN_ALIASES = {
  name: ["name", "player", "player_name", "athlete"],
  team: ["team", "tm"],
  opponent: ["opponent", "opp"],
  position: ["position", "pos"],
  salary: ["salary", "sal", "cost"],
  projection: ["projection", "proj", "fpts", "fantasy_points"],
  ceiling: ["ceiling", "ceil"],
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
  if (!ADMIN_TOKEN) return res.status(500).json({ error: true, message: "ADMIN_API_TOKEN not configured." });
  if (req.headers["x-admin-token"] !== ADMIN_TOKEN) return res.status(401).json({ error: true, message: "Unauthorized admin token." });
  next();
}

export function runPrivateUpsideEngine(req, res) {
  const { csv, date, sport, platform, slateType, contestType, maxEntries, lineupsPlaying, pctPaidToFirst, showRawAdminData = false } = req.body || {};
  if (!csv || !date || !sport || !platform || !slateType || !contestType) return res.status(400).json({ error: true, message: "Missing required fields." });
  const rows = parseCsv(csv);
  const mapped = mapRows(rows);
  const scored = scoreRows(mapped, { slateType, contestType, maxEntries, lineupsPlaying, pctPaidToFirst });
  const publicResult = scored.map(toPublicResult);
  const adminResult = scored.map((p) => showRawAdminData ? p : toPublicResult(p));

  state.latest = { metadata: { date, sport, platform, slateType, contestType, maxEntries: toNullableNumber(maxEntries), lineupsPlaying: toNullableNumber(lineupsPlaying), pctPaidToFirst: toNullableNumber(pctPaidToFirst), generatedAt: new Date().toISOString() }, publicResult, adminResult };
  res.json({ ...state.latest, adminRawIncluded: Boolean(showRawAdminData) });
}

export function getLatestPublicUpside(req, res) {
  if (!state.latest) return res.status(404).json({ error: true, message: "No processed slate found." });
  res.json({ metadata: state.latest.metadata, count: state.latest.publicResult.length, players: state.latest.publicResult });
}

function parseCsv(csv) {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  const headers = splitCsvLine(lines[0]).map(normalizeKey);
  return lines.slice(1).map((line) => {
    const vals = splitCsvLine(line);
    const row = {};
    headers.forEach((h, i) => (row[h] = vals[i] ?? ""));
    return row;
  });
}
function splitCsvLine(line) { const out=[]; let cur="",q=false; for(let i=0;i<line.length;i++){const c=line[i]; if(c==='"'){q=!q; continue;} if(c===','&&!q){out.push(cur.trim()); cur="";} else cur+=c;} out.push(cur.trim()); return out; }
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
function num(v){const n=Number(String(v||"").replace(/[%$]/g,"")); return Number.isFinite(n)?n:0;}
function bool(v){return /^(1|true|yes|y|starter)$/i.test(String(v||"").trim());}
function norm(rows,key,invert=false){
  const vals=rows.map(r=>r[key]).filter((v)=>Number.isFinite(v));
  const min=Math.min(...vals),max=Math.max(...vals);
  const hasRange = Number.isFinite(min) && Number.isFinite(max) && max !== min;
  rows.forEach((r)=>{
    const base = hasRange ? ((r[key]-min)/(max-min))*100 : 50;
    const s = invert ? 100-base : base;
    r[`${key}_n`]=Math.max(0,Math.min(100,s));
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
return rows.map((r)=>{const environmentScore=clamp(0.35*r.game_total_n+0.35*r.team_total_n+0.2*r.pace_n+0.1*r.spread_n);const confidence=clamp(0.33*r.projection_n+0.2*r.minutes_n+0.2*r.value_n+0.15*r.floor_n+0.12*environmentScore);const boomScore=clamp(0.3*r.ceiling_n+0.22*r.boom_n+0.18*r.projection_n+0.12*r.salary_n+0.1*environmentScore+0.08*r.usage_n);const bustRiskScore=clamp(0.26*(100-r.floor_n)+0.21*(100-r.value_n)+0.2*(100-r.minutes_n)+0.15*(100-r.salary_n)+0.1*(100-r.ownership_n)+0.08*(100-r.volatility_n));const leverageScore=clamp((0.42*boomScore+0.42*r.ownership_n+0.08*environmentScore+0.08*r.usage_n)*settings.leverageBoost);
const inferredStarter = r.isStarter || r.minutes >= 28 || (r.salary_n >= 66 && r.projection_n >= 64);
const starterCaptainBoost = inferredStarter ? 7 : -8;
const nonStarterCptPenalty = (!inferredStarter && (r.minutes > 0 && r.minutes < 20)) ? 10 : 0;
const captainScore=clamp(0.33*r.ceiling_n+0.24*r.projection_n+0.16*r.salary_n+0.17*leverageScore+0.1*r.usage_n+starterCaptainBoost-nonStarterCptPenalty+settings.captainBoost);const flexScore=clamp(0.32*r.value_n+0.28*r.projection_n+0.22*(100-bustRiskScore)+0.12*r.salary_n+0.06*r.minutes_n-settings.flexPenalty);
const bustRisk=bustRiskScore>=67?"High":bustRiskScore>=40?"Medium":"Low";
const lowMinuteRisk = r.minutes > 0 && r.minutes < 8;
const lowProjectionRisk = r.projection > 0 && r.projection < 4;
const starterSignal = inferredStarter || r.minutes >= 18 || r.projection_n >= 58 || r.salary_n >= 55;
const severePunt = (r.minutes > 0 && r.minutes < 6) || (r.projection > 0 && r.projection < 3);
const nonViablePunt = severePunt || ((lowMinuteRisk || lowProjectionRisk) && !starterSignal);
const playoffStudSignal = r.salary_n > 68 && r.projection_n > 70;
const environmentFloor = environmentScore >= 62;
const fade= nonViablePunt || (bustRiskScore>70 && boomScore<50 && !environmentFloor && !starterSignal) || (r.ownership<30?false:boomScore<55 && !playoffStudSignal && !environmentFloor && !starterSignal);
const role = fade?"Fade": captainScore>78?"Captain": flexScore>74?"Flex": confidence>80?"Core": r.salary_n>70&&r.value_n>60?"Value": leverageScore>72?"Leverage":"Flex";
const tier = fade?"Tier 5: Fade Candidate": boomScore>82&&captainScore>75?"Tier 1: Slate Breaker": confidence>76&&bustRisk!=="High"?"Tier 2: Strong Core": r.value_n>65?"Tier 3: Value / Salary Saver":"Tier 4: Risky Leverage";
const contestFit = slateType==="showdown" ? "Showdown" : contestType;
return {...r, confidenceRating:round(confidence), contestAggression: settings.aggression, environmentScore: round(environmentScore), boomScore:round(boomScore), bustRisk, ownershipLeverageScore:round(leverageScore), captainScore:round(captainScore), flexScore:round(flexScore), topValueTag:r.value_n>75?"Yes":"No", bestRole:role, tier, contestFit, nonViablePunt, explanation:buildExplanation(role,contestFit,bustRisk,nonViablePunt,round(environmentScore))};});}
function toPublicResult(r){return { playerName:r.name, team:r.team, position:r.position, salary:r.salary, bestRole:r.bestRole, contestFit:r.contestFit, tier:r.tier, confidenceRating:r.confidenceRating, environmentScore:r.environmentScore, boomScore:r.boomScore, bustRisk:r.bustRisk, ownershipLeverageScore:r.ownershipLeverageScore, captainScore:r.captainScore, flexScore:r.flexScore, topValueTag:r.topValueTag, explanation:r.explanation };}
const clamp=(n)=>Math.max(1,Math.min(100,n)); const round=(n)=>Math.round(clamp(n));
function buildExplanation(role,fit,bust,nonViablePunt=false,environmentScore=50){ if(nonViablePunt) return `Avoid in ${fit}: projection/minutes are too low for realistic upside.`; if(role==="Fade") return `Fade candidate for ${fit} contests because the risk outweighs the upside in this game environment (${environmentScore}/100).`; if(role==="Captain") return `Strong ${fit} leverage play with Captain upside, ${bust.toLowerCase()} bust risk, and supportive game environment (${environmentScore}/100).`; if(role==="Flex") return `Better suited as a Flex play: salary efficiency is stronger than slate-breaking upside, with environment score ${environmentScore}/100.`; return `Solid ${fit} option with a balanced projection, value, risk profile, and game environment (${environmentScore}/100).`; }

function toNullableNumber(v){const n=Number(v); return Number.isFinite(n)?n:null;}
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
