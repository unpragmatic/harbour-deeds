export function actingSeat(s) {
  return s.phase === 'auction' ? s.auction.actor : s.phase === 'trade' ? s.trade.to : s.turn;
}
export function locked(s,rules,i){
  return s.locked?.[i] ?? s.levels?.some((l,k)=>l>0 && rules.tiles[k].group===rules.tiles[i].group);
}
export function tierRent(rules,i,level){
  const t=rules.tiles[i],d=rules.development;
  return level===0?Math.round(t.rent*d.set_rent_pct/100):
    t.rent_levels?.[level-1]??Math.round(t.rent*d.levels[level-1].rent_pct/100);
}
export function tierCost(rules,i,tier){
  const t=rules.tiles[i];
  return t.build_costs?.[tier]??Math.round(t.price*rules.development.levels[tier].cost_pct/100);
}
const visitCache=new Map(),oddsCache=new Map();
function diceOdds({count=2,sides=6}={}){
  const key=`${count}:${sides}`;if(oddsCache.has(key))return oddsCache.get(key);
  let odds=[1];for(let j=0;j<count;j++){const next=Array(odds.length+sides).fill(0);odds.forEach((v,i)=>{for(let k=1;k<=sides;k++)next[i+k]+=v/sides});odds=next}
  oddsCache.set(key,odds);return odds;
}
function visits(n,turns,dice,once=false){
  const odds=diceOdds(dice);
  const key=`${n}:${dice?.count??2}:${dice?.sides??6}:${once}`;
  if(!visitCache.has(key))visitCache.set(key,[Array(n).fill(0)]);
  const byTurn=visitCache.get(key);
  while(byTurn.length<=turns){
    const later=byTurn.at(-1),result=Array(n).fill(0);
    for(let i=0;i<n;i++)odds.forEach((p,d)=>{
      const gap=(i+n-(d%n))%n,hit=Number(gap===0);
      result[i]+=p*(hit+(once && hit?0:later[gap]));
    });
    byTurn.push(result);
  }
  return byTurn[turns];
}
// A rolling planning window for indefinite games, not a game or simulation limit.
function futureTurns(s,rules,seat=s.turn){
  return rules.victory==='elimination'?Math.max(18,rules.tiles.length):rules.rounds-s.round+Number(seat>s.turn);
}
function traffic(k,s,rules,once=false){
  const n=rules.tiles.length;
  let total=0,miss=1;
  for(const [i,p] of s.players.entries()){
    if(i===s.turn||p.out)continue;
    const rolls=futureTurns(s,rules,i);
    const h=visits(n,rolls,rules.dice,once)[(k-p.pos+n)%n];
    total+=h;miss*=1-h;
  }
  return once?1-miss:total;
}
function projectedGain(q,s,rules){
  return q.tiles.reduce((sum,k)=>{
    const gain=tierRent(rules,k,s.levels[k]+1)-(s.rents[k]-(s.bonuses?.[k]??0));
    return sum+gain*traffic(k,s,rules);
  },0);
}
// Liquidate only to materially reduce a known next-roll default risk, not to
// turn cheap auction wins into cash at the expense of final list-value wealth.
function rescueSale(s,rules){
  if(!s.sells?.length)return;
  const actor=s.turn,p=s.players[actor],n=rules.tiles.length;
  const short=diceOdds(rules.dice).map((prob,d)=>{
    const path=p.pos+d,k=path%n,t=rules.tiles[k];
    const salary=Math.floor(path/n)*rules.salary+(path>=n&&k===0?(rules.salary_land??rules.salary)-rules.salary:0);
    const owner=s.owners[k],mult=rules.utility_multipliers?.[t.group];
    const rent=owner!=null&&mult?d*mult[rules.tiles.filter((x,j)=>x.group===t.group&&s.owners[j]===owner).length-1]:s.rents[k];
    const bill=t.kind==='fee'?(t.cash_tax_pct!=null?Math.round((p.cash+salary)*t.cash_tax_pct/100):t.price):owner!=null && owner!==actor?Math.max(0,rent-p.cover):0;
    return {prob,need:bill-p.cash-salary};
  }).filter(x=>x.prob>0 && x.need>0);
  if(short.reduce((sum,x)=>sum+x.prob,0)<0.10)return;
  return s.sells.map(q=>{
    const saved=short.reduce((sum,x)=>sum+(q.price>=x.need?x.prob:0),0);
    return {tile:q.tile,saved,loss:value(s,rules,q.tile,actor)-q.price+(s.bonuses?.[q.tile]??0)};
  }).filter(x=>x.saved>0).sort((a,b)=>b.saved-a.saved||a.loss-b.loss)[0];
}

function value(s, rules, i, who) {
  const t = rules.tiles[i];
  const district = rules.tiles.flatMap((other, k) => other.group === t.group ? [k] : []);
  const others = district.filter(k => k !== i && s.owners[k] === who).length;
  const fares=rules.network_fares?.[t.group]??rules.utility_multipliers?.[t.group]?.map(k=>k*rules.dice.count*(rules.dice.sides+1)/2);
  if(fares){
    const marginal=(others+1)*fares[others]-others*(others?fares[others-1]:0);
    const turns=s.players.reduce((n,p,k)=>n+(k===who||p.out?0:Math.max(0,futureTurns(s,rules,k))),0);
    return t.price+Math.round(marginal*turns/rules.tiles.length);
  }
  const remaining = rules.victory==='elimination'?1:(rules.rounds - s.round + 1) / rules.rounds;
  return t.price + Math.round(t.rent * remaining * (others === district.length - 1 ? 4 : others + 0.4));
}

