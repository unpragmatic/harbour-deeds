const $ = id => document.getElementById(id);
const catalog=JSON.parse($('boardCatalog').textContent),currentEdition=catalog.edition;
function boardFor(edition,map){
  if(typeof edition!=='string'||typeof map!=='string')return null;
  const boards=edition===currentEdition?catalog.boards:
    Object.hasOwn(catalog.history,edition)?catalog.history[edition].boards:null;
  return boards&&Object.hasOwn(boards,map)?boards[map]:null;
}
const usesCharter=edition=>edition===currentEdition||catalog.history[edition]?.charter===true;
const DEFAULT_CLOCK=5;
let activeBoard=catalog.boards[catalog.defaultBoard],rules=activeBoard.rules,clockSeconds=DEFAULT_CLOCK;
const colors = ['#9a321f','#006458','#76500b','#53468d'];
const printCodes=JSON.parse($('printCodes').textContent);
const printCode=group=>printCodes[group]??group.slice(0,2).toUpperCase();
const swatch=group=>`<i class="engraving" data-print="${printCode(group)}" aria-hidden="true"></i>`;
const portSeal={start:'ship',notice:'card',guild:'cover',works:'build',exchange:'gavel',fee:'coin',rest:'mooring'};
const money = n => '$' + n.toLocaleString('en-US');
const seat = n => `Seat ${n + 1}`;
const utilityFor=group=>rules.utility_multipliers?.[group];
const faresFor=group=>rules.network_fares?.[group]??utilityFor(group);
const fareAt=(fares,n)=>n?fares[n-1]:0;
const rateLabel=(group,rate)=>utilityFor(group)?`${rate}× dice`:money(rate);
let engine, state, seats, session;
let inspected=0, focusKey='';
const desktop=matchMedia('(min-width:801px)');

function command(input) {
  const bytes = new TextEncoder().encode(JSON.stringify(input));
  const ptr = engine.reserve(bytes.length);
  new Uint8Array(engine.memory.buffer, ptr, bytes.length).set(bytes);
  const out = engine.dispatch();
  const result = JSON.parse(new TextDecoder().decode(new Uint8Array(engine.memory.buffer, out, engine.length())));
  if (result.error) throw new Error(result.error);
  recordDispatch(input,state,result);
  return result;
}

