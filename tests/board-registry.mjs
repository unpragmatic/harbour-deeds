import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadCatalog} from '../board-catalog.mjs';

const read=name=>JSON.parse(readFileSync(new URL('../web/'+name,import.meta.url)));
const withManifest=change=>{
  const m=read('boards.json');change(m);
  return loadCatalog(name=>name==='boards.json'?m:read(name)).catalog;
};
test('new designer board requires no code and does not change historical membership',()=>{
  const c=withManifest(m=>{
    const b=structuredClone(m.boards.find(b=>b.id==='compact'));
    Object.assign(b,{id:'harbor-test',label:'Test Harbor'});
    Object.assign(b.layout,{start:'bottom-right',direction:'counterclockwise'});
    m.boards.push(b);m.defaultBoard=b.id;
  });
  const trial=c.boards[c.defaultBoard];
  assert.deepEqual(trial.layout.positions.slice(0,2),[[6,6],[5,6]]);
  assert.deepEqual(c.boards.compact.rules,trial.rules);
  assert.equal(new Set(trial.layout.positions.map(String)).size,trial.rules.tiles.length);
  for(const archive of Object.values(c.history)){
    assert.deepEqual(Object.keys(archive.boards).sort(),['compact','grand','outer']);
    assert.ok(!archive.boards.richup&&!archive.boards['harbor-test']);
  }
  const frozen=read('edition-airports.json');
  for(const [k,b] of Object.entries(c.history['airports-1'].boards))assert.deepEqual(b.rules,frozen[k]);
  assert.deepEqual(c.boards.richup.layout.positions.filter((_,i)=>i%10===0),[[1,1],[1,11],[11,11],[11,1]]);
});
test('invalid manifest, missing/ambiguous inputs and engine-invalid rules fail the same compiler',()=>{
  for(const [change,error] of [
    [m=>m.boards.push(m.boards[0]),/duplicate board ID/],
    [m=>m.defaultBoard='absent',/defaultBoard/],
    [m=>m.boards[0].extends='absent',/unknown parent/],
    [m=>m.boards[0].extends=m.boards[0].id,/cycle/],
    [m=>m.boards[0].file='../escape.json',/filename/],
    [m=>m.boards[0].layout.rows++,/perimeter/],
    [m=>m.boards[0].layout.direction='guess',/direction/],
  ])assert.throws(()=>withManifest(change),error);
  for(const [file,change,error] of [
    ['outer-harbor.json',s=>s.inserts[0].after='Missing station',/anchor/],
    ['outer-harbor.json',s=>s.development_cost_pct.pop(),/cost for every level/],
    ['rules.json',s=>s.tiles.find(t=>t.kind==='deed').group='Missing art',/district print/],
    ['rules.json',s=>s.dice.sides=1,/Invalid game configuration/],
  ])assert.throws(()=>loadCatalog(name=>{const s=read(name);if(name===file)change(s);return s}),error);
});
