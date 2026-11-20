// PeerJS only handles discovery and WebRTC transport. The host serializes all moves;
// guests replay accepted commands against their own copy of the seeded Rust engine.
const protocol='harbor-deeds-v1-', alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const playable=new Set(['roll','buy','pass','bid','withdraw','propose','accept','reject']);
let room=null,peerLoader=null;
function loadPeer(){
  if(!peerLoader)peerLoader=new Promise((resolve,reject)=>{
    const tag=document.createElement('script'); tag.src='./peerjs.min.js';
    tag.onload=()=>resolve(window.Peer);
    tag.onerror=()=>{peerLoader=null;reject(Error('Could not load the network client. Open the published game online.'))};
    document.head.append(tag);
  });
  return peerLoader;
}
function roomMenu(){
  if(room){
    if(room.host && room.ready && !room.started){hostLobby(room);return}
    openDialog('<h2>Network table</h2><p id="roomInfo"></p><button id="leave">Leave table</button>');
    $('roomInfo').textContent=room.started?`Table ${room.code}. Keep all devices connected.`:
      room.device?`Table ${room.code} · Device ${room.device}. Waiting for the host to start.`:'Connecting to the table…';
    $('leave').onclick=()=>endRoom('You left the table.');
    return;
  }
  openDialog(`<h2>Play across devices</h2><p>The host sets the rules and assigns up to four seats. Each device can play more than one seat. Share the code only with your players.</p>
    <button id="host" class="primary">Host table</button>
    <hr><form id="joinForm"><label class="field">Table code<input id="code" maxlength="6" minlength="6" required autocapitalize="characters" autocomplete="off"></label><button>Join table</button></form>
    <p>Uses public PeerJS signaling. Keep the host tab open. Connecting replaces your local game.</p>`);
  $('host').onclick=()=>connectRoom(true,Array.from(crypto.getRandomValues(new Uint8Array(6)),n=>alphabet[n%32]).join(''));
  $('joinForm').onsubmit=e=>{
    e.preventDefault();const code=$('code').value.trim().toUpperCase();
    if(!/^[A-HJ-NP-Z2-9]{6}$/.test(code)){
      $('code').setCustomValidity('Enter the six letters or digits from the host.');$('code').reportValidity();$('code').setCustomValidity('');return
    }
    connectRoom(false,code);
  };
}
function endRoom(reason){
  const r=room;if(!r)return;
  room=null;r.step?.abort();clearTimeout(r.timeout);r.peer?.destroy();
  document.querySelector('.live').textContent='Local table';
  $('setupBtn').textContent='＋ New table';
  play(['human','bot','bot']).catch(report);
  openDialog('<h2>Table closed</h2><p id="reason"></p><button id="retry">Multiplayer lobby</button>');
  $('reason').textContent=reason;$('retry').onclick=roomMenu;
}
function hostLobby(r){
  openDialog(`<h2>Table <span id="tableCode"></span></h2><p>Share this code. Guests choose New table → Play across devices → Join table.</p>${settings()}<div id="assign"></div><p id="roster"></p><button id="launch" class="primary">Start network game</button> <button id="leave">Close table</button>`);
  $('tableCode').textContent=r.code;
  $('map').value=r.map;$('clock').value=String(r.seconds);
  $('map').onchange=()=>r.map=$('map').value;$('clock').onchange=()=>r.seconds=Number($('clock').value);
  const ids=[...r.links.keys()];
  $('assign').innerHTML=r.slots.map((v,i)=>`<label class="field">${seat(i)}<select id="owner${i}">${[...(i<2?[]:[-2]),0,...ids,-1].map(n=>`<option value="${n}" ${v===n?'selected':''}>${n===-2?'Empty':n===-1?'Bot':n===0?'Host device':'Device '+n}</option>`).join('')}</select></label>`).join('');
  r.slots.forEach((v,i)=>$('owner'+i).onchange=e=>r.slots[i]=Number(e.target.value));
  $('roster').textContent=ids.length?`Connected: ${ids.map(i=>'Device '+i).join(', ')}. Assign each device at least one seat.`:'Waiting for another device…';
  $('launch').disabled=!ids.length;
  $('leave').onclick=()=>endRoom('The host closed the table.');
  $('launch').onclick=()=>{
    const owners=r.slots.filter(v=>v!==-2);
    if(ids.some(id=>!owners.includes(id))){$('roster').textContent='Assign at least one seat to every connected guest.';return}
    const config={owners,map:r.map,seconds:r.seconds,seed:crypto.getRandomValues(new Uint32Array(1))[0]};
    broadcast(r,{kind:'start',config});startNetwork(r,config);
  };
}
async function connectRoom(host,code){
  if(room)return;
  session?.abort();
  const r=room={host,code,device:0,links:new Map(),slots:[0,-1,-2,-2],map:$('board').dataset.map,seconds:clockSeconds,seq:0};
  $('setupBtn').textContent='Network table';document.querySelector('.live').textContent=`Table ${code}`;
  $('actions').replaceChildren();roomMenu();
  const fail=msg=>{if(room===r)endRoom(msg)};
  r.timeout=setTimeout(()=>fail('Connection timed out. Check the code and try a different network.'),25000);
  try{
    const Peer=await loadPeer();if(room!==r)return;
    r.peer=host?new Peer(protocol+code):new Peer();
    r.peer.on('error',e=>fail(`Connection error (${e.type}). Check the code, or try hosting a new table.`));
    r.peer.on('disconnected',()=>{if(!r.started)fail('The signaling service disconnected. Try again.')});
    r.peer.on('open',()=>{
      if(room!==r)return;
      if(host){
        clearTimeout(r.timeout);r.ready=true;hostLobby(r);return;
      }
      const link=r.peer.connect(protocol+code,{reliable:true,serialization:'json'});r.link=link;
      link.on('close',()=>fail('The host disconnected. This game has ended.'));
      link.on('error',()=>fail('The connection to the host failed.'));
      link.on('data',msg=>{
        if(room!==r)return;
        try{
          if(!msg||typeof msg!=='object')throw Error('Invalid message');
          if(msg.kind==='closed'){fail('This table is full or already playing.');return}
          if(msg.kind==='welcome'&&!r.device&&[1,2,3].includes(msg.device)){
            r.device=msg.device;clearTimeout(r.timeout);roomMenu();
          }else if(msg.kind==='start'&&r.device&&!r.started){startNetwork(r,msg.config)}
          else if(msg.kind==='commit'&&r.started&&msg.seq===r.seq+1&&(playable.has(msg.move?.action)||msg.move?.action==='end')){
            state=command(msg.move);r.seq++;networkStep(r);
          }else if(msg.kind==='reject'&&msg.seq===r.seq){networkStep(r)}
          else throw Error('Out-of-order or incompatible host message');
        }catch(e){fail(`Could not synchronize: ${e.message}`)}
      });
    });
    r.peer.on('connection',link=>{
      if(!host){link.close();return}
      let id;
      link.on('open',()=>{
        if(room!==r||r.started||r.links.size>=3){link.send({kind:'closed'});setTimeout(()=>link.close(),150);return}
        id=[1,2,3].find(i=>!r.links.has(i));r.links.set(id,link);
        const available=r.slots.findIndex(v=>v===-1||v===-2);if(available!==-1)r.slots[available]=id;
        link.send({kind:'welcome',device:id});hostLobby(r);
      });
      link.on('data',msg=>{
        if(room===r&&r.started&&r.links.get(id)===link&&msg?.kind==='intent'&&msg.seq===r.seq)
          acceptMove(r,id,msg.move);
      });
      const lost=()=>{
        if(room!==r||r.links.get(id)!==link)return;
        r.links.delete(id);
        if(r.started){fail(`Device ${id} disconnected. This game has ended.`);return}
        r.slots=r.slots.map((v,i)=>v===id?(i<2?-1:-2):v);hostLobby(r);
      };
      link.on('close',lost);link.on('error',lost);
    });
  }catch(e){fail(e.message)}
}
function broadcast(r,msg){for(const link of r.links.values())link.send(msg)}
function startNetwork(r,c){
  if(!c||!['compact','outer'].includes(c.map)||![0,5,15,30].includes(c.seconds)||
     !Number.isInteger(c.seed)||c.seed<0||c.seed>0xffffffff||!Array.isArray(c.owners)||
     c.owners.length<2||c.owners.length>4||!c.owners.every(n=>[-1,0,1,2,3].includes(n))||
     (!r.host&&!c.owners.includes(r.device)))throw Error('Invalid host settings');
  r.started=true;r.owners=c.owners;
  initialize(c.owners.map(n=>n<0?'bot':'human'),c.map,c.seconds,c.seed);
  $('modal').close();networkStep(r);
}
function commit(r,move){
  state=command(move);r.seq++;
  broadcast(r,{kind:'commit',seq:r.seq,move});
  networkStep(r);
}
function acceptMove(r,device,move){
  const actor=actingSeat(state);
  if(!playable.has(move?.action)||move.actor!==actor||r.owners[actor]!==device||state.phase==='over'||state.phase==='end')return;
  if(r.deadline&&performance.now()>=r.deadline){commit(r,{action:'withdraw',actor});return}
  try{commit(r,move)}catch(e){
    if(device>0)r.links.get(device)?.send({kind:'reject',seq:r.seq});
    else endRoom(`Could not apply move: ${e.message}`);
  }
}
function networkStep(r){
  r.step?.abort();r.step=new AbortController();
  const {signal}=r.step,seq=r.seq,actor=actingSeat(state),owner=r.owners[actor];
  if($('contract')&&$('modal').open)$('modal').close();
  render();r.deadline=0;
  if(state.phase==='over')return;
  const deviceName=n=>n<0?'Bot':n===r.device?'This device':n===0?'Host':`Device ${n}`;
  $('controlType').textContent=`${seat(actor)} · ${deviceName(owner)}`;
  if(state.phase==='end'||owner===-1){
    if(r.host)wait(state.phase==='end'?950:850,signal).then(()=>{
      if(!signal.aborted)commit(r,state.phase==='end'?{action:'end',actor:state.turn}:botMove(state,rules));
    });
    return;
  }
  if(owner===r.device){
    controllers.human(state,signal).then(move=>{
      if(!move||signal.aborted)return;
      if(r.host)acceptMove(r,0,move);
      else {r.link.send({kind:'intent',seq,move});$('actions').textContent='Waiting for host…'}
    });
  }else $('actions').textContent=`Waiting for ${deviceName(owner)}…`;
  if(state.phase==='auction'&&clockSeconds){
    r.deadline=performance.now()+clockSeconds*1000;
    const display=document.createElement('span');display.className='bidClock';display.setAttribute('role','timer');$('actions').prepend(display);
    const tick=()=>{
      const ms=r.deadline-performance.now();
      display.textContent=`Host bid clock · ${Math.max(0,Math.ceil(ms/1000))}s`;
      if(r.host&&ms<=0)commit(r,{action:'withdraw',actor});
    };
    const timer=setInterval(tick,100);signal.addEventListener('abort',()=>clearInterval(timer),{once:true});tick();
  }
}
