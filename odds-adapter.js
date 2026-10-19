/* PickSlip odds feed adapter. No API credentials belong in browser code.
 * Input: The Odds API event-odds JSON, fetched by an authenticated backend.
 * Output: normalized player props ready for review/import.
 */
(function(root){
"use strict";
const markets={
 player_pass_yds:"Passing Yards",player_rush_yds:"Rushing Yards",
 player_reception_yds:"Receiving Yards",player_receptions:"Receptions",
 player_pass_tds:"Passing Touchdowns",player_rush_attempts:"Rushing Attempts",
 player_pass_completions:"Pass Completions",player_pass_attempts:"Pass Attempts",
 player_anytime_td:"Anytime Touchdown"
};
function normalizeEvent(event,bookmakerKey){
 if(!event||!Array.isArray(event.bookmakers))return [];
 const output=[];
 for(const book of event.bookmakers){
  if(bookmakerKey&&book.key!==bookmakerKey)continue;
  for(const market of book.markets||[]){
   if(!markets[market.key])continue;
   const groups=new Map();
   for(const outcome of market.outcomes||[]){
    const player=String(outcome.description||"").trim();
    const side=String(outcome.name||"").toLowerCase();
    const line=Number(outcome.point);
    const odds=Number(outcome.price);
    if(!player||!Number.isFinite(odds)||(!Number.isFinite(line)&&market.key!=="player_anytime_td"))continue;
    if(!["over","under","yes"].includes(side))continue;
    const key=[player,Number.isFinite(line)?line:"td"].join("|");
    if(!groups.has(key))groups.set(key,{player,market:market.key,stat:markets[market.key],line:Number.isFinite(line)?line:null,bookmaker:book.key,bookmakerTitle:book.title,eventId:event.id,commenceTime:event.commence_time,homeTeam:event.home_team,awayTeam:event.away_team,source:"the-odds-api",retrievedAt:new Date().toISOString(),odds:{}});
    groups.get(key).odds[side]=odds;
   }
   output.push(...groups.values());
  }
 }
 return output;
}
function americanOdds(decimal){
 if(typeof decimal!=="number"||!Number.isFinite(decimal)||decimal<=1)return null;
 return decimal>=2?Math.round((decimal-1)*100):-Math.round(100/(decimal-1));
}
root.PickSlipOdds={normalizeEvent,americanOdds,markets};
})(typeof window!=="undefined"?window:globalThis);
