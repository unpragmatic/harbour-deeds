import {readFileSync} from 'node:fs';
import {botMove} from '../web/strategy.mjs';
const page=readFileSync('dist/index.html','utf8');
const data=id=>page.match(new RegExp(`<script id="${id}"[^>]*>([^<]+)</script>`))[1];
const {instance:{exports:e}}=await WebAssembly.instantiate(Buffer.from(data('binary'),'base64'));
function send(c){
  const b=Buffer.from(JSON.stringify(c)), p=e.reserve(b.length);
  new Uint8Array(e.memory.buffer,p,b.length).set(b);
  const out=e.dispatch(),s=JSON.parse(Buffer.from(e.memory.buffer,out,e.length()).toString());
  if(s.error)throw Error(s.error);return s;
}
for(const id of ['config','outer']){
  const rules=JSON.parse(data(id));
  const counts={pairs:0,better:0,worse:0,same:0,min:Infinity,max:-Infinity,onlyBuildWon:0,onlyHoldWon:0};
  for(let seed=1;seed<=200;seed++){
    const journal=[{action:'start',seed,seats:3,rules}];let s=send(journal[0]);
    while(s.phase!=='over'){
      const actor=s.turn;
      const q=s.builds.find(x=>s.players[actor].cash>=x.cost);
      if(q){
        const run=move=>{
          let game=send(move);
          while(game.phase!=='over')game=send(botMove(game,rules));
          const p=game.players[actor];
          return {score:p.out?0:p.cash+game.owners.reduce((v,o,k)=>v+(o===actor?rules.tiles[k].price:0),0),won:game.winners.includes(actor)};
        };
        const build=run({action:'build',tile:q.tile,actor});
        for(const c of journal)send(c);
        const hold=run({action:'roll',actor});
        const delta=build.score-hold.score;counts.pairs++;counts[delta>0?'better':delta<0?'worse':'same']++;
        counts.min=Math.min(counts.min,delta);counts.max=Math.max(counts.max,delta);
        counts.onlyBuildWon+=build.won&&!hold.won;counts.onlyHoldWon+=hold.won&&!build.won;
        break;
      }
      const c=botMove(s,rules);s=send(c);journal.push(c);
    }
  }
  console.log(id,counts);
}
