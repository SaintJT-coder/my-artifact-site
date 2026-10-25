const test=require('node:test');
const assert=require('node:assert/strict');
const {matchLegacyEvent,weekOf}=require('../functions/legacy-schedules');
const now=Date.parse('2026-10-25T15:00:00Z');
const event={id:'confirmed',home_team:'Minnesota Vikings',away_team:'Indianapolis Colts',commence_time:'2026-10-25T17:00:00Z'};
const pick={game:'NFL',name:'Player',team:'Vikings',stat:'Rushing TDs',line:0.5,status:'upcoming',current:null,week:7};
test('manual touchdown schedule repair requires one exact team/week game',()=>{
 assert.equal(matchLegacyEvent(pick,[event],now),event);
 assert.equal(weekOf(event.commence_time),7);assert.equal(weekOf('2026-10-30T00:15:00Z'),8);
 assert.equal(matchLegacyEvent({...pick,team:'Viking'},[event],now),null);
 assert.equal(matchLegacyEvent({...pick,week:6},[event],now),null);
 assert.equal(matchLegacyEvent(pick,[event,{...event,id:'ambiguous'}],now),null);
});
test('past, already mapped, final or live manual picks cannot be rebound',()=>{
 for(const patch of [{status:'final'},{current:1},{eventId:'old'},{commenceTime:event.commence_time}])assert.equal(matchLegacyEvent({...pick,...patch},[event],now),null);
 assert.equal(matchLegacyEvent(pick,[event],Date.parse(event.commence_time)-600000),null);
 assert.equal(pick.line,0.5);
});
