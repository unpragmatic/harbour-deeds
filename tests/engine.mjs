import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {botMove} from '../web/strategy.mjs';

const rules=JSON.parse(readFileSync(new URL('../web/rules.json',import.meta.url)));
const wasm=new URL('../target/wasm32-unknown-unknown/release/harbor_deeds.wasm',import.meta.url);
const {instance:{exports:e}}=await WebAssembly.instantiate(readFileSync(wasm));
function send(command){
  const bytes=Buffer.from(JSON.stringify(command));
  const offset=e.reserve(bytes.length);
  new Uint8Array(e.memory.buffer,offset,bytes.length).set(bytes);
  const p=e.dispatch();
  return JSON.parse(Buffer.from(e.memory.buffer,p,e.length()).toString());
}
test('only the current seat may roll, and only once per turn',()=>{
  send({action:'start',rules,seats:2,seed:10});
  assert.ok(send({action:'roll',actor:1}).error);
  const s=send({action:'roll',actor:0});
  assert.equal(s.players[0].pos,s.dice[0]+s.dice[1]);
  assert.ok(send({action:'roll',actor:0}).error);
});
function act(action,actor,fields={}){
  const s=send({action,actor,...fields});
  assert.ifError(s.error && new Error(`${action}: ${s.error}`));
  return s;
}
function illegal(action,actor,fields={}){
  assert.ok(send({action,actor,...fields}).error,`${action} should be rejected`);
}
const board={...rules,cash:100,salary:0,
  tiles:Array.from({length:16},()=>({kind:'deed',price:20,rent:1}))};
