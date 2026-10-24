const test=require('node:test');
const assert=require('node:assert/strict');
const {createPhotoResolver,uniquePlayer}=require('../functions/player-photos');
const athlete=(id,name)=>({id,displayName:name,headshot:{href:'https://a.espncdn.com/i/headshots/nfl/players/full/'+id+'.png'}});
test('photos require an exact unique player on the verified event teams',()=>{
 const roster=[{team:'Home',athletes:[athlete('1','Michael Penix Jr.')]},{team:'Away',athletes:[athlete('2','Someone Else')]}];
 assert.equal(uniquePlayer('Michael Penix Jr',roster).espnId,'1');
 assert.equal(uniquePlayer('Michael Penix',roster).espnId,'1');
 assert.equal(uniquePlayer('Michael',roster),null);
 assert.equal(uniquePlayer('Unknown',roster),null);
 roster[1].athletes.push(athlete('3','Michael Penix Jr.'));
 assert.equal(uniquePlayer('Michael Penix Jr.',roster),null);
});
test('suffix and documented nickname differences resolve only unique roster identities',()=>{
 assert.equal(uniquePlayer('Kyle Pitts',[{team:'Atlanta',athletes:[athlete('7','Kyle Pitts Sr.')]}]).espnId,'7');
 assert.equal(uniquePlayer('Paul Reed Jr',[{team:'Detroit',athletes:[athlete('8','Paul Reed')]}]).espnId,'8');
 assert.equal(uniquePlayer('Zonovan Knight',[{team:'Arizona',athletes:[athlete('4427728','Bam Knight')]}]).espnId,'4427728');
 assert.equal(uniquePlayer('Zonovan Knight',[{team:'Arizona',athletes:[athlete('9','Bam Knight')]}]),null);
 assert.equal(uniquePlayer('Player',[{team:'Home',athletes:[athlete('1','Player Jr.'),athlete('2','Player Sr.')]}]),null);
});
test('accent normalization and grouped/flat rosters preserve exact identity',async()=>{
 const calls=[];
 const resolver=createPhotoResolver({getJSON:async url=>{
  calls.push(url);
  if(url.includes('/teams?'))return {sports:[{leagues:[{teams:[{team:{id:'1',displayName:'Home',location:'',name:'Home'}},{team:{id:'2',displayName:'Away',location:'',name:'Away'}}]}]}]};
  if(url.includes('/teams/1/'))return {team:{id:'1'},athletes:[{items:[athlete('42','José Player')]}]};
  return {team:{id:'2'},athletes:[athlete('43','Other Player')]};
 }});
 const input=[{id:'p',data:{game:'NFL',name:'Jose Player',line:200,status:'upcoming'}},{id:'t',data:{kind:'team',aMult:2}}];
 const event={home_team:'Home',away_team:'Away'};
 const out=await resolver('NFL',event,input);
 assert.equal(out[0].data.espnId,'42');assert.equal(out[0].data.team,'Home');
 assert.equal(out[0].data.line,200);assert.equal(input[0].data.espnId,undefined);
 assert.equal(out[1],input[1]);
 await resolver('NFL',event,input);assert.equal(calls.length,3);
});
test('failed or mismatched roster never attaches a guessed photo',async()=>{
 const picks=[{data:{name:'Player',line:25}}];
 const resolver=createPhotoResolver({getJSON:async()=>{throw Error('offline')}});
 assert.equal(await resolver('NFL',{home_team:'Home',away_team:'Away'},picks),picks);
 const duplicate=[{team:'Home',athletes:[athlete('1','Player')]},{team:'Away',athletes:[athlete('1','Player')]}];
 assert.equal(uniquePlayer('Player',duplicate),null);
 const invalid=athlete('1','Player');invalid.headshot.href='https://untrusted.example/player.png';
 assert.equal(uniquePlayer('Player',[{team:'Home',athletes:[invalid]}]),null);
});
