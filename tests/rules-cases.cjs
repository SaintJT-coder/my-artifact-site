// Non-mutating Firebase Rules API fixtures: all document lookups are mocked.
const cutoff=Date.parse('2026-10-23T19:00:00Z');
const entry={id:'new',type:'team',picks:[{pid:'new-pick',side:'a',mult:2}]};
const old={id:'old',type:'team',picks:[{pid:'already-live',side:'a',mult:2}]};
const cases=[];
function add(name,expectation,patch={},change={},resource){
 const request={auth:{uid:'test-user'},path:'/databases/(default)/documents/slips/test-user',method:'create',time:'2026-10-23T19:00:00Z',resource:{data:{entries:[entry]}},...change};
 cases.push({name,test:{expectation,request,...(resource?{resource}:{}),functionMocks:[{function:'get',args:[{anyValue:{}}],result:{value:{data:{status:'upcoming',game:'NBA',kind:'team',aMult:2,bMult:2,lockAtMs:cutoff+1,...patch}}}}]}});
}
add('one millisecond before cutoff','ALLOW');
add('exact cutoff','DENY',{lockAtMs:cutoff});
add('one millisecond after cutoff','DENY',{lockAtMs:cutoff-1});
add('missing time','DENY',{lockAtMs:null});
add('postponed','DENY',{eventStatus:'postponed'});
add('suspended','DENY',{eventStatus:'suspended'});
add('canceled','DENY',{eventStatus:'canceled'});
add('awaiting final stats','DENY',{eventStatus:'final'});
add('live status','DENY',{status:'live'});
add('final status','DENY',{status:'final'});
add('other sport','ALLOW',{game:'CFB',lockAtMs:null});
add('other user','DENY',{}, {auth:{uid:'other'}});
add('unauthenticated','DENY',{}, {auth:null});
add('changed multiplier','DENY',{aMult:3});
add('wrong pick type','DENY',{kind:'player'});
add('append retains existing locked picks','ALLOW',{}, {method:'update',resource:{data:{entries:[old,entry]}}},{data:{entries:[old]}});
add('changing past slips denied','DENY',{}, {method:'update',resource:{data:{entries:[{...old,id:'tampered'},entry]}}},{data:{entries:[old]}});
add('replacing past slip denied','DENY',{}, {method:'update',resource:{data:{entries:[entry]}}},{data:{entries:[old]}});
add('deleting slips denied','DENY',{}, {method:'delete',resource:null},{data:{entries:[old]}});
const props={id:'props',type:'props',picks:[{pid:'p1',line:25.5,dir:'more'},{pid:'p2',line:25.5,dir:'less'}]};
add('player picks admitted','ALLOW',{kind:'player',line:25.5},{resource:{data:{entries:[props]}}});
add('changed player line','DENY',{kind:'player',line:26.5},{resource:{data:{entries:[props]}}});
add('six pick slip admitted','ALLOW',{}, {resource:{data:{entries:[{...entry,picks:Array.from({length:6},(_,i)=>({...entry.picks[0],pid:'p'+i}))}]}}});
add('seven pick slip denied','DENY',{}, {resource:{data:{entries:[{...entry,picks:Array.from({length:7},(_,i)=>({...entry.picks[0],pid:'p'+i}))}]}}});
module.exports=cases;
