const test=require('node:test');
const assert=require('node:assert/strict');
const {csv,nba,nfl,createFreeReader}=require('../functions-results/free-feeds');
const {link,linkNBA,prepareNFL}=require('../functions-results/free-mappings');
const {grade,plan}=require('../functions-results/settlement');
const start='2026-10-25T17:00:00Z';
const mapping={provider:'nflverse',league:'NFL',providerGameId:'2026_08_BUF_NYJ',season:2026,homeTeam:'NYJ',awayTeam:'BUF',commenceTime:start};
const game={game_id:mapping.providerGameId,season:'2026',week:'8',game_type:'REG',home_team:'NYJ',away_team:'BUF',espn:'123',home_score:'10',away_score:'20',start};
const row={game_id:game.game_id,season:'2026',week:'8',season_type:'REG',player_id:'00-0031234',player_display_name:'A Player',team:'BUF',opponent_team:'NYJ',attempts:'10',carries:'0',targets:'0',passing_yards:'100',passing_tds:'0',rushing_yards:'0',rushing_tds:'0',receiving_yards:'0',receiving_tds:'0',receptions:'0'};
const confirmation=()=>({header:{id:'123',competitions:[{date:start,status:{type:{completed:true,state:'post',name:'STATUS_FINAL'}},competitors:[{homeAway:'home',team:{abbreviation:'NYJ'},score:'10'},{homeAway:'away',team:{abbreviation:'BUF'},score:'20'}]}]}});
const pick=()=>({game:'NFL',status:'upcoming',stat:'Passing TDs',name:'A Player',team:'Buffalo Bills',homeTeam:'New York Jets',awayTeam:'Buffalo Bills',commenceTime:start,sportsMapping:{provider:'nflverse',gameId:game.game_id,playerId:row.player_id,team:'BUF'}});
test('CSV handles quotes, commas, newlines, missing numbers and truncation',()=>{
 assert.deepEqual(csv('a,b\r\n"one, two","a""b"\r\n'),[{a:'one, two',b:'a"b'}]);
 assert.throws(()=>csv('a,b\n"unfinished,b'),/Truncated/);
 assert.throws(()=>csv('a,a\n1,2'),/headers/);
 assert.throws(()=>csv('a,b\n1'),/row/);
});
test('NFL exact current game stats permit real zero TDs and preserve provider provenance',()=>{
 const e=nfl(mapping,[game],[row],confirmation());
 assert.equal(grade(pick(),e).current,0);assert.equal(plan(pick(),e).settlement.provider,'nflverse');
 assert.equal(e.closed,true);
});
test('NFL requires completed status and agreement between independent final scores',()=>{
 for(const mutate of [c=>c.header.competitions[0].status.type.completed=false,c=>c.header.competitions[0].competitors[0].score='11']){
  const c=confirmation();mutate(c);assert.equal(nfl(mapping,[game],[row],c).closed,false);
 }
 assert.throws(()=>nfl(mapping,[game],[row],{header:{id:'999'}}),/ID mismatch/);
 assert.throws(()=>nfl({...mapping,commenceTime:'2026-10-26T17:00:00Z'},[game],[row],confirmation()),/Schedule changed/);
});
test('NFL missing stats, DNP, duplicate players, wrong game and season remain pending',()=>{
 for(const rows of [[{...row,passing_tds:''}],[{...row,attempts:'0'}],[row,row],[{...row,game_id:'2026_07_BUF_NYJ'}],[{...row,season:'2025'}]])assert.ok(grade(pick(),nfl(mapping,[game],rows,confirmation())).hold);
 assert.throws(()=>nfl({...mapping,season:2025},[game],[row],confirmation()),/season mismatch/);
});
test('automatic NFL mapping requires exact scheduled matchup, player name and team',()=>{
 const p=pick();delete p.sportsMapping;
 assert.equal(link(p,game,[row]).playerId,row.player_id);
 assert.equal(link({...p,name:'A Players'},game,[row]),null);
 assert.equal(link({...p,team:'New York Jets'},game,[row]),null);
 assert.equal(link(p,game,[row,row]),null);
 assert.equal(link({...p,commenceTime:'2026-10-25T17:06:00Z'},game,[row]),null);
 assert.equal(link({...p,commenceTime:'2026-10-25T17:02:25Z'},game,[row]).playerId,row.player_id);
 assert.equal(link({...p,week:7},game,[row]),null);
 assert.equal(link({...p,status:'final'},game,[row]),null);
});
test('team mapping validates accepted A/B labels, exact market and handicap',()=>{
 const p={...pick(),sportsMapping:undefined,kind:'team',source:'the-odds-api',market:'spreads',marketLine:-3.5,aLabel:'New York Jets -3.5',bLabel:'Buffalo Bills +3.5'};
 const m=link(p,game,[]);assert.equal(m.line,-3.5);assert.equal(m.aTeam,'NYJ');
 assert.equal(link({...p,bLabel:'Buffalo Bills -3.5'},game,[]),null);
 const e=nfl(mapping,[game],[row],confirmation());
 assert.equal(grade({...p,sportsMapping:m},e).result,'b');
 const total={...p,market:'totals',marketLine:30,aLabel:'Over +30',bLabel:'Under +30'};
 assert.equal(grade({...total,sportsMapping:link(total,game,[])},e).result,'void');
});
function nbaFixture(){
 const m={provider:'nba',league:'NBA',providerGameId:'0022600001',homeTeam:'BOS',awayTeam:'NYK',commenceTime:start};
 const box={game:{gameId:m.providerGameId,gameTimeUTC:start,gameStatus:3,gameStatusText:'Final',period:4,homeTeam:{teamTricode:'BOS',score:100,players:[{personId:9,played:'1',statistics:{minutes:'PT10M00.00S',points:20}}]},awayTeam:{teamTricode:'NYK',score:90,players:[]}}};
 return {m,box,p:{game:'NBA',stat:'Points',status:'upcoming',sportsMapping:{provider:'nba',gameId:m.providerGameId,playerId:9,team:'BOS'}}};
}
test('NBA requires official final, explicit participation, numeric stats and exact IDs',()=>{
 const {m,box,p}=nbaFixture();assert.equal(grade(p,nba(m,box)).current,20);
 box.game.homeTeam.players[0].statistics.points='20';assert.ok(grade(p,nba(m,box)).hold);
 box.game.homeTeam.players[0].statistics.points=20;box.game.homeTeam.players[0].played='0';assert.ok(grade(p,nba(m,box)).hold);
 box.game.gameStatusText='Suspended';assert.equal(nba(m,box).closed,false);
 assert.throws(()=>nba({...m,providerGameId:'0022600002'},box),/ID mismatch/);
});
test('free final corrections propose review without changing already paid result',()=>{
 const {m,box,p}=nbaFixture(),event=nba(m,box),initial=plan(p,event);
 const paid={...p,...initial};assert.deepEqual(plan(paid,event),{});
 event.players[0].Points=21;const correction=plan(paid,event);assert.equal(correction.current,undefined);assert.equal(correction.proposedSettlement.current,21);
});
test('NBA exact game/player mapping never uses a photo ID or guessed name',()=>{
 const {box}=nbaFixture();box.game.homeTeam.players[0].name='A Player';
 const p={game:'NBA',status:'upcoming',homeTeam:'Boston Celtics',awayTeam:'New York Knicks',team:'Boston Celtics',name:'A Player',espnId:'999',commenceTime:start};
 assert.equal(linkNBA(p,box.game).playerId,9);
 assert.equal(linkNBA({...p,name:'A Players'},box.game),null);
 assert.equal(linkNBA({...p,commenceTime:'2026-10-25T18:00:00Z'},box.game),null);
 const t={...p,kind:'team',source:'the-odds-api',market:'h2h',marketLine:null,aLabel:'Boston Celtics',bLabel:'New York Knicks'};
 assert.equal(linkNBA(t,box.game).aTeam,'BOS');
 assert.equal(linkNBA({...t,aLabel:'New York Knicks'},box.game),null);
});
test('free reader rejects inaccessible or missing current feeds without fallback to another season',async()=>{
 const urls=[];const get=async url=>{urls.push(url);throw Error('HTTP 403');};
 await assert.rejects(createFreeReader(get)({provider:'nba',providerGameId:'0022600001'}),/403/);
 assert.equal(urls.length,1);assert.match(urls[0],/^https:\/\/cdn.nba.com\//);
 await assert.rejects(createFreeReader(get)({provider:'nflverse',season:2026}),/403/);
});
function fakeDB(p,race=false){
 const records=new Map([['players/p',structuredClone(p)]]);
 const ref=path=>({path});const snapshot=path=>{const value=structuredClone(records.get(path));return {exists:records.has(path),ref:ref(path),data:()=>structuredClone(value)};};
 return {records,collection(collection){return {doc:id=>ref(collection+'/'+id),where:()=>({get:async()=>({docs:[snapshot('players/p')]})})}},async runTransaction(fn){
  if(race)records.get('players/p').status='final';
  const writes=[];let writing=false;
  await fn({get:async r=>{assert.equal(writing,false,'read after transaction write');return snapshot(r.path);},set:(r,p)=>{writing=true;writes.push([r,p]);},update:(r,p)=>{writing=true;writes.push([r,{...records.get(r.path),...p}]);}});
  for(const [r,p]of writes)records.set(r.path,p);
 }};
}
const toCSV=rows=>Object.keys(rows[0]).join(',')+'\n'+rows.map(r=>Object.values(r).join(',')).join('\n');
test('NFL linker writes only verified mappings and preserves concurrent manual finalization',async()=>{
 for(const race of [false,true]){
  const p={...pick(),line:1.5,book:0.5};delete p.sportsMapping;
  const db=fakeDB(p,race);
  const get=async url=>url.includes('games.csv')?toCSV([{...game,gameday:'2026-10-25'}]):url.includes('stats_player')?toCSV([row]):confirmation();
  await prepareNFL(db,get,Date.parse(start)+86400000);
  const saved=db.records.get('players/p');assert.equal(saved.line,1.5);assert.equal(saved.book,0.5);assert.equal(saved.commenceTime,start);
  if(race){assert.equal(saved.status,'final');assert.equal(saved.sportsMapping,undefined);}else assert.equal(saved.sportsMapping.playerId,row.player_id);
 }
});
test('NFL linker does not write results or mappings when current stats cannot be fetched',async()=>{
 const p=pick();delete p.sportsMapping;const db=fakeDB(p);
 const get=async url=>{if(url.includes('games.csv'))return toCSV([{...game,gameday:'2026-10-25'}]);if(url.includes('stats_player'))throw Error('unavailable');return confirmation();};
 const report=await prepareNFL(db,get,Date.parse(start)+86400000);assert.equal(report.held,1);assert.equal(db.records.size,1);assert.equal(db.records.get('players/p').sportsMapping,undefined);
});