export function botMove(s, rules) {
  const actor = actingSeat(s), cash = s.players[actor].cash;
  const reserve = Math.min(rules.salary, cash / 3);
  const step = rules.auction_increment;
  // In a duel, a collected dollar can also cost the only rival a dollar.
  // Credit that second dollar only for rent not already covered by their guild.
  const duelRival=s.players.length===2?s.players[1-actor]:null;
  const rentWeight=duelRival&&!duelRival.cover?2:1;
  const send = (action, extra = {}) => ({action, actor, ...extra});
  if(s.phase==='roll'&&s.players[actor].in_prison&&s.players[actor].pardons)return send('pardon');
  if(s.phase==='debt'){
    const need=s.debt.remaining;
    // Cover with the smallest sufficient lot, or make the largest partial
    // payment. Prefer shedding a level to a whole deed at an equal price.
    const options=[...s.salvages.map(q=>({...q,action:'salvage'})),...s.sells.map(q=>({...q,action:'sell'}))];
    options.sort((a,b)=>Math.min(b.price,need)-Math.min(a.price,need)||a.price-b.price);
    return options.length?send(options[0].action,{tile:options[0].tile}):send('bankrupt');
  }
  if(s.phase==='works'){
    const best=s.commissions.filter(q=>q.cost<=cash-reserve)
      .map(q=>({q,net:rentWeight*traffic(q.tile,s,rules,true)*q.gain-q.cost})).sort((a,b)=>b.net-a.net)[0];
    return best?.net>0?send('commission',{tile:best.q.tile}):send('skip');
  }
  if(s.phase==='guild'){
    const p=s.players[actor],t=rules.tiles[p.pos],turns=futureTurns(s,rules);
    const exposed=s.rents.filter((_,k)=>s.owners[k]!==null&&s.owners[k]!==actor);
    const benefit=exposed.reduce((sum,r)=>sum+Math.max(0,Math.min(t.cover_offer,r)-Math.min(p.cover,r)),0);
    return send(exposed.length && (1-(1-exposed.length/rules.tiles.length)**turns)*benefit/exposed.length>t.cash_offer?'insure':'grant');
  }
  if (s.phase === 'offer') {
    const tile = rules.tiles[s.players[actor].pos];
    // If rivals cannot meet the list price, try buying it cheaper at auction.
    const rival = Math.max(...s.players.map((p,i) => i === actor || p.out ? 0 : p.cash));
    return send(tile.price <= cash - reserve && (rules.auction_declined===false||rival >= tile.price) ? 'buy' : 'pass');
  }
  if (s.phase === 'auction') {
    const {tile, high_bid} = s.auction;
    const ceiling = Math.min(value(s,rules,tile,actor), cash - reserve);
    const next = Math.max(high_bid + step, Math.floor((high_bid + (ceiling - high_bid) * 0.55) / step) * step);
    return ceiling < high_bid + step ? send('withdraw') : send('bid', {amount:Math.min(next,Math.floor(ceiling / step) * step)});
  }
  if (s.phase === 'trade') {
    const t = s.trade;
    const benefit = t.give_cash + (t.give_deed === null ? 0 : value(s,rules,t.give_deed,actor));
    const cost = t.take_cash + (t.take_deed === null ? 0 : value(s,rules,t.take_deed,actor));
    return send(benefit >= cost && cash - t.take_cash >= reserve ? 'accept' : 'reject');
  }
  if(s.phase==='roll' && !rules.liquidation?.deeds){
    const q=rescueSale(s,rules);
    if(q)return send('sell',{tile:q.tile});
  }
  if (s.phase === 'roll' && !s.traded) {
    // Seek mutually valuable acquisitions rather than sending speculative offers every turn.
    const deals = s.owners.flatMap((to, i) => {
      if (to === null || to === actor || locked(s,rules,i)) return [];
      const max = value(s,rules,i,actor), min = value(s,rules,i,to);
      const give_cash = Math.ceil((max+min)/2);
      return max-min >= step && give_cash <= cash-reserve ? [{to,i,give_cash,margin:max-min}] : [];
    }).sort((a,b) => b.margin-a.margin);
    if(deals.length) {
      const {to,i,give_cash}=deals[0];
      return send('propose',{to,take_deed:i,give_deed:null,take_cash:0,give_cash});
    }
  }
  if(s.phase==='roll'&&(!s.traded||rules.victory==='elimination')){
    const options=(s.builds||[]).filter(q=>q.cost<=cash-reserve).map(q=>({q,net:rentWeight*projectedGain(q,s,rules)-q.cost})).sort((a,b)=>b.net-a.net);
    if(options[0]?.net>0)return send('build',{tile:options[0].q.tile});
  }
  return send(s.phase);
}
