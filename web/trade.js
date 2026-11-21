// Drafts are local quotes. Pending terms, including on observing devices, come only from Rust.
let tradeMap=null;
const tradable=(s,i)=>s.owners[i]!=null&&!s.players[s.owners[i]].out&&!locked(s,rules,i);
const tradePeers=s=>s.players.flatMap((p,i)=>!p.out&&i!==s.turn?[i]:[]);
const tradeDeeds=(s,who)=>deeds(s,who).filter(i=>tradable(s,i));
const blankTrade=(from,to)=>({from,to,give_deed:null,take_deed:null,give_cash:0,take_cash:0});
function tradeDistricts(s,d){
  const groups=new Set([d.give_deed,d.take_deed].filter(k=>k!==null).map(k=>rules.tiles[k].group));
  return Array.from(groups,group=>{
    const tiles=rules.tiles.flatMap((t,k)=>t.kind==='deed'&&t.group===group?[k]:[]);
    const seats=[d.from,d.to].map(who=>{
      const before=tiles.filter(k=>s.owners[k]===who).length;
      const after=tiles.filter(k=>(k===d.give_deed?d.to:k===d.take_deed?d.from:s.owners[k])===who).length;
      return {who,before,after};
    });
    return {group,total:tiles.length,seats};
  });
}
function suggestTrade(s,peers){
  const own=tradeDeeds(s,s.turn);
  let best=blankTrade(s.turn,peers[0]),bestScore=-Infinity,bestMutual=false;
  for(const to of peers){
    const other=tradeDeeds(s,to);
    for(const give of [null,...own])for(const take of [null,...other]){
      if(give===null&&take===null)continue;
      const d={...blankTrade(s.turn,to),give_deed:give,take_deed:take};
      const diff=(rules.tiles[take]?.price??0)-(rules.tiles[give]?.price??0);
      d.give_cash=Math.min(Math.max(0,diff),s.players[d.from].cash,2147483647-s.players[to].cash);
      d.take_cash=Math.min(Math.max(0,-diff),s.players[to].cash,2147483647-s.players[d.from].cash);
      if((give===null&&!d.give_cash)||(take===null&&!d.take_cash))continue;
      // Price at list (or balance a swap). Prefer finishing sets, then adding to
      // partial sets. Don't dismantle a complete district for ordinary progress.
      let completed=0,score=(give===null?2:take===null?1:0)-Math.abs(diff-d.give_cash+d.take_cash)/100;
      for(const row of tradeDistricts(s,d))for(const {who,before,after} of row.seats){
        if(after>before)score+=(after===row.total?80:before?12*after/row.total:0)*(who===d.from?1.25:1);
        if(after>before&&after===row.total)completed++;
        if(after<before&&before===row.total)score-=50;
      }
      const mutual=completed===2;
      if((mutual&&!bestMutual)||(mutual===bestMutual&&score>bestScore)){
        bestMutual=mutual;bestScore=score;best=d;
      }
    }
  }
  return best;
}
function tradeProblem(s,d){
  const own=tradeDeeds(s,d.from),other=tradeDeeds(s,d.to);
  if(!own.length&&!other.length)return 'No tradable deeds between these seats. Unowned deeds and developed districts cannot be traded.';
  for(const [who,tiles] of [[d.from,own],[d.to,other]]){
    if(!tiles.length&&!s.players[who].cash)return `${seat(who)} has no tradable deed or cash to offer.`;
  }
  if(d.give_deed===null&&d.take_deed===null)return 'Select at least one deed on the board.';
  for(const [who,n] of [[d.from,d.give_cash],[d.to,d.take_cash]]){
    if(!Number.isSafeInteger(n)||n<0)return 'Enter a whole, non-negative cash amount.';
    if(n>s.players[who].cash)return `${seat(who)} has only ${money(s.players[who].cash)}.`;
  }
  if(d.give_cash&&d.take_cash)return 'Put cash on only one side.';
  if(s.players[d.from].cash-d.give_cash+d.take_cash>2147483647||s.players[d.to].cash-d.take_cash+d.give_cash>2147483647)return 'The receiving balance would exceed the table limit.';
  if((d.give_deed===null&&!d.give_cash)||(d.take_deed===null&&!d.take_cash))return 'Each side must contribute a deed or cash.';
  return '';
}
function closeTrade(focus=false){
  if(!tradeMap)return;
  const {cells,scroll,phase}=tradeMap;
  tradeMap=null;
  delete document.body.dataset.trade;
  for(const {b,label,value} of cells){
    delete b.dataset.tradeTile;delete b.dataset.tradeDistrict;
    b.disabled=false;b.removeAttribute('aria-pressed');b.removeAttribute('title');
    b.setAttribute('aria-label',label);b.querySelector('.tileValue').textContent=value;
  }
  for(const id of ['tradeDesk','tradeGuide','tradeLegend']){$(id).hidden=true;$(id).replaceChildren()}
  $('phaseLabel').textContent=phase;
  $('boardView').scrollTop=scroll;
  if(focus)$('draftTrade')?.focus({preventScroll:true});
}
function openTrade(s,send=null){
  closeTrade();closePlots();showView('board');
  const draft=Boolean(send),peers=tradePeers(s);
  const deal=draft?suggestTrade(s,peers):{...s.trade};
  const cells=rules.tiles.map((_,i)=>{
    const b=$(`tile-${i}`);
    return {b,label:b.getAttribute('aria-label'),value:b.querySelector('.tileValue').textContent};
  });
  const me=draft||(!room?.started?seats[deal.to]==='human':room.owners[deal.to]===room.device);
  tradeMap={s,deal,draft,cells,edited:false,scroll:$('boardView').scrollTop,phase:$('phaseLabel').textContent};
  document.body.dataset.trade=draft?'draft':'response';
  $('phaseLabel').textContent=draft?'TRADE DESK':'TRADE RESPONSE';
  const who=draft?deal.from:deal.to;
  const card=(side,key,title)=>`<section class="tradeLeg ${side}"><h3>${title}</h3>
    <strong id="${side}Asset"></strong><small id="${side}Owner"></small>
    ${draft?`<label class="tradeCash">Cash ($)<input type="number" step="1" min="0" inputmode="numeric" id="${key}Cash" aria-label="${title}: cash in dollars"></label>`:''}</section>`;
  const desk=$('tradeDesk');desk.hidden=false;
  desk.innerHTML=`<div class="tradePaper"><small class="tradeKicker" id="tradeStatus"></small><h2 tabindex="-1" id="tradeTitle">${draft?'Draft a trade':`Offer from ${seat(deal.from)}`}</h2>
    ${draft?`<div class="tradePartners" role="group" aria-label="Trade with"><span>Trade with</span>${peers.map(i=>`<button data-partner="${i}">${seat(i)}</button>`).join('')}</div><p class="foldTradeHint">Select your deed to give or a rival’s to get. Select again to remove.</p>`:''}
    <div class="tradeLegs">${card('out','give',me?'You give':`${seat(who)} gives`)}${card('in','take',me?'You get':`${seat(who)} gets`)}</div>
    <h3 class="tradeLabel">Cash after acceptance</h3><div id="tradeBalances" class="tradeBalances"></div>
    <h3 class="tradeLabel">Districts after acceptance</h3><div id="tradeImpact"></div>
    <p id="tradeRefits"></p><p id="tradeError" role="status"></p></div>
    ${draft?'<div class="tradeFoot"><button id="tradeSend" class="primary">Send proposal</button><button id="tradeCancel">Cancel</button></div>':''}`;
  if(draft){
    for(const b of desk.querySelectorAll('[data-partner]'))b.onclick=()=>{
      const to=Number(b.dataset.partner);if(to===tradeMap.deal.to)return;
      tradeMap.deal=suggestTrade(s,[to]);tradeMap.edited=false;updateTrade(true);
    };
    for(const key of ['give','take'])$(`${key}Cash`).oninput=e=>{
      const input=e.target;
      tradeMap.deal[`${key}_cash`]=input.validity.badInput?NaN:input.value===''?0:input.valueAsNumber;
      tradeMap.edited=true;updateTrade(false);
    };
    $('tradeCancel').onclick=()=>closeTrade(true);
    $('tradeSend').onclick=()=>{
      const {from,...terms}=tradeMap.deal;
      if(!tradeProblem(s,tradeMap.deal))send('propose',terms);
    };
  }
  $('tradeGuide').hidden=false;
  $('tradeLegend').hidden=false;
  $('tradeLegend').textContent=draft?'◇ Available · ✓ Selected · ↔ Other partner · Locked = developed district':`${seat(who)}’s terms · ✓ GIVE / GET marks the transfer. Deed flags still show current owners.`;
  updateTrade(true);
  $('boardView').scrollTop=0;
  if(draft||me&&!$('modal').open)$('tradeTitle').focus({preventScroll:true});
}
function pickTrade(i){
  const {s,draft,deal:d}=tradeMap;
  if(!draft||!tradable(s,i))return;
  const owner=s.owners[i];
  if(owner!==d.from&&owner!==d.to){
    d.to=owner;d.take_deed=i;d.take_cash=0;
    d.give_cash=d.give_deed===null?Math.min(rules.tiles[i].price,s.players[d.from].cash):0;
  }else{
    const key=owner===d.from?'give_deed':'take_deed';
    d[key]=d[key]===i?null:i;
  }
  tradeMap.edited=true;updateTrade(true);
}
function focusTradeTile(i,dir){
  const targets=tradeMap.cells.filter(({b})=>!b.disabled).map(({b})=>b);
  if(targets.length)targets[(targets.indexOf($(`tile-${i}`))+dir+targets.length)%targets.length].focus();
}
function tradeKey(e){
  if(!tradeMap.draft)return;
  if(e.key==='Escape'){e.preventDefault();closeTrade(true)}
  else if(e.key.toUpperCase()==='B'&&!e.target.matches('input,textarea,select,[contenteditable=true]')){
    e.preventDefault();
    const {deal:d,cells}=tradeMap;
    (cells[d.take_deed]?.b??cells[d.give_deed]?.b??cells.find(({b})=>!b.disabled)?.b)?.focus();
  }
}
function updateTrade(syncInputs){
  const {s,deal:d,cells,draft,edited}=tradeMap,viewer=draft?d.from:d.to,peer=draft?d.to:d.from;
  const keys=draft?['give','take']:['take','give'];
  const problem=draft?tradeProblem(s,d):'';
  for(const [j,key] of keys.entries()){
    const who=key==='give'?d.from:d.to,side=j?'in':'out',k=d[`${key}_deed`],cash=d[`${key}_cash`];
    $(`${side}Asset`).textContent=summary(k,Number.isFinite(cash)?cash:0)||'Nothing selected';
    $(`${side}Owner`).textContent=`From ${seat(who)}${k===null?'':` · ${money(rules.tiles[k].price)} list`}`;
    if(draft){
      $(`${key}Cash`).max=s.players[who].cash;
      if(syncInputs)$(`${key}Cash`).value=Number.isFinite(cash)?cash:'';
    }
  }
  const rows=tradeDistricts(s,d);
  $('tradeBalances').innerHTML=[viewer,peer].map(who=>{
    const cash=s.players[who].cash,after=cash+(d.take_cash-d.give_cash)*(who===d.from?1:-1);
    return `<div><span>${seat(who)}</span> <b>${problem?'—':money(after)}</b></div>`;
  }).join('');
  $('tradeImpact').innerHTML=rows.length?rows.map(({group,total,seats})=>`<div class="tradeDistrict"><strong>${group}</strong>${(draft?seats:[...seats].reverse()).map(({who,before,after})=>{
    const mark=before===after?'':after===total?' · Completes set':before===total?' · Breaks set':'';
    return `<span>${seat(who)}: ${before} → ${after}/${total}<b>${mark}</b></span>`;
  }).join('')}</div>`).join(''):'<p>No deeds selected.</p>';
  $('tradeRefits').textContent=[d.give_deed,d.take_deed].filter(k=>k!==null&&s.bonuses?.[k]).map(k=>`${rules.tiles[k].name}: accepting cancels the unused ${money(s.bonuses[k])} refit.`).join(' ');
  $('tradeError').textContent=problem||`No assets move until ${seat(d.to)} accepts.`;
  $('tradeStatus').textContent=`${seat(viewer)}’s ${draft?edited?'edited terms':'suggested terms':'decision'}`;
  if(draft){
    $('tradeSend').disabled=Boolean(problem);
    for(const b of $('tradeDesk').querySelectorAll('[data-partner]'))b.setAttribute('aria-pressed',String(+b.dataset.partner===d.to));
  }
  for(const [i,{b,label,value}] of cells.entries()){
    const owner=s.owners[i],out=i===d[`${keys[0]}_deed`],incoming=i===d[`${keys[1]}_deed`];
    const side=owner===viewer?'Give':owner===peer?'Get':null;
    const mark=out?'out':incoming?'in':owner===null?'off':locked(s,rules,i)?'locked':!draft?'off':side?'option':'rival';
    const badge=({out:'✓ GIVE',in:'✓ GET',locked:'Locked',option:`◇ ${side}`,rival:`↔ ${seat(owner)}`})[mark];
    if(rows.some(row=>row.group===rules.tiles[i].group))b.dataset.tradeDistrict='';else delete b.dataset.tradeDistrict;
    b.dataset.tradeTile=mark;b.disabled=!draft||!tradable(s,i);
    if(!b.disabled)b.setAttribute('aria-pressed',String(out||incoming));else b.removeAttribute('aria-pressed');
    b.querySelector('.tileValue').textContent=badge??value;
    const hint=out||incoming?`${seat(viewer)} ${out?'gives':'gets'} this deed${draft?'; select again to remove':''}`:
      mark==='locked'?'Developed district: cannot trade':mark==='rival'?`Choose ${seat(owner)} as partner and request this deed`:
      mark==='option'?`Select this deed to ${side.toLowerCase()}`:'Not in this offer';
    b.setAttribute('aria-label',`${label.split('. Inspect space')[0]}. ${hint}.`);b.title=hint;
  }
  const assets=keys.map(key=>summary(d[`${key}_deed`],Number.isFinite(d[`${key}_cash`])?d[`${key}_cash`]:0)||'Nothing selected');
  const seals=rows.flatMap(row=>row.seats.filter(({after,before})=>after===row.total&&after!==before)
    .map(({who})=>`<span>${row.group} · ${seat(who)} completes set</span>`));
  $('tradeGuide').innerHTML=`<small>HARBOR DEEDS &nbsp;/&nbsp; ${draft?'CONTRACT DRAFT':'PENDING CONTRACT'}</small><strong>${seat(viewer)}’s side of the deal</strong>
    <div class="guideLegs"><div><b>GIVE →</b>${assets[0]}</div><div><b>← GET</b>${assets[1]}</div></div>
    ${seals.length?`<div class="tradeSeals">${seals.join('')}</div>`:''}
    <p>${draft?'Select your deed to give. Select a rival’s deed to get it. Select again to remove.':'Marked deeds are part of the offer. Ownership has not changed.'}</p>
    ${draft?'<p class="tradeKeys">B: focus board · ← →: browse · Space: select · Esc: cancel</p>':''}`;
}
