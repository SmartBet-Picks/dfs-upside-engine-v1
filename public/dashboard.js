const els = Object.fromEntries(["adminToken","csvFile","date","sport","platform","slateType","contestType","maxEntries","lineupsPlaying","pctPaidToFirst","contestName","contestId","entryFee","fieldSize","yourEntries","prizePool","firstPlacePrize","paidSpots","percentFieldPaid","lateSwapEnabled","slateName","slateStartTime","topHeavyPayoutScore","duplicationRiskTarget","showRaw","runBtn","search","tierFilter","roleFilter","contestFilter","teamFilter","sort","body","status","insights","lineupCards"].map(id=>[id,document.getElementById(id)]));
els.date.value=new Date().toISOString().slice(0,10); let players=[];
const sortState={key:els.sort.value,dir:'desc'};
els.slateType.onchange=()=>{sortState.key=els.slateType.value.toLowerCase()==='classic'?'classicScore':'captainScore'; els.sort.value=sortState.key; render();};

els.runBtn.onclick=async()=>{const file=els.csvFile.files[0]; if(!file) return setStatus('Upload projection CSV first',true); const csv=await file.text(); setStatus('Running with projection CSV...');
const contestProfile=buildContestProfile(); const payload={csv,date:els.date.value,sport:els.sport.value.toLowerCase(),platform:els.platform.value.toLowerCase(),slateType:els.slateType.value.toLowerCase(),contestType:els.contestType.value,maxEntries:numOrNull(els.maxEntries.value),lineupsPlaying:numOrNull(els.lineupsPlaying.value),pctPaidToFirst:numOrNull(els.pctPaidToFirst.value),contestProfile,showRawAdminData:els.showRaw.checked};
const r=await fetch('/admin/upside-engine/run',{method:'POST',headers:{'content-type':'application/json','x-admin-token':els.adminToken.value},body:JSON.stringify(payload)}); const j=await r.json(); if(!r.ok) return setStatus(j.message||'Run failed',true); setStatus(`Engine complete: ${j.publicResult.length} players.`); players=j.publicResult; window.lastLineups=j.lineups||[]; hydrateFilters(); render(); };
["search","tierFilter","roleFilter","contestFilter","teamFilter","sort"].forEach(k=>els[k].oninput=render);
document.querySelectorAll('th[data-sort]').forEach(th=>th.onclick=()=>toggleSort(th.dataset.sort));

async function loadPublic(){const r=await fetch('/api/upside/public'); if(!r.ok) return; const j=await r.json(); players=j.players||[]; hydrateFilters(); render();}
function hydrateFilters(){fill(els.tierFilter,[...new Set(players.map(p=>p.tier))],'Tier: All'); fill(els.roleFilter,[...new Set(players.map(p=>p.bestRole))],'Role: All'); fill(els.contestFilter,[...new Set(players.map(p=>p.contestFit))],'Contest: All'); fill(els.teamFilter,[...new Set(players.map(p=>p.team))],'Team: All');}
function fill(el,vals,label){const cur=el.value; el.innerHTML=`<option value=''>${label}</option>`+vals.filter(Boolean).sort().map(v=>`<option>${v}</option>`).join(''); el.value=cur;}

function render(){let rows=[...players]; const q=els.search.value.toLowerCase(); if(q) rows=rows.filter(p=>Object.values(p).some(v=>String(v).toLowerCase().includes(q))); if(els.tierFilter.value) rows=rows.filter(p=>p.tier===els.tierFilter.value); if(els.roleFilter.value) rows=rows.filter(p=>p.bestRole===els.roleFilter.value); if(els.contestFilter.value) rows=rows.filter(p=>p.contestFit===els.contestFilter.value); if(els.teamFilter.value) rows=rows.filter(p=>p.team===els.teamFilter.value);
rows=rows.map(p=>({...p,eliteScore:eliteScore(p)}));
const s=sortState.key;
rows.sort((a,b)=>sortByKey(a,b,s,sortState.dir));
els.body.innerHTML=rows.map(row).join('');
renderInsights(rows);
renderLineupCards();
updateSortIndicators();
}

