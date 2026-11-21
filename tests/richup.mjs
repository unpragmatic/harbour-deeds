import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {boards,send} from './economy-fixture.mjs';
import {botMove} from '../web/strategy.mjs';

const classic=boards.richup;
const hash=s=>createHash('sha256').update(s).digest('hex');
const start=(r,seed=1)=>send({action:'start',rules:r,seats:3,seed});
test('ordered board and every city ledger match the independently captured Classic map',()=>{
  assert.equal(hash(classic.tiles.map(t=>t.name).join('\n')),'9545f5fe19a7825af78b6ed0cef0751278c619c863e22eb8d6102ee27ae05606');
  const rows=classic.tiles.flatMap((t,i)=>t.rent_levels?[[i,t.name,t.price,t.group,[t.rent,...t.rent_levels],t.build_costs]]:[]);
  assert.equal(rows.length,22);
  assert.equal(hash(JSON.stringify(rows)),'b5d7dad6be9cc7ce68e6f79208fa6473614f0ddf92289dd831eae049343acaba');
  assert.deepEqual(classic.network_fares.Airports,[25,50,100,200]);
  assert.deepEqual(classic.utility_multipliers.Companies,[4,10]);
  assert.deepEqual(classic.tiles.flatMap((t,i)=>t.deck?[[i,t.deck]]:[]),[[2,'Treasure'],[8,'Surprise'],[17,'Treasure'],[22,'Surprise'],[33,'Treasure'],[36,'Surprise']]);
  assert.equal(classic.named_cards.length,34);
});

test('a backward Surprise can draw Treasure, pass Start and offer an actual deed',()=>{
  const named_cards=[{title:'Back three',deck:'Surprise',kind:'steps',steps:-3},
    {title:'Advance',deck:'Treasure',kind:'advance',target:1,salary:true}];
  const tiles=classic.tiles.map((t,i)=>i===2?{name:'Rest',kind:'rest'}:i===5?{kind:'notice',name:'Treasure',deck:'Treasure'}:t);
  // Keep the four-airport schedule valid; swap the lost airport with the old Treasure.
  tiles[2]=classic.tiles[5];
  const r={...classic,named_cards,tiles};
  for(let seed=1;seed<100;seed++){
    start(r,seed);
    const s=send({action:'roll',actor:0});
    if(s.dice[0]+s.dice[1]!==8)continue;
    assert.deepEqual(s.card_receipt.draws.map(d=>[d.source,d.card]),[[8,0],[5,1]]);
    assert.equal(s.players[0].pos,1);
    assert.equal(s.players[0].cash,1700);
    assert.equal(s.phase,'offer');
    assert.equal(send({action:'pass',actor:0}).phase,'end');
    return;
  }
  assert.fail('No seed exercised the chained landing');
});

test('named decks cycle separately, without exposing shuffled order or losing a card',()=>{
  const r={...boards.compact,notices:[],rounds:100,dice:{count:1,sides:2},
    tiles:Array.from({length:6},(_,i)=>({kind:'notice',name:'Post',deck:i%2?'A':'B'})),
    named_cards:['A','B'].flatMap(deck=>[1,2,3].map(n=>({deck,title:deck+n,kind:'cash',amount:n})))};
  const sample=()=>{
    let s=start(r,17),hands={A:[],B:[]};
    for(let i=0;i<80;i++){
      const a=s.turn;s=send({action:'roll',actor:a});
      const draw=s.card_receipt.draws[0],entry=r.named_cards[draw.card],deck=r.tiles[draw.source].deck;
      assert.equal(entry.deck,deck);assert.equal(draw.after-draw.before,entry.amount);
      assert.ok(!('piles' in s));hands[deck].push(draw.card);
      s=send({action:'end',actor:a});
    }
    return hands;
  };
  const hands=sample();assert.deepEqual(hands,sample());
  for(const draws of Object.values(hands)){
    assert.ok(draws.length>=9);
    assert.equal(new Set(draws.slice(0,3)).size,3);
    for(let i=3;i<draws.length;i++)assert.equal(draws[i],draws[i%3]);
  }
});
test('Rust resolves complete seeded Classic matches using the shipped controllers',t=>{
  const rounds=[];
  for(const seed of [2,3,11]){
    let s=start(classic,seed),commands=0,draws=0;
    while(s.phase!=='over'){
      const cmd=botMove(s,classic);s=send(cmd);
      if(cmd.action==='roll')draws+=s.card_receipt?.draws.length??0;
      assert.ok(++commands<15000,`Match stalled at round ${s.round}`);
    }
    assert.equal(s.players.filter(p=>!p.out).length,1);assert.ok(draws>0);
    rounds.push(s.round);
  }
  t.diagnostic(`Three-seat elimination games: ${rounds.join(', ')} rounds`);
});
