const routeScreen=matchMedia('(max-width:1199px), (max-height:940px)');
const still=matchMedia('(prefers-reduced-motion: reduce)');
const signed=n=>`${n<0?'−':'+'}${money(Math.abs(n))}`;
const pips=[[],[4],[0,8],[0,4,8],[0,2,6,8],[0,2,4,6,8],[0,2,3,5,6,8]];
const artwork={
  ship:'<path d="M7 43h50l-9 10H17zM30 7v32H9L30 7zm5 7 17 25H35z"/>',
  deed:'<path d="M14 5h35v40H14zM21 15h21m-21 7h15m-15 7h20"/><circle cx="40" cy="40" r="8"/><path d="m36 48-2 10 6-4 5 4-1-11"/>',
  gavel:'<path d="m21 14 8-8 17 17-8 8zM12 23l7-7 17 17-7 7zM34 28l21 21-5 5-21-21zM8 49h22l4 7H5z"/>',
  build:'<path d="M6 54h52M10 52V32l14 6V25l15 9v18M43 52l2-39h7l3 39M16 43v4m9-4v4m9-4v4"/>',
  trade:'<path d="M7 17h36v-7l13 12-13 12v-7H7zm50 29H21v7L8 41l13-12v7h36z"/>',
  card:'<path d="m10 22 22-13 22 13v29H10zM10 23l22 16 22-16m-40 23 14-13m22 13L36 33"/>',
  cover:'<path d="m32 6 22 8c0 18-3 31-22 43C13 45 10 32 10 14zM21 31l8 8 15-17"/>',
  coin:'<ellipse cx="32" cy="20" rx="21" ry="9"/><path d="M11 20v20c0 12 42 12 42 0V20M11 27c0 12 42 12 42 0M11 34c0 12 42 12 42 0"/>',
  final:'<path d="M17 9h30l-3 17q-2 9-12 13-10-4-12-13zM18 14H8q0 17 15 18m23-18h10q0 17-15 18M32 39v9m-12 6h24l-4-6H24z"/>'
};
const icon=name=>`<svg viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">${artwork[name]}</svg>`;
function diceProp(values){
  return `<span class="diceSet">${values.map(v=>`<span class="die">${pips[v]?pips[v].map(i=>`<i style="grid-area:${1+Math.floor(i/3)} / ${1+i%3}"></i>`).join(''):v}</span>`).join('')}</span>`;
}
function placeStage(){
  const stage=$('stage'),board=$('board'),route=routeScreen.matches;
  board.classList.toggle('route',route);stage.classList.toggle('strip',route);
  if(route)board.before(stage);else board.querySelector('.ocean').append(stage);
}
let animations=[], lastDeltas=[];
function clearMotion(){
  animations.forEach(a=>a.cancel());animations=[];$('wake').replaceChildren();$('board').classList.remove('inTransit');
}
function resetStage(){
  clearMotion();lastDeltas=[];delete $('stage').dataset.live;
}
function initFeedback(){
  initSound();routeScreen.addEventListener('change',()=>{clearMotion();placeStage()});
  still.addEventListener('change',clearMotion);
}
function plate(tag,title,detail,prop,kind){
  $('stage').dataset.kind=kind;$('stageTag').textContent=tag;$('stageTitle').textContent=title;
  $('stageDetail').textContent=detail;$('stageProp').innerHTML=prop;
}
function ledger(s){
  const actor=actingSeat(s);
  const rows=s.players.map((p,i)=>{
    const diff=lastDeltas[i]||0;
    return `<div class="account ${actor===i&&s.phase!=='over'?'acting':''}" style="--seat:${colors[i]}" aria-label="${seat(i)}: ${p.out?'bankrupt':money(p.cash)}${diff?', change '+signed(diff):''}"><span class="seatDisc">${i+1}</span><span class="seatName">${seat(i)}</span><b>${p.out?'Out':money(p.cash)}</b>${diff?`<em class="${diff>0?'credit':'debit'}">${signed(diff)}</em>`:''}</div>`;
  }).join('');
  $('stageLedger').innerHTML=rows;$('sheetLedger').innerHTML=rows;
}
function syncStage(s){
  ledger(s);
  if($('stage').dataset.live)return;
  const tile=s.auction?.tile??s.players[s.turn].pos;
  const context={roll:'Ready to sail',offer:'Deed for sale',guild:'Guild charter',auction:'At auction',trade:'Contract offered',end:'Settlement',over:'Final accounts'};
  plate(context[s.phase],s.phase==='over'?s.winners.map(seat).join(' & '):rules.tiles[tile].name,
    s.phase==='roll'?`${seat(s.turn)} to roll · ${rules.dice?.count??2} dice`:s.events.at(-1)||context[s.phase],
    icon(s.phase==='auction'?'gavel':s.phase==='over'?'final':'ship'),'ready');
}
function outcome(m,b,s){
  const a=m.actor,dieTotal=s.dice.reduce((x,y)=>x+y,0),pos=s.players[a].pos;
  const delta=s.players[a].cash-b.players[a].cash, lot=b.auction?.tile??m.tile??pos;
  const tile=rules.tiles[lot],who=seat(a),action=m.action;
  let tag=who,title='',detail='',prop='ship',cue=uxInventory.commands[action][2],kind=action,targets=[lot];
  if(s.phase==='over'){
    tag='Final accounts';title=`${s.winners.map(seat).join(' & ')} ${s.winners.length>1?'tie':'wins'}`;
    detail='Cash and deed values settled';prop='final';cue='final';kind='final';targets=[];
  }else if(action==='roll'){
    tag=`${who} rolled ${dieTotal}`;title=tile.name;prop='dice';
    if(tile.kind==='deed')detail=s.owners[pos]===null?`For sale · ${money(tile.price)}`:s.owners[pos]===a?'Your own deed':`Rent to ${seat(s.owners[pos])} · ${money(b.rents[pos])}`;
    else detail=({guild:'Guild charter · cash or cover',fee:`Harbor dues · ${money(tile.price??0)}`,start:'Port salary',rest:'Safe harbor',notice:'Port notice',
      exchange:s.auction?`Auction: ${rules.tiles[s.auction.tile].name}`:'All deeds owned'})[tile.kind];
    if(s.last_card!=null){title=rules.cards[s.last_card].title;detail=`Dispatch at ${tile.name}`;kind='dispatch'}
    if(delta)detail+=` · Net ${signed(delta)}`;
    if(s.players[a].cover!==b.players[a].cover&&!s.players[a].out)detail+=` · Cover ${money(s.players[a].cover)}`;
    if(s.players[a].out)detail+=' · Bankrupt';
  }else if(b.auction&&!s.auction){
    const winner=s.owners[lot];tag='Auction closed';title=winner==null?'No sale':`Sold · ${money(action==='bid'?m.amount:b.auction.high_bid)}`;
    detail=`${tile.name} · ${winner==null?'Still on the market':seat(winner)+' takes the deed'}`;kind='sold';prop='gavel';cue='gavel';
  }else if(action==='pass'||action==='bid'||action==='withdraw'){
    tag=action==='pass'?'Auction opened':action==='bid'?'High bid':'Bidder out';
    title=action==='pass'?tile.name:action==='bid'?money(m.amount):`${who} withdrew`;
    detail=action==='pass'?`Bidding starts at ${money(rules.auction_increment)}`:`${tile.name} · ${action==='bid'?who+' leads':seat(s.auction.actor)+' to bid'}`;prop='gavel';
  }else if(action==='buy'){
    tag='Deed recorded';title=tile.name;detail=`${who} paid ${money(-delta)} · Rent ${money(s.rents[lot])}`;prop='deed';
  }else if(action==='build'){
    targets=b.builds.find(q=>q.tile===lot).tiles;
    tag=`${who} built level ${s.levels[lot]}`;title=targets.length>1?tile.group:tile.name;
    detail=`Cost ${money(-delta)} · ${targets.length>1?targets.length+' deeds improved':'Rent '+money(b.rents[lot])+' → '+money(s.rents[lot])}`;prop='build';
  }else if(['propose','accept','reject'].includes(action)){
    const deal=s.trade??b.trade;targets=[deal.give_deed,deal.take_deed].filter(i=>i!=null);
    tag=`${seat(deal.from)} ↔ ${seat(deal.to)}`;title={propose:'Contract offered',accept:'Trade signed',reject:'Offer declined'}[action];
    detail=`${summary(deal.give_deed,deal.give_cash)} ↔ ${summary(deal.take_deed,deal.take_cash)}`;prop='trade';
  }else if(action==='grant'||action==='insure'){
    const grant=action==='grant';tag=grant?'Guild grant':'Rent cover';title=grant?signed(delta):money(s.players[a].cover);
    detail=`${who} · ${grant?'Paid by the guild':'Protected on next rent bill'}`;prop=grant?'coin':'cover';
  }
  return {tag,title,detail,kind,cue,targets,prop:prop==='dice'?diceProp(s.dice):icon(prop)};
}
function animate(el,frames,timing){
  if(!el?.animate)return;
  const anim=el.animate(frames,timing);animations.push(anim);return anim;
}
function impact(el,delay=0,ink=''){
  const center=el.getBoundingClientRect(),base=$('wake').getBoundingClientRect();
  const ring=document.createElement('i');ring.className='waveRing';
  ring.style.left=`${center.left-base.left+center.width/2}px`;ring.style.top=`${center.top-base.top+center.height/2}px`;$('wake').append(ring);
  animate(ring,[{transform:'translate(-50%,-50%) scale(.3)',opacity:0},{opacity:1,offset:.12},{transform:'translate(-50%,-50%) scale(2.4)',opacity:0}],{delay,duration:430});
  animate(el,[{boxShadow:'inset 0 0 0 4px #f6a92d',backgroundColor:'#ffdf89'},{boxShadow:'inset 0 0 0 1px transparent'}],{delay,duration:620});
  if(ink){
    const stamp=document.createElement('b');stamp.className='inkStamp';stamp.textContent=ink;
    stamp.style.left=ring.style.left;stamp.style.top=ring.style.top;$('wake').append(stamp);
    animate(stamp,[{opacity:0,transform:'translate(-50%,-90%) scale(1.7) rotate(-18deg)'},{opacity:1,transform:'translate(-50%,-50%) scale(.94) rotate(-8deg)',offset:.18},{opacity:1,offset:.74},{opacity:0,transform:'translate(-50%,-66%) rotate(-8deg)'}],{duration:880,delay});
  }
}
function followTile(i){
  if($('boardView').hidden||$('modal').open)return;
  const view=$('boardView'),v=view.getBoundingClientRect(),r=$(`tile-${i}`).getBoundingClientRect();
  const top=v.top+(routeScreen.matches?$('stage').offsetHeight:0);
  if(r.top<top||r.bottom>v.bottom)view.scrollTop+=r.top-(top+v.bottom-r.height)/2;
}
function sail(move,b,s){
  const board=$('board'),wake=$('wake'),base=wake.getBoundingClientRect(),total=s.dice.reduce((x,y)=>x+y,0);
  const start=b.players[move.actor].pos,n=rules.tiles.length;
  const frames=[],steps=Math.min(total,n); // Limit work for designer dice that circle the board several times.
  for(let k=0;k<=steps;k++){
    const at=(start+Math.round(k*total/steps))%n,el=$(`tile-${at}`),r=el.getBoundingClientRect();
    const x=r.left-base.left+r.width/2,y=r.top-base.top+r.height/2;
    frames.push({transform:`translate(${x}px,${y}px)`,offset:k/steps});
    if(k>0&&k<steps)animate(el,[{backgroundColor:'#ffcf69'},{backgroundColor:getComputedStyle(el).backgroundColor}],{delay:85+490*k/steps,duration:300});
  }
  const pawn=document.createElement('div');pawn.className='sailing';
  pawn.style.setProperty('--seat',colors[move.actor]);pawn.innerHTML=`${icon('ship')}<b>${move.actor+1}</b>`;
  wake.append(pawn);board.classList.add('inTransit');
  const trip=animate(pawn,frames,{delay:85,duration:490,fill:'both'});
  const dock=()=>{pawn.remove();board.classList.remove('inTransit')};
  if(trip)trip.onfinish=dock;else dock();
  impact($(`tile-${s.players[move.actor].pos}`),550);
}
function liveFeedback(move,before,after){
  if(move.action==='end'&&after.phase!=='over')return;
  const event=outcome(move,before,after);
  clearMotion();lastDeltas=after.players.map((p,i)=>p.cash-before.players[i].cash);
  $('stage').dataset.live=move.action;plate(event.tag,event.title,event.detail,event.prop,event.kind);ledger(after);
  foley(event.cue);
  if(move.action==='roll'&&!document.hidden)followTile(after.players[move.actor].pos);
  if(still.matches||document.hidden||$('boardView').hidden)return;
  const prop=$('stageProp');
  if(prop.querySelector('.die')){
    [...prop.querySelectorAll('.die')].forEach((die,i)=>animate(die,[
      {transform:`translate(${i%2?25:-25}px,-20px) rotate(${i%2?75:-85}deg) scale(.8)`},
      {transform:'translateY(2px) rotate(-12deg)',offset:.42},
      {transform:'translateY(-9px) rotate(7deg)',offset:.66},{transform:'none'}],{duration:420+i*18}));
    sail(move,before,after);
  }else{
    const hammer=prop.querySelector('svg');
    const frames=event.kind==='build'||event.kind==='sold'||event.kind==='bid'?
      [{transform:'rotate(-35deg) translateY(-14px)'},{transform:'rotate(9deg)',offset:.62},{transform:'none'}]:
      [{transform:'scale(1.48) rotate(-14deg)',opacity:.3},{transform:'scale(.90) rotate(3deg)',offset:.65},{transform:'none'}];
    animate(hammer,frames,{duration:360,easing:'ease-out'});
    const ink={buy:'DEED FILED',sold:after.owners[event.targets[0]]==null?'NO SALE':'SOLD',build:`LEVEL ${after.levels[move.tile]}`,accept:'SIGNED',insure:'COVERED'}[event.kind];
    event.targets.forEach(i=>impact($(`tile-${i}`),110,ink));
  }
  animate(document.querySelector('.stageCopy'),[{transform:event.kind==='dispatch'?'rotateX(-65deg)':'translateY(8px)',opacity:.5},{transform:'none',opacity:1}],{duration:220});
  $('stageLedger').querySelectorAll('em').forEach(el=>animate(el,[{transform:'translateY(9px) scale(.85)'},{transform:'translateY(-3px) scale(1.15)',offset:.6},{transform:'none'}],{duration:380}));
}
