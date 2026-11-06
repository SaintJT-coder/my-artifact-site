"use strict";

const WIN_PAY={p2:3,p3:5,p4:10,p5:20,p6:37.5,f3_3:2.25,f3_2:1.25,f4_4:5,f4_3:1.5,f5_5:10,f5_4:2,f6_6:25,f6_5:2,f6_4:0.4};
const RELEVANT_FIELDS=["status","current","result","spoiled"];
const MAX_MATCHING_USERS=200;
const MAX_DEVICES_PER_USER=10;

function slipOutcome(e,playerData){
 if(!Array.isArray(e.picks)||!e.picks.length||!Number.isFinite(Number(e.amt)))return null;
 const states=e.picks.map(p=>{
  const pl=playerData[p.pid];
  if(!pl)return "void";
  if(pl.spoiled&&p.promo==="taco")return "push";
  if(p.side)return pl.status==="final"&&pl.result?(pl.result==="void"?"push":pl.result===p.side?"hit":"miss"):"open";
  if(pl.status!=="final"||pl.current==null)return "open";
  const actual=Number(pl.current),line=Number(p.line);
  if(!Number.isFinite(actual)||!Number.isFinite(line))return "open";
  return actual===line?"push":((p.dir==="more"?actual>line:actual<line)?"hit":"miss");
 });
 if(states.includes("open"))return null;
 const active=e.picks.filter((p,i)=>states[i]==="hit"||states[i]==="miss");
 const hits=states.filter(x=>x==="hit").length,n=active.length,amt=Number(e.amt);
 let won;
 if(e.type==="team")won=n===0?amt:hits<n?0:amt*active.reduce((m,p)=>m*Number(p.mult),1);
 else if(n<2)won=amt;
 else{
  const pay=e.pay||WIN_PAY,base=e.mode==="power"||n<3?(hits===n?Number(pay["p"+n]||0):0):Number(pay["f"+n+"_"+hits]||0);
  won=base>0?amt*base*Number(e.pmul||1)*Number(e.bst||1):0;
 }
 if(e.prot&&won===0)won=amt;
 return Number.isFinite(won)?Math.max(0,won-amt):null;
}

function settlementRelevantChange(before,after){
 return RELEVANT_FIELDS.some(field=>JSON.stringify(before?.[field]??null)!==JSON.stringify(after?.[field]??null));
}

async function getPlayers(db,ids){
 const data={};
 for(let i=0;i<ids.length;i+=100){
  const refs=ids.slice(i,i+100).map(id=>db.collection("players").doc(id));
  const docs=await db.getAll(...refs);
  docs.forEach(doc=>{if(doc.exists)data[doc.id]=doc.data()});
 }
 return data;
}

function createWinningSlipNotifier({admin,hash}){
 return async event=>{
  const before=event.data?.before?.data(),after=event.data?.after?.data();
  if(!before||!after||!settlementRelevantChange(before,after))return {matchedUsers:0,notified:0};
  const db=admin.firestore(),changedId=event.params.playerId;
  const matched=await db.collection("slips").where("pickIds","array-contains",changedId).limit(MAX_MATCHING_USERS+1).get();
  if(matched.size>MAX_MATCHING_USERS){
   console.error("Winning slip notification held: user bound exceeded",{playerId:changedId,matchedUsers:matched.size});
   return {matchedUsers:matched.size,notified:0,held:true};
  }
  const entries=[];
  for(const userDoc of matched.docs)for(const entry of userDoc.data().entries||[])
   if(entry?.id&&entry.picks?.some(p=>p.pid===changedId))entries.push({uid:userDoc.id,entry});
  const ids=[...new Set(entries.flatMap(x=>x.entry.picks.map(p=>p.pid)).filter(Boolean))];
  const playerData=await getPlayers(db,ids);playerData[changedId]=after;
  const oldData={...playerData,[changedId]:before};
  let notified=0;
  for(const {uid,entry} of entries){
   const profit=slipOutcome(entry,playerData),previous=slipOutcome(entry,oldData);
   if(!(profit>0)||(previous!==null&&previous>0))continue;
   const eventId=hash(uid+":"+entry.id),sentRef=db.collection("pushWinNotifications").doc(eventId);
   try{await sentRef.create({uid,slipId:entry.id,profit,createdAt:admin.firestore.FieldValue.serverTimestamp()})}
   catch(e){if(e.code===6||e.code==="already-exists")continue;throw e}
   const devices=await db.collection("pushDevices").where("uid","==",uid).where("enabled","==",true).limit(MAX_DEVICES_PER_USER).get();
   if(devices.empty)continue;
   const amount=profit.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
   const messages=devices.docs.map(d=>({token:d.data().token,notification:{title:"You won on PickSlip! 💰",body:"Congrats! You won $"+amount+". Place another PickSlip when you're ready."},webpush:{fcmOptions:{link:"https://saintjt-coder.github.io/my-artifact-site/preview/"}}}));
   const result=await admin.messaging().sendEach(messages);notified+=result.successCount;
   await Promise.all(result.responses.map((v,i)=>!v.success&&["messaging/registration-token-not-registered","messaging/invalid-registration-token"].includes(v.error?.code)?devices.docs[i].ref.delete():Promise.resolve()));
  }
  console.log("Winning slip notification results",{playerId:changedId,matchedUsers:matched.size,notified});
  return {matchedUsers:matched.size,notified};
 };
}

module.exports={slipOutcome,settlementRelevantChange,createWinningSlipNotifier,MAX_MATCHING_USERS};
