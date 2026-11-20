const $ = id => document.getElementById(id);
const maps = {compact:JSON.parse($('config').textContent),outer:JSON.parse($('outer').textContent)};
const DEFAULT_CLOCK=5;
let rules=maps.compact, clockSeconds=DEFAULT_CLOCK;
const colors = ['#a54d37','#347367','#936c20','#5d608a'];
const bands = {'Old Town':'#b76952', Foundry:'#d39e47', Market:'#7989a9', Marina:'#589587', Shipyards:'#ac84a2', Exchange:'#7195aa'};
const money = n => '$' + n.toLocaleString('en-US');
const seat = n => `Seat ${n + 1}`;
let engine, state, seats, session;

function command(input) {
  const bytes = new TextEncoder().encode(JSON.stringify(input));
  const ptr = engine.reserve(bytes.length);
  new Uint8Array(engine.memory.buffer, ptr, bytes.length).set(bytes);
  const out = engine.dispatch();
  const result = JSON.parse(new TextDecoder().decode(new Uint8Array(engine.memory.buffer, out, engine.length())));
  if (result.error) throw new Error(result.error);
  return result;
}

const deeds = (s, who) => s.owners.flatMap((owner,i)=>owner===who?[i]:[]);
function compose(s, send) {
  const a=s.turn;
  const peers=s.players.flatMap((p,i)=>!p.out && i!==a && (deeds(s,i).length||deeds(s,a).length)?[i]:[]);
  openDialog(`<small>PRIVATE CONTRACT · ${seat(a)}</small><h2>Draft a trade</h2><p>Exchange a deed for cash, another deed, or both. One proposal per turn.</p>
    <form id="contract"><label class="field">Trade with<select id="partner">${peers.map(i=>`<option value="${i}">${seat(i)}</option>`)}</select></label>
    <div id="terms"></div><p id="tradeError" role="alert"></p><button class="primary">Send proposal</button></form>`);
  const leg=(who,key,title)=>`<fieldset><legend>${title} · ${seat(who)}</legend><label class="field">Deed<select id="${key}Deed"><option value="">No deed</option>${deeds(s,who).map(i=>`<option value="${i}">${rules.tiles[i].name} · ${money(rules.tiles[i].price)}</option>`)}</select></label><label class="field">Cash ($)<input type="number" step="1" min="0" max="${s.players[who].cash}" id="${key}Cash" value="0" required></label></fieldset>`;
  const terms=()=>{$('terms').innerHTML=leg(a,'give','You offer')+leg(+$('partner').value,'take','You request');$('tradeError').textContent=''};
  terms();$('partner').onchange=terms;
  $('contract').onsubmit=e=>{
    e.preventDefault();
    const index=id=>$(id).value===''?null:Number($(id).value);
    const deal={to:+$('partner').value,give_deed:index('giveDeed'),take_deed:index('takeDeed'),give_cash:+$('giveCash').value,take_cash:+$('takeCash').value};
    if((deal.give_deed===null&&!deal.give_cash)||(deal.take_deed===null&&!deal.take_cash)||(deal.give_cash&&deal.take_cash)){
      $('tradeError').textContent='Each side must contribute. Put cash on only one side.';return;
    }
    $('modal').close();send('propose',deal);
  };
}
function wait(ms,signal) {
  return new Promise(resolve=>{
    const t=setTimeout(resolve,ms);
    signal.addEventListener('abort',()=>{clearTimeout(t);resolve()},{once:true});
  });
}
// Measure active time, not interval ticks. A blocked event loop must not grant a late bid.
function bidClock(seconds,signal,onExpiry) {
  const display=document.createElement('span');
  display.className='bidClock'; display.setAttribute('role','timer');
  $('actions').prepend(display);
  let left=seconds*1000, since=null, expired=false;
  const remaining=()=>left-(since===null?0:performance.now()-since);
  function update(){
    if(expired||signal.aborted)return;
    if(document.hidden||$('modal').open){
      left=remaining();since=null;
    }else if(since===null){since=performance.now()}
    const ms=remaining();
    if(ms<=0){expired=true;onExpiry();return}
    display.textContent=`${since===null?'Paused':'Bid clock'} · ${Math.ceil(ms/1000)}s · withdraws at zero`;
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
    const send=(action,extra={})=>resolve({action,actor,...extra});
    signal.addEventListener('abort',()=>resolve(null),{once:true});
    function button(label,fn,primary=false,disabled=false) {
      const b = document.createElement('button');
      b.textContent = label;
      b.disabled = disabled;
      b.className = primary ? 'primary' : '';
      b.addEventListener('click',fn,{signal});
      $('actions').append(b);
    }
    if(s.phase==='roll'){
      button('Roll dice',()=>send('roll'),true);
      if(!s.traded && s.owners.some(o=>o!==null)) button('Draft trade',()=>compose(s,send));
    }else if(s.phase==='offer'){
      const cost=rules.tiles[s.players[actor].pos].price;
      button(`Buy · ${money(cost)}`,()=>send('buy'),true,cash<cost);
      button('Start auction',()=>send('pass'));
    }else if(s.phase==='auction'){
      const min=s.auction.high_bid+rules.auction_increment;
      const inTime=clockSeconds&&!room?bidClock(clockSeconds,signal,()=>send('withdraw')):()=>true;
      if(cash>=min) {
        const label=document.createElement('label');
        label.className='bidField';label.innerHTML=`Your bid ($)<input id="amount" type="number" min="${min}" max="${cash}" step="1" required value="${min}">`;
        $('actions').append(label);
        button('Place bid',()=>{if(inTime()&&$('amount').reportValidity())send('bid',{amount:+$('amount').value})},true);
      }
      button('Withdraw',()=>send('withdraw'));
    }else if(s.phase==='trade'){
      button('Accept trade',()=>send('accept'),true);button('Decline',()=>send('reject'));
    }
  }),
  bot: async (s, signal) => {await wait(850,signal);return botMove(s,rules)}
};

