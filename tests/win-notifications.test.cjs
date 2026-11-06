const test=require("node:test");
const assert=require("node:assert/strict");
const {settlementRelevantChange,createWinningSlipNotifier,MAX_MATCHING_USERS}=require("../functions/win-notifications");

test("ignores timestamp-only player updates before any database query",async()=>{
 let queried=false;
 const admin={firestore:()=>{queried=true;throw Error("unexpected query")}};
 const notify=createWinningSlipNotifier({admin,hash:x=>x});
 const data={status:"final",current:10,lastSportsSync:1};
 await notify({params:{playerId:"p"},data:{before:{data:()=>data},after:{data:()=>({...data,lastSportsSync:2})}}});
 assert.equal(queried,false);
 assert.equal(settlementRelevantChange(data,{...data,lastSportsSync:2}),false);
});

test("queries only reverse-indexed slips and referenced players",async()=>{
 const calls=[],created=[];
 const playerDocs={p:{status:"final",current:11},q:{status:"final",current:9}};
 const slip={id:"u",data:()=>({pickIds:["p","q"],entries:[{id:"e",amt:10,type:"props",mode:"power",picks:[{pid:"p",line:10,dir:"more"},{pid:"q",line:10,dir:"less"}]}]})};
 const db={
  collection(name){return name==="slips"?{where(field,op,value){calls.push([name,field,op,value]);return{limit(n){calls.push(["limit",n]);return{get:async()=>({size:1,docs:[slip]})}}}}}:{doc:id=>({id,create:async x=>created.push([name,id,x])}),where(){return{where(){return{limit(){return{get:async()=>({empty:true,docs:[]})}}}}}}}},
  getAll:async(...refs)=>{calls.push(["getAll",...refs.map(x=>x.id)]);return refs.map(ref=>({id:ref.id,exists:true,data:()=>playerDocs[ref.id]}))}
 };
 const admin={firestore:()=>db,messaging:()=>({sendEach:async()=>({successCount:0,responses:[]})})};admin.firestore.FieldValue={serverTimestamp:()=>"now"};
 const notify=createWinningSlipNotifier({admin,hash:x=>x});
 const result=await notify({params:{playerId:"p"},data:{before:{data:()=>({status:"upcoming",current:null})},after:{data:()=>playerDocs.p}}});
 assert.deepEqual(calls[0],["slips","pickIds","array-contains","p"]);
 assert.deepEqual(calls[1],["limit",MAX_MATCHING_USERS+1]);
 assert.deepEqual(calls[2],["getAll","p","q"]);
 assert.equal(created.length,1);
 assert.equal(result.matchedUsers,1);
});

test("holds before fan-out when the matching-user bound is exceeded",async()=>{
 let playerReads=0;
 const db={collection:name=>name==="slips"?{where(){return{limit(){return{get:async()=>({size:MAX_MATCHING_USERS+1,docs:[]})}}}}}:{} ,getAll:async()=>{playerReads++;return[]}};
 const admin={firestore:()=>db};
 const notify=createWinningSlipNotifier({admin,hash:x=>x});
 const result=await notify({params:{playerId:"p"},data:{before:{data:()=>({status:"upcoming"})},after:{data:()=>({status:"final",current:1})}}});
 assert.equal(result.held,true);assert.equal(playerReads,0);
});
