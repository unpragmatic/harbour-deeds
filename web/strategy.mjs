export function actingSeat(s) {
  return s.phase === 'auction' ? s.auction.actor : s.phase === 'trade' ? s.trade.to : s.turn;
}
export function locked(s,rules,i){
  return s.levels?.some((l,k)=>l>0 && rules.tiles[k].group===rules.tiles[i].group);
}
const visitCache=new Map();
function visits(n,turns){
  const key=`${n}:${turns}`;if(visitCache.has(key))return visitCache.get(key);
  let dist=Array(n).fill(0);dist[0]=1;const totals=Array(n).fill(0);
  for(let roll=0;roll<turns;roll++){
    const next=Array(n).fill(0);
    for(let i=0;i<n;i++)for(let d=2;d<=12;d++)next[(i+d)%n]+=dist[i]*(6-Math.abs(7-d))/36;
    next.forEach((v,i)=>totals[i]+=v);dist=next;
  }
  visitCache.set(key,totals);return totals;
}
function projectedGain(q,s,rules){
  const n=rules.tiles.length;
  return q.tiles.reduce((sum,k)=>{
    const level=rules.development.levels[s.levels[k]];
    const gain=Math.round(rules.tiles[k].rent*level.rent_pct/100)-s.rents[k];
    return sum+gain*s.players.reduce((hits,p,i)=>i===s.turn||p.out?hits:hits+visits(n,rules.rounds-s.round+(i>s.turn?1:0))[(k-p.pos+n)%n],0);
  },0);
}

function value(s, rules, i, who) {
  const t = rules.tiles[i];
  const district = rules.tiles.flatMap((other, k) => other.group === t.group ? [k] : []);
  const others = district.filter(k => k !== i && s.owners[k] === who).length;
  const remaining = (rules.rounds - s.round + 1) / rules.rounds;
  return t.price + Math.round(t.rent * remaining * (others === district.length - 1 ? 4 : others + 0.4));
}

export function botMove(s, rules) {
  const actor = actingSeat(s), cash = s.players[actor].cash;
  const reserve = Math.min(rules.salary, cash / 3);
  const step = rules.auction_increment;
  const send = (action, extra = {}) => ({action, actor, ...extra});
  if (s.phase === 'offer') {
    const tile = rules.tiles[s.players[actor].pos];
    // If rivals cannot meet the list price, try buying it cheaper at auction.
    const rival = Math.max(...s.players.map((p,i) => i === actor || p.out ? 0 : p.cash));
    return send(tile.price <= cash - reserve && rival >= tile.price ? 'buy' : 'pass');
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
    if(s.phase==='roll'){
      const options=(s.builds||[]).filter(q=>q.cost<=cash-reserve).map(q=>({q,net:projectedGain(q,s,rules)-q.cost})).sort((a,b)=>b.net-a.net);
      if(options[0]?.net>0)return send('build',{tile:options[0].q.tile});
    }
  }
  return send(s.phase);
}
