const test=require('node:test');
const assert=require('node:assert/strict');
const {available,phase}=require('../functions/lifecycle');
const {normalize,grade,plan}=require('../functions-results/settlement');
const start=Date.parse('2026-11-01T20:00:00Z');
const p={game:'NBA',status:'upcoming',commenceTime:new Date(start).toISOString(),stat:'Points',sportsMapping:{provider:'sportsdataio',gameId:42,playerId:9,team:'BOS'}};
const mapping={league:'NBA',providerGameId:42,homeTeam:'BOS',awayTeam:'NY'};
const box={Game:{GameID:42,HomeTeam:'BOS',AwayTeam:'NY',HomeTeamScore:100,AwayTeamScore:90,Status:'Final',IsClosed:true,DateTimeUTC:'2026-11-01T20:00:00'},PlayerGames:[{GameID:42,PlayerID:9,Team:'BOS',Played:1,Games:1,Points:0,Rebounds:5,Assists:2}]};
const ev=()=>normalize(mapping,structuredClone(box));
test('exact cutoff for team and player picks, including millisecond boundaries',()=>{
 for(const game of ['NBA','NFL'])for(const kind of ['team','player']){
  const pick={...p,game,kind};
  assert.equal(available(pick,start-600001),true);
  assert.equal(available(pick,start-600000),false);
  assert.equal(available(pick,start-1),false);
  assert.equal(phase(pick,start),'live');
 }
});
test('invalid or timezone-free schedules are unavailable; other sports retain behavior',()=>{
 for(const commenceTime of [null,'bad','2026-11-01T12:00:00'])assert.equal(available({...p,commenceTime},0),false);
 assert.equal(available({...p,game:'CFB',commenceTime:null},0),true);
});
test('postponements and suspensions block admission and LIVE',()=>{
 for(const eventStatus of ['postponed','suspended','canceled','review']){
  assert.equal(available({...p,eventStatus},start-700000),false);
  assert.equal(phase({...p,eventStatus},start+1),eventStatus);
 }
 assert.equal(phase({...p,eventStatus:'final'},start+1),'pending');
 assert.equal(available({...p,status:'final'},0),false);
});
test('IDs and team orientation must match exactly',()=>{
 for(const changed of [{providerGameId:43},{homeTeam:'NY'},{league:'MLB'}])assert.throws(()=>normalize({...mapping,...changed},box));
 assert.equal(grade({...p,sportsMapping:{...p.sportsMapping,gameId:'42'}},ev()).hold,'unmapped');
});
test('final AND closed required; confirmed zero retained',()=>{
 const e=ev();assert.equal(grade(p,e).current,0);
 for(const status of ['scheduled','live','postponed','suspended','canceled'])assert.ok(grade(p,{...e,status}).hold);
 assert.ok(grade(p,{...e,closed:false}).hold);
});
test('missing data, nonparticipants, duplicate players, wrong game or team never settle',()=>{
 for(const patch of [{Games:0},{Games:null},{Points:null},{Points:'0'},{Points:NaN},{Team:'NY'},{GameID:43}]){
  const e=ev();Object.assign(e.players[0],patch);assert.ok(grade(p,e).hold);
 }
 for(const players of [[],[...ev().players,...ev().players]])assert.ok(grade(p,{...ev(),players}).hold);
 assert.ok(grade({...p,stat:'Unknown'},ev()).hold);
 assert.ok(grade(p,{...ev(),homeScore:null}).hold);
});
test('combination stats require all confirmed components',()=>{
 const pick={...p,stat:'Points + Rebounds + Assists'};
 assert.equal(grade(pick,ev()).current,7);
 const e=ev();delete e.players[0].Assists;assert.ok(grade(pick,e).hold);
});
test('moneyline, spread, totals and pushes preserve a/b/void contract',()=>{
 const team={...p,kind:'team',sportsMapping:{...p.sportsMapping,market:'moneyline',aTeam:'BOS'}};
 assert.equal(grade(team,ev()).result,'a');
 assert.equal(grade({...team,sportsMapping:{...team.sportsMapping,aTeam:'NY'}},ev()).result,'b');
 for(const [line,result] of [[-9,'a'],[-10,'void'],[-11,'b']])assert.equal(grade({...team,sportsMapping:{...team.sportsMapping,market:'spread',line}},ev()).result,result);
 for(const [line,result] of [[189,'a'],[190,'void'],[191,'b']])assert.equal(grade({...team,sportsMapping:{...team.sportsMapping,market:'total',aSide:'over',line}},ev()).result,result);
 assert.ok(grade({...team,sportsMapping:{...team.sportsMapping,market:'total',line:190}},ev()).hold);
});
test('idempotent retries and corrections never silently change paid results',()=>{
 const first=plan(p,ev());assert.equal(first.current,0);
 const paid={...p,...first};assert.deepEqual(plan(paid,ev()),{});
 const e=ev();e.players[0].Points=1;
 const correction=plan(paid,e);assert.equal(correction.proposedSettlement.current,1);assert.equal(correction.current,undefined);
 assert.equal(plan({...p,status:'final',result:'void'},ev()).reviewReason,'stat-correction-or-manual-final');
});
test('NFL uses ScoreID and explicitly confirmed player stats',()=>{
 const e=normalize({...mapping,league:'NFL'},{Score:{...box.Game,ScoreID:42,HomeScore:21,AwayScore:17},PlayerGames:[{ScoreID:42,PlayerID:9,Team:'BOS',Played:1,Games:1,PassingYards:225}]});
 assert.equal(grade({...p,game:'NFL',stat:'Passing Yards'},e).current,225);
 for(const [stat,key] of [['Passing TDs','PassingTouchdowns'],['Rushing TDs','RushingTouchdowns'],['Receiving TDs','ReceivingTouchdowns']]){
  e.players[0][key]=2;
  assert.equal(grade({...p,game:'NFL',stat},e).current,2);
 }
});