function sortByKey(a,b,key,dir){
  const av=normalizeSortValue(a[key]);
  const bv=normalizeSortValue(b[key]);
  if(av<bv) return dir==='asc'?-1:1;
  if(av>bv) return dir==='asc'?1:-1;
  return 0;
}
function normalizeSortValue(v){if(v==null) return ''; const n=Number(v); return Number.isFinite(n)?n:String(v).toLowerCase();}
function toggleSort(key){if(sortState.key===key){sortState.dir=sortState.dir==='desc'?'asc':'desc';}else{sortState.key=key; sortState.dir='desc';} render();}
function updateSortIndicators(){document.querySelectorAll('th[data-sort]').forEach(th=>{th.classList.remove('sorted'); th.textContent=th.textContent.replace(/\s[↑↓]$/,''); if(th.dataset.sort===sortState.key){th.classList.add('sorted'); th.textContent=`${th.textContent.replace(/\s[↑↓]$/,'')} ${sortState.dir==='desc'?'↓':'↑'}`;}});}

function row(p){const fixed=harmonizeExplanation(p); const env=p.environmentTag||p.game_environment_tag||'Neutral Environment'; return `<tr class='${(p.bestRole||'').toLowerCase()}'><td class='stickyPlayer col-player'>${p.playerName}</td><td class='col-secondary'>${p.slateFormat||''}</td><td class='col-team'>${p.team||''}</td><td class='col-pos'>${p.position||''}</td><td class='col-salary'>${p.salary}</td><td class='col-role'><span class='roleBadge role-${(p.bestRole||'').toLowerCase()}'>${p.bestRole||''}</span></td><td class='col-fit'>${p.contestFit||''}</td><td class='col-secondary'>${p.captainTier||p.captain_tier||p.tier||''}</td><td class='col-env'><span class='envBadge'>${env}</span></td><td class='col-score'>${pct(p.confidenceRating)}</td><td class='col-score'>${pct(p.boomScore)}</td><td class='col-score'>${pct(p.bustRisk)}</td><td class='col-score'>${pct(p.ownershipLeverageScore)}</td><td class='col-score'>${pct(p.classicScore)}</td><td class='col-score'>${pct(p.exactContestScore)}</td><td class='col-secondary'>${pct(p.captainScore||p.showdown_captain_score)}</td><td class='col-secondary'>${pct(p.flexScore||p.showdown_flex_score)}</td><td class='col-score'>${pct(p.eliteScore)}</td><td class='col-value'>${p.topValueTag||''}</td><td class='col-explanation explanationCell'>${p.premium_explanation||fixed}</td></tr>`;}
function pct(v){const n=Number(v); return Number.isFinite(n)?`${n}%`:v??'';}
function eliteScore(p){
  const confidence=numOrZero(p.confidenceRating);
  const boom=numOrZero(p.boomScore);
  const leverage=numOrZero(p.ownershipLeverageScore);
  const captain=numOrZero(p.captainScore);
  const flex=numOrZero(p.flexScore);
  const classic=numOrZero(p.classicScore);
  const bust=numOrZero(p.bustRiskScore ?? p.bustRisk);
  const raw=(confidence*.22)+(boom*.24)+(leverage*.18)+(classic*.16)+(captain*.1)+(flex*.1)-(bust*.25);
  return Math.max(0,Math.min(100,Math.round(raw)));
}
function numOrZero(v){const n=Number(v); return Number.isFinite(n)?n:0;}
function renderInsights(rows){
  if(!els.insights) return;
  if(!rows.length){els.insights.innerHTML=''; return;}
  const topElite=rows.reduce((best,p)=>!best||numOrZero(p.eliteScore)>numOrZero(best.eliteScore)?p:best,null);
  const safest=rows.reduce((best,p)=>!best||floorSafetyScore(p)>floorSafetyScore(best)?p:best,null);
  const topExact=rows.reduce((best,p)=>!best||numOrZero(p.exactContestScore)>numOrZero(best.exactContestScore)?p:best,null);
  const avgElite=Math.round(rows.reduce((sum,p)=>sum+numOrZero(p.eliteScore),0)/rows.length);
  els.insights.innerHTML=[
    insightCard('Top Elite Play', `${topElite.playerName} (${pct(topElite.eliteScore)})`),
    insightCard('Exact Contest', `${topExact.playerName} (${pct(topExact.exactContestScore)})`),
    insightCard('Safest Floor', `${safest.playerName} (${pct(floorSafetyScore(safest))} floor)`),
    insightCard('Slate Avg Elite', `${avgElite}% across ${rows.length} players`)
  ].join('');
}
function insightCard(label,value){return `<article class='insightCard'><div class='insightLabel'>${label}</div><div class='insightValue'>${value}</div></article>`;}
function floorSafetyScore(p){
  const explicit=Number(p.floorSafetyScore);
  if(Number.isFinite(explicit)) return explicit;
  return 100-numOrZero(p.bustRiskScore);
}
function harmonizeExplanation(p){
  const contest=p.contestFit||'';
  let text=String(p.explanation||'');
  if(!contest||!text) return text;
  const contestRegex=/(single entry|3-max|small field|large field gpp|mini-max|showdown)/ig;
  const matches=[...text.matchAll(contestRegex)].map(m=>m[0]);
  if(matches.length && matches.some(m=>m.toLowerCase()!==contest.toLowerCase())){
    text=text.replace(contestRegex,contest);
  }
  return text;
}
function setStatus(m,e){els.status.textContent=m; els.status.className=e?'error':'';}
loadPublic();

