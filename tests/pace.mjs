import {readFileSync} from 'node:fs';
import {botMove} from '../web/strategy.mjs';

// Count player commands, not automatic engine transitions, animation frames or form keystrokes.
const legacy=Boolean(process.argv[3]);
const page=readFileSync(process.argv[2]||'dist/index.html','utf8');
const data=id=>page.match(new RegExp(`<script id="${id}"[^>]*>([^<]+)</script>`))[1];
const rules=JSON.parse(data('config'));
const {instance:{exports:e}}=await WebAssembly.instantiate(Buffer.from(data('binary'),'base64'));
function send(c){
  const b=Buffer.from(JSON.stringify(c)), p=e.reserve(b.length);
  new Uint8Array(e.memory.buffer,p,b.length).set(b);
  const out=e.dispatch(),s=JSON.parse(Buffer.from(e.memory.buffer,out,e.length()).toString());
  if(s.error)throw Error(`${JSON.stringify(c)}: ${s.error}`);return s;
}
const totals={turns:0,inputs:0,marketInputs:0,offers:0,auctions:0,bids:0,proposals:0,accepted:0,sets:0,bankruptcies:0};
for(let seed=1;seed<=100;seed++){
  let s=send({action:'start',seed,seats:3,rules}),steps=0;
  while(s.phase!=='over'){
    if(++steps>2000) throw Error('Game did not end');
    let c=legacy?{actor:s.turn,action:s.phase==='offer'?(s.players[s.turn].cash>=rules.tiles[s.players[s.turn].pos].price?'buy':'pass'):s.phase}:botMove(s,rules);
    if(c.action==='roll')totals.turns++;
    if(legacy||c.action!=='end')totals.inputs++;
    if(!['end','roll'].includes(c.action))totals.marketInputs++;
    if(s.phase==='offer')totals.offers++;
    if(!legacy&&c.action==='pass')totals.auctions++;
    if(c.action==='bid')totals.bids++;
    if(c.action==='propose')totals.proposals++;
    if(c.action==='accept')totals.accepted++;
    s=send(c);
  }
  totals.bankruptcies+=s.players.filter(p=>p.out).length;
  for(const g of new Set(rules.tiles.filter(t=>t.kind==='deed').map(t=>t.group))){
    const owners=s.owners.filter((_,k)=>rules.tiles[k].group===g);
    if(owners[0]!==null&&owners.every(o=>o===owners[0]))totals.sets++;
  }
}
console.log(JSON.stringify(Object.fromEntries(Object.entries(totals).map(([k,v])=>[k,v/100]))));
