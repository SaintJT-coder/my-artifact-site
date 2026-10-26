'use strict';
const {csv,espnNFLCode,compatibleStart}=require('./free-feeds');
const {digest}=require('./settlement');
const teams={ARI:'Arizona Cardinals',ATL:'Atlanta Falcons',BAL:'Baltimore Ravens',BUF:'Buffalo Bills',CAR:'Carolina Panthers',CHI:'Chicago Bears',CIN:'Cincinnati Bengals',CLE:'Cleveland Browns',DAL:'Dallas Cowboys',DEN:'Denver Broncos',DET:'Detroit Lions',GB:'Green Bay Packers',HOU:'Houston Texans',IND:'Indianapolis Colts',JAX:'Jacksonville Jaguars',KC:'Kansas City Chiefs',LA:'Los Angeles Rams',LAC:'Los Angeles Chargers',LV:'Las Vegas Raiders',MIA:'Miami Dolphins',MIN:'Minnesota Vikings',NE:'New England Patriots',NO:'New Orleans Saints',NYG:'New York Giants',NYJ:'New York Jets',PHI:'Philadelphia Eagles',PIT:'Pittsburgh Steelers',SEA:'Seattle Seahawks',SF:'San Francisco 49ers',TB:'Tampa Bay Buccaneers',TEN:'Tennessee Titans',WAS:'Washington Commanders'};
const name=x=>String(x||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const nbaTeams={ATL:'Atlanta Hawks',BOS:'Boston Celtics',BKN:'Brooklyn Nets',CHA:'Charlotte Hornets',CHI:'Chicago Bulls',CLE:'Cleveland Cavaliers',DAL:'Dallas Mavericks',DEN:'Denver Nuggets',DET:'Detroit Pistons',GSW:'Golden State Warriors',HOU:'Houston Rockets',IND:'Indiana Pacers',LAC:'Los Angeles Clippers',LAL:'Los Angeles Lakers',MEM:'Memphis Grizzlies',MIA:'Miami Heat',MIL:'Milwaukee Bucks',MIN:'Minnesota Timberwolves',NOP:'New Orleans Pelicans',NYK:'New York Knicks',OKC:'Oklahoma City Thunder',ORL:'Orlando Magic',PHI:'Philadelphia 76ers',PHX:'Phoenix Suns',POR:'Portland Trail Blazers',SAC:'Sacramento Kings',SAS:'San Antonio Spurs',TOR:'Toronto Raptors',UTA:'Utah Jazz',WAS:'Washington Wizards'};
function acceptedTeam(p,base,home){
  if(p.source!=='the-odds-api')return null;
  const market={h2h:'moneyline',spreads:'spread',totals:'total'}[p.market];
  if(!market)return null;
  const line=p.marketLine;
  const label=x=>x.name+(p.market==='h2h'?'':' '+(x.point>0?'+':'')+x.point);
  if(market==='total'){
   if(typeof line!=='number'||!Number.isFinite(line)||p.aLabel!==label({name:'Over',point:line})||p.bLabel!==label({name:'Under',point:line}))return null;
   return {...base,market,line,aSide:'over'};
  }
  if(market==='spread'&&(typeof line!=='number'||!Number.isFinite(line)))return null;
  if(p.aLabel!==label({name:p.homeTeam,point:line})||p.bLabel!==label({name:p.awayTeam,point:line===null?null:-line}))return null;
  return {...base,market,aTeam:home,...(market==='spread'?{line}:{})};
}
function link(p,g,stats){
 if(p.sportsMapping||!['upcoming','live'].includes(p.status)||p.game!=='NFL'||p.homeTeam!==teams[g.home_team]||p.awayTeam!==teams[g.away_team]||!compatibleStart(p.commenceTime,g.start)||(p.week!==undefined&&p.week!==Number(g.week)))return null;
 const gameKey='free-'+digest(['nflverse',g.game_id]);
 const base={provider:'nflverse',gameKey,gameId:g.game_id};
 if(p.kind==='team')return acceptedTeam(p,base,g.home_team);
 // Exact full display-name equality inside the exact game. No fuzzy names,
 // suffix removal, photo IDs, or roster guesses enter financial settlement.
 const rows=stats.filter(r=>r.game_id===g.game_id&&Number(r.season)===Number(g.season)&&r.season_type===g.game_type&&Number(r.week)===Number(g.week)&&name(r.player_display_name)===name(p.name)&&p.team===teams[r.team]&&r.opponent_team===(r.team===g.home_team?g.away_team:g.home_team)&&[g.home_team,g.away_team].includes(r.team));
 if(rows.length!==1||!/^00-\d{7}$/.test(rows[0].player_id))return null;
 return {...base,playerId:rows[0].player_id,team:rows[0].team};
}
async function prepareNFL(db,get,now=Date.now()){
 const picks=await db.collection('players').where('game','==','NFL').get();
 const candidates=picks.docs.filter(d=>!d.data().sportsMapping&&['upcoming','live'].includes(d.data().status)&&Number.isFinite(Date.parse(d.data().commenceTime))&&Date.parse(d.data().commenceTime)<=now&&Date.parse(d.data().commenceTime)>now-7*86400000);
 if(!candidates.length)return {linked:0,held:0};
 const games=csv(await get('https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv',false));
 const statsBySeason=new Map(),report={linked:0,held:0};
 for(const g of games){
  if(!/^\d{4}_\d{2}_[A-Z]{2,3}_[A-Z]{2,3}$/.test(g.game_id)||!/^\d+$/.test(g.espn)||!teams[g.home_team]||!teams[g.away_team])continue;
  const matching=candidates.filter(d=>{const p=d.data();return p.homeTeam===teams[g.home_team]&&p.awayTeam===teams[g.away_team]&&Math.abs(Date.parse(p.commenceTime)-Date.parse(g.gameday))<2*86400000;});
  if(!matching.length)continue;
  try{
   const confirmation=await get('https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event='+g.espn,true);
   const competitions=confirmation?.header?.competitions||[];
   if(String(confirmation?.header?.id)!==g.espn||competitions.length!==1)throw Error('NFL schedule confirmation mismatch');
   const c=competitions[0],h=c.competitors?.filter(t=>t.homeAway==='home'),a=c.competitors?.filter(t=>t.homeAway==='away');
   if(h?.length!==1||a?.length!==1||espnNFLCode(h[0].team?.abbreviation)!==g.home_team||espnNFLCode(a[0].team?.abbreviation)!==g.away_team)throw Error('NFL schedule team mismatch');
   if(!/(Z|[+-]\d\d:\d\d)$/.test(c.date||''))throw Error('Missing NFL UTC schedule');
   g.start=c.date;
   const season=Number(g.season);
   if(!Number.isInteger(season)||season<2020||season>2100)throw Error('Invalid season');
   if(!statsBySeason.has(season))statsBySeason.set(season,csv(await get('https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_'+season+'.csv',false)));
   const plans=matching.map(d=>({doc:d,mapping:link(d.data(),g,statsBySeason.get(season))})).filter(p=>p.mapping);
   if(!plans.length)continue;
   if(plans.length>200)throw Error('More than 200 pick mappings require review');
   const gameRef=db.collection('sportsGames').doc(plans[0].mapping.gameKey);
   await db.runTransaction(async tx=>{
    const old=await tx.get(gameRef),fresh=[];
    for(const p of plans)fresh.push(await tx.get(p.doc.ref));
    const gameMapping={provider:'nflverse',league:'NFL',providerGameId:g.game_id,season,homeTeam:g.home_team,awayTeam:g.away_team,commenceTime:new Date(g.start).toISOString(),verified:true,enabled:true,pollFrom:Date.parse(g.start),monitorUntil:Date.parse(g.start)+14*86400000};
    if(old.exists){const prev=old.data();if(['provider','league','providerGameId','season','homeTeam','awayTeam','commenceTime'].some(k=>prev[k]!==gameMapping[k])||!prev.enabled||!prev.verified)return;}
    else tx.set(gameRef,gameMapping);
    fresh.forEach((snap,i)=>{if(snap.exists&&digest(snap.data())===digest(plans[i].doc.data())){tx.update(snap.ref,{sportsMapping:plans[i].mapping});report.linked++;}});
   });
  }catch(error){report.held+=matching.length;console.error('Free NFL mapping held',g.game_id,error.message);}
 }
 return report;
}
function linkNBA(p,g){
 if(p.sportsMapping||p.game!=='NBA'||!['upcoming','live'].includes(p.status)||p.homeTeam!==nbaTeams[g.homeTeam?.teamTricode]||p.awayTeam!==nbaTeams[g.awayTeam?.teamTricode]||!compatibleStart(p.commenceTime,g.gameTimeUTC))return null;
 const base={provider:'nba',gameKey:'free-'+digest(['nba',g.gameId]),gameId:g.gameId};
 if(p.kind==='team')return acceptedTeam(p,base,g.homeTeam.teamTricode);
 const rows=[g.homeTeam,g.awayTeam].flatMap(t=>(t.players||[]).filter(r=>name(r.name)===name(p.name)&&nbaTeams[t.teamTricode]===p.team).map(r=>({id:r.personId,team:t.teamTricode})));
 if(rows.length!==1||!Number.isSafeInteger(rows[0].id)||rows[0].id<=0)return null;
 return {...base,playerId:rows[0].id,team:rows[0].team};
}
async function prepareNBA(db,get,now=Date.now()){
 const picks=await db.collection('players').where('game','==','NBA').get();
 const candidates=picks.docs.filter(d=>!d.data().sportsMapping&&['upcoming','live'].includes(d.data().status)&&Date.parse(d.data().commenceTime)<=now&&Date.parse(d.data().commenceTime)>now-7*86400000);
 if(!candidates.length)return {linked:0};
 const schedule=await get('https://cdn.nba.com/static/json/staticData/scheduleLeagueV2_1.json',true);
 const games=(schedule.leagueSchedule?.gameDates||[]).flatMap(d=>d.games||[]),report={linked:0};
 for(const g of games){
  if(!/^\d{10}$/.test(g.gameId))continue;
  const matching=candidates.filter(d=>{const p=d.data();return p.homeTeam===nbaTeams[g.homeTeam?.teamTricode]&&p.awayTeam===nbaTeams[g.awayTeam?.teamTricode]&&compatibleStart(p.commenceTime,g.gameDateTimeUTC);});
  if(!matching.length)continue;
  try{
   const box=await get('https://cdn.nba.com/static/json/liveData/boxscore/boxscore_'+g.gameId+'.json',true),b=box.game;
   if(b?.gameId!==g.gameId||b.homeTeam?.teamTricode!==g.homeTeam.teamTricode||b.awayTeam?.teamTricode!==g.awayTeam.teamTricode||Date.parse(b.gameTimeUTC)!==Date.parse(g.gameDateTimeUTC))throw Error('NBA box/schedule mismatch');
   const plans=matching.map(doc=>({doc,mapping:linkNBA(doc.data(),b)})).filter(p=>p.mapping);
   if(!plans.length)continue;
   if(plans.length>200)throw Error('More than 200 pick mappings require review');
   const gameRef=db.collection('sportsGames').doc(plans[0].mapping.gameKey);
   await db.runTransaction(async tx=>{
    const old=await tx.get(gameRef),fresh=[];
    for(const p of plans)fresh.push(await tx.get(p.doc.ref));
    const mapping={provider:'nba',league:'NBA',providerGameId:g.gameId,homeTeam:g.homeTeam.teamTricode,awayTeam:g.awayTeam.teamTricode,commenceTime:new Date(b.gameTimeUTC).toISOString(),verified:true,enabled:true,pollFrom:Date.parse(b.gameTimeUTC),monitorUntil:Date.parse(b.gameTimeUTC)+14*86400000};
    if(old.exists){const prev=old.data();if(['provider','league','providerGameId','homeTeam','awayTeam','commenceTime'].some(k=>prev[k]!==mapping[k])||!prev.enabled||!prev.verified)return;}
    else tx.set(gameRef,mapping);
    fresh.forEach((snap,i)=>{if(snap.exists&&digest(snap.data())===digest(plans[i].doc.data())){tx.update(snap.ref,{sportsMapping:plans[i].mapping});report.linked++;}});
   });
  }catch(error){console.error('Free NBA mapping held',g.gameId,error.message);}
 }
 return report;
}
module.exports={link,prepareNFL,teams,linkNBA,prepareNBA};