const deeds = (s, who) => s.owners.flatMap((owner,i)=>owner===who?[i]:[]);
function bankTerms(){
  const sale=rules.bank_sale??{rate_pct:50,basis:'list'};
  return `The bank pays ${sale.rate_pct}% of ${sale.basis==='list'?'the printed list price':'the price last paid to the bank'}.`;
}
function wait(ms,signal) {
  return new Promise(resolve=>{
    const t=setTimeout(resolve,ms);
    signal.addEventListener('abort',()=>{clearTimeout(t);resolve()},{once:true});
  });
}
function makeBidMeter(prefix,totalMs) {
  const element=document.createElement('div');element.className='bidClock';
  const label=document.createElement('span');label.setAttribute('role','timer');
  const bar=document.createElement('progress');bar.max=totalMs;bar.value=totalMs;
  bar.setAttribute('aria-label','Bid time remaining');
  element.append(label,bar);
  function update(ms,paused=false){
    bar.value=Math.max(0,Math.min(ms,totalMs));
    const seconds=Math.ceil(bar.value/1000);
    label.textContent=`${paused?'Paused':prefix} · ${seconds}s remaining`;
    bar.setAttribute('aria-valuetext',`${seconds} seconds remaining`);
    element.classList.toggle('urgent',!paused&&bar.value<=2000);
  }
  update(totalMs);
  return {element,update};
}
function bidClock(seconds,signal,onExpiry) {
  const meter=makeBidMeter('Bid clock',seconds*1000);
  $('actions').prepend(meter.element);
  let left=seconds*1000, since=null, expired=false;
  const remaining=()=>left-(since===null?0:performance.now()-since);
  function update(){
    if(expired||signal.aborted)return;
    if(document.hidden||$('modal').open){
      left=remaining();since=null;
    }else if(since===null){since=performance.now()}
    const ms=remaining();
    if(ms<=0){expired=true;onExpiry();return}
    meter.update(ms,since===null);
  }
  const timer=setInterval(update,100);
  document.addEventListener('visibilitychange',update,{signal});
  $('modal').addEventListener('clockchange',update,{signal});
  $('modal').addEventListener('close',update,{signal});
  signal.addEventListener('abort',()=>clearInterval(timer),{once:true});
  update();
  return ()=>{update();return !expired};
}
const controllers = {
  human: (s, signal) => new Promise(resolve => {
    const actor=actingSeat(s), cash=s.players[actor].cash;
    const send=(action,extra={})=>{if(tradeMap?.draft)closeTrade();if(plotAccess?.s===s)releasePlots();resolve({action,actor,...extra})};
    signal.addEventListener('abort',()=>{if(tradeMap?.s===s)closeTrade();resolve(null)},{once:true});
    function button(label,fn,primary=false,disabled=false) {
      const b = document.createElement('button');
      b.textContent = label;
      b.disabled = disabled;
      b.className = primary ? 'primary' : '';
      const key=({'Roll dice':'R','Draft trade':'T','Improve':'I','Sell deed':'S'})[label];
      if(key){b.dataset.key=key;b.setAttribute('aria-keyshortcuts',key);b.insertAdjacentHTML('beforeend',`<kbd aria-hidden="true">${key}</kbd>`)}
      b.addEventListener('click',fn,{signal});
      $('actions').append(b);
      return b;
    }
    if(s.phase==='roll'){
      button('Roll dice',()=>send('roll'),true);
      if(s.players[actor].in_prison){
        if(rules.bail_cost!=null)button(`Pay bail · ${money(rules.bail_cost)}`,()=>send('bail'),false,cash<rules.bail_cost);
        if(s.players[actor].pardons)button('Use pardon',()=>send('pardon'));
      }
      if(!s.traded)button('Draft trade',()=>openTrade(s,send)).id='draftTrade';
      if(s.sells?.length||s.builds.length){
        const entry=button('Manage deeds',()=>openPlots());entry.id='manageDeeds';entry.setAttribute('aria-keyshortcuts','I S');
        enablePlots(s,send,signal);
      }
    }else if(s.phase==='debt'){
      button('Review assets',()=>openPlots(),true).id='manageDeeds';enablePlots(s,send,signal);
      button('Declare bankruptcy',()=>{
        openDialog(`<h2>Leave the game bankrupt?</h2><p>${seat(actor)} still owes ${money(s.debt.remaining)} to ${debtCreditor(s)}. All remaining deeds and improvements return to the bank. This cannot be undone.</p><button id="keepPlaying" class="primary">Keep playing</button> <button id="surrender">Declare bankruptcy</button>`);
        $('keepPlaying').focus();$('keepPlaying').onclick=()=>$('modal').close();
        $('surrender').onclick=()=>{$('modal').close();send('bankrupt')};
        signal.addEventListener('abort',()=>{if($('surrender')&&$('modal').open)$('modal').close()},{once:true});
      });
    }else if(s.phase==='offer'){
      const cost=rules.tiles[s.players[actor].pos].price;
      button(`Buy · ${money(cost)}`,()=>send('buy'),true,cash<cost);
      button(rules.auction_declined===false?'Pass':'Start auction',()=>send('pass'));
    }else if(s.phase==='auction'){
      const min=s.auction.high_bid+rules.auction_increment;
      const inTime=clockSeconds&&!room?bidClock(clockSeconds,signal,()=>send('withdraw')):()=>true;
      if(cash>=min) {
        const bid=amount=>{if(inTime())send('bid',{amount})};
        button(`Bid ${money(min)}`,()=>bid(min),true);
        const jump=min+2*rules.auction_increment;
        if(jump<=cash)button(`Bid ${money(jump)}`,()=>bid(jump));
        button('Custom',()=>{
          openDialog(`<h2>Custom bid</h2><p>${money(min)} minimum · ${money(cash)} available${room?' · Host clock continues':''}</p><form id="bidForm"><label class="field">Amount ($)<input id="amount" type="number" min="${min}" max="${cash}" step="1" required value="${min}"></label><button class="primary">Place bid</button></form>`);
          $('amount').select();
          $('bidForm').onsubmit=e=>{e.preventDefault();const n=+$('amount').value;$('modal').close();bid(n)};
          signal.addEventListener('abort',()=>{if($('bidForm')&&$('modal').open)$('modal').close()},{once:true});
        });
      }
      button('Withdraw',()=>send('withdraw'));
    }else if(s.phase==='works'){
      button('Review refit',()=>openPlots('commission'),true,!s.commissions.length).id='manageDeeds';
      if(s.commissions.length)enablePlots(s,send,signal);
      button('Pass on refit',()=>send('skip'));
    }else if(s.phase==='guild'){
      const tile=rules.tiles[s.players[actor].pos];
      button(`Take ${money(tile.cash_offer)}`,()=>send('grant'),true);
      button(`Cover ${money(tile.cover_offer)}`,()=>send('insure'));
    }else if(s.phase==='trade'){
      button('Accept trade',()=>send('accept'),true);button('Decline',()=>send('reject'));
    }
  }),
  bot: async (s, signal) => {await wait(presentationWait(850),signal);return botMove(s,rules)}
};

