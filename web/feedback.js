const routeScreen=matchMedia('(max-width:1199px), (max-height:719px)');
const still=matchMedia('(prefers-reduced-motion: reduce)');
const prefsKey='harbor-presentation-v1';
const paceChoices=[
  ['standard','Standard','Read the dice, follow the ship, then watch it dock.'],
  ['fast','Fast','A quick cast with the ship already underway.'],
  ['reduced','Reduced motion','Show the settled dice and result without animation.']
];
let pace='standard',accents=true,phoneBoard='folded',storageAvailable=true;
const effectivePace=()=>still.matches?'reduced':pace;
const signed=n=>`${n<0?'−':'+'}${money(Math.abs(n))}`;
const pips=[[],[4],[0,8],[0,4,8],[0,2,6,8],[0,2,4,6,8],[0,2,3,5,6,8]];
const artwork={
  ship:'<path d="M7 43h50l-9 10H17zM30 7v32H9L30 7zm5 7 17 25H35z"/>',
  mooring:'<circle cx="32" cy="12" r="5"/><path d="M32 17v38M22 25h20M10 39q6 16 22 16t22-16m-44 0 1 11m-1-11 10 5m34-5-1 11m1-11-10 5"/>',
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
  const face=v=>pips[v]?pips[v].map(i=>`<i style="grid-area:${1+Math.floor(i/3)} / ${1+i%3}"></i>`).join(''):v;
  return `<span class="diceSet">${values.map(v=>{
    const side=({1:[2,3],2:[6,3],3:[2,6],4:[2,1],5:[1,3],6:[5,3]})[v];
    const faces=side&&(rules.dice?.sides??6)===6&&effectivePace()!=='reduced'?[v,7-v,...side,7-side[0],7-side[1]]:[v];
    return `<span class="die" data-value="${v}"><span class="dieCube">${faces.map((n,i)=>`<span class="pipFace face${i}">${face(n)}</span>`).join('')}</span></span>`;
  }).join('')}</span>`;
}
function syncPhoneBoard(){
  $('board').classList.toggle('mobileLoop',!desktop.matches&&phoneBoard==='circuit'&&!tradeMap&&!plotDesk);
}
function placeStage(){
  const stage=$('stage'),board=$('board'),route=routeScreen.matches;
  board.classList.toggle('route',route);stage.classList.toggle('strip',route);
  syncPhoneBoard();
  if(route)board.before(stage);else board.querySelector('.ocean').append(stage);
}
const animations=new Set(), effectTimers=new Set();
let lastDeltas=[], readThrough=0,voyager=null;
const dispatchArchive=new Map();
let dispatchTimeout;
function maskVoyager(){
  if(!voyager)return;
  const berth=$(`tile-${voyager.tile}`);
  voyager.token=Array.from(berth.querySelectorAll('.token')).find(el=>+el.textContent===voyager.actor+1);
  voyager.token?.classList.add('atSea');
}
function releaseBerth(){voyager?.token?.classList.remove('atSea');voyager=null}
// This is an optional presentation budget for local automated turns, never an input or clock gate.
function presentationWait(ms){return Math.max(ms,Math.ceil(readThrough-performance.now()))}
function later(ms,fn){
  const id=setTimeout(()=>{effectTimers.delete(id);fn()},ms);effectTimers.add(id);
}
function clearMotion(){
  readThrough=0;
  effectTimers.forEach(clearTimeout);effectTimers.clear();
  animations.forEach(a=>a.cancel());animations.clear();
  $('wake').replaceChildren();releaseBerth();stopFoley();
}
function resetStage(){
  clearMotion();clearTimeout(dispatchTimeout);dispatchArchive.clear();lastDeltas=[];$('dispatchCard')?.remove();delete $('stage').dataset.live;delete $('stage').dataset.set;
}
function syncPrefs(){
  const effective=effectivePace();
  document.documentElement.dataset.motion=effective;
  const note=$('motionStatus'),accent=$('showAccents');
  if(note)note.textContent=(still.matches?'Your system requests reduced motion. Animations are off regardless of your selection.':
    `${paceChoices.find(row=>row[0]===effective)[1]} is active.`)+(storageAvailable?'':' Storage is unavailable; this choice lasts for this visit.');
  if(accent)accent.disabled=effective==='reduced';
}
function openPrefs(){
  openDialog(`<h2>Table presentation</h2><p>These preferences stay in this browser. They do not change another player’s view or the bidding clock.</p>
    <div class="phoneBoardField"><label class="field">Phone board<select id="phoneBoard">
    <option value="folded">Detailed tiles</option><option value="circuit">Around the board</option></select></label>
    <p>Follow numbered spaces around the edge. Tap one for its name and details. Trade and deed selection use detailed tiles.</p></div>
    <fieldset id="motionChoices"><legend>Animation pace</legend>${paceChoices.map(([v,name,help])=>
    `<label><input type="radio" name="motionPace" value="${v}" ${pace===v?'checked':''}><span><b>${name}</b><small>${help}</small></span></label>`).join('')}</fieldset>
    <label class="fxOption"><input type="checkbox" id="showAccents" ${accents?'checked':''}> Show wakes, stamps and district seals</label>
    <p id="motionStatus" role="status"></p>`);
  const change=()=>{
    pace=$('motionChoices').querySelector(':checked').value;accents=$('showAccents').checked;
    phoneBoard=$('phoneBoard').value;
    try{localStorage.setItem(prefsKey,JSON.stringify({pace,accents,phoneBoard}));storageAvailable=true}catch{storageAvailable=false}
    clearMotion();syncPrefs();syncPhoneBoard();
  };
  $('phoneBoard').value=phoneBoard;
  $('motionChoices').onchange=$('showAccents').onchange=$('phoneBoard').onchange=change;syncPrefs();
}
function initFeedback(){
  let saved;
  try{saved=JSON.parse(localStorage.getItem(prefsKey))}catch(e){if(e.name!=='SyntaxError')storageAvailable=false}
  if(paceChoices.some(([v])=>v===saved?.pace))pace=saved.pace;
  if(saved?.phoneBoard==='circuit')phoneBoard='circuit';
  accents=saved?.accents!==false;syncPrefs();
  if($('prefsBtn'))$('prefsBtn').onclick=openPrefs;
  initSound();routeScreen.addEventListener('change',()=>{clearMotion();placeStage()});
  desktop.addEventListener('change',()=>{clearMotion();syncPhoneBoard()});
  still.addEventListener('change',()=>{clearMotion();syncPrefs()});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearMotion()});
  window.addEventListener('resize',()=>{if(voyager)clearMotion()});
}
function plate(tag,title,detail,prop,kind){
  $('stage').dataset.kind=kind;$('stageTag').textContent=tag;$('stageTitle').textContent=title;
  $('stageDetail').textContent=detail;$('stageProp').innerHTML=prop;
}
function cardInstruction(c,units){
  if(c.deck){
    if(c.kind==='each')return `${c.amount<0?'Pay':'Collect'} ${money(Math.abs(c.amount))} ${c.amount<0?'to':'from'} each other active seat.`;
    if(c.kind==='repairs')return `Pay ${money(c.house)} per house or ${money(c.hotel)} per hotel.`;
    if(c.kind==='pardon')return 'Keep this card. Use it instead of paying bail on a prison turn.';
    if(c.kind==='prison')return `Go directly to ${rules.tiles[rules.tiles[c.entry].move_to].name}. No Start payment.`;
    if(c.kind==='advance')return `Move to ${rules.tiles[c.target].name}.${c.salary?' Collect the applicable Start payment if crossed.':''}`;
    if(c.kind==='nearest')return `Advance to the next deed in ${c.group}. Resolve that landing.`;
    if(c.kind==='steps')return `Move ${c.steps<0?'back':'forward'} ${Math.abs(c.steps)} spaces. Resolve that landing.`;
  }
  const amount=money(Math.abs(c.amount)),verb=c.amount<0?'Pay':'Collect';
  if(c.kind==='cover')return `Carry ${amount} against your next rent. Keep any higher cover.`;
  const unit=c.kind==='deeds'?'owned deed':c.kind==='levels'?'permanent level':null;
  return unit?`${verb} ${amount} per ${unit}${units==null?'':` × ${units}`}.`:`${verb} ${amount} ${c.amount<0?'at':'from'} the port office.`;
}
const hasDraw=s=>s.last_card!=null||Boolean(s.card_receipt?.draws.length);
function namedReceipt(a,s,draw){
  const c=rules.named_cards[draw.card],player=s.players[a];
  // Intermediate draws close before the next landing. Only the final card can own its rent bill.
  const rent=draw===s.card_receipt.draws.at(-1)?utilityRentBill(s,a):null;
  const after=rent?player.cash:draw.after;
  return {deck:c.deck,title:c.title,order:cardInstruction(c),result:rent?`${draw.result} ${rent}`:draw.result,
    account:`Cash ${money(draw.before)} → ${money(after)}`,
    kind:after<draw.before?'charge':after>draw.before?'award':'cover',
    address:`To ${seat(a)} · ${rules.tiles[draw.source].name}`,serial:`${c.deck} / Round ${s.round}`};
}
// A receipt is frozen at the draw. In particular, a later default can return the
// player's deeds, and their net cash change can include one or more laps of salary.
function dispatchReceipt(a,b,s){
  if(s.card_receipt?.draws.length)return namedReceipt(a,s,s.card_receipt.draws.at(-1));
  const c=rules.cards[s.last_card],from=b.players[a],to=s.players[a];
  const owned=deeds(b,a),levels=owned.reduce((n,i)=>n+b.levels[i],0);
  const laps=Math.floor((from.pos+s.dice.reduce((n,d)=>n+d,0))/rules.tiles.length);
  const salary=laps*rules.salary,cash=to.cash-from.cash-salary;
  const units=c.kind==='deeds'?owned.length:c.kind==='levels'?levels:1;
  const bill=c.amount*units;
  let order=cardInstruction(c,units),result;
  if(c.kind==='cover'){
    result=`${money(to.cover)} cover ${to.cover===from.cover?'retained':'in force'}`;
  }else{
    if(c.kind==='levels'&&owned.some(i=>b.bonuses?.[i]))order+=' Temporary refits do not count.';
    result=c.amount<0?`Paid ${money(Math.abs(cash))}`:`Received ${money(cash)}`;
    if(cash!==bill)result+=` of ${money(Math.abs(bill))}`;
    if(s.debt?.debtor===a)result+=` · ${money(s.debt.remaining)} due at draw`;
    if(to.out)result+=' · Bankrupt';
  }
  const account=[salary?`Port salary ${signed(salary)}`:'',`Cash ${money(from.cash)} → ${money(to.cash)}`].filter(Boolean).join(' · ');
  return {title:c.title,order,result,account,kind:c.kind==='cover'?'cover':c.amount<0?'charge':'award',
    address:`To ${seat(a)} · ${rules.tiles[to.pos].name}`,serial:`Nº ${String(s.last_card+1).padStart(2,'0')} / Round ${s.round}`};
}
function pinDispatch(receipt){
  let card=$('dispatchCard');
  if(!card){
    card=document.createElement('article');card.id='dispatchCard';
    card.setAttribute('aria-labelledby','dispatchTitle');
    card.innerHTML=`<div class="dispatchMast"><b>Harbor Dispatch</b><span id="dispatchSerial"></span>
      <span class="dispatchFiled">Filed in Activity</span></div>
      <div class="dispatchLetter"><svg class="dispatchPostage" viewBox="0 0 84 68" aria-hidden="true" fill="none" stroke="currentColor">
        <path stroke-width="2" d="M3 3h78v62H3z"/><path d="M6 6h72v56H6zM9 49h66M9 52h66"/>
        <circle cx="54" cy="21" r="7"/><path d="m51 11-2-4m8 4 2-4m4 8 6-4m-5 10 8-1m-15 9 2 4"/>
        <path stroke-width="1.8" d="M12 41h48l-8 7H22zm24-29v25H18zm4 6 14 19H40z"/>
        <path d="M13 44h43m-33-10 10-1m-8-2 8-1m-6-2 6-1m-3-2 3-1M10 55q5-2 10 0t10 0t10 0t10 0t10 0t13 0m-58 4q6-2 12 0t12 0t12 0t12 0"/>
      </svg><p id="dispatchAddress"></p><h3 id="dispatchTitle"></h3><p id="dispatchOrder"></p></div>
      <div class="dispatchReceipt"><strong id="dispatchResult"></strong><span id="dispatchAccount"></span></div>`;
    $('stage').append(card);
  }
  card.dataset.ink=receipt.kind;
  card.querySelector('.dispatchMast b').textContent=receipt.deck??'Harbor Dispatch';
  for(const key of ['serial','address','title','order','result','account']){
    $(`dispatch${key[0].toUpperCase()+key.slice(1)}`).textContent=receipt[key];
  }
  // Independent of the next command's motion cleanup and of the real bid clock.
  clearTimeout(dispatchTimeout);
  dispatchTimeout=setTimeout(()=>card.remove(),8500);
  return card;
}
function recordDispatch(move,before,after){
  if(move.action==='roll'&&after.card_receipt?.draws.length){
    for(const draw of after.card_receipt.draws)dispatchArchive.set(draw.event,namedReceipt(move.actor,after,draw));
    return;
  }
  if(move.action!=='roll'||after.last_card==null)return;
  const receipt=dispatchReceipt(move.actor,before,after);
  const index=after.events.findIndex((e,i)=>i>=before.events.length&&e.startsWith(receipt.title+':'));
  if(index!==-1)dispatchArchive.set(index,receipt);
}
function renderLog(events){
  const latest=[...dispatchArchive.keys()].at(-1);
  const receipt=r=>`<small>${r.serial} · ${r.address}</small><strong>${r.title} · ${r.result}</strong><span>${r.order} ${r.account}</span>`;
  const featured=$('lastLetter');
  featured.hidden=latest===undefined;
  featured.innerHTML=featured.hidden?'':receipt(dispatchArchive.get(latest));
  $('log').innerHTML=events.map((line,i)=>{
    const r=dispatchArchive.get(i);
    if(r&&i!==latest)return `<li class="logLetter">${receipt(r)}</li>`;
    return `<li>${r?`${r.address} · ${r.title}: ${r.result}`:line.replace(/\bdeed (\d+)\b/gi,(word,k)=>rules.tiles[+k]?.name??word)}</li>`;
  }).reverse().join('');
}
function ledger(s){
  const actor=actingSeat(s);
  const rows=s.players.map((p,i)=>{
    const diff=lastDeltas[i]||0,t=rules.tiles[p.pos],owner=s.owners[p.pos];
    const location=p.out?'Out of play':t.name,tenure=p.out?'':p.in_prison?`Detained · ${p.skip_turns}`:p.skip_turns?`Away · ${p.skip_turns}`:p.pardons?'Pardon held':t.kind!=='deed'?'Port space':owner===null?'Unowned':`Deed: ${seat(owner)}`;
    const berth=p.out?`<span class="shipLocation">${location}</span>`:`<button type="button" class="shipLocation" data-locate="${i}" aria-label="Locate ${seat(i)} at ${location}" title="Locate ${seat(i)} on the board">${location}</button>`;
    return `<div class="account ${actor===i&&s.phase!=='over'?'acting':''}" style="--seat:${colors[i]}" aria-label="${seat(i)}: ${p.out?'bankrupt':money(p.cash)}, ${location}. ${tenure}${diff?', change '+signed(diff):''}"><span class="seatDisc">${i+1}</span><span class="seatName">${seat(i)}</span><b>${p.out?'Out':money(p.cash)}</b>${diff?`<em class="${diff>0?'credit':'debit'}">${signed(diff)}</em>`:''}${berth}<span class="portOwner">${tenure}</span></div>`;
  }).join('');
  $('stageLedger').innerHTML=rows;$('sheetLedger').innerHTML=rows;
}
function shipPiece(seatId,convoy){
  if(convoy)return `<svg viewBox="0 0 17 20" aria-hidden="true"><path d="M1 1h15v12l-7 6-8-6z" fill="var(--seat)" stroke="#fbf4d8"/><text x="8.5" y="13.8" text-anchor="middle" fill="white" font-family="system-ui,sans-serif" font-weight="800" font-size="14">${seatId+1}</text></svg>`;
  return `<svg viewBox="0 0 36 24" aria-hidden="true"><path class="sail" d="M3 16 13 3v13zm12-12 8 12h-8z"/><path d="M1 17h33l-5 6H7z" fill="var(--seat)" stroke="#13272a"/><circle cx="25" cy="10" r="9" stroke="#fff4cc" stroke-width="1.6" fill="var(--seat)"/><text x="25" y="14.8" text-anchor="middle" fill="white" font-family="system-ui,sans-serif" font-weight="800" font-size="14">${seatId+1}</text></svg>`;
}
function syncStage(s){
  ledger(s);maskVoyager();
  if($('stage').dataset.live)return;
  const tile=s.auction?.tile??s.players[s.turn].pos;
  const context={roll:'Ready to sail',offer:'Deed for sale',guild:'Guild charter',works:'Harbor works',auction:'At auction',trade:'Contract offered',debt:'Outstanding bill',end:'Settlement',over:'Final accounts'};
  plate(context[s.phase],s.phase==='over'?s.winners.map(seat).join(' & '):rules.tiles[tile].name,
    s.phase==='roll'?`${seat(s.turn)} to roll · ${rules.dice?.count??2} dice`:s.events.at(-1)||context[s.phase],
    icon(s.phase==='auction'?'gavel':s.phase==='over'?'final':'ship'),'ready');
}
const rolledDoubles=s=>s.dice.length===2&&s.dice[0]===s.dice[1];
const reachedDoublesLimit=(b,s)=>!b.players[b.turn].in_prison&&rolledDoubles(s)&&(b.doubles_in_row??0)+1===rules.doubles_limit;
function ownedUtilityRate(s,i){
  const group=rules.tiles[i].group,rates=utilityFor(group),owner=s.owners[i];
  if(!rates||owner==null)return null;
  return rates[districtTiles(group).filter(k=>s.owners[k]===owner).length-1];
}
function utilityRentBill(s,a){
  const pos=s.players[a].pos,owner=s.owners[pos],rate=ownedUtilityRate(s,pos);
  return rate==null||owner===a?null:`Rent to ${seat(owner)} · roll ${s.dice.reduce((x,y)=>x+y,0)} × ${rate} = ${money(s.rents[pos])}`;
}
function outcome(m,b,s){
  const a=m.actor,dieTotal=s.dice.reduce((x,y)=>x+y,0),pos=s.players[a].pos;
  const delta=s.players[a].cash-b.players[a].cash, lot=b.auction?.tile??m.tile??pos;
  const tile=rules.tiles[lot],who=seat(a),action=m.action;
  let tag=who,title='',detail='',prop='ship',cue=uxInventory.commands[action][2],kind=action,targets=[lot];
  let sets=[];
  if(s.phase==='over'){
    tag='Final accounts';title=`${s.winners.map(seat).join(' & ')} ${s.winners.length>1?'tie':'wins'}`;
    detail=s.players.filter(p=>!p.out).length===1?'Last solvent merchant':'Cash and printed deed values settled';prop='final';cue='final';kind='final';targets=[];
  }else if(action==='roll'){
    tag=`${who} rolled ${dieTotal}`;title=tile.name;prop='dice';
    if(tile.kind==='deed'){
      const owner=s.owners[pos];
      detail=owner===null?`For sale · ${money(tile.price)}`:owner===a?'Your own deed':utilityRentBill(s,a)??`Rent to ${seat(owner)} · ${money(b.rents[pos])}`;
    }
    else detail=({guild:'Guild charter · cash or cover',works:s.commissions?.length?'Public works · commission a deed or skip':'Public works · no eligible project',fee:tile.cash_tax_pct!=null?`${tile.cash_tax_pct}% cash tax`:`Harbor dues · ${money(tile.price??0)}`,start:'Start payment',rest:s.players[a].in_prison?'Detained':s.players[a].skip_turns?'On vacation':'Just visiting',notice:'Port notice',
      exchange:s.auction?`Auction: ${rules.tiles[s.auction.tile].name}`:'All deeds owned'})[tile.kind];
    if(hasDraw(s)){detail='Card delivered';kind='dispatch'}
    else{
      if(b.players[a].in_prison&&!rolledDoubles(s))detail=s.events.at(-1);
      else if(reachedDoublesLimit(b,s))detail=`${rules.doubles_limit} consecutive doubles · Sent to prison`;
      if(delta)detail+=` · Net ${signed(delta)}`;
      if(s.players[a].cover!==b.players[a].cover&&!s.players[a].out)detail+=` · Cover ${money(s.players[a].cover)}`;
      if(s.players[a].out)detail+=' · Bankrupt';
    }
    if(b.players[a].in_prison&&rolledDoubles(s)&&!s.players[a].in_prison)detail=`Released on doubles · ${detail}`;
  }else if(b.auction&&!s.auction){
    const winner=s.owners[lot];tag='Auction closed';title=winner==null?'No sale':`Sold · ${money(action==='bid'?m.amount:b.auction.high_bid)}`;
    detail=`${tile.name} · ${winner==null?'Still on the market':seat(winner)+' takes the deed'}`;kind='sold';prop='gavel';cue=winner==null?'noSale':'sold';
  }else if(action==='pass'||action==='bid'||action==='withdraw'){
    tag=action==='pass'?(s.auction?'Auction opened':'Purchase declined'):action==='bid'?'High bid':'Bidder out';
    title=action==='pass'?tile.name:action==='bid'?money(m.amount):`${who} withdrew`;
    detail=action==='pass'?(s.auction?`Bidding starts at ${money(rules.auction_increment)}`:'The deed stays on the market.'):`${tile.name} · ${action==='bid'?who+' leads':seat(s.auction.actor)+' to bid'}`;prop='gavel';
  }else if(action==='bail'||action==='pardon'){
    tag='Prison release';title=action==='pardon'?'Pardon redeemed':`Bail paid · ${money(-delta)}`;detail=`${who} is free next turn.`;
  }else if(action==='buy'){
    const rate=ownedUtilityRate(s,lot);
    tag='Deed recorded';title=tile.name;detail=`${who} paid ${money(-delta)} · Rent ${rate==null?money(s.rents[lot]):rateLabel(tile.group,rate)}`;prop='deed';cue='file';
  }else if(action==='sell'){
    const quote=b.sells.find(q=>q.tile===lot);
    tag='Sold to the bank';title=tile.name;
    detail=`Bank paid ${money(quote.price)} · ${who}: ${money(b.players[a].cash)} → ${money(s.players[a].cash)} · Back on the market`;prop='deed';cue='sale';
  }else if(action==='salvage'){
    const q=b.salvages.find(q=>q.tile===lot);targets=q.tiles;
    tag='Improvements sold';title=tile.group;detail=`${money(q.price)} raised · ${s.debt?money(s.debt.remaining)+' still due':'Bill settled'}`;prop='deed';cue='sale';
  }else if(action==='bankrupt'){
    tag='Bankruptcy';title=`${who} is out`;detail='Remaining deeds and improvements returned to market.';prop='deed';cue='down';targets=[];
  }else if(action==='commission'){
    const quote=b.commissions.find(q=>q.tile===lot);
    tag='Works commissioned';title=tile.name;
    detail=`Cost ${money(quote.cost)} · Rent ${money(b.rents[lot])} → ${money(s.rents[lot])}`;prop='build';cue='build';
  }else if(action==='skip'){
    tag='Works passed';title=tile.name;detail=`${who} kept ${money(s.players[a].cash)} · No project commissioned`;prop='build';cue='quiet';targets=[];
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
  if(['buy','sold','accept'].includes(kind)){
    const acquired=targets.filter(i=>s.owners[i]!=null&&s.owners[i]!==b.owners[i]);
    for(const group of new Set(acquired.map(i=>rules.tiles[i].group))){
      const tiles=rules.tiles.flatMap((t,i)=>t.kind==='deed'&&t.group===group?[i]:[]);
      const owner=s.owners[tiles[0]];
      if(owner!=null&&tiles.every(i=>s.owners[i]===owner)){
        sets.push(tiles);detail+=` · ${seat(owner)} completed ${group}`;
      }
    }
  }
  return {tag,title,detail,kind,cue,targets,sets,prop:prop==='dice'?diceProp(s.dice):icon(prop)};
}
function animate(el,frames,timing){
  if(!el?.animate)return;
  const anim=el.animate(frames,timing);animations.add(anim);
  anim.addEventListener('finish',()=>animations.delete(anim),{once:true});return anim;
}
function tilePoint(el,base){
  const r=el.getBoundingClientRect();
  return {x:r.left-base.left+r.width/2,y:r.top-base.top+r.height/2,w:r.width,h:r.height};
}
function spray(className,point,txt,frames,timing){
  const mark=document.createElement('span');mark.className=className;
  mark.style.left=`${point.x}px`;mark.style.top=`${point.y}px`;mark.textContent=txt;
  $('wake').append(mark);animate(mark,frames,timing)?.addEventListener('finish',()=>mark.remove(),{once:true});
}
function impact(el,delay,ink='',kind=''){
  const color=kind==='dock'?'#327c87':kind==='set'?'#a56d18':kind==='sell'?'#66748f':'#a1572c';
  animate(el,[{boxShadow:`inset 0 0 0 4px ${color}`,backgroundColor:'#ffe5a6'},{}],{delay,duration:540});
  if(!accents)return;
  const p=tilePoint(el,$('wake').getBoundingClientRect());
  const rings=kind==='dock'?[0,125]:[0];
  rings.forEach(extra=>spray(`waveRing ${kind}`,p,'',[
    {transform:'translate(-50%,-50%) scale(.36)',opacity:0},{opacity:.9,offset:.15},
    {transform:'translate(-50%,-50%) scale(1.85)',opacity:0}],{delay:delay+extra,duration:470}));
  if(ink)spray(`inkStamp ${kind}`,p,ink,[
    {opacity:0,transform:'translate(-50%,-95%) scale(1.45) rotate(-16deg)'},
    {opacity:1,transform:'translate(-50%,-50%) scale(.93) rotate(-6deg)',offset:.17},
    {opacity:1,offset:.72},{opacity:0,transform:'translate(-50%,-66%) rotate(-6deg)'}],{duration:840,delay});
}
function followTile(i){
  if($('boardView').hidden||$('modal').open)return;
  const view=$('boardView'),v=view.getBoundingClientRect(),r=$(`tile-${i}`).getBoundingClientRect();
  const top=v.top+(routeScreen.matches?$('stage').offsetHeight:0);
  if(r.top<top||r.bottom>v.bottom)view.scrollTop+=r.top-(top+v.bottom-r.height)/2;
}
function cast(fast){
  $('stageProp').querySelectorAll('.die').forEach((die,i)=>{
    const dir=i%2?1:-1,duration=fast?420+i*12:780+(i%3)*36;
    animate(die,[
      {transform:`translate(${dir*18}px,-14px) rotate(${dir*48}deg) scale(.8)`},
      {transform:`translate(${-dir*5}px,1px) rotate(${-dir*10}deg)`,offset:.40},
      {transform:`translate(0,-8px) rotate(${dir*9}deg)`,offset:.59},
      {transform:'translateY(1px)',offset:.79},{}],{duration});
    const cube=die.firstElementChild,rotate=(x,y)=>`translateZ(calc(-1 * var(--half))) rotateX(${x}deg) rotateY(${dir*y}deg)`;
    if(cube.children.length>1)animate(cube,[{transform:rotate(-205,255)},
      {transform:rotate(28,-66),offset:.42},{transform:rotate(-18,20),offset:.66},
      {transform:rotate(5,-3),offset:.85},{transform:rotate(0,0)}],{duration});
  });
}
function sail(move,b,s,fast,dispatch){
  const start=b.players[move.actor].pos,end=s.players[move.actor].pos;
  const total=s.dice.reduce((x,y)=>x+y,0),delay=fast?85:1000,travel=fast?490:Math.min(1530,550+95*total);
  const noWalk=b.players[move.actor].in_prison&&!rolledDoubles(s);
  if(noWalk){impact($(`tile-${end}`),delay,'','dock');foley('dice');return}
  const direct=reachedDoublesLimit(b,s);
  const route=direct?[start,end]:Array.from({length:total+1},(_,k)=>(start+k)%rules.tiles.length);
  if(route.at(-1)!==end)route.push(end);
  const lastStep=route.length-1;
  const dockAt=delay+travel,settle=fast?145:325;
  followTile(fast?end:start);
  const wake=$('wake'),base=wake.getBoundingClientRect(),view=$('boardView'),initialScroll=view.scrollTop;
  const frames=[],seen=new Map(),sample=Math.ceil(total/16);
  const timeAt=k=>fast||!k||k===lastStep?k/lastStep:(k+.4)/(lastStep+1.1);
  let prev;
  // Engine dice are bounded (8d32). Keep every visited berth, even on multi-lap rolls;
  // measure each tile only once and leave at most sixteen wakes per journey.
  for(let k=0;k<=lastStep;k++){
    const at=route[k],el=$(`tile-${at}`);
    if(!seen.has(at))seen.set(at,tilePoint(el,base));
    const p=seen.get(at),offset=timeAt(k),transform=`translate(${p.x}px,${p.y}px)`;
    const jump=prev&&(Math.abs(p.x-prev.x)>p.w*1.65||Math.abs(p.y-prev.y)>p.h*1.65);
    if(jump){ // Across a folded chart's line break, do not cut through unrelated berths.
      const last=frames.at(-1),span=offset-last.offset;
      frames.push({...last,offset:last.offset+span*.43,opacity:0},{transform,offset:offset-span*.43,opacity:0});
    }
    frames.push({transform,offset,opacity:1});
    if(k>0&&k<total&&k%sample===0&&accents){
      const arrival=delay+travel*offset;
      animate(el,[{boxShadow:'inset 0 -4px 0 #117686',backgroundColor:'#fff1bc'},{}],{delay:arrival,duration:300});
      if(!jump){
        const angle=Math.atan2(p.y-prev.y,p.x-prev.x)*180/Math.PI;
        const trail=`translate(-50%,-50%) rotate(${angle}deg)`;
        spray('wakeFeather',p,'',[
          {opacity:0,transform:`${trail} scale(.42)`},{opacity:.95,offset:.12},
          {opacity:0,transform:`${trail} translateX(-8px) scale(1.25)`}],{delay:arrival,duration:390});
      }
    }
    prev=p;
  }
  const pawn=document.createElement('div');pawn.className='sailing';
  pawn.style.setProperty('--seat',colors[move.actor]);pawn.innerHTML=`${icon('ship')}<b>${move.actor+1}</b>`;
  pawn.style.transform=frames.at(-1).transform;
  wake.append(pawn);voyager={actor:move.actor,tile:end};maskVoyager();
  animate(pawn,frames,{delay,duration:travel,fill:'backwards'});
  animate(pawn.firstElementChild,[{transform:'rotate(-7deg)'},{transform:'rotate(6deg)'},{transform:'rotate(-7deg)'}],
    {delay,duration:travel/3,iterations:3});
  animate(pawn.firstElementChild,[{transform:'translateY(0)'},{transform:'translateY(2px) rotate(6deg)',offset:.3},{transform:'none'}],{delay:dockAt,duration:settle});
  animate(pawn,[{opacity:1},{opacity:1,offset:.45},{opacity:0}],{delay:dockAt,duration:settle});
  later(dockAt,()=>{if(view.scrollTop===initialScroll)followTile(end)});
  later(dockAt+settle,()=>{pawn.remove();releaseBerth()});
  impact($(`tile-${end}`),dockAt,'','dock');
  readThrough=performance.now()+dockAt+settle+30;
  foley(dispatch?'dispatch':fast?'dice':'cast');foley('depart',delay);foley('dock',dockAt);
}
function liveFeedback(move,before,after){
  // A quiet network handoff may arrive before the dock; the next meaningful action supersedes it.
  if(move.action==='end'&&after.phase!=='over')return;
  clearMotion();
  const event=outcome(move,before,after);
  lastDeltas=after.players.map((p,i)=>p.cash-before.players[i].cash);
  $('stage').toggleAttribute('data-set',!!event.sets.length);
  $('stage').dataset.live=move.action;plate(event.tag,event.title,event.detail,event.prop,event.kind);ledger(after);
  // last_card survives non-roll commands, including end; never print from render,
  // a state-only reconnect or historical replay. A final draw still has a receipt.
  const card=move.action==='roll'&&hasDraw(after)?pinDispatch(dispatchReceipt(move.actor,before,after)):null;
  if(document.hidden||$('modal').open)return;
  const rolling=move.action==='roll'&&event.kind!=='final';
  if(effectivePace()==='reduced'||$('boardView').hidden||!$('stage').animate){
    if(rolling)followTile(after.players[move.actor].pos);
    foley(card?'dispatch':rolling?'dock':event.cue);if(event.sets.length)foley('district',300);return;
  }
  const prop=$('stageProp');
  if(card){
    animate(card,[{transform:'translateY(7px) rotate(-.65deg)'},{transform:'none'}],{duration:240,easing:'ease-out'});
    if(accents)animate(card.querySelector('.dispatchPostage'),[{transform:'rotate(1deg) scale(1.09)'},{}],{duration:190,easing:'ease-out'});
  }
  if(rolling){
    const fast=effectivePace()==='fast';cast(fast);sail(move,before,after,fast,!!card);
  }else{
    if(card)foley('dispatch');foley(event.cue,card?300:0);
    const hammer=prop.querySelector('svg');
    const frames=['build','sold','bid','commission'].includes(event.kind)?
      [{transform:'rotate(-35deg) translateY(-14px)'},{transform:'rotate(9deg)',offset:.62},{transform:'none'}]:
      [{transform:'scale(1.48) rotate(-14deg)',opacity:.3},{transform:'scale(.90) rotate(3deg)',offset:.65},{transform:'none'}];
    animate(hammer,frames,{duration:360,easing:'ease-out'});
    const ink={buy:'FILED',sell:'RELEASED',sold:event.cue==='noSale'?'NO SALE':'SOLD',commission:'FITTED',build:`LEVEL ${after.levels[move.tile]}`,accept:'SIGNED',insure:'COVERED'}[event.kind];
    event.targets.slice(0,16).forEach(i=>impact($(`tile-${i}`),110,ink,event.kind));
    if(event.sets.length){
      foley('district',410);
      event.sets.forEach(tiles=>tiles.slice(0,12).forEach((id,j)=>impact($(`tile-${id}`),430+j*55,j?'':'CHARTERED','set')));
    }
  }
  if(!card)animate(document.querySelector('.stageCopy'),[{transform:'translateY(8px)',opacity:.5},{transform:'none',opacity:1}],{duration:220});
  $('stageLedger').querySelectorAll('em').forEach(el=>animate(el,[{transform:'translateY(9px) scale(.85)'},{transform:'translateY(-3px) scale(1.15)',offset:.6},{transform:'none'}],{duration:380}));
}
