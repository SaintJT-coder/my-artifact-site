const {onCall,HttpsError}=require("firebase-functions/v2/https");
const {defineSecret}=require("firebase-functions/params");
const {getFirestore}=require("firebase-admin/firestore");
const {initializeApp}=require("firebase-admin/app");
initializeApp();
const oddsKey=defineSecret("ODDS_API_KEY");
const allowedMarkets=["player_pass_yds","player_rush_yds","player_reception_yds","player_receptions","player_pass_tds","player_rush_attempts","player_pass_completions","player_pass_attempts","player_anytime_td"];
async function getJson(url){
 const response=await fetch(url);
 if(!response.ok)throw new HttpsError("unavailable","Odds provider request failed ("+response.status+")");
 return response.json();
}
exports.getNflProps=onCall({secrets:[oddsKey],region:"us-central1",maxInstances:3},async(request)=>{
 if(!request.auth)throw new HttpsError("unauthenticated","Sign in required");
 const adminDoc=await getFirestore().collection("admins").doc(request.auth.uid).get();
 if(!adminDoc.exists||adminDoc.data()?.enabled!==true)throw new HttpsError("permission-denied","Admin access required");
 const key=oddsKey.value();
 if(!key)throw new HttpsError("failed-precondition","Odds API key not configured");
 const eventId=request.data?.eventId;
 const base="https://api.the-odds-api.com/v4/sports/americanfootball_nfl";
 if(!eventId){
  return {events:await getJson(base+"/events?apiKey="+encodeURIComponent(key))};
 }
 if(typeof eventId!=="string"||!/^[a-zA-Z0-9_-]{5,100}$/.test(eventId))throw new HttpsError("invalid-argument","Invalid event ID");
 const params=new URLSearchParams({apiKey:key,regions:"us",markets:allowedMarkets.join(","),oddsFormat:"american"});
 const event=await getJson(base+"/events/"+encodeURIComponent(eventId)+"/odds?"+params);
 return {event};
});
