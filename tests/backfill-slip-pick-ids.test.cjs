const test=require('node:test');
const assert=require('node:assert/strict');
const {pickIds}=require('../scripts/backfill-slip-pick-ids.cjs');

test('slip reverse-index migration extracts unique IDs without changing entries',()=>{
 const pick=pid=>({mapValue:{fields:{pid:{stringValue:pid}}}});
 const entry=(...ids)=>({mapValue:{fields:{picks:{arrayValue:{values:ids.map(pick)}}}}});
 const fields={entries:{arrayValue:{values:[entry('a','b'),entry('b','c')]}}};
 const before=JSON.stringify(fields);
 assert.deepEqual(pickIds(fields),['a','b','c']);
 assert.equal(JSON.stringify(fields),before);
 assert.deepEqual(pickIds({}),[]);
});
