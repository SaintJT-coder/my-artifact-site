const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function worker(free=false,paid=true){
 let now=Date.parse('2026-11-01T23:00:00Z'),failure=false;
 const box={Game:{GameID:42,HomeTeam:'BOS',AwayTeam:'NY',HomeTeamScore:100,AwayTeamScore:90,Status:'Final',IsClosed:true,DateTimeUTC:'2026-11-01T20:00:00'},PlayerGames:[{GameID:42,PlayerID:9,Team:'BOS',Games:1,Points:20}]};
 const records=new Map([
  ['sportsGames/g',{provider:'sportsdataio',verified:true,league:'NBA',providerGameId:42,homeTeam:'BOS',awayTeam:'NY',enabled:true,pollFrom:now-86400000,monitorUntil:now+8*86400000}],
  ['players/p',{game:'NBA',status:'upcoming',stat:'Points',line:25,sportsMapping:{gameKey:'g',gameId:42,provider:'sportsdataio',playerId:9,team:'BOS'}}]
 ]);
 if(free){records.get('sportsGames/g').provider='nba';records.get('players/p').sportsMapping.provider='nba';records.get('players/p').commenceTime='2026-11-01T20:00:00Z';}
 const remove=Symbol('delete');
 function ref(path){return {path,id:path.split('/').pop(),async update(patch){apply(path,patch)}}}
 function apply(path,patch){const data={...records.get(path)};for(const [k,v] of Object.entries(patch)){if(v===remove)delete data[k];else data[k]=v}records.set(path,data)}
 const snap=path=>({exists:records.has(path),id:path.split('/').pop(),ref:ref(path),data:()=>structuredClone(records.get(path))});
 const db={collection(name){return {doc:id=>ref(name+'/'+id),where:()=>({get:async()=>{const docs=[...records.keys()].filter(k=>k.startsWith(name+'/')).map(snap);return {docs,size:docs.length}}})}},async runTransaction(fn){const writes=[];await fn({get:async r=>snap(r.path),update:(r,p)=>writes.push([r.path,p]),set:(r,p)=>writes.push([r.path,p])});for(const [path,patch] of writes)apply(path,patch)}};
 const admin={initializeApp(){},firestore:()=>db};admin.firestore.FieldValue={delete:()=>remove};
 const exports={};
 const context={exports,require(name){if(name==='firebase-functions/v2/scheduler')return {onSchedule:(options,callback)=>callback};if(name==='firebase-functions/params')return {defineSecret:()=>({value:()=> 'test-key'}),defineBoolean:()=>({value:()=>true})};if(name==='firebase-admin')return admin;if(name==='./settlement')return require('../functions-results/settlement');throw Error(name)},Date:class extends Date{static now(){return now}},AbortSignal,fetch:async()=>{if(failure)throw Error('provider unavailable');return {ok:true,json:async()=>structuredClone(box)}},console:{error(){}}};
 context.console.log=()=>{};
 context.process={env:{DEPLOY_PAID_SPORTS_RESULTS:String(paid)}};
 const originalRequire=context.require;context.require=name=>name==='./free-feeds'?{compatibleStart:require('../functions-results/free-feeds').compatibleStart,createFreeReader:()=>async m=>{if(failure)throw Error('provider unavailable');return {...require('../functions-results/settlement').normalize(m,box),provider:'nba'};},read(){}}:name==='./free-mappings'?{prepareNFL:async()=>({linked:0}),prepareNBA:async()=>({linked:0})}:originalRequire(name);
 vm.runInNewContext(fs.readFileSync('functions-results/index.js','utf8'),context);
 return {run:free?exports.syncFreeSportsResults:exports.syncSportsResults,exported:Object.keys(exports),records,box,advance:()=>{now+=180000},fail:()=>{failure=true}};
}
test('worker waits for two stable closed finals, applies once and audits corrections',async()=>{
 const w=worker();await w.run();assert.equal(w.records.get('players/p').status,'upcoming');
 w.advance();await w.run();assert.equal(w.records.get('players/p').current,20);assert.equal(w.records.get('players/p').status,'final');
 await w.run();assert.equal([...w.records.keys()].filter(k=>k.startsWith('sportsSettlementAudit/')).length,1);
 w.box.PlayerGames[0].Points=21;await w.run();w.advance();await w.run();
 assert.equal(w.records.get('players/p').current,20);
 assert.equal(w.records.get('players/p').proposedSettlement.current,21);
 assert.equal([...w.records.keys()].filter(k=>k.startsWith('sportsSettlementAudit/')).length,2);
});
test('provider errors cannot mutate scores or settle missing data',async()=>{
 const w=worker();w.fail();await w.run();assert.equal(w.records.get('players/p').status,'upcoming');assert.equal(w.records.get('players/p').current,undefined);assert.match(w.records.get('sportsGames/g').lastError,/unavailable/);
});
test('postponements block entry and rescheduled UTC time replaces deadline',async()=>{
 const w=worker();w.box.Game.Status='Postponed';w.box.Game.IsClosed=false;await w.run();assert.equal(w.records.get('players/p').eventStatus,'postponed');
 w.box.Game.Status='Scheduled';w.box.Game.DateTimeUTC='2026-11-03T20:00:00';await w.run();
 assert.equal(w.records.get('players/p').commenceTime,'2026-11-03T20:00:00.000Z');
 assert.equal(w.records.get('players/p').lockAtMs,Date.parse('2026-11-03T19:50:00Z'));
});
test('free scheduled worker requires stable finals, preserves corrections and survives feed failure',async()=>{
 const w=worker(true);await w.run();assert.equal(w.records.get('players/p').status,'upcoming');
 w.advance();await w.run();assert.equal(w.records.get('players/p').current,20);assert.equal(w.records.get('players/p').settlement.provider,'nba');
 w.box.PlayerGames[0].Points=22;await w.run();w.advance();await w.run();assert.equal(w.records.get('players/p').current,20);assert.equal(w.records.get('players/p').proposedSettlement.current,22);
 w.fail();await w.run();assert.equal(w.records.get('players/p').current,20);
});
test('free-only deployment does not discover a paid function or require a paid secret',()=>{
 assert.deepEqual(worker(true,false).exported,['syncFreeSportsResults']);
});
