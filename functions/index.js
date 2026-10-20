"use strict";
const {onRequest} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
admin.initializeApp();

const oddsKey = defineSecret("ODDS_API_KEY");
const PROJECT = "pickslip-4e265";
const BASE = "https://api.the-odds-api.com/v4";
const MARKETS = ["player_pass_yds","player_rush_yds","player_reception_yds"];
const MAX_EVENTS = 8;
const PLAYABLE_MARKETS = {player_pass_yds:"Passing Yards",player_rush_yds:"Rushing Yards",player_reception_yds:"Receiving Yards"};
const crypto = require("crypto");
const hash = s => crypto.createHash("sha256").update(s).digest("hex");
const priority = k => k === "draftkings" ? 0 : k === "fanduel" ? 1 : 2;
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const weekFromKickoff = iso => {
  // NFL 2026 regular season starts September 10; weeks run Thursday through Wednesday.
  const t = Date.parse(iso), start = Date.parse("2026-09-10T00:00:00Z");
  const w = Math.floor((t-start)/(7*86400000))+1;
  return Number.isFinite(t) && w>=1 && w<=18 ? w : null;
};

const clean = s => String(s || "").trim().slice(0,160);

async function getJSON(path, key) {
  const url = new URL(BASE + path);
  url.searchParams.set("apiKey", key);
  const res = await fetch(url);
  if (!res.ok) throw new Error("Odds API request failed (HTTP " + res.status + ")");
  return res.json();
}

// Manually invoke with an authorized Firebase ID token. Never expose this endpoint unauthenticated.
exports.importNflOdds = onRequest({region:"us-central1",secrets:[oddsKey],timeoutSeconds:120,maxInstances:1,cors:["https://saintjt-coder.github.io"]}, async (req,res) => {
  if (req.method !== "POST") return res.status(405).json({error:"POST required"});
  const token = /^Bearer (.+)$/.exec(req.get("Authorization") || "")?.[1];
  if (!token) return res.status(401).json({error:"Authentication required"});
  let decoded;
  try { decoded = await admin.auth().verifyIdToken(token, true); }
  catch { return res.status(401).json({error:"Invalid token"}); }
  // Grant the import privilege via Firebase custom claims on a trusted server.
  if (decoded.oddsImporter !== true) return res.status(403).json({error:"Importer permission required"});
  try {
    const key = oddsKey.value();
    const events = await getJSON("/sports/americanfootball_nfl/events",key);
    const upcoming = events.filter(e=>new Date(e.commence_time).getTime()>Date.now()).slice(0,MAX_EVENTS);
    let written = 0;
    let playable = 0;
    for (const event of upcoming) {
      const odds = await getJSON("/sports/americanfootball_nfl/events/"+encodeURIComponent(event.id)+"/odds?regions=us&markets="+MARKETS.join(",")+"&oddsFormat=american",key);
      const candidates = new Map();
      let batch = admin.firestore().batch();
      let count = 0;
      let pending = 0;
      for (const book of odds.bookmakers || []) for (const market of book.markets || []) {
        if (!MARKETS.includes(market.key)) continue;
        for (const outcome of market.outcomes || []) {
          if (!["Over","Under"].includes(outcome.name) || !outcome.description || !Number.isFinite(Number(outcome.point))) continue;
          const id = [event.id,book.key,market.key,outcome.description,outcome.name].join("|");
          const doc = admin.firestore().collection("oddsApiNflProps").doc(require("crypto").createHash("sha256").update(id).digest("hex"));
          batch.set(doc,{eventId:clean(event.id),homeTeam:clean(event.home_team),awayTeam:clean(event.away_team),commenceTime:event.commence_time,bookmaker:clean(book.key),market:market.key,player:clean(outcome.description),side:outcome.name,line:Number(outcome.point),americanOdds:Number(outcome.price),updatedAt:admin.firestore.FieldValue.serverTimestamp(),source:"the-odds-api"},{merge:true});
          // One candidate per event, player, market, and sportsbook; prefer Over as reference line.
          if (outcome.name === "Over" && Number(outcome.point)>=0) {
            const candidateKey = [event.id,market.key,clean(outcome.description).toLowerCase()].join("|");
            const old = candidates.get(candidateKey);
            if (!old || priority(book.key)<priority(old.bookmaker) ||
                (priority(book.key)===priority(old.bookmaker) && book.key < old.bookmaker)) {
              candidates.set(candidateKey,{player:clean(outcome.description),market:market.key,
                bookmaker:book.key,bookLine:Number(outcome.point)});
            }
          }
          count++; written++; pending++;
          if (pending === 400) { await batch.commit(); batch = admin.firestore().batch(); pending = 0; }
        }
      }
      if (pending) await batch.commit();
      const week = weekFromKickoff(event.commence_time);
      // Do not create new playable picks for games already underway or outside regular season.
      if (!week || Date.parse(event.commence_time) <= Date.now()) continue;
      for (const c of candidates.values()) {
        const stat = PLAYABLE_MARKETS[c.market];
        if (!stat) continue;
        const docId = "oddsapi-"+hash([event.id,c.player.toLowerCase(),c.market].join("|"));
        const ref = admin.firestore().collection("players").doc(docId);
        const adjusted = c.bookLine + (["Rushing Yards","Receiving Yards"].includes(stat)?5:0);
        // Create only: never reset statuses, results, or previously imported player lines.
        try {
          await ref.create({game:"NFL",name:c.player,team:"—",pos:"",opp:clean(event.away_team)+" @ "+clean(event.home_team),
            week,stat,book:c.bookLine,line:adjusted,l5:[],status:"upcoming",current:null,
            source:"the-odds-api",bookmaker:c.bookmaker,eventId:clean(event.id),commenceTime:event.commence_time});
          playable++;
        } catch (e) {
          if (e.code !== 6 && e.code !== "already-exists") throw e;
        }
      }
    }
    return res.json({ok:true,events:upcoming.length,props:written,playableCreated:playable});
  } catch(e) {
    console.error("NFL odds import failed",e.message);
    return res.status(502).json({error:"Odds import failed; check Cloud Functions logs"});
  }
});

