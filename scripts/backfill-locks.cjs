// Dry run by default. Requires a short-lived Google OAuth token with Firestore access.
// Only derives deadlines from existing explicit UTC schedules; never matches names.
const {start,supported}=require('../functions/lifecycle');
async function run(token,{apply=false,project='pickslip-4e265'}={}){
 if(!token)throw Error('FIREBASE_ACCESS_TOKEN is required');
 const root=`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
 async function call(url,options={}){
  const r=await fetch(url,{...options,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}});
  if(!r.ok)throw Error('Firestore HTTP '+r.status);
  return r.json();
 }
 let page='',eligible=0,unchanged=0,missing=0;
 do{
  const data=await call(root+'/players?pageSize=300'+(page?'&pageToken='+encodeURIComponent(page):''));
  for(const doc of data.documents||[]){
   const f=doc.fields,p={game:f.game?.stringValue,commenceTime:f.commenceTime?.stringValue};
   if(!supported(p))continue;
   const ms=start(p);
   if(!Number.isFinite(ms)){missing++;continue;}
   if(Number(f.lockAtMs?.integerValue??f.lockAtMs?.doubleValue)===ms-600000){unchanged++;continue;}
   eligible++;
   if(apply)await call('https://firestore.googleapis.com/v1/'+doc.name+'?updateMask.fieldPaths=lockAtMs&currentDocument.updateTime='+encodeURIComponent(doc.updateTime),{method:'PATCH',body:JSON.stringify({fields:{lockAtMs:{integerValue:String(ms-600000)}}})});
  }
  page=data.nextPageToken;
 }while(page);
 const report={apply,eligible,unchanged,missing};console.log(JSON.stringify(report));return report;
}
module.exports=run;
if(require.main===module)run(process.env.FIREBASE_ACCESS_TOKEN,{apply:process.argv.includes('--apply'),project:process.env.GCLOUD_PROJECT}).catch(e=>{console.error(e.message);process.exitCode=1});