function boardPosition(i) {
  const edge=rules.tiles.length/4, side=edge+1;
  if(i<=edge)return [side-i,1];
  if(i<=2*edge)return [1,i-edge+1];
  if(i<=3*edge)return [i-2*edge+1,side];
  return [side,4*edge+1-i];
}
function openDialog(html) {
  $('content').innerHTML = html;
  if (!$('modal').open) $('modal').showModal();
  $('modal').dispatchEvent(new Event('clockchange'));
}
function detail(i) {
  const t = rules.tiles[i], owner = state.owners[i];
  const info = {
    deed:`${t.group} district. Price ${money(t.price ?? 0)}; rent ${money(t.rent ?? 0)}. Double rent for a complete district.`,
    start:`Collect ${money(rules.salary)} each time you pass or land here.`,
    fee:`Pay ${money(t.price ?? 0)} to the port authority.`,
    notice:'Draw a port notice for a cash award or unexpected bill.',
    rest:'A safe harbor. No payment is due here.'
  };
  openDialog(`<h2>${t.name}</h2><p>${info[t.kind]}</p>${t.kind==='deed'?`<small>${owner===null?'ON THE MARKET':'OWNED BY '+seat(owner).toUpperCase()}</small>`:''}`);
}
const summary=(deed,cash)=>[deed===null?'':rules.tiles[deed].name,cash?money(cash):''].filter(Boolean).join(' + ');
function facts(entries){
  return `<dl class="facts">${entries.map(([key,v])=>`<div><dt>${key}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
}
function render() {
  const s = state, a = actingSeat(s), p = s.players[a], t = rules.tiles[s.players[s.turn].pos];
  const phaseNames={roll:'Navigation',offer:'Deed for sale',auction:'Live auction',trade:'Trade offer',end:'Settlement',over:'Final accounts'};
  document.body.dataset.phase=s.phase;
  $('phaseLabel').textContent=phaseNames[s.phase].toUpperCase();
  $('controlType').textContent=s.phase==='over'?'TABLE CLOSED':`${seat(a)} · ${seats[a]==='bot'?'Bot':'Local'}`;
  $('chartStatus').textContent=s.phase==='roll'?`${seat(a)} at ${t.name}`:s.phase==='auction'?`${t.name} · Auction in progress`:s.phase==='trade'?'Private negotiation':s.phase==='over'?'Port closed':`${s.dice.join(' + ')} → ${t.name}`;
  $('round').textContent = `ROUND ${String(s.round).padStart(2,'0')} / ${rules.rounds}`;
  for (const [i,tile] of rules.tiles.entries()) {
    let b = $(`tile-${i}`);
    if (!b) {
      b = document.createElement('button'); b.id=`tile-${i}`;
      const [row,col] = boardPosition(i);
      b.style.gridArea=`${row} / ${col}`;
      b.className='tile '+(tile.kind==='deed'?'deed':'special');
      b.style.setProperty('--band',bands[tile.group] || '#718373');
      b.onclick=()=>detail(i);
      $('board').append(b);
    }
    b.classList.toggle('landing',s.phase!=='over'&&i===s.players[s.turn].pos);
    const here=s.players.flatMap((player,j)=>player.pos===i&&!player.out?[j]:[]);
    b.innerHTML=`${tile.kind==='deed'?`<span class="num">Nº ${String(i).padStart(2,'0')}</span>`:`<span class="mark">${tile.mark}</span>`}<strong>${tile.name}</strong>${tile.price?`<span class="cost">${money(tile.price)}</span>`:''}${s.owners[i]!==null?`<span class="owned">●${s.owners[i]+1}</span>`:''}<span class="tokens">${here.map(j=>`<span class="token" style="background:${colors[j]}">${j+1}</span>`).join('')}</span>`;
    b.setAttribute('aria-label',`${tile.name}${here.length?', occupied by '+here.map(seat).join(', '):''}. Inspect space`);
  }
  $('register').innerHTML=s.players.map((player,i)=>{
    const owned=deeds(s,i), groups=Object.keys(bands).map(g=>{
      const count=owned.filter(k=>rules.tiles[k].group===g).length;
      return count?`<span title="${g}" style="--band:${bands[g]}">${g} ${count}/${rules.tiles.filter(t=>t.group===g).length}</span>`:'';
    }).join('');
    return `<div class="row"><span class="badge" style="background:${colors[i]}">${i+1}</span><div><strong>${seat(i)}</strong><div class="meta">${player.out?'Bankrupt':seats[i]==='bot'?'Bot':'Local player'} · ${owned.length} deeds</div><div class="holdings">${groups}</div></div><span class="money">${money(player.cash)}</span></div>`;
  }).join('');
  $('log').innerHTML=s.events.slice(-8).reverse().map(e=>`<li>${e}</li>`).join('');
  $('actions').replaceChildren();
  if(s.phase==='over'){
    $('turn').innerHTML=`<h2>${s.winners.map(seat).join(' & ')} ${s.winners.length>1?'tie':'wins'}</h2><p>Cash plus the list value of all deeds.</p>${facts(s.players.map((player,i)=>[seat(i),player.out?'Bankrupt':money(player.cash+deeds(s,i).reduce((sum,k)=>sum+rules.tiles[k].price,0))]))}`;
    const b=document.createElement('button'); b.className='primary';b.textContent=room?'Leave table':'Play again';b.onclick=room?()=>endRoom('You left the table.'):setup;$('actions').append(b);
    return;
  }
  let title, text, stats=[];
  if(s.phase==='roll'){
    title=`${seat(a)} to sail`;text=`Departing ${t.name}. ${!s.traded&&s.owners.some(o=>o!==null)?'Roll now, or negotiate before you move.':'Roll both dice to move clockwise.'}`;
  }else if(s.phase==='offer'){
    title=t.name;text=`${t.group} · Buy at list price or open the deed to every bidder.`;
    stats=[['List price',money(t.price)],['Base rent',money(t.rent)],['After buying',p.cash>=t.price?money(p.cash-t.price):'Short of cash']];
  }else if(s.phase==='auction'){
    title=t.name;text=`${seat(a)} bids next. ${s.auction.leader===null?'No bids yet.':seat(s.auction.leader)+' leads.'} Withdraw to leave this auction.`;
    stats=[['High bid',money(s.auction.high_bid)],['Your cash',money(p.cash)],['List / rent',`${money(t.price)} / ${money(t.rent)}`]];
  }else if(s.phase==='trade'){
    const d=s.trade;title=`Offer from ${seat(d.from)}`;text=`${seat(d.to)}, review both sides. Nothing changes hands unless you accept.`;
    stats=[['You receive',summary(d.give_deed,d.give_cash)],['You give',summary(d.take_deed,d.take_cash)]];
  }else{
    title=t.name;text=s.events.at(-1);
  }
  $('turn').innerHTML=`<h2>${title}</h2><p>${text}</p>${stats.length?facts(stats):''}`;
  if(seats[a]==='bot' || s.phase==='end') $('actions').innerHTML=`<small class="waiting">${s.phase==='end'?'Advancing to the next turn…':'Bot is considering the table…'}</small>`;
}
function initialize(types,map,seconds,seed) {
  rules=maps[map];clockSeconds=seconds;
  const side=rules.tiles.length/4+1;
  const board=$('board');
  board.querySelectorAll('.tile').forEach(tile=>tile.remove());
  board.style.gridTemplate=`repeat(${side},minmax(0,1fr)) / repeat(${side},minmax(0,1fr))`;
  board.querySelector('.ocean').style.gridArea=`2 / 2 / ${side} / ${side}`;
  board.dataset.map=map;
  seats=types;
  state=command({action:'start',rules,seats:types.length,seed});
}
async function play(types,map='compact',seconds=DEFAULT_CLOCK) {
  session?.abort(); session=new AbortController(); const {signal}=session;
  initialize(types,map,seconds,crypto.getRandomValues(new Uint32Array(1))[0]);
  while(!signal.aborted) {
    render();
    if(state.phase==='over') return;
    const step=new AbortController();
    const cancel=()=>step.abort();
    signal.addEventListener('abort',cancel,{once:true});
    const action=state.phase==='end'
      ? (await wait(950,step.signal),{action:'end',actor:state.turn})
      : await controllers[seats[actingSeat(state)]](state,step.signal);
    signal.removeEventListener('abort',cancel); step.abort();
    if(signal.aborted) return;
    state=command(action);
  }
}
function report(err){$('actions').replaceChildren();$('turn').textContent=`Game unavailable: ${err.message}`;console.error(err)}
function settings(){
  return `
    <label class="field">Board<select id="map"><option value="compact">Inner Harbor · 20 spaces</option><option value="outer">Outer Harbor · 28 spaces</option></select></label>
    <label class="field">Human bid clock<select id="clock"><option value="5" selected>5 seconds</option><option value="0">Untimed</option><option value="15">15 seconds</option><option value="30">30 seconds</option></select></label>`;
}
function setup(){
  if(room){roomMenu();return}
  const fields=Array.from({length:4},(_,i)=>`<label class="field">${seat(i)}<select id="seat-${i}">${(i<2?['human','bot']:['off','human','bot']).map(v=>`<option value="${v}" ${v===(seats[i]??'off')?'selected':''}>${{human:'Local player',bot:'Bot',off:'Empty'}[v]}</option>`).join('')}</select></label>`).join('');
  openDialog(`<h2>Open a new table</h2><p>Starting replaces the current game.</p>${settings()}
    <p>Each human bidder gets a fresh clock. At zero they withdraw. Hidden tabs and open dialogs pause it in local play.</p>${fields}<button id="start" class="primary">Start game</button><hr><button id="online">Play across devices</button>`);
  $('online').onclick=roomMenu;
  $('map').value=$('board').dataset.map;$('clock').value=String(clockSeconds);
  $('start').onclick=()=>{
    const types=[0,1,2,3].map(i=>$(`seat-${i}`).value).filter(v=>v!=='off');
    const map=$('map').value,seconds=Number($('clock').value);
    $('modal').close();play(types,map,seconds).catch(report);
  };
}
$('setupBtn').onclick=setup;
$('close').onclick=()=>$('modal').close();
$('modal').setAttribute('aria-label','Table information');
$('rulesBtn').onclick=()=>openDialog(`<h2>The rulebook</h2><p>Start with ${money(rules.cash)}. Roll two dice to move clockwise. Passing Port Office pays ${money(rules.salary)}.</p><h3>Buy or auction</h3><p>Buy a vacant deed at list price or send it to auction. Everyone, including the landing player, may bid. Raise by at least ${money(rules.auction_increment)} or withdraw. The last bidder pays their bid. Without a bid, the deed stays vacant.</p><h3>Negotiate before rolling</h3><p>Once per turn, propose a deed sale or swap. Either side may add cash; the other merchant can accept or decline. Owning a full district doubles its rent.</p><h3>Settle accounts</h3><p>If you cannot pay rent or a bill, your remaining cash is paid and your deeds return to market. Be the last solvent merchant, or finish round ${rules.rounds} with the greatest cash plus deed value. Ties share the win.</p>`);
try {
  const bytes=Uint8Array.from(atob($('binary').textContent),c=>c.charCodeAt(0));
  engine=(await WebAssembly.instantiate(bytes)).instance.exports;
  await play(['human','bot','bot']);
} catch(err){report(err)}