function numOrNull(v){const n=Number(v); return Number.isFinite(n)?n:null;}
function strOrNull(v){const s=String(v||'').trim(); return s||null;}
function boolOrNull(v){if(v==='') return null; return v==='true';}
function buildContestProfile(){return {site:els.platform.value.toLowerCase(),contestName:strOrNull(els.contestName.value),contestId:strOrNull(els.contestId.value),entryFee:numOrNull(els.entryFee.value),fieldSize:numOrNull(els.fieldSize.value),maxEntries:numOrNull(els.maxEntries.value),yourEntries:numOrNull(els.yourEntries.value)||numOrNull(els.lineupsPlaying.value),prizePool:numOrNull(els.prizePool.value),firstPlacePrize:numOrNull(els.firstPlacePrize.value),percentPaidToFirst:numOrNull(els.pctPaidToFirst.value),paidSpots:numOrNull(els.paidSpots.value),percentFieldPaid:numOrNull(els.percentFieldPaid.value),contestType:els.contestType.value,lateSwapEnabled:boolOrNull(els.lateSwapEnabled.value),slateName:strOrNull(els.slateName.value),slateStartTime:strOrNull(els.slateStartTime.value),topHeavyPayoutScore:numOrNull(els.topHeavyPayoutScore.value),duplicationRiskTarget:strOrNull(els.duplicationRiskTarget.value)};}

function renderLineupCards(){ if(!els.lineupCards) return; const cards=(window.lastLineups||[]).slice(0,12); if(!cards.length){els.lineupCards.innerHTML=''; return;} els.lineupCards.innerHTML=cards.map(l=>`<article class='lineupCard'><div><strong>${l.archetype||'Balanced Build'}</strong> <span class='dup ${String(l.duplication_risk||'').toLowerCase()}'>${l.duplication_risk||'Medium'} Dup</span></div><div>${l.archetype_reason||''}</div><div>Salary ${l.salary} | Left ${l.salary_left||0} | ${l.stack_type||''}</div><div class='meters'><span>Ceiling ${pct(l.ceiling_rating)}</span><span>Leverage ${pct(l.leverage_rating)}</span><span>Vol ${pct(l.volatility_rating)}</span></div></article>`).join(''); }
