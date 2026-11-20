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
  assert.ok(['guild','auction','works'].every(p=>phases.has(p)));assert.equal(cards.size,grand.cards.length);
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
test('frozen rules without bank_sale replay original charges, rent and level cap',()=>{
  const {bank_sale,victory,liquidation,...legacy}=board;
  const levels=[10,15,20].map((c,i)=>({cost_pct:c,rent_pct:[300,380,440][i]}));
  for(const policy of ['even','free','district']){
    const tiles=board.tiles.map((_,k)=>[2,7].includes(k)?{kind:'deed',group:'pair',price:100,rent:25}:{kind:'rest'});
    start(2,{...legacy,cash:1000,tiles,development:{...rules.development,policy,levels}});
    for(const actor of [0,1]){act('roll',actor);act('buy',actor);act('end',actor)}
    illegal('build',0,{tile:2});
    act('propose',0,{to:1,give_cash:100,take_cash:0,give_deed:null,take_deed:7});
    let s=act('accept',1);
    assert.deepEqual(s.sells,[]);
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
test('bank buys at the legal pre-roll quote; trades do not reset auction receipts',()=>{
  const tiles=board.tiles.map((_,k)=>k===2?{kind:'deed',group:'A',price:200,rent:10}:k===7?{kind:'deed',group:'B',price:100,rent:25}:{kind:'rest'});
  for(const [bank_sale,expected] of [[rules.bank_sale,100],[{basis:'acquisition',rate_pct:50},30],[{basis:'list',rate_pct:25},50]]){
    start(2,{...board,cash:450,tiles,bank_sale});
    act('roll',0);act('pass',0);act('bid',0,{amount:60});act('withdraw',1);
    illegal('sell',0,{tile:2});act('end',0);act('roll',1);act('buy',1);
    let s=act('end',1);assert.deepEqual(s.sells,[{tile:2,price:expected}]);
    illegal('sell',1,{tile:7});illegal('sell',0,{tile:7});illegal('sell',0,{tile:99});
    s=act('propose',0,{...swap,take_deed:null,take_cash:80,give_cash:0});
    assert.deepEqual(s.sells,[]);illegal('sell',0,{tile:2});act('accept',1);
    act('roll',0);s=act('end',0);
    assert.equal(s.acquisition[2],60);
    assert.deepEqual(s.sells.find(q=>q.tile===2),{tile:2,price:expected});
    const before=s.players[1].cash;
    s=act('sell',1,{tile:2});assert.equal(s.phase,'roll');assert.equal(s.players[1].cash,before+expected);
    assert.equal(s.owners[2],null);assert.equal(s.acquisition[2],null);assert.equal(s.rents[2],10);
    illegal('sell',1,{tile:2});
    // Its next bank sale is a new transaction, not the previous receipt.
    for(let i=0;i<30&&s.phase!=='offer';i++){
      if(s.phase==='end')s=act('end',s.turn);
      s=act('roll',s.turn);
    }
    assert.equal(s.players[s.turn].pos,2);s=act('buy',s.turn);assert.equal(s.acquisition[2],200);
  }
});
test('developing locks even untouched siblings for both sale and trade',()=>{
  const tiles=board.tiles.map((_,k)=>[2,7].includes(k)?{kind:'deed',group:'pair',price:100,rent:25}:{kind:'rest'});
  start(2,{...board,cash:600,tiles});
  act('roll',0);act('buy',0);act('end',0);act('roll',1);act('pass',1);
  act('withdraw',1);act('bid',0,{amount:60});let s=act('end',1);
  assert.deepEqual(s.sells,[{tile:2,price:50},{tile:7,price:50}]);assert.equal(s.rents[7],50);
  s=act('build',0,{tile:2});assert.equal(s.levels[7],0);
  assert.ok(s.locked[2]&&s.locked[7]);assert.deepEqual(s.sells,[]);
  illegal('sell',0,{tile:7});
  illegal('propose',0,{...swap,give_deed:7,take_deed:null,take_cash:5,give_cash:0});
  act('roll',0);act('end',0);
  illegal('propose',1,{to:0,give_cash:5,take_cash:0,take_deed:7,give_deed:null});
});
const works={kind:'works',cost_pct:50,bonus_pct:100};
function firstWorks(){
  const d={kind:'deed',group:'pair',price:100,rent:25};
  const tiles=[{kind:'rest'},d,{kind:'guild',cash_offer:10,cover_offer:40},works,works,d,{kind:'rest'},{kind:'rest'}];
  start(2,{...board,dice:{count:1,sides:2},cash:400,tiles});
  act('roll',0);act('buy',0);act('end',0);act('roll',1);act('end',1);
  return act('roll',0); // seat 0 lands on Works while owning only one of the two deeds.
}
test('Works offers an optional one-visit refit on a split set; no stacking or repeat payout',()=>{
  let s=firstWorks();assert.equal(s.phase,'works');assert.deepEqual(s.commissions,[{tile:1,cost:13,gain:25}]);
  const cash=s.players[0].cash;
  illegal('commission',1,{tile:1});illegal('commission',0,{tile:5});illegal('skip',1);
  s=act('commission',0,{tile:1});assert.equal(s.phase,'end');assert.equal(s.players[0].cash,cash-13);
  assert.equal(s.bonuses[1],25);assert.equal(s.rents[1],50);assert.equal(s.levels[1],0);
  act('end',0);act('roll',1);act('insure',1);s=act('end',1);
  assert.equal(s.locked[1],false);assert.equal(s.sells[0].tile,1);
  s=act('roll',0);assert.equal(s.phase,'works');assert.deepEqual(s.commissions,[]);illegal('commission',0,{tile:1});
  const before=s.players[0].cash;s=act('skip',0);assert.equal(s.players[0].cash,before);
  for(let turn=0;turn<20;turn++){
    s=act('end',s.turn);const a=s.turn,prior=s;s=act('roll',a);
    if(a===1&&s.players[1].pos===1){
      assert.equal(s.bonuses[1],0);assert.equal(s.rents[1],25);
      assert.equal(s.players[1].cover,0);assert.equal(prior.players[1].cash-s.players[1].cash,10);
      assert.equal(s.players[0].cash-prior.players[0].cash,50);return;
    }
    if(s.phase==='works')s=act('skip',a);
    if(s.phase==='guild')s=act('grant',a);
  }assert.fail('renter never visited refitted deed');
});
test('temporary refits stay off the market: cancel on sale or transfer',()=>{
  for(const trade of [true,false]){
    firstWorks();act('commission',0,{tile:1});act('end',0);act('roll',1);act('grant',1);act('end',1);
    let s;if(trade){act('propose',0,{...swap,give_deed:1,take_deed:null,give_cash:0,take_cash:10});s=act('accept',1)}
    else s=act('sell',0,{tile:1});
    assert.equal(s.bonuses[1],0);assert.equal(s.rents[1],25);
    assert.equal(s.acquisition[1],trade?100:null);
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

test('only net worth closes on the final round, with cash + list ties; paying to zero is solvent',()=>{
  const tiles=Array(16).fill({kind:'rest'});
  tiles[2]={kind:'deed',price:100,rent:10};tiles[7]={kind:'deed',price:50,rent:10};
  const {victory,liquidation,...old}=board;
  for(const config of [old,board,{...board,victory:'elimination'}]){
    start(2,{...config,rounds:1,tiles});
    for(const a of [0,1]){act('roll',a);act('buy',a);var s=act('end',a)}
    assert.deepEqual(s.players.map(p=>[p.cash,p.out]),[[0,false],[50,false]]);
    if(config.victory==='elimination'){
      assert.equal(s.phase,'roll');assert.equal(s.round,2);assert.deepEqual(s.winners,[]);
    }else{
      assert.equal(s.phase,'over');assert.deepEqual(s.winners,[0,1]);
    }
  }
  for(const config of [old,board,{...board,liquidation:{deeds:true}}]){
    const fees=tiles.slice();fees[2]={kind:'fee',price:100};fees[7]={kind:'fee',price:101};
    start(2,{...config,tiles:fees});
    const zero=act('roll',0);assert.equal(zero.players[0].cash,0);assert.equal(zero.players[0].out,false);
    act('end',0);const over=act('roll',1);
    assert.equal(over.phase,'over');assert.deepEqual(over.winners,[0]);assert.equal(over.debt,null);
  }
  illegal('start',undefined,{rules:{...board,victory:'time'},seats:2,seed:10});
});

// Fully replayable: two purchases, landlord's one-use refit, renter's guild
// policy, then a short rent past the nominal round count of the elimination game.
function rentDebt(options={}){
  const tiles=Array(16).fill({kind:'rest'});
  for(const [i,price,rent] of [[2,90,10],[7,60,70],[9,70,10]])
    tiles[i]={kind:'deed',price,rent,group:String(i)};
  tiles[1]={kind:'guild',cash_offer:10,cover_offer:25};tiles[15]=works;
  const config={...board,cash:200,rounds:1,victory:'elimination',liquidation:{deeds:true},
    development:{...board.development,set_rent_pct:100},tiles,...options};
  let s=start(2,config);
  for(const [a,action] of [[0,'buy'],[1,'buy'],[0,'buy'],[1,'commission'],[0,'insure'],
    [1],[0],[1],[0],[1,'grant']]){
    s=act('roll',a);
    if(action==='commission'&&config.victory==='elimination'){
      assert.ok(s.round>config.rounds);
      assert.ok(['skip','commission'].includes(botMove(s,config).action));
    }
    if(action)s=act(action,a,action==='commission'?{tile:7}:{});
    s=act('end',a);
  }
  const creditorCash=s.players[1].cash;
  return {s:act('roll',0),creditorCash,config};
}

test('debtor chooses sales or declaration; rent, refit and guild settle once to the original landlord',()=>{
  for(const decision of ['pay','declare','declare-after-sale']){
    const {s:opened,creditorCash,config}=rentDebt();let s=opened;
    assert.equal(s.phase,'debt');
    assert.deepEqual(s.debt,{debtor:0,creditor:1,amount:115,paid:40,remaining:75});
    assert.equal(s.players[1].cash,creditorCash+25+40);
    assert.deepEqual(s.sells,[{tile:2,price:45},{tile:9,price:35}]);
    assert.equal(s.players[0].cover,0);assert.equal(s.bonuses[7],0);
    for(const action of ['end','roll','buy','build','salvage'])illegal(action,0,{tile:2});
    illegal('bankrupt',1);illegal('sell',1,{tile:7});
    if(decision!=='declare'){
      s=act('sell',0,{tile:9});
      assert.deepEqual(s.debt,{debtor:0,creditor:1,amount:115,paid:75,remaining:40});
      assert.equal(s.players[1].cash,creditorCash+100);illegal('sell',0,{tile:9});
    }
    if(decision==='pay'){
      const move=botMove(s,config);assert.deepEqual(move,{action:'sell',actor:0,tile:2});
      s=send(move);
      assert.equal(s.phase,'end');assert.equal(s.players[0].cash,5);assert.equal(s.players[0].out,false);
      assert.equal(s.players[1].cash,creditorCash+140);
    }else{
      s=act('bankrupt',0);
      assert.equal(s.phase,'over');assert.deepEqual(s.winners,[1]);assert.equal(s.players[0].out,true);
      assert.equal(s.players[1].cash,creditorCash+(decision==='declare'?65:100));
    }
    assert.equal(s.debt,null);
    assert.equal(s.owners[2],null);assert.equal(s.acquisition[9],null);
    assert.equal(s.events.filter(e=>e.startsWith('Guild paid')).length,1);
    assert.equal(s.events.filter(e=>e.startsWith('Refit on')).length,1);
    illegal('bankrupt',0);illegal('salvage',0,{tile:2});
  }
});

test('only enabled, legal sales delay insolvency; frozen and explicitly disabled rules agree',()=>{
  const old=rentDebt({victory:undefined,rounds:10,liquidation:undefined});
  for(const options of [{deeds:false,improvements:false},{improvements:true},{deeds:true}]){
    const missingBank=options.deeds?{bank_sale:undefined}:{};
    const {s,creditorCash}=rentDebt({victory:'net_worth',rounds:10,liquidation:options,...missingBank});
    assert.equal(s.phase,'over');assert.deepEqual(s.winners,[1]);assert.equal(s.debt,null);
    assert.equal(s.players[1].cash,creditorCash+65);
    if(!options.improvements&&!options.deeds)assert.deepEqual(s,old.s);
  }
});
