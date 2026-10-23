/* Shared by Cloud Functions and the browser. All timestamps are UTC. */
(function(root){
  'use strict';
  const supported=p=>p&&['NBA','NFL'].includes(p.game);
  const start=p=>typeof p?.commenceTime==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(p.commenceTime)?Date.parse(p.commenceTime):NaN;
  function available(p,now=Date.now()){
    if(!p||p.status!=='upcoming')return false;
    if(!supported(p))return true;
    return Number.isFinite(start(p))&&now<start(p)-600000&&!['postponed','suspended','canceled','review','final'].includes(p.eventStatus);
  }
  function phase(p,now=Date.now()){
    if(!p)return 'missing';
    if(p.status==='final')return 'final';
    if(['postponed','suspended','canceled','review'].includes(p.eventStatus))return p.eventStatus;
    if(p.eventStatus==='final')return 'pending';
    if(p.status==='live'||(supported(p)&&now>=start(p)))return 'live';
    return available(p,now)?'upcoming':'locked';
  }
  const api={supported,start,available,phase};
  if(typeof module!=='undefined')module.exports=api;else root.PickLifecycle=api;
})(typeof window!=='undefined'?window:globalThis);