function start(seats=2,config=board){
  return act('start',undefined,{rules:config,seats,seed:10});
}
const grand={...rules,...JSON.parse(readFileSync(new URL('../web/grand-harbor.json',import.meta.url)))};
test('configurable dice and a reproducible deck exhausted before reshuffling',()=>{
  const config={...grand,dice:{count:3,sides:4},rounds:80,cash:10000,tiles:Array(16).fill({kind:'notice'})};
  function draws(seed){
    let s=act('start',undefined,{rules:config,seats:2,seed});const cards=[];
    for(let i=0;i<16;i++){
      const before=s.players[s.turn].pos;s=act('roll',s.turn);assert.equal(s.dice.length,3);
      assert.ok(s.dice.every(d=>d>=1&&d<=4));assert.equal(s.players[s.turn].pos,(before+s.dice.reduce((a,b)=>a+b))%16);
      cards.push(s.last_card);s=act('end',s.turn);
    }return cards;
  }
  const seq=draws(10);assert.deepEqual(draws(10),seq);assert.notDeepEqual(draws(30),seq);
  for(const k of [0,8])assert.equal(new Set(seq.slice(k,k+8)).size,8);
});
test('exchange auctions another deed; guild cover pays the landlord once',()=>{
  const config={...grand,tiles:Array.from({length:16},(_,i)=>i===2?{kind:'exchange'}:i===7?{kind:'guild',cash_offer:3,cover_offer:60}:{kind:'deed',price:20,rent:80,group:'x'})};
  start(2,config);let s=act('roll',0);assert.equal(s.auction.tile,3);assert.equal(s.players[0].pos,2);
  act('bid',0,{amount:10});s=act('withdraw',1);assert.equal(s.owners[3],0);
  act('end',0);s=act('roll',1);assert.equal(s.phase,'guild');illegal('insure',0);s=act('insure',1);assert.equal(s.players[1].cover,60);
  for(let turn=0;turn<90;turn++){
    s=act('end',s.turn);const a=s.turn,prior=s;s=act('roll',a);
    if(a===1&&s.players[1].cover===0){
      assert.equal(s.players[0].cash-prior.players[0].cash,80);
      assert.match(s.events.join(' '),/Guild paid \$60/);return;
    }
    if(s.phase==='offer')s=act('buy',s.turn);
    else if(s.phase==='guild')s=act('grant',s.turn);
    else while(s.phase==='auction')s=act('withdraw',s.auction.actor);
  }assert.fail('cover was never redeemed');
});
test('Grand Harbor games terminate and exercise all experimental spaces',()=>{
  const phases=new Set(),cards=new Set();
  for(let seed=1;seed<=50;seed++){
    let s=act('start',undefined,{rules:grand,seed,seats:3}), steps=0;
    while(s.phase!=='over'){
      assert.ok(++steps<2000);phases.add(s.phase);if(s.last_card!==null)cards.add(s.last_card);
      s=send(botMove(s,grand));assert.ifError(s.error&&Error(s.error));
    }
  }
  assert.ok(phases.has('guild')&&phases.has('auction'));assert.equal(cards.size,grand.cards.length);
});
test('auction enforces turns, minimum raises, affordability and single settlement',()=>{
  start(3);
  for(const auction_increment of [0,-1])
    illegal('start',undefined,{rules:{...board,auction_increment},seats:3,seed:10});
  illegal('bid',0,{amount:10});
  const roll=act('roll',0),tile=roll.players[0].pos,inc=board.auction_increment;
  illegal('pass',1);
  const open=act('pass',0);
  assert.equal(open.phase,'auction');
  assert.deepEqual(open.auction,{actor:0,high_bid:0,leader:null,tile});
  for(const action of ['end','buy','roll','pass']) illegal(action,0);
  illegal('withdraw',1);
  for(const amount of [inc-1,inc+0.5,101]) illegal('bid',0,{amount});
  const first=act('bid',0,{amount:inc});
  assert.deepEqual(first.auction,{actor:1,high_bid:inc,leader:0,tile});
  illegal('bid',1,{amount:2*inc-1});
  act('withdraw',1);
  const raised=act('bid',2,{amount:2*inc});
  assert.deepEqual(raised.players,roll.players);
  assert.deepEqual(raised.owners,roll.owners);
  assert.equal(raised.auction.actor,0);
  illegal('bid',1,{amount:3*inc});
  const end=act('withdraw',0);
  assert.equal(end.phase,'end');
  assert.equal(end.turn,0);
  assert.equal(end.auction,null);
  assert.equal(end.owners[tile],2);
  assert.deepEqual(end.players.map(p=>p.cash),[100,100,100-2*inc]);
  illegal('withdraw',0);
});
test('all pass expires the auction; bankrupt seats never participate',()=>{
  const tiles=board.tiles.slice();
  tiles[2]={kind:'fee',price:101};
  start(3,{...board,tiles});
  assert.equal(act('roll',0).players[0].out,true);
  act('end',0);
  const roll=act('roll',1);
  act('pass',1);
  assert.equal(act('withdraw',1).auction.actor,2);
  const end=act('withdraw',2);
  assert.equal(end.phase,'end');
  assert.equal(end.auction,null);
  assert.deepEqual(end.players,roll.players);
  assert.deepEqual(end.owners,roll.owners);
  assert.equal(end.turn,1);
});
function tradeTable(){
  start();
  for(const actor of [0,1]){
    act('roll',actor);
    act('buy',actor);
    act('end',actor);
  }
}
const swap={to:1,give_deed:2,take_deed:7,give_cash:5,take_cash:0};
test('full-set gate, selectable policies, charges, rent and level cap',()=>{
  for(const policy of ['even','free','district']){
    const tiles=board.tiles.map((_,k)=>[2,7].includes(k)?{kind:'deed',group:'pair',price:100,rent:25}:{kind:'rest'});
    start(2,{...board,cash:1000,tiles,development:{...rules.development,policy}});
    for(const actor of [0,1]){act('roll',actor);act('buy',actor);act('end',actor)}
    illegal('build',0,{tile:2});
    act('propose',0,{to:1,give_cash:100,take_cash:0,give_deed:null,take_deed:7});
    let s=act('accept',1);
    assert.equal(s.rents[2],50);
    illegal('build',1,{tile:2});
    s=act('build',0,{tile:2});
    assert.equal(s.players[0].cash,800-(policy==='district'?20:10));
    assert.equal(s.rents[2],75);
    if(policy==='even')illegal('build',0,{tile:2});
    else if(policy==='free')assert.ok(s.builds.some(q=>q.tile===2));
    else assert.equal(s.rents[7],75);
    while(s.builds.length)s=act('build',0,{tile:s.builds[0].tile});
    assert.equal(s.levels[7],3);assert.equal(s.rents[2],110);
    illegal('build',0,{tile:2});
  }
});
test('only valid funded proposals lock the roll; only recipient can settle',()=>{
  tradeTable();
  illegal('accept',1);
  illegal('propose',1,{...swap,to:0,give_deed:7,take_deed:2});
  for(const invalid of [{to:0},{to:9},{give_deed:7},{take_deed:2},{take_deed:99},
    {give_cash:-1},{give_cash:81},{give_cash:0,take_cash:81},{give_cash:0.5},
    {take_cash:2},{take_deed:null},{give_deed:null,give_cash:0},
    {give_deed:null,take_deed:null}]) illegal('propose',0,{...swap,...invalid});
  const pending=act('propose',0,swap);
  assert.equal(pending.phase,'trade');
  assert.equal(pending.traded,true);
  assert.deepEqual(pending.trade,{from:0,...swap});
  assert.equal(pending.owners[2],0);
  assert.equal(pending.owners[7],1);
  for(const action of ['accept','reject','roll','end']) illegal(action,0);
  const s=act('accept',1);
  assert.equal(s.phase,'roll');
  assert.equal(s.turn,0);
  assert.equal(s.trade,null);
  assert.equal(s.traded,true);
  assert.equal(s.owners[2],1);
  assert.equal(s.owners[7],0);
  assert.deepEqual(s.players.map(p=>p.cash),[75,85]);
  illegal('accept',1);
  illegal('propose',0,{...swap,give_deed:7,take_deed:2});
});
test('reject preserves assets and consumes only this turn’s proposal',()=>{
  tradeTable();
  const sale={...swap,take_deed:null,take_cash:10,give_cash:0};
  const pending=act('propose',0,sale);
  const rejected=act('reject',1);
  assert.deepEqual(rejected.players,pending.players);
  assert.deepEqual(rejected.owners,pending.owners);
  assert.deepEqual(rejected.dice,pending.dice);
  assert.equal(rejected.trade,null);
  assert.equal(rejected.traded,true);
  illegal('accept',1);
  illegal('propose',0,sale);
  act('roll',0);
  act('buy',0);
  const next=act('end',0);
  assert.equal(next.traded,false);
  act('propose',1,{to:0,give_deed:null,take_deed:2,give_cash:10,take_cash:0});
  const accepted=act('accept',0);
  assert.equal(accepted.owners[2],1);
  assert.deepEqual(accepted.players.map(p=>p.cash),[70,70]);
});
test('complete seeded bot matches with multiple seat counts',()=>{
  for(const seats of [2,3,4]){
    let s=send({action:'start',rules,seats,seed:183});
    for(let i=0;s.phase!=='over'&&i<rules.rounds*seats*(seats+6);i++){
      const old=s,p=s.players[s.turn],price=rules.tiles[p.pos].price;
      let action=s.phase,actor=s.turn,fields={};
      if(action==='offer') action=price<=p.cash && s.round%2===0?'buy':'pass';
      else if(action==='auction'){
        const {high_bid,leader}=s.auction;
        actor=s.auction.actor;
        fields.amount=high_bid+rules.auction_increment;
        action=leader===null && fields.amount<=s.players[actor].cash?'bid':'withdraw';
      }else if(action==='roll' && !s.traded){
        const deed=s.owners.indexOf(actor),to=s.players.findIndex((p,i)=>i!==actor&&!p.out&&p.cash>0);
        if(deed>=0 && to>=0){
          action='propose';
          fields={to,give_deed:deed,take_deed:null,give_cash:0,take_cash:1};
        }
      }else if(action==='trade'){
        actor=s.trade.to;
        action=s.round%2===0?'accept':'reject';
      }
      s=act(action,actor,fields);
      if(action==='buy'){
        assert.equal(s.owners[p.pos],old.turn);
        assert.equal(s.players[old.turn].cash,p.cash-price);
      }
    }
    assert.equal(s.phase,'over');
    const scores=s.players.map((p,i)=>p.out?-Infinity:p.cash+s.owners.reduce((v,o,k)=>v+(o===i?rules.tiles[k].price:0),0));
    assert.deepEqual(s.winners,scores.flatMap((v,i)=>v===Math.max(...scores)?[i]:[]));
  }
});