function openDialog(html) {
  $('content').innerHTML = html;
  if (!$('modal').open) $('modal').showModal();
  const heading=$('content').querySelector('h2');if(heading){heading.id='sheetTitle';$('modal').setAttribute('aria-labelledby','sheetTitle')}
  $('content').scrollTop=0;
  $('modal').dispatchEvent(new Event('clockchange'));
}
function curve(i) {
  const t=rules.tiles[i],d=rules.development,all=d.policy==='district';
  const fares=faresFor(t.group);
  if(fares){
    const owner=state.owners[i],count=owner===null?0:districtTiles(t.group).filter(k=>state.owners[k]===owner).length;
    const utility=utilityFor(t.group);
    return `<div class="curve fareTable"><table><caption>${utility?'Utility rent':'Network fares'} · ${t.group}</caption><thead><tr><th>Deeds held</th><th>Per rival landing</th></tr></thead><tbody>${fares.map((fare,j)=>`<tr${count===j+1?' class="currentTier"':''}><th>${j+1}${count===j+1?' · now':''}</th><td>${rateLabel(t.group,fare)}</td></tr>`).join('')}</tbody></table><small>${utility?'Multiply the landing roll by the rate shown.':'The same fare applies at each network deed you own.'} No construction or refits.</small></div>`;
  }
  const members=all?rules.tiles.flatMap((x,k)=>x.kind==='deed'&&x.group===t.group?[k]:[]):[i];
  const range=a=>{const lo=Math.min(...a),hi=Math.max(...a);return lo===hi?money(lo):`${money(lo)}–${money(hi)}`};
  const rent=(k,row)=>row?tierRent(rules,k,row-1):rules.tiles[k].rent;
  const full=state.owners[i]!=null&&districtTiles(t.group).every(k=>state.owners[k]===state.owners[i]);
  const resale=state.owners[i]===null&&rules.bank_sale?` ${bankTerms()}`:'';
  const rows=['Base','Set',...d.levels.map((l,n)=>l.label??`L${n+1}`)];
  return `<div class="curve"><table><caption>${all?`${t.group} · whole district`:'Deed development'}</caption><thead><tr><th>Tier</th><th>Build</th><th>Rent</th><th>Gain / hit</th></tr></thead><tbody>${rows.map((name,j)=>{
    const active=j===0?!full:full&&state.levels[i]===j-1;
    return `<tr${active?' class="currentTier"':''}><th>${name}</th><td>${j<2?'—':money(members.reduce((v,k)=>v+tierCost(rules,k,j-2),0))}</td><td>${range(members.map(k=>rent(k,j)))}</td><td>${j?'+'+range(members.map(k=>rent(k,j)-rent(k,j-1))):'—'}</td></tr>`;
  }).join('')}</tbody></table><small>${all?'Build cost covers all deeds. Rent is per landing.':'Build is the one-time cost. Rent is per paying landing.'}${resale}</small></div>`;
}
function deckGuide(t){
  const cards=t.deck?rules.named_cards.filter(c=>c.deck===t.deck):rules.cards;
  const named=Boolean(cards?.length);
  const entries=named?cards.map(c=>[c.title,cardInstruction(c)]):rules.notices.map(n=>[n<0?'Port charge':'Port award',`${n<0?'Pay':'Collect'} ${money(Math.abs(n))}.`]);
  // The reference is public rules data, never the live shuffled deck.
  return `<section class="deckGuide"><h3>${named?'Possible cards':'Possible notices'}</h3><p>${t.deck?`${entries.length} ${t.deck} cards. The shuffled stack cycles; held pardons sit out.`:named?`${entries.length} cards in the full deck. Drawn without replacement, then reshuffled.`:'One outcome is picked independently on each landing.'}</p><dl>${entries.map(([name,order])=>`<div><dt>${name}</dt><dd>${order}</dd></div>`).join('')}</dl></section>`;
}
function detailHtml(i) {
  const t = rules.tiles[i], owner = state.owners[i];
  const network=Boolean(faresFor(t.group));
  const info = {
    deed:`${t.group} district. Price ${money(t.price ?? 0)}; rent ${money(t.rent ?? 0)}. Double rent for a complete district.`,
    start:rules.salary_land!=null?`Collect ${money(rules.salary)} for passing or ${money(rules.salary_land)} for landing here, not both.`:`Collect ${money(rules.salary)} each time you pass or land here.`,
    fee:t.cash_tax_pct!=null?`Pay ${t.cash_tax_pct}% of your cash, rounded to the nearest dollar.`:`Pay ${money(t.price ?? 0)} to the bank.`,
    notice:rules.cards?'Draw a Harbor Dispatch. All cards are drawn once before the deck is reshuffled.':'Draw a port notice for a cash award or unexpected bill.',
    guild:`Take ${money(t.cash_offer??0)} now or guard your next rent payment up to ${money(t.cover_offer??0)}. Cover does not stack; the larger policy survives.`,
    exchange:'Open bidding on the next unowned deed clockwise. Your ship stays here. If no deeds remain, the exchange closes.',
    works:'Commission a one-use rent bonus on an eligible deed, without completing a color set. Pay now; a rival must visit before the match ends for it to pay off.',
    rest:t.move_to!=null?`Go directly to ${rules.tiles[t.move_to].name}. No Start payment. Detained for up to ${t.skip_turns} turns.`:t.skip_turns?`Skip ${t.skip_turns} turn. No payment is due.`:rules.prison_entry!=null&&i===rules.tiles[rules.prison_entry].move_to?'Just visiting on an ordinary landing. If detained: roll doubles to leave, wait out the term, pay bail or use a pardon.':'A safe harbor. No payment is due here.'
  };
  const max=rules.development.levels.length,level=state.levels[i];
  const group=districtTiles(t.group);
  const have=group.filter(k=>state.owners[k]===owner).length;
  const status=owner===null||have<group.length?'Complete the district to build.':
    level===max?'Fully improved.':rules.development.policy==='even'&&group.some(k=>state.levels[k]<level)?'Improve the lower-level deeds first.':'The owner can improve before rolling.';
  const visitors=state.players.flatMap((p,j)=>!p.out&&p.pos===i?[seat(j)]:[]);
  const q=state.sells?.find(q=>q.tile===i),bonus=state.bonuses?.[i]??0;
  const holders=[...new Set(group.map(k=>state.owners[k]))];
  const roster=t.kind==='deed'?`<p class="districtRoster"><b>${t.group} · ${group.length} deeds</b><br>${holders.map(who=>{
    const names=group.filter(k=>state.owners[k]===who).map(k=>rules.tiles[k].name);
    return `${who===null?'Unowned':seat(who)}: ${names.join(' · ')}`;
  }).join('<br>')}</p>`:'';
  const title=owner===null?'On the market':`Owned by ${seat(owner)}`;
  const utility=utilityFor(t.group);
  const body=t.kind==='deed'?`<p>${title} · ${utility?'Utility':network?'Network deed':`Level ${level}/${max}`}</p>
    ${facts([['List price',money(t.price)],[utility?'Rent formula':network?'Current fare':'Current rent',utility?rateLabel(t.group,utility[owner==null?0:have-1]):money(state.rents[i])],...(q?[['Bank offer',money(q.price)]]:[])])}
    ${bonus?`<p>Refitted: next rent includes a one-use ${money(bonus)} bonus.</p>`:''}${curve(i)}${roster}
    ${network?'':`<p>${status}${locked(state,rules,i)?' No sale or trade while this district is developed.':''}</p>`}`:
    t.kind==='notice'?deckGuide(t):`<p>${info[t.kind]}</p>`;
  return `<small class="plate">SPACE ${String(i).padStart(2,'0')} / ${t.kind==='deed'?`${swatch(t.group)} ${t.group}`:'Port services'}</small><h2>${t.name}</h2>${body}${visitors.length?`<p>Visiting: ${visitors.join(', ')}</p>`:''}`;
}
function selectSpace(i){
  inspected=i;$('inspector').innerHTML=detailHtml(i);
  document.querySelectorAll('.tile').forEach(el=>el.classList.toggle('selected',el.id===`tile-${i}`));
}
function detail(i) {
  selectSpace(i);if(desktop.matches){showView('board');$('inspector').scrollTop=0}else openDialog(detailHtml(i));
}
const summary=(deed,cash)=>[deed===null?'':rules.tiles[deed].name,cash?money(cash):''].filter(Boolean).join(' + ');
const netWorth=(s,i)=>s.players[i].cash+deeds(s,i).reduce((sum,k)=>sum+rules.tiles[k].price,0);
const districtTiles=group=>rules.tiles.flatMap((t,i)=>t.kind==='deed'&&t.group===group?[i]:[]);
function decisionStakes(s,actor,lot){
  if(s.phase==='offer'||s.phase==='auction'){
    const t=rules.tiles[lot],siblings=districtTiles(t.group).filter(i=>i!==lot);
    const fares=faresFor(t.group);
    if(fares){
      const n=siblings.filter(i=>s.owners[i]===actor).length;
      return `<p class="stakes"><b>If ${seat(actor)} takes ${t.name}:</b> ${n+1}/${fares.length} ${t.group} · ${rateLabel(t.group,fares[n])} per rival landing${n?` at each, up from ${rateLabel(t.group,fares[n-1])}`:''}.</p>`;
    }
    if(!siblings.length)return '';
    const who=s.owners[siblings[0]];
    if(who===null||!siblings.every(i=>s.owners[i]===who))return '';
    const rent=Math.round(t.rent*rules.development.set_rent_pct/100);
    return `<p class="stakes"><b>Last ${t.group} deed.</b> If ${seat(who)} gets it, the set is complete. ${rent===t.rent?'Construction unlocks; base rent stays '+money(rent):`${t.name} rent: ${money(t.rent)} → ${money(rent)}`}.</p>`;
  }
  if(s.phase!=='roll')return '';
  const gaps=[...new Set(deeds(s,actor).map(i=>rules.tiles[i].group))].flatMap(group=>{
    const missing=districtTiles(group).filter(i=>s.owners[i]!==actor);
    return missing.length===1?[missing[0]]:[];
  });
  let race='';
  if(rules.victory!=='elimination'){
    const own=netWorth(s,actor), rivals=s.players.flatMap((p,i)=>i!==actor&&!p.out?[{i,total:netWorth(s,i)}]:[]).sort((a,b)=>b.total-a.total);
    if(rivals.length){
      const {i,total}=rivals[0];
      race=`<p class="race">Net worth <b>${money(own)}</b> · ${own===total?'Tied for first':own>total?`Leading by ${money(own-total)}`:`${money(total-own)} behind ${seat(i)}`}</p>`;
    }
  }
  if(!gaps.length)return race;
  const i=gaps[0],t=rules.tiles[i],who=s.owners[i];
  return race+`<p class="stakes"><b>One short of ${t.group}.</b> ${t.name} · ${who===null?`Unowned, ${money(t.price)}`:`Held by ${seat(who)}`}.</p>`;
}
function facts(entries){
  return `<dl class="facts">${entries.map(([key,v])=>`<div><dt>${key}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
}
const debtCreditor=s=>s.debt.creditor===null?'the bank':seat(s.debt.creditor);
function render() {
  closeTrade();
  const s = state, a = actingSeat(s), p = s.players[a], t = rules.tiles[s.auction?.tile??s.players[s.turn].pos];
  const phaseNames={roll:'Helm',offer:'Land office',auction:'Auction floor',works:'Public works',guild:'Guild charter',trade:'Trade offer',debt:'Outstanding bill',end:hasDraw(s)?'Card drawn':'Settlement',over:'Final accounts'};
  document.body.dataset.phase=s.phase;
  $('phaseLabel').textContent=phaseNames[s.phase].toUpperCase();
  $('controlType').textContent=s.phase==='over'?'TABLE CLOSED':`${seat(a)} · ${seats[a]==='bot'?'Bot':'Local'}`;
  $('chartStatus').textContent=s.phase==='roll'?`${seat(a)} at ${t.name}`:s.phase==='auction'?`${t.name} · Auction in progress`:s.phase==='trade'?'Private negotiation':s.phase==='over'?'Port closed':`${s.dice.join(' + ')} → ${t.name}`;
  $('round').textContent = `ROUND ${String(s.round).padStart(2,'0')}${rules.victory==='elimination'?' · LAST SHIP STANDING':` / ${rules.rounds} · NET WORTH`}`;
  const groups=[...new Set(rules.tiles.filter(t=>t.kind==='deed').map(t=>t.group))];
  const districts=new Map(groups.map(g=>{
    const members=districtTiles(g),counts=s.players.map(()=>0);
    for(const i of members)if(s.owners[i]!==null)counts[s.owners[i]]++;
    return [g,{size:members.length,counts}];
  }));
  for (const [i,tile] of rules.tiles.entries()) {
    let b = $(`tile-${i}`);
    if (!b) {
      b = document.createElement('button'); b.id=`tile-${i}`;
      const [row,col] = activeBoard.layout.positions[i];
      b.style.gridArea=`${row} / ${col}`;
      b.className='tile '+(tile.kind==='deed'?'deed':'special');
      b.dataset.kind=tile.kind;
      if(tile.kind==='deed')b.dataset.print=printCode(tile.group);
      b.onclick=()=>{if(tradeMap)pickTrade(i);else if(!pickPlot(i))detail(i)};
      b.onkeydown=e=>{
        const dir={ArrowLeft:-1,ArrowRight:1}[e.key];if(!dir)return;
        if(tradeMap){e.preventDefault();focusTradeTile(i,dir);return}
        if(plotDesk){e.preventDefault();stepPlot(dir,true);return}
        if(!desktop.matches)return;
        e.preventDefault();const next=(i+dir+rules.tiles.length)%rules.tiles.length;
        $(`tile-${next}`).focus();detail(next);
      };
      $('board').append(b);
    }
    b.classList.toggle('landing',s.phase!=='over'&&i===s.players[s.turn].pos);
    b.classList.remove('located');
    const here=s.players.flatMap((player,j)=>player.pos===i&&!player.out?[j]:[]);
    const owner=s.owners[i],mult=utilityFor(tile.group),value=owner!==null?(mult?rateLabel(tile.group,mult[districts.get(tile.group).counts[owner]-1]):`${faresFor(tile.group)?'Fare':'Rent'} ${money(s.rents[i])}`):tile.kind==='fee'?(tile.cash_tax_pct!=null?`−${tile.cash_tax_pct}% cash`:`−${money(tile.price)}`):tile.price?money(tile.price):({start:'Salary',notice:'Draw',guild:'Choose',exchange:'Auction',works:'Commission',rest:tile.move_to!=null?'Relocate':tile.skip_turns?'Skip turn':'Visit'})[tile.kind];
    const deed=tile.kind==='deed',district=deed?districts.get(tile.group):null;
    const held=owner===null?0:district.counts[owner],full=owner!==null&&held===district.size;
    if(owner!==null)b.style.setProperty('--owner-ink',colors[owner]);else b.style.removeProperty('--owner-ink');
    const mark=owner===null?'':`<span class="ownerMark${full?' complete':''}"><b>S${owner+1}</b> <span>${full?'SET':`${held}/${district.size}`}</span></span>`;
    const markers=here.map(j=>`<span class="token${j===s.turn?' arrived':''}" data-ship="${j}" style="--seat:${colors[j]}" aria-hidden="true">${shipPiece(j,here.length>2)}</span>`).join('');
    b.classList.toggle('hasOwner',owner!==null);b.classList.toggle('fleetHere',here.length>0);
    const span=activeBoard.layout.foldColumns,foldRow=Math.floor(i/span);
    b.style.setProperty('--fold-row',1+foldRow);b.style.setProperty('--fold-col',foldRow%2?span-i%span:1+i%span);
    const face=deed?`<span class="deedFace" aria-hidden="true"></span>
      <span class="deedHead" aria-hidden="true"><span class="districtMark"><span class="printCode">${printCode(tile.group)}</span><span class="printName">${tile.group}</span></span>${mark}</span>`:
      `<span class="portSeal" aria-hidden="true">${icon(portSeal[tile.kind])}</span>`;
    b.innerHTML=`${face}<span class="station" aria-hidden="true">${String(i).padStart(2,'0')} ${foldRow%2?'←':'→'}</span><span class="${deed?'deedLabel':'portLabel'}"><strong>${tile.name}</strong><span class="tileValue">${value}</span></span>${markers?`<span class="berth" data-ships="${here.length}">${markers}</span>`:''}`;
    const title=owner!==null?`Owned by ${seat(owner)}${faresFor(tile.group)?'':`, level ${s.levels[i]}`}. ${held} of ${district.size} ${tile.group} deeds`:(deed?'Unowned':'');
    b.setAttribute('aria-label',[tile.name,tile.group||tile.kind,value,title,full?`Complete ${tile.group} set`:'',here.length?'Occupied by '+here.map(seat).join(', '):'','Inspect space'].filter(Boolean).join('. '));
  }
  $('register').innerHTML=s.players.map((player,i)=>{
    const owned=deeds(s,i), holdings=groups.map(g=>{
      const {counts,size}=districts.get(g),count=counts[i];
      const levels=owned.filter(k=>rules.tiles[k].group===g).reduce((n,k)=>n+s.levels[k],0);
      return count?`<span>${swatch(g)} ${g} ${count}/${size}${count===size?' · Full set':''}${levels?` · ${levels} built · locked`:''}</span>`:'';
    }).join('');
    const assigned=room?.started?room.owners[i]:null;
    const controller=seats[i]==='bot'?'Bot':assigned===null?'Local player':assigned===0?'Host':`Device ${assigned}`;
    const links=owned.map(k=>`<button class="holding" data-deed="${k}">${rules.tiles[k].name}</button>`).join('');
    return `<div class="row"><span class="badge" style="background:${colors[i]}">${i+1}</span><div><strong>${seat(i)}</strong><div class="meta">${player.out?'Bankrupt':controller} · ${owned.length} deeds</div><div class="holdings">${holdings}</div><div>${links}</div></div><span class="money">${money(player.cash)}</span></div>`;
  }).join('');
  syncStage(s);
  const market=s.phase==='offer'||s.phase==='auction',at=s.auction?.tile??s.players[s.turn].pos;
  const key=`${s.round}/${s.turn}/${at}/${market}`;
  if(key!==focusKey){inspected=at;focusKey=key;if(market)$('inspector').scrollTop=0}
  selectSpace(inspected);
  $('mobileLadder').innerHTML=market?curve(at):'';
  renderLog(s.events);
  $('actions').replaceChildren();
  if(s.phase==='over'){
    $('turn').innerHTML=`<h2>${s.winners.map(seat).join(' & ')} ${s.winners.length>1?'tie':'wins'}</h2><p>${s.players.filter(x=>!x.out).length===1?'Last solvent merchant.':`Final net worth after ${s.round} round${s.round===1?'':'s'}: cash plus printed deed values.`}</p>${facts(s.players.map((player,i)=>[seat(i),player.out?'Bankrupt':money(netWorth(s,i))]))}`;
    const b=document.createElement('button'); b.className='primary';b.textContent=room?'Leave table':'Rematch';b.onclick=room?()=>endRoom('You left the table.'):()=>play([...seats],$('board').dataset.map,clockSeconds,rules.development.policy,charterOf(rules)).catch(report);$('actions').append(b);
    return;
  }
  let title, text, stats=[];
  if(s.phase==='roll'){
    title=t.name;text=p.in_prison?`Detained · ${p.skip_turns} attempt${p.skip_turns===1?'':'s'} left. Doubles release you and move. Bail or a pardon ends this turn.`:p.cover?`${money(p.cover)} cover on the next rent bill.`:'';
  }else if(s.phase==='offer'){
    title=rules.auction_declined===false?'Buy or pass?':'Buy or auction?';text=`${t.name} · ${t.group}`;
    stats=[['List price',money(t.price)],[utilityFor(t.group)?'One utility':faresFor(t.group)?'Single fare':'Base rent',rateLabel(t.group,utilityFor(t.group)?.[0]??t.rent)],['After buying',p.cash>=t.price?money(p.cash-t.price):'Short of cash']];
  }else if(s.phase==='auction'){
    title='Raise or withdraw?';text=`${t.name} · ${s.auction.leader===null?'No bids yet':seat(s.auction.leader)+' leads'}`;
    stats=[['High bid',money(s.auction.high_bid)],['Your cash',money(p.cash)],['List / rent',`${money(t.price)} / ${rateLabel(t.group,utilityFor(t.group)?.[0]??t.rent)}`]];
  }else if(s.phase==='debt'){
    title='Raise cash or declare bankruptcy';text=`${seat(s.debt.debtor)} owes ${debtCreditor(s)}. Sales pay this bill first; you keep any surplus.`;
    stats=[['Bill',money(s.debt.amount)],['Already paid',money(s.debt.paid)],['Still due',money(s.debt.remaining)]];
  }else if(s.phase==='works'){
    title='Refit or pass?';text=`${t.name} · Pay for a one-use rent bonus. No visitor, no payoff.`;
  }else if(s.phase==='guild'){
    title=t.name;text=`Cash now, or protection on your next rent bill? Current cover: ${money(p.cover)}.`;
  }else if(s.phase==='end'&&s.card_receipt?.draws.length){
    const last=s.card_receipt.draws.at(-1);title=rules.named_cards[last.card].title;text=last.result;
  }else if(s.phase==='end'&&s.last_card!=null){
    title=rules.cards[s.last_card].title;text=s.events.slice().reverse().find(line=>line.startsWith(title+':'))??s.events.at(-1);
  }else if(s.phase==='trade'){
    openTrade(s);title=`Offer from ${seat(s.trade.from)}`;text='';
  }else{
    title=t.name;text=s.events.at(-1);
  }
  $('turn').innerHTML=`<h2>${title}</h2>${market?`<button id="inspectQuote">${faresFor(t.group)?'Network fares':'Rent &amp; build costs'}</button>`:''}${text?`<p>${text}</p>`:''}${stats.length?facts(stats):''}${decisionStakes(s,a,at)}`;
  if(market)$('inspectQuote').onclick=()=>detail(at);
  if(seats[a]==='bot' || s.phase==='end') $('actions').innerHTML=`<small class="waiting">${s.phase==='end'?'Next turn…':`${seat(a)} is playing…`}</small>`;
}
function initialize(types,map,seconds,seed,policy,edition=currentEdition,charter) {
  const boardSpec=boardFor(edition,map);
  if(!boardSpec)throw Error('Unknown board for this rules edition');
  closeTrade();
  activeBoard=boardSpec;
  const base=boardSpec.rules;
  rules={...base,development:{...base.development,policy:policy??base.development.policy}};clockSeconds=seconds;
  if(usesCharter(edition)&&charter){
    if(!validCharter(charter))throw Error('Invalid victory or liquidation settings');
    rules={...rules,rounds:charter.rounds,victory:charter.victory,liquidation:{...rules.liquidation,deeds:charter.deeds,improvements:charter.improvements}};
  }else if(!usesCharter(edition)){
    rules={...rules,victory:'net_worth',liquidation:{deeds:false,improvements:false,improvement_rate_pct:50}};
  }
  resetStage();
  focusKey='';inspected=0;
  const {rows,columns:cols,density,direction,foldColumns}=boardSpec.layout;
  const board=$('board');
  board.querySelectorAll('.tile').forEach(tile=>tile.remove());
  // An occupied deed needs room for its title band, price and visiting ships.
  board.style.gridTemplate=`repeat(${rows},minmax(min-content,1fr)) / repeat(${cols},minmax(0,1fr))`;
  board.querySelector('.ocean').style.gridArea=`2 / 2 / ${rows} / ${cols}`;
  board.dataset.map=map;board.dataset.density=density;
  board.style.setProperty('--fold-columns',foldColumns);
  $('routeDirection').textContent=direction==='clockwise'?'↻  Clockwise':'↺  Counterclockwise';
  $('printKey').innerHTML=[...new Set(rules.tiles.filter(t=>t.kind==='deed').map(t=>t.group))].map(g=>
    `<div>${swatch(g)}<b>${printCode(g)}</b> ${g}</div>`).join('');
  placeStage();
  const mapName=boardSpec.label;
  $('boardName').textContent=mapName;$('mapTitle').textContent=`${mapName} · ${rules.tiles.length} spaces · ${rules.dice?.count??2}d${rules.dice?.sides??6}`;
  showView('board');
  seats=types;
  state=command({action:'start',rules,seats:types.length,seed});
}
async function play(types,map=catalog.defaultBoard,seconds=DEFAULT_CLOCK,policy,charter) {
  session?.abort(); session=new AbortController(); const {signal}=session;
  initialize(types,map,seconds,crypto.getRandomValues(new Uint32Array(1))[0],policy,currentEdition,charter);
  render();
  while(!signal.aborted) {
    if(state.phase==='over') return;
    const step=new AbortController();
    const cancel=()=>step.abort();
    signal.addEventListener('abort',cancel,{once:true});
    const action=state.phase==='end'
      ? (await wait(presentationWait(950),step.signal),{action:'end',actor:state.turn})
      : await controllers[seats[actingSeat(state)]](state,step.signal);
    signal.removeEventListener('abort',cancel); step.abort();
    if(signal.aborted) return;
    const before=state;state=command(action);render();liveFeedback(action,before,state);
  }
}
function report(err){$('actions').replaceChildren();$('turn').textContent=`Game unavailable: ${err.message}`;console.error(err)}
const charterOf=r=>({victory:r.victory??'net_worth',rounds:r.rounds,deeds:r.liquidation?.deeds??false,improvements:r.liquidation?.improvements??false});
const validCharter=c=>c&&['net_worth','elimination'].includes(c.victory)&&Number.isSafeInteger(c.rounds)&&c.rounds>=1&&c.rounds<=200&&typeof c.deeds==='boolean'&&typeof c.improvements==='boolean';
function boardControls(initial,onChange=()=>{}){
  const map=$('map');
  for(const [id,b] of Object.entries(catalog.boards))
    map.add(new Option(`${b.label} · ${b.rules.tiles.length} spaces`,id));
  map.value=initial.map;
  $('clock').value=String(initial.seconds);
  const chosen=()=>({map:map.value,policy:$('policy').value,seconds:Number($('clock').value),
    charter:{victory:$('victory').value,rounds:$('roundLimit').valueAsNumber,deeds:$('debtDeeds').checked,improvements:$('debtLevels').checked}});
  const changed=()=>{
    $('roundField').hidden=$('victory').value==='elimination';onChange(chosen());
  };
  const selectBoard=({policy,charter}={})=>{
    const base=catalog.boards[map.value].rules,c=charter??charterOf(base);
    $('policy').value=policy??base.development.policy;
    $('victory').value=c.victory;$('roundLimit').value=c.rounds;$('debtDeeds').checked=c.deeds;$('debtLevels').checked=c.improvements;
    changed();
  };
  map.onchange=()=>selectBoard();
  for(const id of ['policy','clock','victory','debtDeeds','debtLevels'])$(id).onchange=changed;
  $('roundLimit').oninput=changed;
  selectBoard(initial);
  return ()=>{
    if($('victory').value==='elimination'&&!$('roundLimit').validity.valid){
      $('roundLimit').value=catalog.boards[map.value].rules.rounds;changed();
    }
    const choice=chosen();
    if(!validCharter(choice.charter)){$('roundLimit').reportValidity();return null}
    return choice;
  };
}
function settings(){
  return `<label class="field">Board<select id="map"></select></label>
    <fieldset class="charter"><legend>Victory &amp; bankruptcy</legend><label class="field">Win by<select id="victory"><option value="net_worth">Net worth at round limit</option><option value="elimination">Last solvent merchant</option></select></label>
    <label class="field" id="roundField">Round limit<input type="number" id="roundLimit" min="1" max="200" step="1" required></label>
    <p>To cover a bill, allow the debtor to sell:</p><label><input id="debtDeeds" type="checkbox"> Undeveloped deeds</label><label><input id="debtLevels" type="checkbox"> Improvement levels</label></fieldset>
    <label class="field">Improvements<select id="policy"><option value="even">Even building</option><option value="free">Unrestricted</option><option value="district">Whole district</option></select></label>
    <label class="field">Human bid clock<select id="clock"><option value="5" selected>5 seconds</option><option value="0">Untimed</option><option value="15">15 seconds</option><option value="30">30 seconds</option></select></label>`;
}
function showView(name){
  if(plotDesk&&name!=='board')closePlots();
  document.body.dataset.instrument=name;
  for(const tab of document.querySelectorAll('[data-view]')){
    const active=tab.dataset.view===name;tab.setAttribute('aria-pressed',String(active));
    $(tab.dataset.view+'View').hidden=!active&&!(desktop.matches&&tab.dataset.view==='board');
  }
  $('inspector').hidden=!desktop.matches||name!=='board';
  document.querySelector('[data-view=board]').textContent=desktop.matches?'Space':'Board';
}
desktop.addEventListener('change',()=>showView(document.querySelector('[data-view][aria-pressed=true]').dataset.view));
$('register').onclick=e=>{const b=e.target.closest('[data-deed]');if(b)detail(+b.dataset.deed)};
$('stageLedger').onclick=e=>{
  const b=e.target.closest('[data-locate]');if(!b)return;
  const i=state.players[+b.dataset.locate].pos;
  showView('board');followTile(i);
  $('board').querySelector('.located')?.classList.remove('located');
  $(`tile-${i}`).classList.add('located');
};
document.querySelector('.switcher').onclick=e=>{if(e.target.dataset.view)showView(e.target.dataset.view)};
document.addEventListener('keydown',e=>{
  if($('modal').open||e.repeat||e.isComposing||e.altKey||e.ctrlKey||e.metaKey)return;
  if(tradeMap){tradeKey(e);return}
  if(e.target.matches('input,textarea,select,[contenteditable=true]'))return;
  if(plotDesk&&e.key==='Escape'){e.preventDefault();closePlots(true);return}
  if(!desktop.matches)return;
  const key=e.key.toUpperCase(),view={B:'board',F:'players',L:'activity'}[key];
  if(plotAccess?.s.phase==='roll'&&['I','S'].includes(key)){
    e.preventDefault();openPlots(key==='I'?'build':'sell');return;
  }
  const control=view?document.querySelector(`[data-view="${view}"]`):key==='?'?$('rulesBtn'):!plotDesk&&/^[RT]$/.test(key)?document.querySelector(`#actions [data-key="${key}"]:enabled`):null;
  if(control){e.preventDefault();control.click()}
});
function setup(){
  if(room){roomMenu();return}
  const fields=Array.from({length:4},(_,i)=>`<label class="field">${seat(i)}<select id="seat-${i}">${(i<2?['human','bot']:['off','human','bot']).map(v=>`<option value="${v}" ${v===(seats[i]??'off')?'selected':''}>${{human:'Local player',bot:'Bot',off:'Empty'}[v]}</option>`).join('')}</select></label>`).join('');
  openDialog(`<h2>New table</h2><p>Choose how to play. Starting replaces this match.</p>
    <div class="modeChoices"><button id="solo"><b>Solo</b><span>You + two bots</span></button><button id="passPlay"><b>Pass &amp; play</b><span>Two on this device</span></button><button id="host"><b>Host online</b><span>Invite devices</span></button><button id="join"><b>Join online</b><span>Enter table code</span></button></div>
    ${savedTableButton()}<details id="advanced"><summary>Custom local table</summary>${settings()}${fields}<button id="start" class="primary">Start game</button></details>`);
  bindSavedTableButton();
  const quick=types=>{$('modal').close();play(types,$('board').dataset.map,clockSeconds,rules.development.policy,charterOf(rules)).catch(report)};
  $('solo').onclick=()=>quick(['human','bot','bot']);$('passPlay').onclick=()=>quick(['human','human']);
  $('host').onclick=hostRoom;$('join').onclick=()=>roomMenu(true);
  const chosen=boardControls({map:$('board').dataset.map,seconds:clockSeconds,policy:rules.development.policy,charter:charterOf(rules)});
  $('start').onclick=()=>{
    const types=[0,1,2,3].map(i=>$(`seat-${i}`).value).filter(v=>v!=='off');
    const choice=chosen();if(!choice)return;
    const {map,seconds,policy,charter}=choice;
    $('modal').close();play(types,map,seconds,policy,charter).catch(report);
  };
}
$('setupBtn').onclick=setup;
$('close').onclick=()=>$('modal').close();
$('modal').setAttribute('aria-label','Table information');
$('rulesBtn').onclick=()=>openDialog(`<h2>The rulebook</h2><h3>How to win this table</h3><p>${rules.victory==='elimination'?'Be the last solvent merchant. There is no round limit.':`Have the most cash plus printed deed value after ${rules.rounds} rounds, or be the last solvent merchant. Equal net worth shares the win.`}</p><p>Start with ${money(rules.cash)}. Passing ${rules.tiles[0].name} pays ${money(rules.salary)}${rules.salary_land!=null?`; landing there pays ${money(rules.salary_land)} instead`:''}. Paying a bill down to exactly $0 is safe.</p><h3>Debt &amp; bankruptcy</h3><p>${rules.liquidation?.deeds||rules.liquidation?.improvements?`Cash goes to the creditor first. To cover the shortfall you may sell ${[rules.liquidation.deeds?'undeveloped deeds':'',rules.liquidation.improvements?`improvement levels at ${rules.liquidation.improvement_rate_pct}% of their build cost`:'' ].filter(Boolean).join(' and ')}. You can instead declare bankruptcy even if a sale would save you. With no permitted assets left, bankruptcy is automatic.`:'Emergency sales are disabled. An unpaid bill eliminates the debtor and returns their deeds to the bank.'}</p><h3>Buy or pass</h3><p>${rules.auction_declined===false?'Buy at list price or leave the deed on the market. No auction opens.':`Buy at list price or auction the deed to all players. Raise by at least ${money(rules.auction_increment)} or withdraw. No bids leaves the deed on the market.`}</p>${rules.doubles_limit?`<h3>Doubles</h3><p>Roll again on doubles. ${rules.doubles_limit} consecutive doubles send you to prison; doubles that free you do not earn another roll.</p>`:''}<h3>Negotiate before rolling</h3><p>Once per turn, propose a deed sale or swap. Either side may add cash; the other merchant can accept or decline.</p>`);
try {
  initFeedback();
  $('rulesBtn').addEventListener('click',()=>{
    $('content').insertAdjacentHTML('afterbegin','<p class="keyGuide"><b>Desktop keys</b> &nbsp; R Roll · T Draft trade · I Improve · S Sell quote · B Space · F Players · L Activity · ← → browse focused spaces · Esc close sheet</p>');
    $('content').insertAdjacentHTML('beforeend',`<h3>Manage deeds on the board</h3><p>Before rolling, select a marked deed or choose Manage deeds. Switch between Improve and Sell to compare your options. Selecting a space only previews it; Confirm is a separate action. ${bankTerms()} Player trades leave the original bank acquisition price unchanged. Permanently developed districts cannot be sold.</p>${rules.tiles.some(t=>t.kind==='works')?'<h3>Public works</h3><p>Land at a works with an eligible deed to commission a one-use rent bonus. It pays only on the next rival rent. No full set is needed, and passing costs nothing.</p>':''}`);
    $('content').insertAdjacentHTML('beforeend',`<h3>Improve full districts</h3><p>This table uses ${({even:'even building: improve a lowest-level deed',free:'unrestricted building: choose any deed',district:'whole-district building: improve every deed together'})[rules.development.policy]}. There are ${rules.development.levels.length} levels. Construction raises rent, locks the district against trades and has no end-game resale value.</p><a href="./development.html" target="_blank" rel="noopener">See costs and break-even analysis</a>`);
  });
  const bytes=Uint8Array.from(atob($('binary').textContent),c=>c.charCodeAt(0));
  engine=(await WebAssembly.instantiate(bytes)).instance.exports;
  const requested=new URLSearchParams(location.search).get('board');
  if(requested!==null&&!boardFor(currentEdition,requested))throw Error('Unknown board. Open the game without the board parameter to choose a table.');
  const initialGame=play(['human','bot','bot'],requested??catalog.defaultBoard);promptSavedTable();await initialGame;
} catch(err){report(err)}
