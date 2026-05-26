const els = Object.fromEntries(["adminToken","csvFile","date","sport","platform","slateType","contestType","maxEntries","lineupsPlaying","pctPaidToFirst","showRaw","runBtn","search","tierFilter","roleFilter","contestFilter","teamFilter","sort","body","status","insights"].map(id=>[id,document.getElementById(id)]));
els.date.value=new Date().toISOString().slice(0,10); let players=[];
const sortState={key:els.sort.value,dir:'desc'};

els.runBtn.onclick=async()=>{const file=els.csvFile.files[0]; if(!file) return setStatus('Upload CSV first',true); const csv=await file.text(); setStatus('Running...');
const payload={csv,date:els.date.value,sport:els.sport.value.toLowerCase(),platform:els.platform.value.toLowerCase(),slateType:els.slateType.value.toLowerCase(),contestType:els.contestType.value,maxEntries:numOrNull(els.maxEntries.value),lineupsPlaying:numOrNull(els.lineupsPlaying.value),pctPaidToFirst:numOrNull(els.pctPaidToFirst.value),showRawAdminData:els.showRaw.checked};
const r=await fetch('/admin/upside-engine/run',{method:'POST',headers:{'content-type':'application/json','x-admin-token':els.adminToken.value},body:JSON.stringify(payload)}); const j=await r.json(); if(!r.ok) return setStatus(j.message||'Run failed',true); setStatus(`Engine complete: ${j.publicResult.length} players.`); players=j.publicResult; hydrateFilters(); render(); };
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

function row(p){const fixed=harmonizeExplanation(p); return `<tr class='${(p.bestRole||'').toLowerCase()}'><td class='stickyPlayer'>${p.playerName}</td><td>${p.team||''}</td><td>${p.position||''}</td><td>${p.salary}</td><td><span class='roleBadge role-${(p.bestRole||'').toLowerCase()}'>${p.bestRole||''}</span></td><td>${p.contestFit||''}</td><td>${p.captainTier||p.tier||''}</td><td>${pct(p.confidenceRating)}</td><td>${pct(p.boomScore)}</td><td>${pct(p.bustRisk)}</td><td>${pct(p.ownershipLeverageScore)}</td><td>${pct(p.captainScore)}</td><td>${pct(p.flexScore)}</td><td>${pct(p.eliteScore)}</td><td>${p.topValueTag}</td><td>${fixed}</td></tr>`;}
function pct(v){const n=Number(v); return Number.isFinite(n)?`${n}%`:v??'';}
function eliteScore(p){
  const confidence=numOrZero(p.confidenceRating);
  const boom=numOrZero(p.boomScore);
  const leverage=numOrZero(p.ownershipLeverageScore);
  const captain=numOrZero(p.captainScore);
  const flex=numOrZero(p.flexScore);
  const bust=numOrZero(p.bustRisk);
  const raw=(confidence*.26)+(boom*.28)+(leverage*.2)+(captain*.14)+(flex*.12)-(bust*.25);
  return Math.max(0,Math.min(100,Math.round(raw)));
}
function numOrZero(v){const n=Number(v); return Number.isFinite(n)?n:0;}
function renderInsights(rows){
  if(!els.insights) return;
  if(!rows.length){els.insights.innerHTML=''; return;}
  const topElite=rows.reduce((best,p)=>!best||numOrZero(p.eliteScore)>numOrZero(best.eliteScore)?p:best,null);
  const safest=rows.reduce((best,p)=>!best||numOrZero(p.bustRisk)<numOrZero(best.bustRisk)?p:best,null);
  const avgElite=Math.round(rows.reduce((sum,p)=>sum+numOrZero(p.eliteScore),0)/rows.length);
  els.insights.innerHTML=[
    insightCard('Top Elite Play', `${topElite.playerName} (${pct(topElite.eliteScore)})`),
    insightCard('Safest Floor', `${safest.playerName} (${pct(100-numOrZero(safest.bustRisk))} floor)`),
    insightCard('Slate Avg Elite', `${avgElite}% across ${rows.length} players`)
  ].join('');
}
function insightCard(label,value){return `<article class='insightCard'><div class='insightLabel'>${label}</div><div class='insightValue'>${value}</div></article>`;}
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