const NBA_PLAYER_MARKETS={
 player_points:"Points",player_rebounds:"Rebounds",player_assists:"Assists",
 player_threes:"3-Pointers Made",player_points_rebounds_assists:"Points + Rebounds + Assists"
};
const NBA_TEAM_MARKETS=["h2h","spreads","totals"];
const nbaTeams={};
async function nbaOddsImport(req,res){
 if(req.method!=="POST")return res.status(405).json({error:"POST required"});
 const token=/^Bearer (.+)$/.exec(req.get("Authorization")||"")?.[1];
 if(!token)return res.status(401).json({error:"Authentication required"});
 let decoded;try{decoded=await admin.auth().verifyIdToken(token,true)}catch{return res.status(401).json({error:"Invalid token"})}
 if(decoded.oddsImporter!==true)return res.status(403).json({error:"Importer permission required"});
 try{
  const key=oddsKey.value();
  const events=await getJSON("/sports/basketball_nba/events",key);
  const upcoming=events.filter(e=>Date.parse(e.commence_time)>Date.now()).slice(0,8);
  let playerCreated=0,teamCreated=0,playerQuotes=0,teamQuotes=0;
  for(const ev of upcoming){
   const eventId=encodeURIComponent(ev.id);
   const url="/sports/basketball_nba/events/"+eventId+"/odds?regions=us&markets="+Object.keys(NBA_PLAYER_MARKETS).concat(NBA_TEAM_MARKETS).join(",")+"&oddsFormat=american";
   const response=await getJSON(url,key);
   const candidates=new Map(),teamCandidates=new Map();
   for(const book of response.bookmakers||[])for(const market of book.markets||[])for(const out of market.outcomes||[]){
    const isPlayer=Object.hasOwn(NBA_PLAYER_MARKETS,market.key);
    const isTeam=NBA_TEAM_MARKETS.includes(market.key);
    if(!isPlayer&&!isTeam)continue;
    const point=out.point==null?null:Number(out.point),price=Number(out.price);
    if(!Number.isFinite(price)|| (out.point!=null&&!Number.isFinite(point)))continue;
    const name=clean(out.description||out.name);
    if(isPlayer&&(!out.description||out.name!=="Over"||point===null||point<0))continue;
    if(isTeam&&market.key==="spreads"&&point===null)continue;
    if(isTeam&&market.key==="totals"&&(!["Over","Under"].includes(out.name)||point===null))continue;
    const k=isPlayer?[ev.id,market.key,name.toLowerCase()].join("|"):[ev.id,market.key,out.name].join("|");
    const m=isPlayer?candidates:teamCandidates;
    const prev=m.get(k);
    if(!prev||priority(book.key)<priority(prev.bookmaker)){
      m.set(k,{name,market:market.key,point,price,bookmaker:book.key});
    }
    if(isPlayer)playerQuotes++;else teamQuotes++;
   }
   for(const c of candidates.values()){
    const stat=NBA_PLAYER_MARKETS[c.market],adjusted=c.point+(["Points","Rebounds"].includes(stat)?1:0);
    const ref=admin.firestore().collection("players").doc("oddsapi-nba-"+hash([ev.id,c.market,c.name.toLowerCase()].join("|")));
    try{await ref.create({game:"NBA",name:c.name,team:"—",opp:clean(ev.away_team)+" @ "+clean(ev.home_team),
      stat,book:c.point,line:adjusted,status:"upcoming",current:null,l5:[],
      source:"the-odds-api",bookmaker:c.bookmaker,americanOdds:c.price,eventId:clean(ev.id),commenceTime:ev.commence_time,
      starterStatus:"unverified",importedAt:admin.firestore.FieldValue.serverTimestamp()});playerCreated++}
    catch(e){if(e.code!==6&&e.code!=="already-exists")throw e}
   }
   const byMarket={};for(const c of teamCandidates.values())(byMarket[c.market]??=[]).push(c);
   const match=clean(ev.away_team)+" @ "+clean(ev.home_team);
   for(const market of NBA_TEAM_MARKETS){
    const rows=byMarket[market]||[];
    let a,b,title;
    if(market==="h2h"){a=rows.find(x=>x.name===ev.home_team);b=rows.find(x=>x.name===ev.away_team);title="Moneyline"}
    if(market==="spreads"){a=rows.find(x=>x.name===ev.home_team);b=rows.find(x=>x.name===ev.away_team);title="Spread"}
    if(market==="totals"){a=rows.find(x=>x.name==="Over");b=rows.find(x=>x.name==="Under");title="Total Points"}
    if(!a||!b)continue;
    const ref=admin.firestore().collection("players").doc("oddsapi-nba-team-"+hash([ev.id,market].join("|")));
    const mult=odds=>odds>0?1+odds/100:1+100/Math.abs(odds);
    const fmt=c=>c.name+(c.point===null?"":" "+(c.point>0?"+":"")+c.point);
    try{await ref.create({kind:"team",game:"NBA",title:match+" · "+title,
      aLabel:fmt(a),bLabel:fmt(b),aMult:Number(mult(a.price).toFixed(3)),bMult:Number(mult(b.price).toFixed(3)),
      status:"upcoming",result:null,source:"the-odds-api",eventId:clean(ev.id),commenceTime:ev.commence_time,
      bookmakerA:a.bookmaker,bookmakerB:b.bookmaker,americanOddsA:a.price,americanOddsB:b.price,
      importedAt:admin.firestore.FieldValue.serverTimestamp()});teamCreated++}
    catch(e){if(e.code!==6&&e.code!=="already-exists")throw e}
   }
  }
  res.json({ok:true,events:upcoming.length,playerQuotes,teamQuotes,playerCreated,teamCreated});
 }catch(e){console.error("NBA odds import failed",e);res.status(502).json({error:"NBA import failed; inspect function logs and API market access"})}
}
exports.importNbaOdds=onRequest({region:"us-central1",secrets:[oddsKey],timeoutSeconds:120,maxInstances:1,cors:["https://saintjt-coder.github.io"]},nbaOddsImport);

