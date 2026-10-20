
const RD_TEAMS={
"49ers":["sf","#AA1926"],Bears:["chi","#C8381A"],Bengals:["cin","#FB4F14"],Bills:["buf","#1957A6"],Broncos:["den","#EF6323"],Browns:["cle","#A84918"],Buccaneers:["tb","#C42132"],Cardinals:["ari","#9B1839"],Chargers:["lac","#158EC2"],Chiefs:["kc","#C8102E"],Colts:["ind","#14559C"],Commanders:["wsh","#773141"],Cowboys:["dal","#5478A5"],Dolphins:["mia","#008F95"],Eagles:["phi","#006F62"],Falcons:["atl","#A61E30"],Giants:["nyg","#194997"],Jaguars:["jax","#047F83"],Jets:["nyj","#176A45"],Lions:["det","#168BC8"],Packers:["gb","#237249"],Panthers:["car","#168ACC"],Patriots:["ne","#325A82"],Raiders:["lv","#606978"],Rams:["lar","#2459B2"],Ravens:["bal","#553E87"],Saints:["no","#A48A55"],Seahawks:["sea","#2D6672"],Steelers:["pit","#B68913"],Texans:["hou","#18405D"],Titans:["ten","#497DA9"],Vikings:["min","#603C9D"]};
const rdNorm=v=>String(v||"").toLowerCase().replace(/[^a-z0-9]/g,"");
function rdTeam(name){const n=rdNorm(name);return Object.keys(RD_TEAMS).find(k=>rdNorm(k)===n||n.endsWith(rdNorm(k))||RD_TEAMS[k][0]===n)||null}
const rdColor=p=>p.game==="NFL"&&rdTeam(p.team)?RD_TEAMS[rdTeam(p.team)][1]:tc(p.team);
const rdAbbr=p=>rdTeam(p.team)?RD_TEAMS[rdTeam(p.team)][0].toUpperCase():abbr(p.team);
const rdCache=new Map(),rdPending=new Set();
let rdDetailId=null;
const rdClaimKey="pickslip-promo-claims-v2";
function rdClaims(){try{return JSON.parse(localStorage.getItem(rdClaimKey)||"{}")}catch(e){return {}}}
function rdHasClaim(id,started){const k=String(myId||"guest")+":"+id+":"+started;return !!rdClaims()[k]}
window.pickslipHasPromo=(id)=>rdPromoList().some(p=>p.id===id&&rdHasClaim(id,p.start));
function rdDayStart(date){return new Date(date.getFullYear(),date.getMonth(),date.getDate()).getTime()}
function rdPromoList(){
 const now=new Date(),start=rdDayStart(now),end=start+86400000,t=today(),o=[];
 const add=(id,icon,title,desc,from=start)=>{const until=from+86400000;if(Date.now()>=from&&Date.now()<until)o.push({id,icon,title,desc,start:from,end:until})};
 if(promo.prot&&!entries.some(e=>(e.day||myDay(e.ts))===t))add("prot","🛡️","First entry protection","Protect your first eligible paid slip today.");
 if(promo.taco&&now.getDay()===2)add("taco","🌮","Taco Tuesday","Special Tuesday player lines.");
 if(promo.flexfri&&now.getDay()===5)add("flexfri","🔥","Flex Friday",`Flex payout boost of ${Math.round((promo.fboost-1)*100)}%.`);
 if(promo.boostOn)add("boost","⚡","Payout boost",`${promo.boostPct}% boost for eligible picks.`);
 (promo.events||[]).forEach((ev,i)=>{if(ev.from&&ev.to&&ev.from<=t&&ev.to>=t){const d=new Date(ev.from+"T00:00:00");if(!isNaN(d))add("event-"+i,"🎉",ev.title,`${ev.pct}% payout boost.`,d.getTime())}});
 return o;
}
function rdClock(ms){const s=Math.max(0,Math.ceil(ms/1000));return [Math.floor(s/3600),Math.floor(s%3600/60),s%60].map(n=>String(n).padStart(2,"0")).join(":")}
function rdColorFor(end,start,now){const elapsed=now-start;return elapsed<28800000?"green":elapsed<57600000?"yellow":"red"}
function rdPromoBanner(){
 const list=rdPromoList(),next=list.filter(p=>!rdHasClaim(p.id,p.start)).sort((a,b)=>a.end-b.end)[0];
 return `<button class="rd-promocard" type="button" data-promobox="1"><span class="rd-gift">🎁</span><span class="rd-promotext"><strong>View Promo Rewards</strong><small>${list.length} available reward${list.length===1?"":"s"}${next?" · Ending soon":""}</small></span><span class="rd-arrow">›</span></button>`;
}
function rdShowPromos(){
 const rows=rdPromoList().map(p=>{
  const claimed=rdHasClaim(p.id,p.start),phase=rdColorFor(p.end,p.start,Date.now());
  return `<div class="rd-promoitem rd-promo-${phase}" data-promo-id="${esc(p.id)}" data-start="${p.start}" data-end="${p.end}"><span>${p.icon}</span><div class="rd-promo-info"><b>${esc(p.title)}</b><small>${esc(p.desc)}</small><div class="rd-promo-timer" data-promo-clock="${p.end}">⏱ ${rdClock(p.end-Date.now())}</div></div><button class="rd-promo-claim" data-rdclaim="${esc(p.id)}" data-rdstart="${p.start}" ${claimed?"disabled":""}>${claimed?"Claimed ✓":"Opt in"}</button></div>`;
 }).join("");
 $("panel").innerHTML=`<div class="rd-sheet-handle"></div><button class="rd-close" data-closepanel="1" aria-label="Close">×</button><h2>Promo Rewards</h2><p class="rd-note">Opt in to each reward before its 24-hour window expires. Timers use your device's local time. Green: first 8 hours · yellow: next 8 · red: final 8.</p>${rows||'<p class="rd-note">No rewards are available right now.</p>'}<p class="rd-note">Claims are saved on this device. An opt-in does not guarantee a winning entry.</p>`;
 $("sheet").classList.add("open");
}
function rdClaimPromo(id,started){
 const p=rdPromoList().find(p=>p.id===id&&p.start===Number(started));
 if(!p||Date.now()>=p.end){rdShowPromos();return}
 const claims=rdClaims();claims[String(myId||"guest")+":"+id+":"+p.start]=true;
 try{localStorage.setItem(rdClaimKey,JSON.stringify(claims))}catch(e){alert("Unable to save your opt-in on this device.");return}
 rdShowPromos();toast("Reward opted in");
}
function rdTickPromos(){
 const panel=$("panel");if(!panel||!$("sheet").classList.contains("open"))return;
 const clocks=panel.querySelectorAll("[data-promo-clock]");
 clocks.forEach(el=>{
  const row=el.closest("[data-promo-id]");if(!row)return;
  const end=Number(row.dataset.end),start=Number(row.dataset.start),now=Date.now();
  if(now>=end){rdShowPromos();return}
  el.textContent="⏱ "+rdClock(end-now);
  row.classList.remove("rd-promo-green","rd-promo-yellow","rd-promo-red");
  row.classList.add("rd-promo-"+rdColorFor(end,start,now));
 });
}
setInterval(rdTickPromos,1000);
function rdFetchRoster(team){
 if(!team||rdCache.has(team)||rdPending.has(team))return;
 rdPending.add(team);
 fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/"+RD_TEAMS[team][0]+"/roster")
 .then(r=>{if(!r.ok)throw Error("roster");return r.json()})
 .then(d=>{
  const map=new Map();
  (d.athletes||[]).flatMap(group=>Array.isArray(group.items)?group.items:[]).forEach(a=>{
   const name=rdNorm(a.displayName||a.fullName),id=String(a.id||"");
   if(name&&/^\d+$/.test(id))map.set(name,a.headshot&&a.headshot.href||"https://a.espncdn.com/i/headshots/nfl/players/full/"+id+".png");
  });
  rdCache.set(team,map);rdApplyPhotos();
 }).catch(()=>rdCache.set(team,new Map())).finally(()=>rdPending.delete(team));
}
function rdHeadshot(p){
 let url=p.headshotUrl||p.photoUrl||p.imageUrl||p.headshot;
 if(typeof url==="object")url=url.href;
 if(typeof url==="string"&&/^https:\/\/[^"'<>\s]+$/.test(url))return url;
 if(/^\d+$/.test(String(p.espnId||"")))return "https://a.espncdn.com/i/headshots/nfl/players/full/"+p.espnId+".png";
 const team=rdTeam(p.team);if(team)rdFetchRoster(team);
 return (rdCache.get(team)||new Map()).get(rdNorm(p.name))||"";
}
function rdApplyPhotos(){
 document.querySelectorAll("img[data-rd-player]").forEach(im=>{
  const url=(rdCache.get(im.dataset.rdTeam)||new Map()).get(rdNorm(im.dataset.rdPlayer));
  if(url&&!im.getAttribute("src"))im.src=url;
 });
}
function rdPhoto(p,large){
 const team=rdTeam(p.team),url=rdHeadshot(p),logo=team?"https://a.espncdn.com/i/teamlogos/nfl/500/"+RD_TEAMS[team][0]+".png":"";
 return `<div class="rd-photo ${large?"rd-photo-large":""}" style="--team:${esc(rdColor(p))}">
 <span class="rd-initial">${esc(ini(p.name||"?"))}</span>
 ${logo?`<img class="rd-logo" src="${esc(logo)}" loading="lazy" alt="" onerror="this.style.display='none'">`:""}
 <img class="rd-headshot" ${url?`src="${esc(url)}"`:""} data-rd-player="${esc(p.name)}" data-rd-team="${esc(team||"")}" alt="${esc(p.name)}" loading="lazy" onload="this.classList.add('ready')" onerror="this.classList.remove('ready');this.removeAttribute('src')">
 </div>`;
}
function rdFilters(){
 if(gf!=="NFL"||bsub==="teams")return"";
 const ps=Object.values(players).filter(p=>!isTeam(p)&&p.game==="NFL"),weeks=[...new Set(ps.map(p=>p.week).filter(Boolean))].sort((a,b)=>a-b),stats=[...new Set(ps.map(p=>p.stat).filter(Boolean))].sort();
 return `<div class="rd-filters"><label>Week <select id="rd-week" aria-label="Week"><option value="All">All</option>${weeks.map(w=>`<option value="${esc(w)}" ${String(w)===wf?"selected":""}>Week ${w}</option>`).join("")}</select></label><label>Stat <select id="rd-stat" aria-label="Stat"><option value="All">All</option>${stats.map(s=>`<option value="${esc(s)}" ${s===sf?"selected":""}>${esc(s)}</option>`).join("")}</select></label><button title="Clear filters" data-rdreset="1">☷</button></div>`;
}
function redesignedBoard(){
 const T=bsub==="teams",games=["NFL","NBA","MLB","All",...GAMES.filter(g=>!["NFL","NBA","MLB"].includes(g))];
 $("main").innerHTML=`<div class="rd-sports"><button class="rd-search" data-sq="1" aria-label="Search">${IC.search}</button>${games.map(g=>`<button class="rd-sport ${gf===g?"active":""}" data-gf="${esc(g)}">${gl(g)}</button>`).join("")}</div>
 ${sq?`<div class="search"><input id="q" placeholder="Search players, teams or props" value="${esc(q)}" autocomplete="off"></div>`:""}
 ${admin?`<details class="rd-admin"><summary>Admin tools</summary><div class="tools"><button class="pill on" id="add">+ Player</button><button class="pill on" id="addt">+ Team pick</button><button class="pill" id="odds">Payout odds</button><button class="pill" id="colors">Team colors</button><button class="pill" id="vbteams">VBall teams</button><button class="pill on" id="promos">Manage promos</button><button class="pill on" id="nflimp">Import NFL props</button></div></details>`:""}
 ${rdPromoBanner()}${rdFilters()}<div class="rd-section"><h2 class="sec">${gf==="All"?(T?"Team Picks":"All Picks"):esc(gf)+" Picks"}</h2></div>${hideRow(T)}<div id="cards"></div>`;
 fillCards();
}
function rdCard(id,p){
 const sel=picks[id]&&picks[id].dir,lock=p.status!=="upcoming";
 return `<article class="rd-card ${sel?"rd-selected":""}" style="--team:${esc(rdColor(p))}">
 ${hideBtn(id,p)}
 <button class="rd-cardtap" data-rddetail="${esc(id)}" aria-label="Show ${esc(p.name)} past five games">
 <div class="rd-media">${rdPhoto(p)}${p.status==="upcoming"?'<span class="rd-heart" aria-hidden="true">♡</span>':""}</div>
 <div class="rd-name">${esc(p.name)}</div><div class="rd-meta">${esc(p.pos||"NFL")} · ${esc(rdAbbr(p))}</div>
 <div class="rd-line">${p.baseLine!=null&&p.baseLine!==p.line?`<s>${esc(p.baseLine)}</s>`:""}${esc(p.line)}</div><div class="rd-stat">${esc(p.stat)}</div>
 ${lock?`<span class="rd-status">${badge(p)}</span>`:""}${pbadge(p)}
 </button><div class="rd-actions"><button data-k="${esc(id)}" data-d="more" class="rd-more ${sel==="more"?"chosen":""}" ${lock?"disabled":""}>↑ More</button><button data-k="${esc(id)}" data-d="less" class="rd-less ${sel==="less"?"chosen":""}" ${lock?"disabled":""}>↓ Less</button></div>
 ${admin?`<div class="adm"><div class="step"><button data-st="${esc(id)}" data-by="-1">−</button><b>${p.current==null?"–":esc(p.current)}</b><button data-st="${esc(id)}" data-by="1">+</button></div>${chipsH(id,p)}<button class="del" data-edit="${esc(id)}">Edit player</button></div>`:""}
 </article>`;
}
function redesignedFillCards(){
 const ids=Object.keys(players).filter(id=>{
  const p=players[id];
  return !isTeam(p)&&(gf==="All"||p.game===gf)&&!(p.status==="final"&&hid[id]&&!showHid)&&(gf!=="NFL"||((wf==="All"||String(p.week)===wf)&&(sf==="All"||p.stat===sf)))&&(!q||[p.name,p.team,p.stat,p.pos,p.opp].join(" ").toLowerCase().includes(q.trim().toLowerCase()));
 });
 ids.sort((a,b)=>{
 const x=players[a],y=players[b];return (y.status==="upcoming")-(x.status==="upcoming")||(x.week||999)-(y.week||999)||String(x.name||"").localeCompare(String(y.name||""))||String(x.stat||"").localeCompare(String(y.stat||""));
 });
 $("cards").innerHTML=ids.length?`<div class="rd-grid">${ids.map(id=>rdCard(id,players[id])).join("")}</div>`:`<div class="empty">No picks match these filters.</div>`;
 rdApplyPhotos();
}
function rdGameHistory(p){
 const a=Array.isArray(p.last5Games)?p.last5Games:Array.isArray(p.recentGames)?p.recentGames:Array.isArray(p.l5)?p.l5:[];
 return a.slice(-5).map((v,i)=>{
 const obj=v&&typeof v==="object"&&!Array.isArray(v)?v:null;
 const n=Number(obj?(obj.value??obj.actual??obj.result):v);
 return {value:Number.isFinite(n)?n:null,opponent:obj?(obj.opponent||obj.opp||""):"",label:obj&&obj.week?"W"+obj.week:obj&&obj.date?String(obj.date):"G"+(i+1)};
 }).filter(x=>x.value!==null);
}
function rdDetailOptions(p){
 const same=Object.entries(players).filter(([id,x])=>!isTeam(x)&&x.game===p.game&&rdNorm(x.name)===rdNorm(p.name));
 const close=same.filter(([id,x])=>x.week===p.week),out=[],seen=new Set();
 (close.length?close:same).forEach(v=>{if(!seen.has(v[1].stat)){seen.add(v[1].stat);out.push(v)}});
 return out;
}
function rdChart(games,line){
 if(!games.length)return '<div class="rd-no-data">No individual game history imported for this stat yet.</div>';
 const mx=Math.max(1,line||0,...games.map(g=>g.value)),pct=v=>Math.max(2,Math.min(100,v/mx*100));
 return `<div class="rd-chart" role="img" aria-label="Game-by-game results versus current line ${esc(line)}"><div class="rd-guide" style="bottom:${pct(line)}%"><span>${esc(line)}</span></div>${games.map(g=>`<div class="rd-column"><div class="rd-bar ${g.value>line?"over":g.value<line?"under":"even"}" style="height:${pct(g.value)}%"><b>${esc(g.value)}</b></div><small>${esc(g.label)}</small></div>`).join("")}</div>`;
}
function rdShowDetail(id,stat){
 const p=players[id];if(!p)return;rdDetailId=id;
 const options=rdDetailOptions(p),current=options.find(([key,v])=>v.stat===stat)||options[0]||[id,p],key=current[0],a=current[1];
 const games=rdGameHistory(a),line=Number(a.line),num=Number.isFinite(line),hits=games.filter(g=>num&&g.value>line).length,vals=games.map(g=>g.value).sort((x,y)=>x-y),avg=games.length?games.reduce((s,g)=>s+g.value,0)/games.length:null,median=vals.length?(vals[Math.floor((vals.length-1)/2)]+vals[Math.ceil((vals.length-1)/2)])/2:null;
 const fmt=v=>v==null?"—":String(Math.round(v*10)/10),sel=picks[key]&&picks[key].dir,lock=a.status!=="upcoming";
 $("panel").innerHTML=`<div class="rd-sheet-handle"></div><button class="rd-close" data-closepanel="1" aria-label="Close">×</button>
 <div class="rd-profile" style="--team:${esc(rdColor(p))}">${rdPhoto(p,true)}<div><h2>${esc(p.name)}</h2><p>${esc(p.pos||"NFL")} · ${esc(p.team)}</p><small>${p.week?"Week "+esc(p.week)+" · ":""}${p.opp?"vs "+esc(p.opp):"Player performance"}</small></div></div>
 <div class="rd-stat-tabs">${options.map(([k,v])=>`<button data-rdstat="${esc(v.stat)}" class="${v.stat===a.stat?"active":""}">${esc(v.stat)}</button>`).join("")}</div>
 <div class="rd-prop"><div><b>${esc(a.line)}</b><small>${esc(a.stat)} · current line</small></div><div class="rd-prop-actions"><button data-k="${esc(key)}" data-d="more" class="rd-more ${sel==="more"?"chosen":""}" ${lock?"disabled":""}>↑ More</button><button data-k="${esc(key)}" data-d="less" class="rd-less ${sel==="less"?"chosen":""}" ${lock?"disabled":""}>↓ Less</button></div></div>
 <div class="rd-historytitle"><b>Last ${games.length||5} games</b><span>vs current line</span></div>
 ${rdChart(games,line)}
 ${games.length?`<div class="rd-table-scroll"><table class="rd-game-table"><thead><tr><th>Game</th><th>Opponent</th><th>Result</th><th>vs ${esc(a.line)}</th></tr></thead><tbody>${games.slice().reverse().map(g=>`<tr><td>${esc(g.label)}</td><td>${esc(g.opponent||"—")}</td><td class="${g.value>line?"rd-win":g.value<line?"rd-loss":""}">${esc(g.value)}</td><td class="${g.value>line?"rd-win":g.value<line?"rd-loss":""}">${g.value>line?"Over":g.value<line?"Under":"Push"}</td></tr>`).join("")}</tbody></table></div>`:""}
 <div class="rd-metrics"><div><b>${games.length?hits+"/"+games.length:"—"}</b><small>Over line</small></div><div><b>${fmt(avg)}</b><small>Average</small></div><div><b>${fmt(median)}</b><small>Median</small></div><div><b>${games.length?fmt(Math.max(...vals)):"—"}</b><small>High</small></div></div>
 <p class="rd-note">Over/Under compares results with the currently displayed line, not past sportsbook lines. Generic game labels and — mean that historical week or opponent details were not supplied.</p>`;
 $("sheet").classList.add("open");rdApplyPhotos();
}
document.addEventListener("change",e=>{if(e.target.id==="rd-week"){wf=e.target.value;render()}else if(e.target.id==="rd-stat"){sf=e.target.value;render()}});

document.addEventListener("click",e=>{
 const t=e.target.closest("button");if(!t)return;
 if(t.dataset.rdclaim){e.stopImmediatePropagation();rdClaimPromo(t.dataset.rdclaim,t.dataset.rdstart);return}
 if(t.dataset.promobox){e.stopImmediatePropagation();rdShowPromos();return}
 if(t.dataset.optpromo){e.stopImmediatePropagation();rdShowPromos();return}
},true);
