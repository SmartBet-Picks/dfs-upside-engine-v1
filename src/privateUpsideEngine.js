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
  minutes: ["minutes", "mins", "projected_minutes"]
};

const state = { latest: null };

export function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) return res.status(500).json({ error: true, message: "ADMIN_API_TOKEN not configured." });
  if (req.headers["x-admin-token"] !== ADMIN_TOKEN) return res.status(401).json({ error: true, message: "Unauthorized admin token." });
  next();
}

export function runPrivateUpsideEngine(req, res) {
  const { csv, date, sport, platform, slateType, contestType, showRawAdminData = false } = req.body || {};
  if (!csv || !date || !sport || !platform || !slateType || !contestType) return res.status(400).json({ error: true, message: "Missing required fields." });
  const rows = parseCsv(csv);
  const mapped = mapRows(rows);
  const scored = scoreRows(mapped, { slateType, contestType });
  const publicResult = scored.map(toPublicResult);
  const adminResult = scored.map((p) => showRawAdminData ? p : toPublicResult(p));

  state.latest = { metadata: { date, sport, platform, slateType, contestType, generatedAt: new Date().toISOString() }, publicResult, adminResult };
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
function mapRows(rows) { return rows.map((row, idx) => ({ id: idx + 1, name: findField(row, "name"), team: findField(row, "team"), opponent: findField(row, "opponent"), position: findField(row, "position"), salary: num(findField(row, "salary")), projection: num(findField(row, "projection")), ceiling: num(findField(row, "ceiling")), floor: num(findField(row, "floor")), ownership: num(findField(row, "ownership")), boom: num(findField(row, "boom")), bust: num(findField(row, "bust")), value: num(findField(row, "value")), captain_projection: num(findField(row, "captain_projection")), flex_projection: num(findField(row, "flex_projection")), minutes: num(findField(row, "minutes")) })); }
function num(v){const n=Number(String(v||"").replace(/[%$]/g,"")); return Number.isFinite(n)?n:0;}
function norm(rows,key,invert=false){const vals=rows.map(r=>r[key]);const min=Math.min(...vals),max=Math.max(...vals),d=max-min||1;rows.forEach(r=>{const s=((r[key]-min)/d)*100;r[`${key}_n`]=Math.max(0,Math.min(100,invert?100-s:s));});}
function scoreRows(rows,{slateType,contestType}){["projection","ceiling","value","ownership","boom","bust","salary","minutes","floor"].forEach(k=>norm(rows,k,k==="ownership"||k==="salary"||k==="bust"));
return rows.map((r)=>{const confidence=clamp(0.36*r.projection_n+0.24*r.minutes_n+0.22*r.value_n+0.18*r.floor_n);const boomScore=clamp(0.38*r.ceiling_n+0.27*r.boom_n+0.20*r.projection_n+0.15*r.salary_n);const bustRiskScore=clamp(0.28*(100-r.floor_n)+0.23*(100-r.value_n)+0.2*(100-r.minutes_n)+0.17*(100-r.salary_n)+0.12*(100-r.ownership_n));const leverageScore=clamp(0.5*boomScore+0.5*r.ownership_n);const captainScore=clamp(0.35*r.ceiling_n+0.25*r.projection_n+0.20*r.salary_n+0.20*leverageScore);const flexScore=clamp(0.32*r.value_n+0.28*r.projection_n+0.22*(100-bustRiskScore)+0.18*r.salary_n);
const bustRisk=bustRiskScore>=67?"High":bustRiskScore>=40?"Medium":"Low"; const fade= (bustRiskScore>70 && boomScore<50) || (r.ownership<30?false:boomScore<55);
const role = fade?"Fade": captainScore>78?"Captain": flexScore>74?"Flex": confidence>80?"Core": r.salary_n>70&&r.value_n>60?"Value": leverageScore>72?"Leverage":"Flex";
const tier = fade?"Tier 5: Fade Candidate": boomScore>82&&captainScore>75?"Tier 1: Slate Breaker": confidence>76&&bustRisk!=="High"?"Tier 2: Strong Core": r.value_n>65?"Tier 3: Value / Salary Saver":"Tier 4: Risky Leverage";
const contestFit = slateType==="showdown"? (captainScore>flexScore?"Showdown":"3-Max") : contestType;
return {...r, confidenceRating:round(confidence), boomScore:round(boomScore), bustRisk, ownershipLeverageScore:round(leverageScore), captainScore:round(captainScore), flexScore:round(flexScore), topValueTag:r.value_n>75?"Yes":"No", bestRole:role, tier, contestFit, explanation:buildExplanation(role,contestFit,bustRisk)};});}
function toPublicResult(r){return { playerName:r.name, team:r.team, position:r.position, salary:r.salary, bestRole:r.bestRole, contestFit:r.contestFit, tier:r.tier, confidenceRating:r.confidenceRating, boomScore:r.boomScore, bustRisk:r.bustRisk, ownershipLeverageScore:r.ownershipLeverageScore, captainScore:r.captainScore, flexScore:r.flexScore, topValueTag:r.topValueTag, explanation:r.explanation };}
const clamp=(n)=>Math.max(1,Math.min(100,n)); const round=(n)=>Math.round(clamp(n));
function buildExplanation(role,fit,bust){ if(role==="Fade") return `Fade candidate for ${fit} contests because the risk outweighs the upside.`; if(role==="Captain") return `Strong ${fit} leverage play with Captain upside, but ${bust.toLowerCase()} bust risk.`; if(role==="Flex") return `Better suited as a Flex play because salary efficiency is strong but slate-breaking upside is limited.`; return `Solid ${fit} option with a balanced projection, value, and risk profile.`; }
