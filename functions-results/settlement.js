'use strict';
const {createHash}=require('node:crypto');
const fields={NBA:{Points:['Points'],Rebounds:['Rebounds'],Assists:['Assists'],'3-Pointers Made':['ThreePointersMade'],'Points + Rebounds + Assists':['Points','Rebounds','Assists'],'Points + Rebounds':['Points','Rebounds'],'Points + Assists':['Points','Assists'],'Rebounds + Assists':['Rebounds','Assists'],Steals:['Steals'],Blocks:['BlockedShots'],Turnovers:['Turnovers']},NFL:{'Passing Yards':['PassingYards'],'Rushing Yards':['RushingYards'],'Receiving Yards':['ReceivingYards'],Receptions:['Receptions'],'Passing TDs':['PassingTouchdowns'],'Passing Touchdowns':['PassingTouchdowns'],'Rushing TDs':['RushingTouchdowns'],'Rushing Touchdowns':['RushingTouchdowns'],'Receiving TDs':['ReceivingTouchdowns'],'Receiving Touchdowns':['ReceivingTouchdowns']}};
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
// Explicit IDs only. The Odds API eventId and ESPN espnId are NOT SportsDataIO IDs.
function normalize(mapping,box){
  const nfl=mapping.league==='NFL',g=nfl?box?.Score:box?.Game;
  const id=nfl?g?.ScoreID:g?.GameID;
  if(!['NFL','NBA'].includes(mapping.league)||!Number.isSafeInteger(mapping.providerGameId)||id!==mapping.providerGameId)throw Error('Game ID mismatch');
  if(g.HomeTeam!==mapping.homeTeam||g.AwayTeam!==mapping.awayTeam||g.HomeTeam===g.AwayTeam)throw Error('Team mapping mismatch');
  const raw=g.DateTimeUTC;
  const time=typeof raw==='string'?Date.parse(/Z$|[+-]\d\d:\d\d$/.test(raw)?raw:raw+'Z'):NaN;
  const statuses={Scheduled:'scheduled',InProgress:'live',Final:'final','F/OT':'final',Postponed:'postponed',Suspended:'suspended',Canceled:'canceled'};
  const status=statuses[g.Status];
  if(!status)throw Error('Unknown game status');
  return {id,league:mapping.league,status,closed:g.IsClosed===true,start:Number.isFinite(time)?new Date(time).toISOString():null,home:g.HomeTeam,away:g.AwayTeam,homeScore:nfl?g.HomeScore:g.HomeTeamScore,awayScore:nfl?g.AwayScore:g.AwayTeamScore,players:Array.isArray(box.PlayerGames)?box.PlayerGames:[],updated:g.Updated||null};
}
function grade(p,event){
  const m=p.sportsMapping;
  if(!m||m.provider!==(event.provider||'sportsdataio')||m.gameId!==event.id||p.game!==event.league)return {hold:'unmapped'};
  if(event.status!=='final'||!event.closed)return {hold:event.status};
  if(!finite(event.homeScore)||!finite(event.awayScore)||event.homeScore<0||event.awayScore<0)return {hold:'missing-score'};
  if(p.kind==='team'){
    const market=m.market;
    if(!['moneyline','spread','total'].includes(market))return {hold:'unsupported-market'};
    let diff;
    if(market==='total'){
      if(!finite(m.line)||m.aSide!=='over')return {hold:'invalid-total'};
      diff=event.homeScore+event.awayScore-m.line;
    }else{
      if(![event.home,event.away].includes(m.aTeam))return {hold:'invalid-team'};
      if(market==='spread'&&!finite(m.line))return {hold:'missing-spread'};
      diff=(m.aTeam===event.home?event.homeScore-event.awayScore:event.awayScore-event.homeScore)+(market==='spread'?m.line:0);
    }
    return {status:'final',result:diff===0?'void':diff>0?'a':'b',current:null};
  }
  const keys=fields[p.game]?.[p.stat];
  if(!keys)return {hold:'unsupported-stat'};
  if(event.provider==='nflverse'?!/^00-\d{7}$/.test(m.playerId):!Number.isSafeInteger(m.playerId))return {hold:'missing-player-id'};
  const rows=event.players.filter(x=>x.PlayerID===m.playerId);
  if(rows.length!==1)return {hold:'missing-or-duplicate-player'};
  const row=rows[0];
  if(![event.home,event.away].includes(row.Team)||row.Team!==m.team)return {hold:'player-team-mismatch'};
  if(row[p.game==='NFL'?'ScoreID':'GameID']!==event.id)return {hold:'player-game-mismatch'};
  // Absence/DNP/missing fields are never converted to zero or auto-voided.
  const participated=p.game==='NFL'?row.Played===1:row.Games===1;
  if(!participated||keys.some(k=>!finite(row[k])))return {hold:'missing-stat-or-participation'};
  return {status:'final',result:null,current:keys.reduce((s,k)=>s+row[k],0)};
}
function plan(p,event){
  const result=grade(p,event);
  if(result.hold)return {reviewReason:result.hold};
  const fingerprint=digest(result);
  if(p.settlement?.fingerprint===fingerprint)return {};
  // Existing balances are computed from these records: never silently debit paid winnings.
  if(p.status==='final')return {reviewReason:'stat-correction-or-manual-final',proposedSettlement:result,proposedFingerprint:fingerprint};
  return {...result,settlement:{provider:event.provider||'sportsdataio',eventId:event.id,fingerprint,providerUpdated:event.updated}};
}
module.exports={normalize,grade,plan,digest};
