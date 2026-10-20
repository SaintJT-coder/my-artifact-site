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

/**
 * Snapshot: 2026 FBS season passing yards through Oct 17, 2026.
 * Source: NCAA passing-yards leaderboard (d1sportsnet.com/football/stats/ipassyd.php).
 * Refresh the ranking after each completed college football week before importing.
 */
const CFB_TOP30_PASSERS = [
  "Braden Atkinson",
  "Jayden Maiava",
  "Julian Sayin",
  "Ethan Grunkemeyer",
  "Gio Lopez",
  "Drew Mestemaker",
  "Tayven Jackson",
  "Micah Alejado",
  "John Alan Richter",
  "Lincoln Kienholz",
  "Marcus Stokes",
  "Kevin Jennings",
  "Ryan Browne",
  "Sam Leavitt",
  "Austin Simmons",
  "Conner Weigman",
  "Darian Mensah",
  "Noah Fifita",
  "Keelon Russell",
  "Caden Veltkamp",
  "Jaden Craig",
  "Noah Kim",
  "Trinidad Chambliss",
  "Rocco Becht",
  "Josh Hoover",
  "CJ Carr",
  "Deuce Bailey",
  "Caden Creel",
  "Trey Owens",
  "Davis Warren"
];
const cfbRank = new Map(CFB_TOP30_PASSERS.map((name,index)=>[name.toLowerCase(),index+1]));
const normalizePlayer = name => clean(name).normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9 ]/gi,"").replace(/\s+/g," ").trim().toLowerCase();
const cfbRanks = new Map(CFB_TOP30_PASSERS.map((name,index)=>[normalizePlayer(name),index+1]));

// Manually invoked; same admin-only Firebase custom claim as the NFL importer.
// Import only real DraftKings main-market passing-yard lines. No estimates or substitutions.
exports.importCfbDraftKingsPassing = onRequest({region:"us-central1",secrets:[oddsKey],timeoutSeconds:120,maxInstances:1,cors:["https://saintjt-coder.github.io"]},async(req,res)=>{
 if(req.method!=="POST")return res.status(405).json({error:"POST required"});
 const token=/^Bearer (.+)$/.exec(req.get("Authorization")||"")?.[1];
 if(!token)return res.status(401).json({error:"Authentication required"});
 let decoded;
 try{decoded=await admin.auth().verifyIdToken(token,true);}
 catch{return res.status(401).json({error:"Invalid token"});}
 if(decoded.oddsImporter!==true)return res.status(403).json({error:"Importer permission required"});
 try{
  const key=oddsKey.value();
  const events=await getJSON("/sports/americanfootball_ncaaf/events",key);
  const upcoming=events.filter(e=>Date.parse(e.commence_time)>Date.now());
  let checked=0,created=0,matched=0,errors=0;
  for(const event of upcoming){
   let odds;
   try{
    odds=await getJSON("/sports/americanfootball_ncaaf/events/"+encodeURIComponent(event.id)+"/odds?regions=us&bookmakers=draftkings&markets=player_pass_yds&oddsFormat=american",key);
   }catch(e){errors++;continue;} // No verified DK line => no prop.
   checked++;
   const dk=(odds.bookmakers||[]).find(b=>b.key==="draftkings");
   const market=dk?.markets?.find(m=>m.key==="player_pass_yds");
   if(!market)continue;
   const grouped=new Map();
   for(const o of market.outcomes||[]){
    if(!["Over","Under"].includes(o.name)||!o.description||!Number.isFinite(Number(o.point))||!Number.isFinite(Number(o.price)))continue;
    const rank=cfbRanks.get(normalizePlayer(o.description));
    if(!rank)continue;
    const id=normalizePlayer(o.description);
    if(!grouped.has(id))grouped.set(id,{rank,name:clean(o.description),sides:{}});
    grouped.get(id).sides[o.name]={line:Number(o.point),odds:Number(o.price)};
   }
   for(const candidate of grouped.values()){
    const over=candidate.sides.Over,under=candidate.sides.Under;
    if(!over||!under||over.line!==under.line||over.line<0)continue;
    matched++;
    const id="oddsapi-cfb-"+hash([event.id,candidate.name.toLowerCase(),"player_pass_yds"].join("|"));
    try{
     await admin.firestore().collection("players").doc(id).create({
      game:"CFB",name:candidate.name,team:"—",pos:"QB",
      opp:clean(event.away_team)+" @ "+clean(event.home_team),
      stat:"Passing Yards",book:over.line,line:over.line,l5:[],
      status:"upcoming",current:null,source:"the-odds-api",
      bookmaker:"draftkings",rank2026:candidate.rank,
      oddsOver:over.odds,oddsUnder:under.odds,
      eventId:clean(event.id),commenceTime:event.commence_time,
      rankingAsOf:"2026-10-17",importedAt:admin.firestore.FieldValue.serverTimestamp()
     });created++;
    }catch(e){if(e.code!==6&&e.code!=="already-exists")throw e;}
   }
  }
  return res.json({ok:true,rankingAsOf:"2026-10-17",topQbs:30,eventsChecked:checked,verifiedDraftKingsProps:matched,playableCreated:created,unavailableEvents:errors});
 }catch(e){console.error("CFB DraftKings import failed",e.message);return res.status(502).json({error:"CFB import failed; check Cloud Functions logs"});}
});
