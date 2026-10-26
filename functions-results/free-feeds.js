'use strict';
// Free-source adapters. Provider IDs are separate from ESPN photo / Odds API IDs.
// nflverse data: CC BY 4.0, https://github.com/nflverse/nflverse-data
// NBA schema: https://github.com/swar/nba_api/tree/master/docs/nba_api/live
const {digest}=require('./settlement');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const num=x=>typeof x==='string'&&x.trim()!==''&&Number.isFinite(Number(x))?Number(x):null;
// Explicit provider abbreviation differences, not fuzzy team matching.
const espnNFLCode=code=>({LAR:'LA',WSH:'WAS'})[code]||code;
function compatibleStart(a,b){
 if(![a,b].every(t=>typeof t==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(t)&&finite(Date.parse(t))))return false;
 return new Date(a).toISOString().slice(0,10)===new Date(b).toISOString().slice(0,10)&&Math.abs(Date.parse(a)-Date.parse(b))<=300000;
}
function csv(text){
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
  else if(!quoted&&(c===','||c==='\n')){row.push(cell.replace(/\r$/,''));cell='';if(c==='\n'){rows.push(row);row=[];}}
  else cell+=c;
 }
 if(quoted)throw Error('Truncated CSV');
 if(cell||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}
 const headers=rows.shift();
 if(!headers?.length||new Set(headers).size!==headers.length)throw Error('Invalid CSV headers');
 return rows.filter(r=>r.some(Boolean)).map(r=>{if(r.length!==headers.length)throw Error('Invalid CSV row');return Object.fromEntries(headers.map((h,i)=>[h,r[i]]));});
}
function start(mapping,value){
 if(typeof value!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(value)||!finite(Date.parse(value)))throw Error('Missing UTC start');
 if(Date.parse(mapping.commenceTime)!==Date.parse(value))throw Error('Schedule changed; remapping required');
 return new Date(value).toISOString();
}
function nba(mapping,box){
 const g=box?.game;
 if(mapping.league!=='NBA'||!/^\d{10}$/.test(mapping.providerGameId)||g?.gameId!==mapping.providerGameId)throw Error('NBA game ID mismatch');
 if(g.homeTeam?.teamTricode!==mapping.homeTeam||g.awayTeam?.teamTricode!==mapping.awayTeam||mapping.homeTeam===mapping.awayTeam)throw Error('NBA team mismatch');
 const status={1:'scheduled',2:'live',3:'final'}[g.gameStatus];
 if(!status)throw Error('Unknown NBA game status');
 const closed=status==='final'&&/^Final(?:\/.*)?$/i.test(String(g.gameStatusText).trim())&&g.period>=4;
 const keys={points:'Points',reboundsTotal:'Rebounds',assists:'Assists',threePointersMade:'ThreePointersMade',steals:'Steals',blocks:'BlockedShots',turnovers:'Turnovers'};
 const players=[g.homeTeam,g.awayTeam].flatMap(t=>(t.players||[]).map(p=>({PlayerID:p.personId,GameID:g.gameId,Team:t.teamTricode,Games:p.played==='1'&&/^PT(?=.*[1-9])/.test(p.statistics?.minutes||'')?1:0,...Object.fromEntries(Object.entries(keys).map(([from,to])=>[to,p.statistics?.[from]]))})));
 return {provider:'nba',id:g.gameId,league:'NBA',status,closed,start:start(mapping,g.gameTimeUTC),home:mapping.homeTeam,away:mapping.awayTeam,homeScore:g.homeTeam.score,awayScore:g.awayTeam.score,players,updated:null};
}
function nfl(mapping,games,stats,confirmation){
 if(mapping.league!=='NFL'||!/^\d{4}_\d{2}_[A-Z]{2,3}_[A-Z]{2,3}$/.test(mapping.providerGameId))throw Error('Invalid NFL game ID');
 const matches=games.filter(g=>g.game_id===mapping.providerGameId);
 if(matches.length!==1)throw Error('Missing or duplicate NFL game');
 const g=matches[0];
 if(g.home_team!==mapping.homeTeam||g.away_team!==mapping.awayTeam||g.home_team===g.away_team||num(g.season)!==mapping.season)throw Error('NFL team or season mismatch');
 // A schedule score alone does not establish a final. Cross-check the exact
 // schedule's ESPN event ID and explicit completed status; never infer by name.
 const competitions=confirmation?.header?.competitions||[];
 if(String(confirmation?.header?.id)!==g.espn||competitions.length!==1)throw Error('NFL final confirmation ID mismatch');
 const c=competitions[0],home=c.competitors?.filter(t=>t.homeAway==='home'),away=c.competitors?.filter(t=>t.homeAway==='away');
 if(home?.length!==1||away?.length!==1||espnNFLCode(home[0].team?.abbreviation)!==g.home_team||espnNFLCode(away[0].team?.abbreviation)!==g.away_team)throw Error('NFL final confirmation team mismatch');
 const hs=num(g.home_score),as=num(g.away_score);
 const closed=c.status?.type?.completed===true&&c.status.type.state==='post'&&c.status.type.name==='STATUS_FINAL'&&hs!==null&&as!==null&&num(String(home[0].score))===hs&&num(String(away[0].score))===as;
 const players=stats.filter(p=>p.game_id===g.game_id&&num(p.season)===mapping.season&&num(p.week)===num(g.week)&&p.season_type===g.game_type&&((p.team===g.home_team&&p.opponent_team===g.away_team)||(p.team===g.away_team&&p.opponent_team===g.home_team))).map(p=>({
  PlayerID:p.player_id,ScoreID:g.game_id,Team:p.team,
  // Missing / DNP never becomes a zero. At least one recorded offensive action
  // proves participation; players without it stay pending for review.
  Played:['attempts','carries','targets'].some(k=>num(p[k])>0)?1:0,
  PassingYards:num(p.passing_yards),RushingYards:num(p.rushing_yards),ReceivingYards:num(p.receiving_yards),Receptions:num(p.receptions),PassingTouchdowns:num(p.passing_tds),RushingTouchdowns:num(p.rushing_tds),ReceivingTouchdowns:num(p.receiving_tds)
 }));
 return {provider:'nflverse',id:g.game_id,league:'NFL',status:closed?'final':'pending',closed,start:start(mapping,c.date),home:g.home_team,away:g.away_team,homeScore:hs,awayScore:as,players,updated:null};
}
async function read(url,json=true){
 const r=await fetch(url,{signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('Free feed HTTP '+r.status+' ('+new URL(url).hostname+')');
 const text=await r.text();if(text.length>40000000)throw Error('Feed exceeds size limit');
 return json?JSON.parse(text):text;
}
function createFreeReader(get=read){
 const cache=new Map();
 const once=(url,json)=>{if(!cache.has(url))cache.set(url,get(url,json));return cache.get(url);};
 return async m=>{
  if(m.provider==='nba'){
   if(!/^\d{10}$/.test(m.providerGameId))throw Error('Invalid NBA mapping');
   return nba(m,await once('https://cdn.nba.com/static/json/liveData/boxscore/boxscore_'+m.providerGameId+'.json',true));
  }
  if(m.provider!=='nflverse'||!Number.isInteger(m.season)||m.season<2020||m.season>2100)throw Error('Invalid free provider mapping');
  const games=csv(await once('https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv',false));
  const gamesForID=games.filter(g=>g.game_id===m.providerGameId);
  if(gamesForID.length!==1||!/^\d+$/.test(gamesForID[0].espn))throw Error('Unconfirmed NFL schedule ID');
  const [stats,confirmation]=await Promise.all([
   once('https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_'+m.season+'.csv',false),
   once('https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event='+gamesForID[0].espn,true)
  ]);
  return nfl(m,games,csv(stats),confirmation);
 };
}
module.exports={csv,nba,nfl,createFreeReader,read,digest,espnNFLCode,compatibleStart};
