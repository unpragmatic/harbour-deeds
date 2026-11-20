// Only a live human controller can open a preview. The quote and command key come from Rust.
let plotAccess=null,plotDesk=null;
const plotModes={build:'Improve',sell:'Sell',commission:'Refit',salvage:'Sell levels'};
const plotMembers=q=>q.tiles??[q.tile];
const plotQuotes=(s,mode)=>({build:s.builds,sell:s.sells,commission:s.commissions,salvage:s.salvages}[mode]??[]);
const plotQuote=(s,mode,i)=>plotQuotes(s,mode).find(q=>plotMembers(q).includes(i));
function enablePlots(s,send,signal){
  const cells=rules.tiles.map((_,i)=>{
    const b=$(`tile-${i}`),label=b.getAttribute('aria-label'),value=b.querySelector('.tileValue').textContent;
    const modes=Object.keys(plotModes).filter(mode=>plotQuote(s,mode,i));
    if(modes.length){b.dataset.actionable='';b.setAttribute('aria-label',`${label}. Preview: ${modes.map(m=>plotModes[m]).join(' or ')}`)}
    return {b,label,value,modes};
  });
  const access={s,send,cells};
  plotAccess=access;
  $('turn').insertAdjacentHTML('beforeend','<p class="plotHint">◇ Select a marked deed on the board to preview your options.</p>');
  signal.addEventListener('abort',()=>{if(plotAccess===access)releasePlots()},{once:true});
}
function releasePlots(){
  if(!plotAccess)return;
  closePlots();
  for(const {b,label} of plotAccess.cells){delete b.dataset.actionable;b.setAttribute('aria-label',label)}
  $('turn').querySelector('.plotHint')?.remove();
  plotAccess=null;
}
function closePlots(focus=false){
  if(!plotDesk)return;
  const {origin}=plotDesk;
  plotDesk=null;
  delete document.body.dataset.plot;
  $('propertyDesk').hidden=$('plotGuide').hidden=true;
  $('propertyDesk').replaceChildren();$('plotGuide').replaceChildren();
  for(const {b,label,value,modes} of plotAccess.cells){
    delete b.dataset.plot;delete b.dataset.scope;
    b.disabled=false;b.removeAttribute('aria-pressed');b.removeAttribute('title');
    b.setAttribute('aria-label',label+(modes.length?`. Preview: ${modes.map(m=>plotModes[m]).join(' or ')}`:''));
    b.querySelector('.tileValue').textContent=value;
  }
  selectSpace(inspected);
  if(focus)(origin?.isConnected&&origin!==document.body?origin:$('manageDeeds'))?.focus({preventScroll:true});
}
function pickPlot(i){
  if(!plotAccess)return false;
  const {s,cells}=plotAccess;
  if(plotDesk){if(plotQuote(s,plotDesk.mode,i))setPlot(i);return true}
  if(!cells[i].modes.length)return false;
  openPlots(cells[i].modes[0],i);return true;
}
function openPlots(mode,i){
  if(!plotAccess)return;
  const {s}=plotAccess;
  const cash=s.players[s.turn].cash;
  mode??=s.phase==='debt'?(s.sells.length?'sell':'salvage'):s.phase==='works'?'commission':s.builds.some(q=>q.cost<=cash)||!s.sells?.length?'build':'sell';
  const preferred=i??plotDesk?.i??inspected;
  const options=plotQuotes(s,mode);
  const q=plotQuote(s,mode,preferred)??options.find(x=>!(x.cost>cash))??options[0];
  const origin=plotDesk?.origin??document.activeElement;
  showView('board');
  plotDesk={origin,mode,i:null};
  document.body.dataset.plot=mode;
  $('propertyDesk').hidden=false;
  setPlot(q?(plotMembers(q).includes(preferred)?preferred:q.tile):null);
  // Keep the focus on a non-spending control, never on a new confirmation.
  (i!==undefined?$(`tile-${i}`):$('propertyDesk').querySelector('[aria-pressed=true]')??$('plotCancel')).focus({preventScroll:true});
}
function stepPlot(dir,focus=false){
  const {s}=plotAccess,{mode,i}=plotDesk;
  const spaces=plotQuotes(s,mode).flatMap(plotMembers).sort((a,b)=>a-b);
  if(!spaces.length)return;
  const next=spaces[(spaces.indexOf(i)+dir+spaces.length)%spaces.length];
  setPlot(next);
  if(focus)$(`tile-${next}`).focus({preventScroll:true});
}
function plotImpact(s,mode,i,q){
  const t=rules.tiles[i],cash=s.players[s.turn].cash;
  const group=rules.tiles.flatMap((x,k)=>x.kind==='deed'&&x.group===t.group?[k]:[]);
  if(s.phase==='debt'){
    const level=mode==='salvage',affected=level?q.tiles:[i],complete=group.every(k=>s.owners[k]===s.turn);
    const payout=q.price,due=s.debt.remaining,surplus=cash+payout-due;
    return {metrics:[['Proceeds',money(payout)],['Still due',money(Math.max(0,-surplus))],['Cash after',money(Math.max(0,surplus))]],
      note:level?`Remove one level from ${affected.map(k=>rules.tiles[k].name).join(', ')}. ${t.name} rent: ${money(s.rents[i])} → ${money(lowerRent(s,i))}.`:`${t.name} returns to market; lose ${money(s.rents[i])} next rent.${complete?' Breaks the set.':''}`,
      detail:`${money(Math.min(due,payout))} goes to ${debtCreditor(s)}. ${surplus>=0?'This clears the bill.':'More liquidation is needed.'}`,
      scope:level?affected:complete?group:[i],button:`${level?'Sell level':'Sell deed'} · ${money(payout)}`};
  }
  if(mode==='sell'){
    const complete=group.every(k=>s.owners[k]===s.turn);
    return {metrics:[['Bank pays','+'+money(q.price)],['Cash after',money(cash+q.price)],['Rent forfeited',money(s.rents[i])]],
      note:`Returns to market.${complete?' Breaks the set: remaining deeds lose their set rent.':''}${s.bonuses?.[i]?' The unused refit is lost.':''}`,
      detail:bankTerms(),scope:complete?group:[i],button:`Sell for ${money(q.price)}`};
  }
  const short=q.cost>cash,after=short?`${money(q.cost-cash)} short`:money(cash-q.cost);
  if(mode==='commission')return {metrics:[['Fee now',money(q.cost)],['Cash after',after],['Next rent',`${money(s.rents[i])} → ${money(s.rents[i]+q.gain)}`]],
    note:`+${money(q.gain)} once: gain ${money(q.gain-q.cost)} net if collected in full; lose ${money(q.cost)} if unused.`,
    detail:'No full set required. This is not a permanent level.',scope:[i],button:`Refit for ${money(q.cost)}`};
  const d=rules.development,affected=plotMembers(q);
  const next=k=>Math.round(rules.tiles[k].rent*d.levels[s.levels[k]].rent_pct/100);
  const current=k=>s.rents[k]-(s.bonuses?.[k]??0);
  const gains=affected.map(k=>next(k)-current(k));
  const range=(nums,format)=>{const lo=Math.min(...nums),hi=Math.max(...nums);return lo===hi?format(lo):`${format(lo)}–${format(hi)}`};
  const rolls=(rules.rounds-s.round)*(s.players.filter(p=>!p.out).length-1)+s.players.filter((p,k)=>!p.out&&k>s.turn).length;
  const visits=range(gains.map(g=>g>0?Math.ceil(q.cost/g):Infinity),v=>Number.isFinite(v)?String(v):'∞');
  return {metrics:[['Build cost',money(q.cost)],['Cash after',after],['Rent / visit',`${money(current(i))} → ${money(next(i))}`]],
    note:`${affected.length>1?`All ${affected.length} deeds improve. `:''}+${range(gains,money)} per paying visit · ${visits} to recover cost. ${t.group} ${s.locked[i]?'stays locked':'locks'} against sale and trade.`,
    detail:`Level ${s.levels[i]} → ${s.levels[i]+1}. ${rules.victory==='elimination'?'No round limit.':`Up to ${rolls} rival rolls left.`} No final score premium.${s.bonuses?.[i]?' Permanent rents shown; the one-use refit remains.':''}`,scope:s.locked[i]?affected:group,button:`Build for ${money(q.cost)}`};
}
function lowerRent(s,k){
  const lv=s.levels[k]-1,d=rules.development;
  return Math.round(rules.tiles[k].rent*(lv?d.levels[lv-1].rent_pct:d.set_rent_pct)/100)+(s.bonuses?.[k]??0);
}
function districtPreview(s,mode,i,q,scope){
  if(scope.length<2)return '';
  return `<table class="plotScope"><caption>${rules.tiles[i].group} · rent you collect after confirming</caption><thead><tr><th>Space</th><th>Now</th><th>After</th></tr></thead><tbody>${scope.map(k=>{
    const t=rules.tiles[k],bonus=s.bonuses?.[k]??0,before=s.rents[k];
    const after=mode==='sell'?(k===i?0:t.rent+bonus):mode==='salvage'?lowerRent(s,k):q.tiles.includes(k)?Math.round(t.rent*rules.development.levels[s.levels[k]].rent_pct/100)+bonus:before;
    return `<tr><th>${t.name}</th><td>${money(before)}</td><td>${before===after?'Unchanged':money(after)}</td></tr>`;
  }).join('')}</tbody></table>`;
}
function setPlot(i){
  const {s,cells}=plotAccess,{mode}=plotDesk;
  plotDesk.i=i;
  const options=plotQuotes(s,mode),q=i===null?null:plotQuote(s,mode,i),members=q?plotMembers(q):[];
  const impact=q?plotImpact(s,mode,i,q):null;
  if(q)selectSpace(i);
  const cash=s.players[s.turn].cash,spaceCount=options.flatMap(plotMembers).length;
  for(const [k,{b,label,value}] of cells.entries()){
    const option=plotQuote(s,mode,k),short=option?.cost>cash;
    b.disabled=!option;
    b.dataset.plot=!option?'off':short?'short':'candidate';
    if(impact?.scope.includes(k))b.dataset.scope=members.includes(k)?'target':'district';else delete b.dataset.scope;
    b.classList.toggle('selected',k===i);
    if(option)b.setAttribute('aria-pressed',String(k===i));else b.removeAttribute('aria-pressed');
    const price=option?(option.price!=null?'+'+money(option.price):'−'+money(option.cost)):'';
    b.querySelector('.tileValue').textContent=option?(short?'! ':'')+price:value;
    const action=option?`${plotModes[mode]} preview, ${price}${short?', not affordable':''}`:'Not a candidate';
    b.setAttribute('aria-label',`${label.replace(/\. Inspect space$/,'')}. ${action}.${b.dataset.scope==='district'?' District affected.':''}`);
    b.title=action;
  }
  const count=`${spaceCount} marked ${spaceCount===1?'space':'spaces'}`;
  const district=q?districtPreview(s,mode,i,q,impact.scope):'';
  const guide=$('plotGuide');guide.hidden=false;
  guide.innerHTML=`<small>PROPERTY MAP</small><strong>${({build:'Improvements',sell:'Bank sales',commission:'Public works',salvage:'Remove improvements'})[mode]}</strong><span><b>◇</b> ${count} · ${['sell','salvage'].includes(mode)?'bank payout':'project cost'} on each tile</span><span><b>✓</b> Selected${options.some(x=>x.cost>cash)?' · ! Insufficient cash':''}. Select a tile to preview; no money moves.</span>${district}`;
  if(q)$('inspector').innerHTML=`<small class="plate">${rules.tiles[i].name} / ${rules.tiles[i].group}</small>${curve(i)}`;
  const desk=$('propertyDesk'),modes=s.phase==='debt'?['sell','salvage'].filter(m=>plotQuotes(s,m).length):s.phase==='works'?['commission']:['build','sell'];
  desk.innerHTML=`<div class="plotTools">${modes.map(m=>`<button data-mode="${m}" aria-pressed="${m===mode}">${plotModes[m]} <b>${plotQuotes(s,m).length}</b></button>`).join('')}<button id="plotCancel" aria-label="Close property desk">Cancel</button></div>
    <div role="status" aria-atomic="true" class="plotReadout"><small>${q?`${rules.tiles[i].group} · `:''}${count}</small><h2>${q?rules.tiles[i].name:`Nothing to ${plotModes[mode].toLowerCase()}`}</h2>
    ${q?facts(impact.metrics)+`<p>${impact.note}</p><p class="plotDetail">${impact.detail}</p>`:`<p>${mode==='build'?'Complete a district and meet its level rules before building.':'No owned deed is available for this action.'}</p>`}</div>
    ${q?`<div class="plotFoot"><button class="primary" id="plotCommit" ${q.cost>cash?'disabled':''}>${impact.button}</button><div class="plotNav">${spaceCount>1?'<button data-step="-1" aria-label="Previous candidate">‹</button><button data-step="1" aria-label="Next candidate">›</button>':''}<button id="plotLadder">Rent tiers</button></div></div>`:''}`;
  for(const b of desk.querySelectorAll('[data-mode]'))b.onclick=()=>openPlots(b.dataset.mode);
  $('plotCancel').onclick=()=>closePlots(true);
  if(!q)return;
  $('plotCommit').onclick=()=>{const {send}=plotAccess;send(mode,{tile:q.tile})};
  $('plotLadder').onclick=()=>openDialog(`<h2>${rules.tiles[i].name}</h2>${district}${curve(i)}`);
  for(const b of desk.querySelectorAll('[data-step]'))b.onclick=()=>{const d=b.dataset.step;stepPlot(+d);desk.querySelector(`[data-step="${d}"]`)?.focus({preventScroll:true})};
  // Scroll the folded chart only, not the treasury or the command panel.
  if($('board').classList.contains('route')){
    const pane=$('boardView'),box=pane.getBoundingClientRect(),tile=cells[i].b.getBoundingClientRect();
    if(tile.top<box.top||tile.bottom>box.bottom)pane.scrollTop+=tile.top-box.top-(box.height-tile.height)/2;
  }
}
