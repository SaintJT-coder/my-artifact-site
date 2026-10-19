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
const clean = s => String(s || "").trim().slice(0,160);

async function getJSON(path, key) {
  const url = new URL(BASE + path);
  url.searchParams.set("apiKey", key);
  const res = await fetch(url);
  if (!res.ok) throw new Error("Odds API request failed (HTTP " + res.status + ")");
  return res.json();
}

// Manually invoke with an authorized Firebase ID token. Never expose this endpoint unauthenticated.
exports.importNflOdds = onRequest({region:"us-central1",secrets:[oddsKey],timeoutSeconds:120,maxInstances:1}, async (req,res) => {
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
    for (const event of upcoming) {
      const odds = await getJSON("/sports/americanfootball_nfl/events/"+encodeURIComponent(event.id)+"/odds?regions=us&markets="+MARKETS.join(",")+"&oddsFormat=american",key);
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
          count++; written++; pending++;
          if (pending === 400) { await batch.commit(); batch = admin.firestore().batch(); pending = 0; }
        }
      }
      if (pending) await batch.commit();
    }
    return res.json({ok:true,events:upcoming.length,props:written});
  } catch(e) {
    console.error("NFL odds import failed",e.message);
    return res.status(502).json({error:"Odds import failed; check Cloud Functions logs"});
  }
});
