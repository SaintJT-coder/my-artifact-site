'use strict';
// Display metadata only. ESPN IDs must never be used as result-provider IDs.
const paths={NFL:'football/nfl',NBA:'basketball/nba'};
const normalize=x=>String(x||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const baseName=x=>normalize(String(x||'').replace(/\s+(?:jr|sr|ii|iii|iv)\.?$/i,''));
// Official Cardinals notes identify Zonovan (Bam) Knight; photo-only alias,
// tied to the verified roster athlete ID, never used for settlement.
// https://static.clubs.nfl.com/image/upload/cardinals/aco9qqv0vuzefcnaobv2.pdf
const aliases={'4427728':['Zonovan Knight']};
function photoURL(value){
 try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='a.espncdn.com'&&/^\/i\/headshots\/(nfl|nba)\/players\//.test(u.pathname)?u.href:null;}catch{return null;}
}
function rosterPlayers(data){
 return (data?.athletes||[]).flatMap(a=>Array.isArray(a.items)?a.items:[a]);
}
function uniquePlayer(name,rosters){
 const exact=new Map(),suffix=new Map();
 for(const {team,athletes} of rosters)for(const athlete of athletes){
  const names=[athlete.displayName,athlete.fullName,...(aliases[String(athlete.id)]||[])].filter(Boolean);
  const direct=names.some(n=>normalize(n)===normalize(name));
  if(!direct&&!names.some(n=>baseName(n)===baseName(name)))continue;
  const id=String(athlete.id||''),url=photoURL(athlete.headshot?.href);
  if(!/^\d+$/.test(id))return null;
  const key=id+'|'+normalize(team),metadata={team,espnId:id,headshotUrl:url,photoSource:'espn-roster'};
  suffix.set(key,metadata);if(direct)exact.set(key,metadata);
 }
 const matches=exact.size?exact:suffix;
 const match=matches.size===1?[...matches.values()][0]:null;
 return match?.headshotUrl?match:null;
}
function createPhotoResolver({getJSON=async url=>{
 const res=await fetch(url,{signal:AbortSignal.timeout(10000)});
 if(!res.ok)throw Error('Roster HTTP '+res.status);
 return res.json();
}}={}){
 const teams=new Map(),rosters=new Map();
 async function teamList(game){
  if(!teams.has(game))teams.set(game,getJSON('https://site.api.espn.com/apis/site/v2/sports/'+paths[game]+'/teams?limit=100').then(data=>{
   const map=new Map();
   for(const sport of data.sports||[])for(const league of sport.leagues||[])for(const item of league.teams||[]){
    const t=item.team;if(!t||!/^\d+$/.test(String(t.id)))continue;
    const aliases=[t.displayName,t.location+' '+t.name];
    if(t.location==='LA')aliases.push('Los Angeles '+t.name);
    for(const alias of aliases)map.set(normalize(alias),t);
   }
   return map;
  }).catch(error=>{teams.delete(game);throw error;}));
  return teams.get(game);
 }
 async function roster(game,name){
  const list=await teamList(game),team=list.get(normalize(name));
  if(!team)return null;
  const key=game+':'+team.id;
  if(!rosters.has(key))rosters.set(key,getJSON('https://site.api.espn.com/apis/site/v2/sports/'+paths[game]+'/teams/'+team.id+'/roster').then(data=>{
   if(String(data.team?.id)!==String(team.id))throw Error('Roster team mismatch');
   return {team:team.displayName,athletes:rosterPlayers(data)};
  }).catch(error=>{rosters.delete(key);throw error;}));
  return rosters.get(key);
 }
 return async(game,event,picks)=>{
  if(!paths[game])return picks;
  const result=await Promise.allSettled([roster(game,event.home_team),roster(game,event.away_team)]);
  // A failed/missing opponent roster cannot prove a unique event-scoped identity.
  if(result.some(r=>r.status!=='fulfilled'||!r.value))return picks;
  const verified=result.map(r=>r.value);
  return picks.map(pick=>{
   if(pick.data.kind==='team'||photoURL(pick.data.headshotUrl))return pick;
   const match=uniquePlayer(pick.data.name,verified);
   return match?{...pick,data:{...pick.data,...match}}:pick;
  });
 };
}
module.exports={createPhotoResolver,uniquePlayer,rosterPlayers,photoURL};
