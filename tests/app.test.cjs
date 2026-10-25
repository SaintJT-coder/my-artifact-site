const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function app(){
 const nodes=new Map(),listeners={},errors=[];
 function node(id){if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){}},addEventListener(){},querySelectorAll(){return []},append(){},appendChild(){}});return nodes.get(id)}
 const auth={currentUser:{uid:'test',isAnonymous:false},setPersistence:async()=>{}};
 const snap={exists:false,data:()=>({}),docs:[]};
 const db={doc:()=>({get:async()=>snap,set:async()=>{},onSnapshot:cb=>cb(snap)}),collection:()=>({onSnapshot:cb=>cb(snap)})};
 const firebase={apps:[],initializeApp(){},auth:()=>auth,firestore:()=>db};firebase.auth.Auth={Persistence:{LOCAL:'local'}};
 const context={console:{log(){},warn(){},error(...x){errors.push(x)}},document:{getElementById:node,addEventListener:(name,cb)=>{(listeners[name]??=[]).push(cb)},querySelectorAll:()=>[],querySelector:()=>null,body:node('body'),documentElement:node('html')},firebase,localStorage:{getItem:()=>null,setItem(){}},navigator:{},location:{href:'http://test/',reload(){}},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,MutationObserver:class{observe(){}},fetch:async()=>{throw Error('Unexpected network')},URL,Date,addEventListener(){},confirm:()=>true,alert(){}};
 context.window=context;context.globalThis=context;
 vm.createContext(context);
 vm.runInContext(fs.readFileSync('firebase-config.js','utf8'),context);
 vm.runInContext(fs.readFileSync('functions/lifecycle.js','utf8'),context);
 for(const match of fs.readFileSync('index.html','utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(!/src=/.test(match[1]))vm.runInContext(match[2],context);
 vm.runInContext(fs.readFileSync('pickslip-redesign.js','utf8'),context);
 return {context,nodes,errors,run:s=>vm.runInContext(s,context)};
}
test('full app scripts initialize and render without startup errors',async()=>{
 const a=app();await new Promise(r=>setImmediate(r));
 assert.deepEqual(a.errors,[]);
 assert.match(a.nodes.get('main').innerHTML,/rd-sports/);
 a.run('view="entries";render()');assert.match(a.nodes.get('main').innerHTML,/No active slips/);
});
test('board removes locked team and player picks, slips retain them with LIVE dot',async()=>{
 const a=app();await new Promise(r=>setImmediate(r));
 a.run(`players={p:{game:'NFL',name:'Test Player',team:'Test',stat:'Passing Yards',line:200,status:'upcoming',commenceTime:new Date(Date.now()-1000).toISOString()},t:{game:'NFL',kind:'team',title:'Test Match',aLabel:'A',bLabel:'B',aMult:2,bMult:2,status:'upcoming',commenceTime:new Date(Date.now()-1000).toISOString()}};gf='NFL';view='board';bsub='players';render()`);
 assert.doesNotMatch(a.nodes.get('cards').innerHTML,/Test Player/);
 a.run(`bsub='teams';render()`);assert.doesNotMatch(a.nodes.get('cards').innerHTML,/Test Match/);
 assert.match(a.run('badge(players.p)'),/sports-live-dot.*LIVE/);
 assert.match(a.run('badge(players.t)'),/sports-live-dot.*LIVE/);
 assert.equal(a.run(`pickState({pid:'p',line:200,dir:'more'}).r`),'open');
 assert.equal(a.run(`pickState({pid:'missing',line:200,dir:'more'}).r`),'open');
});
test('existing payout behavior: pushes, team multipliers, protection and promo boosts',async()=>{
 const a=app();await new Promise(r=>setImmediate(r));
 a.run(`players={a:{status:'final',current:30},b:{status:'final',current:20},c:{status:'final',result:'void'},t:{kind:'team',status:'final',result:'a'}}`);
 assert.equal(a.run(`evalEntry({type:'props',amt:10,mode:'power',pay:{p2:3},pmul:2,bst:1.5,picks:[{pid:'a',line:25,dir:'more'},{pid:'b',line:25,dir:'less'},{pid:'c',line:5,dir:'more'}]}).won`),90);
 assert.equal(a.run(`evalEntry({type:'props',amt:10,mode:'power',pay:{p2:3},prot:true,picks:[{pid:'a',line:25,dir:'less'},{pid:'b',line:25,dir:'less'}]}).won`),10);
 assert.equal(a.run(`evalEntry({type:'team',amt:10,picks:[{pid:'t',side:'a',mult:2.5},{pid:'c',side:'a',mult:9}]}).won`),25);
});
test('NFL filters omit expired weeks and clear stale saved selections',async()=>{
 const a=app();await new Promise(r=>setImmediate(r));
 a.run(`players={old:{game:'NFL',week:6,name:'Old',stat:'Passing TDs',status:'upcoming',commenceTime:new Date(Date.now()-86400000).toISOString()},soon:{game:'NFL',week:7,name:'Z Next',team:'Test',stat:'Passing Yards',line:200,status:'upcoming',commenceTime:new Date(Date.now()+3600000).toISOString()},later:{game:'NFL',week:8,name:'A Later',team:'Test',stat:'Rushing TDs',line:0.5,status:'upcoming',commenceTime:new Date(Date.now()+86400000).toISOString()}};wf='6';sf='Passing TDs';gf='NFL';view='board';bsub='players';render()`);
 const html=a.nodes.get('main').innerHTML;
 assert.doesNotMatch(html,/Week 6/);assert.match(html,/Week 7/);assert.match(html,/Week 8/);
 assert.equal(a.run('wf'),'All');assert.equal(a.run('sf'),'All');
 const cards=a.nodes.get('cards').innerHTML;
 assert.ok(cards.indexOf('Z Next')<cards.indexOf('A Later'));
});
