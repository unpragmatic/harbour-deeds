import assert from 'node:assert/strict';
import {boards,oldCurve,send} from './economy-fixture.mjs';
import {botMove} from '../web/strategy.mjs';

// These benchmarks compare the Harbor percentage curves, not fixed-price development tables.
for(const [id,rules] of Object.entries({compact:boards.compact,outer:boards.outer,grand:boards.grand,grandOldCurve:oldCurve})){
  const ratios=rules.development.levels.map(()=>[]);
  for(const t of rules.tiles.filter(t=>t.kind==='deed')){
    let rent=Math.round(t.rent*rules.development.set_rent_pct/100),prev=0;
    for(const [j,l] of rules.development.levels.entries()){
      const cost=Math.round(t.price*l.cost_pct/100),next=Math.round(t.rent*l.rent_pct/100);
      const hits=cost/(next-rent);assert.ok(hits>prev);ratios[j].push(hits);prev=hits;rent=next;
    }
  }
  console.log(id,'break-even hits per tier',ratios.map(a=>[Math.min(...a),Math.max(...a)].map(n=>n.toFixed(3))));
  for(const [seats,policy] of id==='grand'?[[3,'none'],[3,'even'],[3,'free'],[3,'district'],[2,'even'],[4,'even']]:[[3,'even']]){
    const config={...rules,development:policy==='none'?{...rules.development,levels:[]}:{...rules.development,policy}};
    const totals={levels:[0,0,0],out:0,sells:0,works:0,eligible:0,commissions:0,redeemed:0,splitRefits:0,gamesBuilding:0};
    for(let seed=1;seed<=100;seed++){
      let s=send({action:'start',seed,seats,rules:config}),built=false;
      while(s.phase!=='over'){
        const c=botMove(s,config);
        if(c.action==='build'){
          totals.levels[s.levels[c.tile]]+=s.builds.find(q=>q.tile===c.tile).tiles.length;
          built=true;
        }
        totals.sells+=c.action==='sell';totals.works+=s.phase==='works';
        totals.eligible+=s.commissions.length>0;
        if(c.action==='commission'){
          totals.commissions++;
          totals.splitRefits+=config.tiles.some((t,k)=>t.group===config.tiles[c.tile].group && s.owners[k]!==c.actor);
        }
        const next=send(c);
        if(c.action==='roll'){
          const k=next.players[c.actor].pos;
          totals.redeemed+=s.bonuses[k]>0 && s.owners[k]!==c.actor;
        }
        s=next;
      }
      totals.out+=s.players.filter(p=>p.out).length;totals.gamesBuilding+=built;
    }
    console.log(id,seats,policy,JSON.stringify(totals));
  }
}
