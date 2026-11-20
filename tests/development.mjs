import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {botMove} from '../web/strategy.mjs';
const page=readFileSync('dist/index.html','utf8');
const data=id=>page.match(new RegExp(`<script id="${id}"[^>]*>([^<]+)</script>`))[1];
const {instance:{exports:e}}=await WebAssembly.instantiate(Buffer.from(data('binary'),'base64'));
function send(c){
  const b=Buffer.from(JSON.stringify(c)), p=e.reserve(b.length);
  new Uint8Array(e.memory.buffer,p,b.length).set(b);
  const out=e.dispatch(),s=JSON.parse(Buffer.from(e.memory.buffer,out,e.length()).toString());
  assert.ifError(s.error && new Error(s.error));return s;
}
for(const id of ['config','outer']){
  const rules=JSON.parse(data(id));
  const ratios=rules.development.levels.map(()=>[]);
  for(const t of rules.tiles.filter(t=>t.kind==='deed')){
    let rent=Math.round(t.rent*rules.development.set_rent_pct/100),prev=0;
    for(const [j,l] of rules.development.levels.entries()){
      const cost=Math.round(t.price*l.cost_pct/100), next=Math.round(t.rent*l.rent_pct/100);
      const hits=cost/(next-rent);assert.ok(hits>prev);ratios[j].push(hits);prev=hits;rent=next;
    }
  }
  console.log(id,'payback ranges',ratios.map(a=>[Math.min(...a),Math.max(...a)].map(n=>n.toFixed(3))));
  for(const policy of ['none','even','free','district']){
    const config={...rules,development:policy==='none'?{...rules.development,levels:[]}:{...rules.development,policy}};
    let builds=[0,0,0],out=0;
    for(let seed=1;seed<=100;seed++){
      let s=send({action:'start',seed,seats:3,rules:config});
      while(s.phase!=='over'){
        const c=botMove(s,config);
        if(c.action==='build')builds[s.levels[c.tile]]+=s.builds.find(q=>q.tile===c.tile).tiles.length;
        s=send(c);
      }
      out+=s.players.filter(p=>p.out).length;
    }
    console.log(id,policy,'deed-level purchases',builds,'bankruptcies',out);
  }
}
