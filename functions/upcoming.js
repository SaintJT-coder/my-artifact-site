'use strict';
const {createHash}=require('node:crypto');
const {start}=require('./lifecycle');
const {createPhotoResolver}=require('./player-photos');
const sports={NFL:'americanfootball_nfl',NBA:'basketball_nba'};
const markets={NFL:{player_pass_yds:'Passing Yards',player_rush_yds:'Rushing Yards',player_reception_yds:'Receiving Yards',player_pass_tds:'Passing TDs',player_rush_tds:'Rushing TDs',player_reception_tds:'Receiving TDs'},NBA:{player_points:'Points',player_rebounds:'Rebounds',player_assists:'Assists',player_threes:'3-Pointers Made',player_points_rebounds_assists:'Points + Rebounds + Assists'}};
const hash=x=>createHash('sha256').update(x).digest('hex');
const rank=x=>x==='draftkings'?0:x==='fanduel'?1:2;
const numeric=x=>typeof x==='number'&&Number.isFinite(x);
const price=x=>numeric(x)&&Math.abs(x)>=100;
function eligible(event,now){
 const ms=start({commenceTime:event?.commence_time});
 return typeof event?.id==='string'&&/^[a-f0-9]{32}$/.test(event.id)&&typeof event.home_team==='string'&&typeof event.away_team==='string'&&event.home_team!==event.away_team&&Number.isFinite(ms)&&now<ms-600000&&ms<now+7*86400000;
}
function buildPicks(league,event,odds,now=Date.now()){
 if(!sports[league]||!eligible(event,now))return [];
 if(odds?.id!==event.id||odds.home_team!==event.home_team||odds.away_team!==event.away_team||odds.commence_time!==event.commence_time)throw Error('Odds event identity or schedule mismatch');
 const picks=[],props=new Map(),teams=new Map();
 const base={game:league,status:'upcoming',source:'the-odds-api',eventId:event.id,homeTeam:event.home_team,awayTeam:event.away_team,commenceTime:event.commence_time,lockAtMs:Date.parse(event.commence_time)-600000};
 for(const book of odds.bookmakers||[])for(const market of book.markets||[]){
  if(markets[league][market.key])for(const outcome of market.outcomes||[]){
   if(outcome.name!=='Over'||typeof outcome.description!=='string'||!outcome.description.trim()||!numeric(outcome.point)||outcome.point<0||!price(outcome.price))continue;
   const name=outcome.description.trim(),key=market.key+'|'+name.toLowerCase(),old=props.get(key);
   if(!old||rank(book.key)<rank(old.bookmaker))props.set(key,{name,market:market.key,line:outcome.point,odds:outcome.price,bookmaker:book.key});
  }
  if(!['h2h','spreads','totals'].includes(market.key))continue;
  const rows=market.outcomes||[],total=market.key==='totals';
  const a=rows.find(x=>x.name===(total?'Over':event.home_team)),b=rows.find(x=>x.name===(total?'Under':event.away_team));
  if(!a||!b||!price(a.price)||!price(b.price))continue;
  if(market.key==='spreads'&&(!numeric(a.point)||!numeric(b.point)||a.point!==-b.point))continue;
  if(total&&(!numeric(a.point)||a.point<0||a.point!==b.point))continue;
  const old=teams.get(market.key);
  if(!old||rank(book.key)<rank(old.bookmaker))teams.set(market.key,{a,b,bookmaker:book.key});
 }
 for(const c of props.values()){
  const stat=markets[league][c.market],extra=league==='NBA'?(['Points','Rebounds'].includes(stat)?1:0):(['Rushing Yards','Receiving Yards'].includes(stat)?5:0);
  const id=league==='NBA'?'oddsapi-nba-'+hash([event.id,c.market,c.name.toLowerCase()].join('|')):'oddsapi-'+hash([event.id,c.name.toLowerCase(),c.market].join('|'));
  // Same accepted-line adjustments and IDs as the existing manual importers.
  picks.push({id,data:{...base,name:c.name,stat,team:'—',opp:event.away_team+' @ '+event.home_team,book:c.line,line:c.line+extra,current:null,l5:[],bookmaker:c.bookmaker,americanOdds:c.odds}});
  if(league==='NFL'){
   const week=Math.floor((Date.parse(event.commence_time)-Date.parse('2026-09-10T00:00:00Z'))/(7*86400000))+1;
   if(week>=1&&week<=18)picks[picks.length-1].data.week=week;
  }
 }
 for(const [market,c] of teams){
  const mult=x=>Number((x>0?1+x/100:1+100/Math.abs(x)).toFixed(3));
  const label=x=>x.name+(market==='h2h'?'':' '+(x.point>0?'+':'')+x.point);
  picks.push({id:'oddsapi-'+league.toLowerCase()+'-team-'+hash([event.id,market].join('|')),data:{...base,kind:'team',title:event.away_team+' @ '+event.home_team+' · '+({h2h:'Moneyline',spreads:'Spread',totals:'Total Points'})[market],aLabel:label(c.a),bLabel:label(c.b),aMult:mult(c.a.price),bMult:mult(c.b.price),result:null,bookmakerA:c.bookmaker,bookmakerB:c.bookmaker,americanOddsA:c.a.price,americanOddsB:c.b.price,market,marketLine:market==='h2h'?null:c.a.point,homeTeam:event.home_team,awayTeam:event.away_team}});
 }
 return picks;
}
async function refreshUpcoming({db,getJSON,key,now=Date.now(),limit=8,enrichPhotos=createPhotoResolver()}){
 const report={NFL:{created:0,events:0,errors:0},NBA:{created:0,events:0,errors:0}};
 for(const league of ['NFL','NBA']){
  let events;
  try{events=await getJSON('/sports/'+sports[league]+'/events',key);if(!Array.isArray(events))throw Error('Invalid events');}
  catch{report[league].errors++;continue;}
  let attempted=0;
  for(const event of events.filter(e=>eligible(e,now)).sort((a,b)=>Date.parse(a.commence_time)-Date.parse(b.commence_time))){
   if(attempted>=limit)break;
   const state=db.collection('sportsImports').doc(league+'-'+event.id),snapshot=await state.get(),previous=snapshot.data()||{};
   const marketVersion=league==='NFL'?2:1;
   const tdMarkets=['player_pass_tds','player_rush_tds','player_reception_tds'];
   const missingTD=league==='NFL'?tdMarkets.filter(k=>!(previous.tdCoverage||[]).includes(k)):[];
   const expandMarkets=previous.complete&&((previous.marketVersion||1)<marketVersion||(missingTD.length&&(!previous.tdRetryAfter||previous.tdRetryAfter<=now)));
   if((previous.complete&&!expandMarkets)||(!expandMarkets&&previous.retryAfter>now))continue;
   attempted++;
   try{
    const requested=(expandMarkets?missingTD:Object.keys(markets[league]).concat(['h2h','spreads','totals'])).join(',');
    const odds=await getJSON('/sports/'+sports[league]+'/events/'+event.id+'/odds?regions=us&markets='+requested+'&oddsFormat=american',key);
    const raw=buildPicks(league,event,odds,Date.now());
    const candidates=await enrichPhotos(league,event,raw);
    let created=0;
    for(const pick of candidates){
     try{await db.collection('players').doc(pick.id).create(pick.data);created++;}
     catch(error){if(error.code!==6&&error.code!=='already-exists')throw error;}
    }
    const hasPlayers=candidates.some(x=>x.data.kind!=='team'),hasTeams=expandMarkets||candidates.some(x=>x.data.kind==='team');
    const coverage=league==='NFL'?{tdCoverage:[...new Set([...(previous.tdCoverage||[]),...tdMarkets.filter(k=>candidates.some(p=>p.data.stat===markets.NFL[k]))])],tdRetryAfter:now+6*3600000}:{};
    await state.set({lastAttempt:now,created,complete:expandMarkets?true:hasPlayers&&hasTeams,marketVersion,retryAfter:now+6*3600000,...coverage},{merge:true});
    report[league].created+=created;report[league].events++;
   }catch{
    report[league].errors++;
    await state.set({lastAttempt:now,complete:previous.complete===true,marketVersion,tdCoverage:previous.tdCoverage||[],tdRetryAfter:now+6*3600000,retryAfter:now+6*3600000},{merge:true});
   }
  }
 }
 return report;
}
module.exports={eligible,buildPicks,refreshUpcoming};
