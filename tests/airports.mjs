import assert from 'node:assert/strict';
import test from 'node:test';
import {boards, send} from './economy-fixture.mjs';
import {botMove} from '../web/strategy.mjs';

const deed = () => ({kind:'deed', group:'Ferries', price:180, rent:25});
const rules = {
  ...boards.compact, dice:{count:1, sides:6}, cash:500, salary:0,
  network_fares:{Ferries:[25,55,100]},
  liquidation:{deeds:true, improvements:true, improvement_rate_pct:50},
  tiles:[{kind:'start'}, {kind:'fee',price:400}, deed(), {kind:'rest'}, deed(), deed(),
    {kind:'rest'}, {kind:'works',cost_pct:50,bonus_pct:100}],
};
const ports = [2,4,5];
const start = r => send({action:'start', rules:r, seats:2, seed:146});
const move = (action, actor, fields) => send({action, actor, ...fields});
const fares = s => ports.map(k => s.rents[k]);
const cash = s => s.players.map(p => p.cash);

// Seed 146 lands at 4, 2, 5, 5, 7, 2, 1: the table reaches every tier and
// a real debt decision without modifying a snapshot or forcing a die roll.
function split(r) {
  start(r);
  move('roll',0); move('buy',0); move('end',0);
  move('roll',1); move('pass',1); move('bid',1,{amount:40});
  const won = move('withdraw',0);
  assert.equal(won.owners[2],1);
  assert.equal(won.acquisition[2],40);
  move('end',1); move('roll',0);
  return move('buy',0);
}
function buyLastDeed() {
  move('propose',0,{to:1, take_deed:2, give_cash:20, take_cash:0});
  return move('accept',1);
}

test('network fares use the landlord’s holdings on the actual rent payment', () => {
  assert.deepEqual(fares(start(rules)),[25,25,25]);
  let s = split(rules);
  assert.deepEqual(ports.map(k => s.owners[k]),[1,0,0]);
  assert.deepEqual(fares(s),[25,55,55]);
  move('end',0);
  s = move('roll',1);
  assert.equal(s.players[1].pos,5);
  assert.deepEqual(cash(s),[195,405]); // $55 moved, no salary or cover
  move('end',1);
  s = buyLastDeed();
  assert.deepEqual(fares(s),[100,100,100]);
  assert.deepEqual(s.builds,[]);
  assert.deepEqual(s.sells.map(q => q.tile),ports);
  for (const tile of ports) assert.throws(() => move('build',0,{tile}),/improvement/);
  s = move('roll',0);
  assert.equal(s.phase,'works');
  assert.deepEqual(s.commissions,[]);
  for (const tile of ports) assert.throws(() => move('commission',0,{tile}),/refit/);
  move('skip',0); move('end',0);
  s = move('roll',1);
  assert.equal(s.players[1].pos,2);
  assert.deepEqual(cash(s),[275,325]); // trade cost $20, then rent paid $100

  s = move('end',1);
  assert.deepEqual(s.sells.find(q => q.tile === 2),{tile:2,price:90}); // list, not auction price
  s = move('sell',0,{tile:2});
  assert.equal(s.owners[2],null);
  assert.deepEqual(fares(s),[25,55,55]);
  s = move('roll',0);
  assert.equal(s.phase,'debt');
  assert.equal(s.debt.remaining,35);
  assert.deepEqual(s.salvages,[]);
  assert.deepEqual(s.sells,[{tile:4,price:90},{tile:5,price:90}]);
  s = move('sell',0,{tile:4});
  assert.equal(s.debt,null);
  assert.equal(s.phase,'end');
  assert.equal(s.players[0].cash,55);
  assert.deepEqual(fares(s),[25,25,25]);
});

test('a trade reprices untraded siblings on both sides only on acceptance', () => {
  split(rules);
  move('end',0); move('roll',1); move('end',1);
  const pending = move('propose',0,{to:1, give_deed:4, give_cash:0, take_cash:15});
  assert.deepEqual(fares(pending),[25,55,55]);
  const settled = move('accept',1);
  assert.deepEqual(ports.map(k => settled.owners[k]),[1,1,0]);
  assert.deepEqual(fares(settled),[55,55,25]);
});

test('the same deeds without a schedule retain normal set rent, builds and refits', () => {
  const historic = {...rules};
  delete historic.network_fares;
  assert.deepEqual(fares(split(historic)),[25,25,25]);
  move('end',0); move('roll',1); move('end',1);
  let s = buyLastDeed();
  assert.deepEqual(fares(s),[50,50,50]);
  assert.deepEqual(s.builds.map(q => q.tile),ports);
  s = move('roll',0);
  assert.deepEqual(s.commissions.map(q => q.tile),ports);
});

test('invalid network schedules fail at start; zero is a valid base fare', () => {
  for (const schedule of [[], [25,55], [25,55,100,150], [20,55,100],
    [25,55,55], [25,70,55], [-1,55,100], [25,55.5,100], [25,55,2**31]]) {
    assert.throws(() => start({...rules,network_fares:{Ferries:schedule}}),/start:/);
  }
  assert.throws(() => start({...rules,network_fares:{Ghost:[25]}}),/start:/);
  for (const change of [{rent:26},{kind:'rest'}]) {
    const tiles = rules.tiles.map((t,i) => i === 5 ? {...t,...change} : t);
    assert.throws(() => start({...rules,tiles}),/start:/);
  }
  const tiles = rules.tiles.map(t => t.kind === 'deed' ? {...t,rent:0,price:0} : t);
  assert.deepEqual(fares(start({...rules,tiles,network_fares:{Ferries:[0,1,2]}})),[0,0,0]);
});

test('seeded full-game airport survey on release WASM', t => {
  const grand = boards.grand, schedule = grand.network_fares.Airports;
  const airports = grand.tiles.flatMap((tile,i) => tile.kind === 'deed' && tile.group === 'Airports' ? [i] : []);
  assert.deepEqual(airports,[7,18,33]);
  const stats = {seeds:'1–24', seats:3, rounds:grand.rounds, gamesWithPairOrBetter:0, gamesWithTrio:0,
    bought:0, wonAtAuction:0, transferred:0, soldToBank:0, landingsByFare:{}, creditedOnLanding:0};
  for (let seed=1; seed<=24; seed++) {
    let s = send({action:'start', rules:grand, seats:stats.seats, seed}), peak = 0, moves = 0;
    while (s.phase !== 'over') {
      assert.ok(++moves < 3000,`Unfinished seed ${seed}`);
      const m = botMove(s,grand), next = send(m);
      for (const k of airports) {
        const from = s.owners[k], to = next.owners[k];
        const held = to === null ? 0 : airports.filter(j => next.owners[j] === to).length;
        peak = Math.max(peak,held);
        assert.equal(next.rents[k],schedule[Math.max(held-1,0)]);
        if (from !== to) {
          if (m.action === 'buy') stats.bought++;
          if (s.phase === 'auction') stats.wonAtAuction++;
          if (m.action === 'accept') stats.transferred++;
          if (m.action === 'sell') stats.soldToBank++;
        }
        if (m.action === 'roll' && next.players[m.actor].pos === k && from !== null && from !== m.actor) {
          const fare = s.rents[k];
          stats.landingsByFare[fare] = (stats.landingsByFare[fare] ?? 0) + 1;
          stats.creditedOnLanding += next.players[from].cash - s.players[from].cash;
        }
      }
      s = next;
    }
    stats.gamesWithPairOrBetter += peak >= 2;
    stats.gamesWithTrio += peak === 3;
  }
  t.diagnostic(JSON.stringify(stats));
});
