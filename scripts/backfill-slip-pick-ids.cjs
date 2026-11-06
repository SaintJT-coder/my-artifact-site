// Dry run by default. Adds only the reverse index used by bounded win notifications.
// Existing entries, results and balances are never rewritten.
function pickIds(fields){
 const ids=[];
 for(const entry of fields.entries?.arrayValue?.values||[])
  for(const pick of entry.mapValue?.fields?.picks?.arrayValue?.values||[]){
   const id=pick.mapValue?.fields?.pid?.stringValue;
   if(id&&!ids.includes(id))ids.push(id);
  }
 return ids;
}

async function run(token,{apply=false,project='pickslip-4e265'}={}){
 if(!token)throw Error('FIREBASE_ACCESS_TOKEN is required');
 const root=`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
 async function call(url,options={}){
  const r=await fetch(url,{...options,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}});
  if(!r.ok)throw Error('Firestore HTTP '+r.status);
  return r.json();
 }
 let page='',eligible=0,unchanged=0,empty=0;
 do{
  const data=await call(root+'/slips?pageSize=300'+(page?'&pageToken='+encodeURIComponent(page):''));
  for(const doc of data.documents||[]){
   const ids=pickIds(doc.fields||{}),old=(doc.fields?.pickIds?.arrayValue?.values||[]).map(x=>x.stringValue).filter(Boolean);
   if(!ids.length){empty++;continue;}
   if(ids.length===old.length&&ids.every((id,i)=>id===old[i])){unchanged++;continue;}
   eligible++;
   if(apply)await call('https://firestore.googleapis.com/v1/'+doc.name+'?updateMask.fieldPaths=pickIds&currentDocument.updateTime='+encodeURIComponent(doc.updateTime),{method:'PATCH',body:JSON.stringify({fields:{pickIds:{arrayValue:{values:ids.map(stringValue=>({stringValue}))}}}})});
  }
  page=data.nextPageToken;
 }while(page);
 const report={apply,eligible,unchanged,empty};console.log(JSON.stringify(report));return report;
}

module.exports={run,pickIds};
if(require.main===module)run(process.env.FIREBASE_ACCESS_TOKEN,{apply:process.argv.includes('--apply'),project:process.env.GCLOUD_PROJECT}).catch(e=>{console.error(e.message);process.exitCode=1});
