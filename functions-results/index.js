'use strict';
const {onSchedule}=require('firebase-functions/v2/scheduler');

const {defineSecret,defineBoolean}=require('firebase-functions/params');
const admin=require('firebase-admin');
admin.initializeApp();

const {normalize,plan,digest}=require('./settlement');
const key=defineSecret('SPORTSDATAIO_KEY');
const enabled=defineBoolean('SPORTS_RESULTS_ENABLED',{default:false});
const realData=defineBoolean('SPORTS_RESULTS_REAL_DATA',{default:false});
async function getBox(mapping){
  if(!['NBA','NFL'].includes(mapping.league)||!Number.isSafeInteger(mapping.providerGameId)||mapping.providerGameId<=0)throw Error('Invalid provider mapping');
  const url=`https://api.sportsdata.io/v3/${mapping.league.toLowerCase()}/stats/json/BoxScore/${mapping.providerGameId}`;
  const r=await fetch(url,{headers:{'Ocp-Apim-Subscription-Key':key.value()},signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error('Sports provider HTTP '+r.status);
  return normalize(mapping,await r.json());
}
exports.syncSportsResults=onSchedule({schedule:'every 1 minutes',region:'us-central1',secrets:[key],timeoutSeconds:540,maxInstances:1,retryCount:0},async()=>{
  if(!enabled.value()||!realData.value())return;
  const db=admin.firestore();
  // Only administrator-verified mappings are polled. Continue monitoring for corrections
  // until monitorUntil (at least 7 days after final); never infer a provider ID by name.
  const mappings=await db.collection('sportsGames').where('enabled','==',true).get();
  for(const doc of mappings.docs){
    const m=doc.data(),now=Date.now();
    if(m.provider!=='sportsdataio'||m.verified!==true||!Number.isFinite(m.monitorUntil)||m.monitorUntil<now||!Number.isFinite(m.pollFrom)||m.pollFrom>now)continue;
    try{
      const event=await getBox(m);
      if(!event.start)throw Error('Confirmed UTC start time is missing');
      const candidates=await db.collection('players').where('sportsMapping.gameKey','==',doc.id).get();
      if(candidates.size>200)throw Error('Too many linked picks for one atomic settlement; administrator review required');
      // A transaction prevents concurrent manual edits or overlapping retries being lost.
      await db.runTransaction(async tx=>{
        const game=await tx.get(doc.ref);
        if(!game.exists||digest(game.data())!==digest(m))return;
        const snaps=[];
        for(const candidate of candidates.docs)snaps.push(await tx.get(candidate.ref));
        const eventHash=digest(event),old=game.data();
        const stable=old.observedHash===eventHash&&now-old.observedSince>=120000;
        for(const snap of snaps){
          if(!snap.exists)continue;
          const p=snap.data();
          if(p.game!==m.league||p.sportsMapping?.gameId!==m.providerGameId||p.sportsMapping?.gameKey!==doc.id)continue;
          const patch={eventStatus:event.status,lastSportsSync:now};
          if(event.start){patch.commenceTime=event.start;patch.lockAtMs=Date.parse(event.start)-600000;}
          // Keep accepted lines, multipliers, and slip snapshots unchanged.
          if(event.status==='live'&&p.status!=='final')patch.status='live';
          if(event.status==='scheduled'&&p.status!=='final')patch.status='upcoming';
          if(event.status==='final')Object.assign(patch,stable?plan(p,event):{reviewReason:'awaiting-stable-final'});
          if(['postponed','suspended','canceled'].includes(event.status))patch.reviewReason=event.status;
          if(patch.settlement)patch.reviewReason=admin.firestore.FieldValue.delete();
          tx.update(snap.ref,patch);
          if(patch.settlement||patch.proposedFingerprint){
            const fingerprint=patch.settlement?.fingerprint||patch.proposedFingerprint;
            tx.set(db.collection('sportsSettlementAudit').doc(digest([snap.id,fingerprint])),{pickId:snap.id,gameKey:doc.id,observedAt:now,eventHash,decision:patch.settlement?'applied':'review',result:patch.proposedSettlement||{status:patch.status,result:patch.result,current:patch.current}},{merge:true});
          }
        }
        const finalFirstSeenAt=old.finalFirstSeenAt||(event.status==='final'?now:null);
        tx.update(doc.ref,{observedHash:eventHash,observedSince:old.observedHash===eventHash?old.observedSince:now,lastSuccess:now,lastError:admin.firestore.FieldValue.delete(),
          monitorUntil:Math.max(old.monitorUntil,Date.parse(event.start)+7*86400000,finalFirstSeenAt?finalFirstSeenAt+7*86400000:0),
          ...(finalFirstSeenAt?{finalFirstSeenAt}:{})});
      });
    }catch(error){
      // No status/result writes on provider errors. Log no credentials or raw responses.
      console.error('Sports sync failed',doc.id,error.message);
      await doc.ref.update({lastError:String(error.message).slice(0,200),lastAttempt:now});
    }
  }
});


