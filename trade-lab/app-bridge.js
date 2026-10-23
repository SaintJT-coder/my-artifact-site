/* FieldVision authenticated bridge.
 * All GitHub and ESPN secrets remain on the backend.
 * Backend must be deployed before dispatch or data refresh can succeed.
 */
import {initializeApp} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

const app=initializeApp({
 apiKey:"AIzaSyA4Z1PnKxXnTVJ_G-XCGse323DiUhkwhwI",
 authDomain:"pickslip-4e265.firebaseapp.com",
 projectId:"pickslip-4e265",
 storageBucket:"pickslip-4e265.firebasestorage.app",
 messagingSenderId:"893144261549",
 appId:"1:893144261549:web:d3624341a6777ad2963724",
},"fieldvision");
const auth=getAuth(app);
const API="https://us-central1-pickslip-4e265.cloudfunctions.net/fieldvisionDispatch";
const $=id=>document.getElementById(id);
const note=(value)=>{$("copyMessage").textContent=value;};
const actionIds=["previewTrade","liveTrade","runLineupDry","runLineupLive","refreshIntelligence","refreshStatuses","loadSnapshot","checkRuns"];
let busy=false;
function setBusy(value) {
 busy=value;for(const id of actionIds) $(id).disabled=value;
}
async function api(path,method="GET",data=null) {
 const user=auth.currentUser;
 if(!user)throw Error("Sign in with the authorized Google account first.");
 const jwt=await user.getIdToken();
 let response;
 try {
   response=await fetch(API+"/"+path,{
     method,headers:{"Authorization":"Bearer "+jwt,...(data?{"Content-Type":"application/json"}:{})},
     ...(data?{body:JSON.stringify(data)}:{}),
     cache:"no-store"
   });
 }catch(err) {
   throw Error("Secure bot connection is not deployed or is unreachable. Backend setup is required.");
 }
 let result;try{result=await response.json()}catch(_){throw Error("Invalid response from secure bot backend.");}
 if(!response.ok)throw Error(result.error||"Backend returned error "+response.status);
 return result;
}
async function run(task,success) {
 if(busy)return;
 setBusy(true);note("Connecting securely...");
 try{const result=await task();note(success?.(result)||"Request accepted.");return result;}
 catch(error){note("⚠ "+error.message);return null}
 finally{setBusy(false)}
}
$("signInBot").addEventListener("click",async()=>{
 $("loginState").textContent="Opening Google sign-in...";
 try {
   await signInWithPopup(auth,new GoogleAuthProvider());
 }catch(error){
   $("loginState").textContent="Sign-in failed: "+(error.code||error.message);
 }
});
$("signOutBot").addEventListener("click",()=>signOut(auth));
onAuthStateChanged(auth,user=>{
 $("loginState").textContent=user
   ?"Signed in as "+(user.email||"Google user")+". Server access is limited to the approved owner."
   :"Not signed in. Use your authorized Google account to run the bot.";
 $("signInBot").hidden=Boolean(user);
 $("signOutBot").hidden=!user;
});
function players(){
 const offer=$("offerName").value.trim(),request=$("requestName").value.trim();
 if(!/^[A-Za-z .'-]{2,60}$/.test(offer)||!/^[A-Za-z .'-]{2,60}$/.test(request)||offer.toLowerCase()===request.toLowerCase())
   throw Error("Enter two different player names.");
 return {offer,request};
}
$("previewTrade").addEventListener("click",()=>run(async()=>api("dispatch","POST",{kind:"trade",...players(),live:false}),()=> "Trade scan queued. View recent runs for results."));
$("liveTrade").addEventListener("click",()=>run(async()=>{
 const selected=players();
 // Native confirm is intentional: live writes need a separate explicit human gesture.
 if(!confirm("Send REAL ESPN trade proposals across all matching leagues?\n\nOffer: "+selected.offer+"\nRequest: "+selected.request+"\n\nThe bot will skip known duplicates."))
   throw Error("Live proposal canceled.");
 return api("dispatch","POST",{kind:"trade",...selected,live:true,confirm:"SEND_ALL_MATCHING_TRADES"});
},()=> "Real trade batch queued. Open recent runs to monitor the result."));
$("runLineupDry").addEventListener("click",()=>run(()=>api("dispatch","POST",{kind:"lineup",live:false}),()=> "Lineup dry run queued."));
$("runLineupLive").addEventListener("click",()=>run(async()=>{
 if(!confirm("Run REAL lineup updates across your configured ESPN leagues?"))throw Error("Lineup update canceled.");
 return api("dispatch","POST",{kind:"lineup",live:true,confirm:"UPDATE_LINEUPS"});
},()=> "Live lineup workflow queued. GitHub's existing write safeguards still apply."));
$("refreshIntelligence").addEventListener("click",()=>run(()=>api("dispatch","POST",{kind:"intelligence",top:3}),()=> "Roster analysis queued. Load latest data after it completes."));
$("refreshStatuses").addEventListener("click",()=>run(()=>api("dispatch","POST",{kind:"status"}),()=> "Trade status report queued."));
$("loadSnapshot").addEventListener("click",()=>run(async()=>{
 const result=await api("snapshot");
 if(result.analysis) {
   localStorage.setItem("fieldvision-v1",JSON.stringify({analysis:result.analysis,history:result.history||[]}));
   // Public PWA uses local-only rendering; reload to populate existing views.
   location.reload();
 }else if(result.history){
   localStorage.setItem("fieldvision-v1",JSON.stringify({analysis:null,history:result.history}));
   location.reload();
 }
 return result;
},()=> "Latest private data downloaded."));
$("checkRuns").addEventListener("click",()=>run(()=>api("runs"),result=>{
 const safe=(s)=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 $("runsPanel").innerHTML=(result.runs||[]).slice(0,10).map(r=>
   '<div class="league-row"><strong>'+safe(r.kind)+"</strong> · "+safe(r.conclusion||r.status)+
   '<div class="detail">'+safe(new Date(r.created_at).toLocaleString())+"</div></div>"
 ).join("")||"No recent workflow runs.";
 return "Fetched recent runs.";
}));
