// The same Rust/WASM dispatch used at the live table. Controllers choose commands only.
import assert from 'node:assert/strict';
import {boards, score, send} from './economy-fixture.mjs';
import {actingSeat, botMove} from '../web/strategy.mjs';
import {readFileSync} from 'node:fs';

const rules={...JSON.parse(readFileSync(new URL('../web/edition-charter.json',import.meta.url))).grand,rounds:8};
const id=name=>{
  const i=rules.tiles.findIndex(t=>t.name===name);
  assert.notEqual(i,-1,name);return i;
};
const slip=id('Slipway'), spar=id('Spar Yard'), grain=id('Grain Quay');
const human=(s,swap,build)=>{
  const actor=actingSeat(s), move=(action,fields)=>({action,actor,...fields});
  switch(s.phase){
    case 'roll':
      if(s.round===3&&!s.traded)
        return move('propose',{to:1,give_deed:null,take_deed:slip,give_cash:185,take_cash:0});
      if(swap&&s.round===6&&!s.traded)
        return move('propose',{to:2,give_deed:grain,take_deed:spar,give_cash:0,take_cash:30});
      if(build&&s.round===6&&!s.levels[slip]&&s.builds.some(q=>q.tile===slip))
        return move('build',{tile:slip});
      return move('roll');
    case 'offer':return move(s.round===4||s.players[actor].cash<rules.tiles[s.players[actor].pos].price?'pass':'buy');
    case 'auction':{
      const {high_bid:high,tile}=s.auction;
      const amount=tile===id('Fish Hall')?30:tile===id('Kelp Farm')?120:0;
      return amount>=high+rules.auction_increment&&amount<=s.players[actor].cash?move('bid',{amount}):move('withdraw');
    }
    case 'trade':return move('reject');
    case 'works':return move('skip');
    case 'end':return move('end');
    default:throw Error(`Unrecorded human decision: ${s.phase}, round ${s.round}`);
  }
};
function play(swap,build){
  const moves=[],markers={},rolls=[];
  let s=send({action:'start',seed:1,seats:3,rules});
  while(s.phase!=='over'){
    assert.ok(moves.length<500,'Playtest exceeded its move budget');
    const actor=actingSeat(s);
    if(actor===0){
      const marker=s.round===4&&s.phase==='roll'?'chase':s.round===5&&s.phase==='offer'?'block':
        s.round===5&&s.phase==='auction'?'price-out':null;
      if(marker)markers[marker]??=moves.length;
    }
    const m=actor===0?human(s,swap,build):botMove(s,rules);
    s=send(m);moves.push(m);
    if(m.action==='roll')rolls.push([m.actor,...s.dice,s.last_card]);
  }
  return {moves,markers,rolls,scores:s.players.map((p,i)=>score(s,rules,i)),winners:s.winners};
}
const actual=play(true,true);
assert.deepEqual(actual.scores,[880,1157,1023],'The headless replay must match the played table');
assert.deepEqual(actual.winners,[1]);
if(process.argv.includes('--journal')){
  console.log(JSON.stringify({moves:actual.moves,markers:actual.markers}));
}else{
  const keepCash=play(true,false),noDeal=play(false,false);
  assert.deepEqual(actual.rolls,keepCash.rolls);
  assert.deepEqual(actual.rolls,noDeal.rolls);
  // Describe observed play under the ordinary policy, not what a human "should" do.
  const sample={games:100,completed:0,proposals:0,accepted:0,declined:0,twoDeedOffers:0};
  for(let seed=1;seed<=sample.games;seed++){
    let s=send({action:'start',seed,seats:3,rules:boards.grand}),n=0;
    while(s.phase!=='over'){
      assert.ok(++n<=2500,`Unfinished seed ${seed}`);
      const m=botMove(s,boards.grand);s=send(m);
      if(m.action==='propose'){
        sample.proposals++;
        if(m.give_deed!=null&&m.take_deed!=null)sample.twoDeedOffers++;
      }else if(m.action==='accept')sample.accepted++;
      else if(m.action==='reject')sample.declined++;
    }
    sample.completed++;
  }
  console.log(JSON.stringify({engine:'Rust/WASM',seed:1,identicalRollsAndDraws:actual.rolls.length,
    tradeAndBuild:actual.scores,tradeAndKeepCash:keepCash.scores,noTradeOrBuild:noDeal.scores,
    shippedBotsGrandHarbor:sample},null,2));
}
