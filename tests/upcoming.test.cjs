const test=require('node:test');
const assert=require('node:assert/strict');
const {eligible,buildPicks,refreshUpcoming}=require('../functions/upcoming');
const now=Date.now();
const event={id:'a'.repeat(32),home_team:'Home',away_team:'Away',commence_time:new Date(now+86400000).toISOString()};
function odds(){return {...event,bookmakers:[{key:'draftkings',markets:[{key:'player_points',outcomes:[{name:'Over',description:'Player',point:20.5,price:-110}]},{key:'player_rush_yds',outcomes:[{name:'Over',description:'Runner',point:50.5,price:-110}]},{key:'h2h',outcomes:[{name:'Home',price:-120},{name:'Away',price:110}]},{key:'spreads',outcomes:[{name:'Home',point:-2.5,price:-110},{name:'Away',point:2.5,price:-110}]},{key:'totals',outcomes:[{name:'Over',point:200.5,price:-110},{name:'Under',point:200.5,price:-110}]}]}]};}
test('upcoming import restores both team and player boards with verified deadlines',()=>{
 for(const game of ['NFL','NBA']){
  const picks=buildPicks(game,event,odds(),now);
  assert.equal(picks.filter(x=>x.data.kind==='team').length,3);
  const player=picks.find(x=>x.data.kind!=='team');
  assert.equal(player.data.line,game==='NFL'?55.5:21.5);
  for(const p of picks){assert.equal(p.data.lockAtMs,Date.parse(event.commence_time)-600000);assert.equal(p.data.eventId,event.id);}
 }
});
test('no expired, near-start, undated, distant or mismatched events are imported',()=>{
 assert.equal(eligible({...event,commence_time:new Date(now+600000).toISOString()},now),false);
 assert.equal(eligible({...event,commence_time:null},now),false);
 assert.equal(eligible({...event,commence_time:new Date(now+8*86400000).toISOString()},now),false);
 assert.throws(()=>buildPicks('NBA',event,{...odds(),id:'b'.repeat(32)},now));
 assert.throws(()=>buildPicks('NBA',event,{...odds(),home_team:'Other'},now));
});
test('team pairs require the same book and complementary confirmed lines',()=>{
 const data=odds();data.bookmakers[0].markets.find(x=>x.key==='spreads').outcomes[1].point=3.5;
 data.bookmakers[0].markets.find(x=>x.key==='totals').outcomes[1].point=201.5;
 assert.equal(buildPicks('NBA',event,data,now).filter(x=>x.data.kind==='team').length,1);
});
test('refresh creates once, retains existing slips/lines, and skips completed events',async()=>{
 const data=new Map(),created=[];
 const db={collection(name){
  return {doc(id){
   const key=name+'/'+id;
   return {
    get:async()=>({data:()=>data.get(key)}),
    set:async value=>data.set(key,value),
    create:async value=>{if(data.has(key))throw {code:6};data.set(key,value);created.push(key)}
   };
  }};
 }};
 const getJSON=async path=>path.includes('/odds?')?odds():[event];
 const first=await refreshUpcoming({db,getJSON,key:'test',now,enrichPhotos:async(game,event,picks)=>picks});
 assert.equal(first.NBA.created,4);assert.equal(first.NFL.created,4);
 const count=created.length;
 const second=await refreshUpcoming({db,getJSON,key:'test',now:now+3600000,enrichPhotos:async(game,event,picks)=>picks});
 assert.equal(created.length,count);assert.equal(second.NBA.events,0);
});
test('provider failure never removes or rewrites picks',async()=>{
 const db={collection(){throw Error('No database writes should occur')}};
 const result=await refreshUpcoming({db,getJSON:async()=>{throw Error('offline')},key:'test',now});
 assert.equal(result.NFL.errors,1);assert.equal(result.NBA.errors,1);
});
test('all three distinct NFL touchdown markets retain confirmed sportsbook lines',()=>{
 const data=odds();data.bookmakers[0].markets=[
  {key:'player_pass_tds',outcomes:[{name:'Over',description:'QB',point:1.5,price:-110}]},
  {key:'player_rush_tds',outcomes:[{name:'Over',description:'RB',point:0.5,price:110}]},
  {key:'player_reception_tds',outcomes:[{name:'Over',description:'WR',point:0.5,price:120}]},
  {key:'player_anytime_td',outcomes:[{name:'Yes',description:'Other',price:120}]}
 ];
 const picks=buildPicks('NFL',event,data,now);
 assert.deepEqual(picks.map(p=>[p.data.stat,p.data.line]),[['Passing TDs',1.5],['Rushing TDs',0.5],['Receiving TDs',0.5]]);
 assert.equal(new Set(picks.map(p=>p.id)).size,3);
});
test('market expansion revisits completed NFL games once without reimporting NBA',async()=>{
 let state={complete:true,retryAfter:now+86400000};const requests=[];
 const db={collection(name){return {doc(){return {get:async()=>({data:()=>state}),set:async value=>{state=value},create:async()=>{}}}}}};
 const getJSON=async path=>{
  requests.push(path);
  if(path.includes('basketball_nba'))return [];
  if(!path.includes('/odds?'))return [event];
  const data=odds();data.bookmakers[0].markets=[{key:'player_pass_tds',outcomes:[{name:'Over',description:'QB',point:1.5,price:-110}]}];return data;
 };
 const options={db,getJSON,key:'test',now,enrichPhotos:async(game,event,picks)=>picks};
 await refreshUpcoming(options);
 assert.equal(state.marketVersion,2);assert.equal(state.complete,true);
 const quotes=requests.filter(x=>x.includes('/odds?'));assert.equal(quotes.length,1);
 assert.match(quotes[0],/markets=player_pass_tds,player_rush_tds,player_reception_tds&/);
 await refreshUpcoming(options);assert.equal(requests.filter(x=>x.includes('/odds?')).length,1);
});
