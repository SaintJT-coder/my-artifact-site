// Requires a short-lived OAuth token with Firebase Rules access. No documents are written.
const fs=require('node:fs');
const cases=require('../tests/rules-cases.cjs');
async function run(token,project='pickslip-4e265'){
 if(!token)throw Error('FIREBASE_RULES_ACCESS_TOKEN is required');
 const content=fs.readFileSync(require('node:path').join(__dirname,'../firestore.rules'),'utf8');
 const r=await fetch(`https://firebaserules.googleapis.com/v1/projects/${project}:test`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({source:{files:[{name:'firestore.rules',content}]},testSuite:{testCases:cases.map(x=>x.test)}})});
 const d=await r.json();
 if(!r.ok)throw Error('Rules API HTTP '+r.status);
 if(d.issues?.some(x=>x.severity==='ERROR'))throw Error(JSON.stringify(d.issues));
 for(const [i,result] of (d.testResults||[]).entries()){
  console.log(`${result.state}: ${cases[i].name}`);
  if(result.state!=='SUCCESS')throw Error(JSON.stringify(result));
 }
 if(d.testResults?.length!==cases.length)throw Error('Incomplete rule test results');
 return d.testResults.length;
}
module.exports=run;
if(require.main===module)run(process.env.FIREBASE_RULES_ACCESS_TOKEN,process.env.GCLOUD_PROJECT).catch(e=>{console.error(e.message);process.exitCode=1});
