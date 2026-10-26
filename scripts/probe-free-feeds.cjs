'use strict';
// Read-only, no credentials. Verifies real current-season NFL rows and NBA access.
const {csv,nfl,read}=require('../functions-results/free-feeds');
(async()=>{
 const season=Number(process.argv[2]||new Date().getUTCFullYear());
 const games=csv(await read('https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv',false));
 const stats=csv(await read('https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_'+season+'.csv',false));
 const finished=games.filter(g=>Number(g.season)===season&&g.home_score!==''&&g.away_score!==''&&/^\d+$/.test(g.espn)).sort((a,b)=>b.gameday.localeCompare(a.gameday));
 let sample;
 for(const g of finished.slice(0,8)){
  const confirmation=await read('https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event='+g.espn);
  const commenceTime=confirmation.header?.competitions?.[0]?.date;
  const m={provider:'nflverse',league:'NFL',providerGameId:g.game_id,homeTeam:g.home_team,awayTeam:g.away_team,season,commenceTime};
  try{const e=nfl(m,games,stats,confirmation);if(e.closed&&e.players.length){sample={game:e.id,closed:e.closed,playerRows:e.players.length,participatingRows:e.players.filter(p=>p.Played===1).length};break;}}catch{}
 }
 let nba;
 try{const d=await read('https://cdn.nba.com/static/json/staticData/scheduleLeagueV2_1.json');nba={accessible:true,season:d.leagueSchedule?.seasonYear||null};}
 catch(e){nba={accessible:false,reason:e.message};}
 console.log(JSON.stringify({season,NFL:{currentSeasonRows:stats.filter(p=>Number(p.season)===season).length,verifiedFinalSample:sample||null},NBA:nba},null,2));
 if(!sample)process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1;});
