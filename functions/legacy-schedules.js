'use strict';
const {start,available}=require('./lifecycle');
const norm=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const sameTeam=(stored,full)=>norm(stored)===norm(full)||norm(stored)===norm(String(full).split(' ').at(-1));
function weekOf(iso){
 const ms=start({commenceTime:iso}),week=Math.floor((ms-Date.parse('2026-09-10T00:00:00Z'))/(7*86400000))+1;
 return Number.isFinite(ms)&&week>=1&&week<=18?week:null;
}
// Schedule/display repair for existing manual lines only. Never grade a result.
function matchLegacyEvent(p,events,now=Date.now()){
 if(p.game!=='NFL'||!['Rushing TDs','Receiving TDs'].includes(p.stat)||p.status!=='upcoming'||p.current!=null||p.eventId||p.commenceTime||!Number.isInteger(p.week)||!p.team)return null;
 const matches=events.filter(e=>weekOf(e.commence_time)===p.week&&(sameTeam(p.team,e.home_team)||sameTeam(p.team,e.away_team))&&available({...p,commenceTime:e.commence_time},now));
 return matches.length===1?matches[0]:null;
}
module.exports={matchLegacyEvent,sameTeam,weekOf};
