// Exercise the release engine and source rules directly; no published HTML required.
import {readFileSync} from 'node:fs';
import {loadCatalog} from '../board-catalog.mjs';
const file=p=>readFileSync(new URL('../'+p,import.meta.url));
export const {catalog}=loadCatalog();
export const boards=Object.fromEntries(Object.entries(catalog.boards).map(([id,b])=>[id,b.rules]));

// Curve-only control: same revised map (including Works and liquidation),
// round limit, seats and strategy; substitute the formerly shipped costs AND rents.
export const oldCurve={...boards.grand,development:{...boards.grand.development,
  levels:[7,11,14].map((c,i)=>({cost_pct:c,rent_pct:[300,380,440][i]}))}};

const {instance:{exports:e}}=await WebAssembly.instantiate(file('target/wasm32-unknown-unknown/release/harbor_deeds.wasm'));
export function send(c){
  const b=Buffer.from(JSON.stringify(c)), p=e.reserve(b.length);
  new Uint8Array(e.memory.buffer,p,b.length).set(b);
  const out=e.dispatch(),s=JSON.parse(Buffer.from(e.memory.buffer,out,e.length()).toString());
  if(s.error)throw Error(`${c.action}: ${s.error}`);
  return s;
}
export function score(s,rules,actor){
  return s.players[actor].out?0:s.players[actor].cash+s.owners.reduce((v,o,k)=>v+(o===actor?rules.tiles[k].price:0),0);
}