const CFB_POLL_DATE="2026-10-18";
const CFB_TOP30=[
 "Miami","BYU","Ohio State","Notre Dame","Georgia","Indiana","Ole Miss","Texas Tech","UCLA","Utah",
 "Tennessee","Kentucky","Alabama","Houston","Iowa","USC","Wake Forest","LSU","Texas","Florida",
 "Boise State","Missouri","SMU","Northwestern","Arizona","Oklahoma State","Oregon","Auburn","James Madison","Mississippi State"
];
// AP Top 25 plus the five highest receiving-votes teams (Oct 18 2026).
// Revalidate/update this list each poll week; never silently claim it is a live ranking.
const cfbNorm=x=>String(x||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const CFB_ALIASES={
 "miami":["miami hurricanes","miami fl","miami (fl)"],
 "byu":["byu cougars","brigham young"],
 "ole miss":["ole miss rebels","mississippi rebels"],
 "usc":["usc trojans","southern cal","southern california"],
 "lsu":["lsu tigers","louisiana state"],
 "smu":["smu mustangs","southern methodist"],
 "uc la":["ucla bruins"]
};
function cfbRank(team){
 const t=cfbNorm(team);
 for(let i=0;i<CFB_TOP30.length;i++){
  const key=cfbNorm(CFB_TOP30[i]),aliases=(CFB_ALIASES[key]||[]).map(cfbNorm);
  if(t===key||t.startsWith(key+" ")||aliases.some(a=>t===a||t.startsWith(a+" ")))return i+1;
 }
 return null;
}
exports.importCfbOdds=onRequest({region:"us-central1",secrets:[oddsKey],timeoutSeconds:120,maxInstances:1,cors:["https://saintjt-coder.github.io"]},async(req,res)=>{
 if(req.method!=="POST")return res.status(405).json({error:"POST required"});
 const token=/^Bearer (.+)$/.exec(req.get("Authorization")||"")?.[1];
 if(!token)return res.status(401).json({error:"Authentication required"});
 let decoded;try{decoded=await admin.auth().verifyIdToken(token,true)}catch{return res.status(401).json({error:"Invalid token"})}
 if(decoded.oddsImporter!==true)return res.status(403).json({error:"Importer permission required"});
 try{
  const key=oddsKey.value();
  const odds=await getJSON("/sports/americanfootball_ncaaf/odds?regions=us&markets=h2h,spreads,totals&oddsFormat=american",key);
  let games=0,created=0,quotes=0;
  for(const ev of odds){
   if(Date.parse(ev.commence_time)<=Date.now())continue;
   const homeRank=cfbRank(ev.home_team),awayRank=cfbRank(ev.away_team);
   if(!homeRank&&!awayRank)continue;
   games++;
   const markets=new Map();
   for(const book of ev.bookmakers||[])for(const market of book.markets||[]){
    if(!["h2h","spreads","totals"].includes(market.key))continue;
    for(const o of market.outcomes||[]){
     const price=Number(o.price),point=o.point==null?null:Number(o.point);
     if(!Number.isFinite(price)||(point!==null&&!Number.isFinite(point)))continue;
     const k=market.key+"|"+o.name,old=markets.get(k);
     if(!old||priority(book.key)<priority(old.bookmaker)){
      markets.set(k,{name:o.name,point,price,bookmaker:book.key});
     }
     quotes++;
    }
   }
   const get=(market,name)=>markets.get(market+"|"+name);
   const decimal=price=>Number((price>0?1+price/100:1+100/Math.abs(price)).toFixed(3));
   const fmt=x=>x.name+(x.point==null?"":" "+(x.point>0?"+":"")+x.point);
   for(const market of ["h2h","spreads","totals"]){
    const a=get(market,market==="totals"?"Over":ev.home_team);
    const b=get(market,market==="totals"?"Under":ev.away_team);
    if(!a||!b)continue;
    const label={h2h:"Moneyline",spreads:"Spread",totals:"Total Points"}[market];
    const ref=admin.firestore().collection("players").doc("oddsapi-cfb-"+hash([ev.id,market].join("|")));
    try{
     await ref.create({kind:"team",game:"CFB",title:clean(ev.away_team)+" @ "+clean(ev.home_team)+" · "+label,
      aLabel:fmt(a),bLabel:fmt(b),aMult:decimal(a.price),bMult:decimal(b.price),
      status:"upcoming",result:null,source:"the-odds-api",eventId:clean(ev.id),
      commenceTime:ev.commence_time,bookmakerA:a.bookmaker,bookmakerB:b.bookmaker,
      americanOddsA:a.price,americanOddsB:b.price,homeRank,awayRank,
      pollDate:CFB_POLL_DATE,importedAt:admin.firestore.FieldValue.serverTimestamp()});
     created++;
    }catch(e){if(e.code!==6&&e.code!=="already-exists")throw e}
   }
  }
  res.json({ok:true,games,created,quotes,pollDate:CFB_POLL_DATE,rankedTeams:CFB_TOP30.length});
 }catch(e){console.error("CFB odds import failed",e);res.status(502).json({error:"CFB import failed; verify API key coverage and Cloud Functions logs"})}
});
