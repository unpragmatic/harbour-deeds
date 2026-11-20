import assert from 'node:assert/strict';
import {boards,oldCurve,send,score} from './economy-fixture.mjs';
import {botMove} from '../web/strategy.mjs';

// Find one common decision state per seed *before the first build*. Replay its
// actual commands, not its bot, so the two price schedules have identical assets.
const current=boards.grand,results={old:[],revised:[]},absent=[];
for(let seed=1;seed<=200;seed++){
  const journal=[],start=rules=>send({action:'start',seed,seats:3,rules});
  let s=start(current),q;
  while(s.phase!=='over'){
    q=s.builds.find(x=>s.players[s.turn].cash>=x.cost);if(q)break;
    const c=botMove(s,current);journal.push(c);s=send(c);
  }
  if(!q){absent.push(seed);continue}
  const actor=s.turn;
  for(const [key,rules] of [['old',oldCurve],['revised',current]]){
    function run(build){
      let game=start(rules);for(const c of journal)game=send(c);
      assert.deepEqual(game.players,s.players);assert.deepEqual(game.owners,s.owners);
      const option=game.builds.find(x=>x.tile===q.tile);
      assert.ok(option.cost<=game.players[actor].cash);
      if(build)send({action:'build',tile:q.tile,actor});
      game=send({action:'roll',actor}); // no extra decisions before this roll in either branch
      while(game.phase!=='over')game=send(botMove(game,rules));
      return {wealth:score(game,rules,actor),won:game.winners.includes(actor),out:game.players[actor].out};
    }
    const b=run(true),h=run(false);
    results[key].push({seed,round:s.round,delta:b.wealth-h.wealth,
      buildOnlyWin:b.won&&!h.won,holdOnlyWin:h.won&&!b.won,buildOnlyOut:b.out&&!h.out,holdOnlyOut:h.out&&!b.out});
  }
}
console.log('no common affordable opportunity:',absent.length,'of 200');
for(const [id,rows] of Object.entries(results)){
  const ordered=xs=>xs.sort((a,b)=>a-b);
  const dist=ordered(rows.map(r=>r.delta)),rounds=ordered(rows.map(r=>r.round));
  const quant=(a,p)=>a[Math.max(0,Math.ceil(a.length*p)-1)];
  console.log(id,JSON.stringify({pairs:rows.length,richer:dist.filter(x=>x>0).length,
    poorer:dist.filter(x=>x<0).length,tied:dist.filter(x=>x===0).length,
    delta_min_p10_p50_p90_max:[0,.1,.5,.9,1].map(p=>quant(dist,p)),
    round_p10_p50_p90:[.1,.5,.9].map(p=>quant(rounds,p)),
    ...Object.fromEntries(['buildOnlyWin','holdOnlyWin','buildOnlyOut','holdOnlyOut'].map(k=>[k,rows.filter(r=>r[k]).length]))}));
}
