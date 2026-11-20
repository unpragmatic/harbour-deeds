// PeerJS only handles discovery and WebRTC transport. The host serializes all moves;
// guests replay accepted commands against their own copy of the seeded Rust engine.
const protocol='harbor-deeds-v4-', alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const saveKey='harbor-deeds.table.v2', codePattern=/^[A-HJ-NP-Z2-9]{6}$/;
const playable=new Set(['roll','buy','pass','bid','withdraw','propose','accept','reject','build','grant','insure','sell','commission','skip','salvage','bankrupt']);
let room=null,peerLoader=null;
function readTable(){
  const raw=localStorage.getItem(saveKey);if(raw===null)return null;
  const s=JSON.parse(raw);
  if(!s||!codePattern.test(s.code)||!['host','guest'].includes(s.role))throw Error('Unreadable table save');
  return s;
}
function savedTableButton(){
  try{
    const s=readTable();return s?`<button id="savedTable">${s.role==='host'?'Rehost':'Rejoin'} table ${s.code}</button>`:'';
  }catch{return '<button id="savedTable">Review unavailable save</button>'}
}
function bindSavedTableButton(){
  if($('savedTable'))$('savedTable').onclick=promptSavedTable;
}
function withTableLock(fn){
  if(!navigator.locks)throw Error('Online recovery requires HTTPS or localhost and a browser with Web Locks.');
  return navigator.locks.request(saveKey,{ifAvailable:true},lock=>{
    if(!lock)throw Error('This browser already has an active network tab. Close that tab before retrying.');
    return fn();
  });
}
function promptSavedTable(){
  if(room)return;
  let s,unreadable=false;
  try{s=readTable()}catch{unreadable=true}
  if(!s&&!unreadable)return;
  openDialog(`<h2>${s?'Saved network table':'Save unavailable'}</h2><p id="resumeInfo"></p>
    ${s?`<button id="resumeTable" class="primary">${s.role==='host'?'Rehost':'Rejoin'} table ${s.code}</button>`:''}
    <button id="forgetTable">Forget on this browser</button>`);
  $('resumeInfo').textContent=!s?'Browser storage is unavailable or the table save is unreadable.':
    s.role==='host'?'Restore the match under the same code. Ask each guest to rejoin from their original browser.':
    `Device ${s.device}: wait for the original host to rehost, then rejoin to recover your assigned seats.`;
  if(s)$('resumeTable').onclick=()=>connectRoom(s.role==='host',s.code,true);
  $('forgetTable').onclick=async()=>{
    if(!confirm('Forget this table here? Your host save or reserved seats cannot be recovered.'))return;
    try{await withTableLock(()=>localStorage.removeItem(saveKey));setup()}catch(e){$('resumeInfo').textContent=e.message}
  };
}
const randomHex=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
const validKey=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
// On rejoin neither side transmits its saved secret to an unverified peer ID.
async function proof(secret,role,code,id,guestNonce,hostNonce){
  const bytes=new TextEncoder(),key=await crypto.subtle.importKey('raw',bytes.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const mac=await crypto.subtle.sign('HMAC',key,bytes.encode([role,code,id,guestNonce,hostNonce].join(':')));
  return Array.from(new Uint8Array(mac),n=>n.toString(16).padStart(2,'0')).join('');
}
function loadPeer(){
  if(!peerLoader)peerLoader=new Promise((resolve,reject)=>{
    const tag=document.createElement('script'); tag.src='./peerjs.min.js';
    tag.onload=()=>resolve(window.Peer);
    tag.onerror=()=>{peerLoader=null;reject(Error('Could not load the network client. Open the published game online.'))};
    document.head.append(tag);
  });
  return peerLoader;
}
function hostRoom(){connectRoom(true,Array.from(crypto.getRandomValues(new Uint8Array(6)),n=>alphabet[n%32]).join(''))}
function roomMenu(joinOnly=false){
  if(room){
    if(room.host && room.ready && !room.started){hostLobby(room);return}
    openDialog('<h2>Network table</h2><p id="roomInfo"></p><button id="leave">Leave table</button>');
    $('roomInfo').textContent=room.started?`Table ${room.code}. Keep all devices connected.`:
      room.device?`Table ${room.code} · Device ${room.device}. Waiting for the host to start.`:'Connecting to the table…';
    if(room.resuming&&!room.ready&&!room.started){
      $('leave').textContent='Cancel reconnect';
      $('leave').onclick=()=>finishRoom(room,'Reconnect cancelled. The saved table is still available.');
    }else $('leave').onclick=()=>{if(!room.started||confirm('Leave and end this match for everyone?'))endRoom('You left the table.')};
    return;
  }
  openDialog(`<h2>Join a table</h2><p>Enter the six-character code from your host.</p>
    <form id="joinForm"><label class="field">Table code<input id="code" maxlength="6" minlength="6" required autocapitalize="characters" autocomplete="off" spellcheck="false"></label><button class="primary">Join table</button></form>
    ${joinOnly?'':'<hr><button id="host">Host instead</button>'}`);
  if($('host'))$('host').onclick=hostRoom;
  $('code').focus();
  $('joinForm').onsubmit=e=>{
    e.preventDefault();const code=$('code').value.trim().toUpperCase();
    if(!/^[A-HJ-NP-Z2-9]{6}$/.test(code)){
      $('code').setCustomValidity('Enter the six letters or digits from the host.');$('code').reportValidity();$('code').setCustomValidity('');return
    }
    connectRoom(false,code);
  };
}
function finishRoom(r,reason,{forget=false,notify=false}={}){
  if(room!==r)return;
  room=null;r.step?.abort();clearTimeout(r.timeout);
  if(forget&&r.hasSave)try{localStorage.removeItem(saveKey)}catch{reason+=' Could not clear browser storage.'}
  if(notify){broadcast(r,{kind:'ended'});setTimeout(()=>r.peer?.destroy(),350)}else r.peer?.destroy();
  r.unlock?.();
  document.querySelector('.live').textContent='Local table';
  $('setupBtn').textContent='New table';
  play(['human','bot','bot']).catch(report);
  openDialog(`<h2>Network table</h2><p id="reason"></p>${savedTableButton()} <button id="retry">Table setup</button>`);
  $('reason').textContent=reason;$('retry').onclick=setup;bindSavedTableButton();
}
function endRoom(reason){
  const r=room;if(!r)return;
  if(!r.host&&r.started&&r.link?.open){
    r.step?.abort();r.leaving=true;$('actions').textContent='Waiting for the host to confirm leave…';
    r.link.send({kind:'leave'});
    clearTimeout(r.timeout);r.timeout=setTimeout(()=>finishRoom(r,'Leave not confirmed. Rejoin to check whether the host ended the match.'),10000);return;
  }
  finishRoom(r,reason,{forget:true,notify:r.host});
}
function hostLobby(r){
  openDialog(`<h2>Invite players</h2><div class="invite"><strong id="tableCode"></strong><button id="copyCode">Copy code</button></div><p>Guests choose New table → Join online. Keep this tab open.</p>${settings()}<div id="assign"></div><p id="roster"></p><button id="launch" class="primary">Start network game</button> <button id="leave">Close table</button>`);
  $('tableCode').textContent=r.code;
  $('copyCode').onclick=async e=>{const btn=e.currentTarget;try{await navigator.clipboard.writeText(r.code);btn.textContent='Copied'}catch{btn.textContent='Select code to copy';const range=document.createRange();range.selectNodeContents($('tableCode'));const sel=getSelection();sel.removeAllRanges();sel.addRange(range)}};
  $('map').value=r.map;$('clock').value=String(r.seconds);
  $('policy').value=r.policy??rules.development.policy;$('policy').onchange=()=>r.policy=$('policy').value;
  $('map').onchange=()=>r.map=$('map').value;$('clock').onchange=()=>r.seconds=Number($('clock').value);
  const chosen=charterControls(r.charter??charterOf(rules),c=>r.charter=c);
  const ids=[...r.links.keys()];
  $('assign').innerHTML=r.slots.map((v,i)=>`<label class="field">${seat(i)}<select id="owner${i}">${[...(i<2?[]:[-2]),0,...ids,-1].map(n=>`<option value="${n}" ${v===n?'selected':''}>${n===-2?'Empty':n===-1?'Bot':n===0?'Host device':'Device '+n}</option>`).join('')}</select></label>`).join('');
  r.slots.forEach((v,i)=>$('owner'+i).onchange=e=>r.slots[i]=Number(e.target.value));
  $('roster').textContent=ids.length?`Connected: ${ids.map(i=>'Device '+i).join(', ')}. Assign each device at least one seat.`:'Waiting for another device…';
  $('launch').disabled=!ids.length||ids.some(id=>!r.enrolled.has(id));
  $('leave').onclick=()=>endRoom('The host closed the table.');
  $('launch').onclick=()=>{
    const owners=r.slots.filter(v=>v!==-2);
    if(ids.some(id=>!owners.includes(id))){$('roster').textContent='Assign at least one seat to every connected guest.';return}
    const charter=chosen();if(!charter)return;
    const config={owners,map:r.map,edition:currentEdition,charter,seconds:r.seconds,policy:$('policy').value,seed:crypto.getRandomValues(new Uint32Array(1))[0]};
    try{
      r.save={role:'host',code:r.code,config,keys:r.keys,journal:[],remaining:config.seconds*1000};
      persist(r);startNetwork(r,config);for(const link of r.links.values())sendReplay(r,link);
      hostStatus(r);
    }catch(e){finishRoom(r,`Could not start: ${e.message}`)}
  };
}
function persist(r){
  localStorage.setItem(saveKey,JSON.stringify(r.save));r.hasSave=true;
}
function remaining(r){return r.deadline?Math.max(0,r.deadline-performance.now()):r.remaining}
function hostStatus(r){
  if(room!==r||!r.started)return;
  const missing=[...new Set(r.owners.filter(id=>id>0&&!r.synced.has(id)))];
  r.remaining=remaining(r);r.deadline=0;r.missing=missing;
  r.save.remaining=r.remaining;
  try{persist(r)}catch{finishRoom(r,'Cannot save the clock. Free browser storage, then rehost the last saved turn.');return}
  broadcast(r,{kind:'status',seq:r.seq,missing,remaining:r.remaining});networkStep(r);
}
function sendReplay(r,link){
  const journal=r.save.journal;
  link.send({kind:'start',config:r.save.config,count:journal.length});
  for(let i=0;i<journal.length;i+=40)link.send({kind:'replay',moves:journal.slice(i,i+40)});
  link.send({kind:'caughtUp',seq:r.seq});
}
async function connectRoom(host,code,resume=false){
  if(room)return;
  session?.abort();
  const r=room={host,code,resuming:resume,device:0,links:new Map(),enrolled:new Set(),synced:new Set(),keys:{},slots:[0,-1,-2,-2],map:$('board').dataset.map,seconds:clockSeconds,seq:0,missing:[]};
  $('setupBtn').textContent='Network table';document.querySelector('.live').textContent=`Table ${code}`;
  $('actions').replaceChildren();roomMenu();
  const fail=msg=>{if(room===r)finishRoom(r,msg)};
  r.timeout=setTimeout(()=>fail('Connection timed out. Check the code and try a different network.'),25000);
  try{
    await new Promise((ok,no)=>withTableLock(()=>new Promise(release=>{r.unlock=release;ok()})).catch(no));
    if(room!==r){r.unlock();return}
    const saved=readTable();
    if(saved&&!resume){fail('Resume or forget your saved table before starting another online match.');return}
    if(resume){
      if(!saved||saved.code!==code||saved.role!==(host?'host':'guest'))throw Error('Table save changed. Reopen table setup.');
      r.save=saved;r.hasSave=true;
      if(host){
        if(!Array.isArray(saved.journal)||!saved.config.owners.every(id=>id<=0||validKey(saved.keys[id])))throw Error('Invalid host save');
        r.keys=saved.keys;startNetwork(r,saved.config);
        for(const move of saved.journal)replay(r,move);
        r.remaining=Math.max(0,Math.min(saved.remaining??r.remaining,r.seconds*1000));
      }else{
        if(!validKey(saved.key)||![1,2,3].includes(saved.device))throw Error('Invalid device save');
        r.device=saved.device;
      }
    }else{
      // Refuse to seat anyone when storage is disabled.
      localStorage.setItem(saveKey+'.probe','1');localStorage.removeItem(saveKey+'.probe');
    }
    const Peer=await loadPeer();if(room!==r)return;
    r.peer=host?new Peer(protocol+code):new Peer();
    r.peer.on('error',e=>fail(`Connection error (${e.type}). ${resume?'Check the original host/code, close any old host tab and retry the saved table shortly.':'Check the code and try again.'}`));
    r.peer.on('disconnected',()=>fail('The signaling service disconnected. Reconnect and retry.'));
    r.peer.on('open',()=>{
      if(room!==r)return;
      if(host){
        clearTimeout(r.timeout);r.ready=true;
        if(r.started)hostStatus(r);else hostLobby(r);return;
      }
      const link=r.peer.connect(protocol+code,{reliable:true,serialization:'json'});r.link=link;
      const nonce=randomHex();let authenticated=false;
      link.on('open',()=>link.send(resume?{kind:'hello',id:r.device,nonce}:{kind:'join'}));
      link.on('close',()=>fail('Host disconnected. Wait for the original host to rehost, then rejoin.'));
      link.on('error',()=>fail('The connection to the host failed.'));
      link.on('data',async msg=>{
        if(room!==r)return;
        try{
          if(!msg||typeof msg!=='object')throw Error('Invalid message');
          if(msg.kind==='closed'){fail('This table is unavailable, or this device is already connected.');return}
          if(resume&&!authenticated&&msg.kind==='challenge'&&validKey(msg.nonce)){
            const args=[code,r.device,nonce,msg.nonce];
            if(msg.mac!==await proof(r.save.key,'host',...args))throw Error('Host identity did not match');
            authenticated=true;link.send({kind:'proof',mac:await proof(r.save.key,'guest',...args)});return;
          }
          if(!resume&&!authenticated&&msg.kind==='welcome'&&[1,2,3].includes(msg.device)&&validKey(msg.key)){
            r.device=msg.device;r.save={role:'guest',code,device:r.device,key:msg.key};persist(r);
            authenticated=true;clearTimeout(r.timeout);link.send({kind:'enrolled'});roomMenu();return;
          }
          if(!authenticated)throw Error('Unverified host');
          if(msg.kind==='ended'){finishRoom(r,'The host or a device deliberately ended the table.',{forget:true});return}
          if(msg.kind==='start'&&!r.started&&Number.isSafeInteger(msg.count)&&msg.count>=0){
            r.count=msg.count;startNetwork(r,msg.config);
          }else if(msg.kind==='replay'&&r.count!==undefined&&Array.isArray(msg.moves)&&msg.moves.length<=40){
            for(const move of msg.moves)replay(r,move);
          }else if(msg.kind==='caughtUp'&&msg.seq===r.seq&&r.count===r.seq){
            delete r.count;clearTimeout(r.timeout);link.send({kind:'ready',seq:r.seq});
          }else if(msg.kind==='status'&&r.started&&msg.seq===r.seq&&Array.isArray(msg.missing)&&Number.isFinite(msg.remaining)){
            r.missing=msg.missing;r.remaining=msg.remaining;r.deadline=0;networkStep(r);
          }else if(msg.kind==='commit'&&r.started&&msg.seq===r.seq+1){
            const before=state;replay(r,msg.move);r.remaining=r.seconds*1000;r.deadline=0;networkStep(r);liveFeedback(msg.move,before,state);
          }else if(msg.kind==='reject'&&msg.seq===r.seq){r.remaining=remaining(r);networkStep(r)}
          else throw Error('Out-of-order or incompatible host message');
        }catch(e){fail(`Could not synchronize: ${e.message}`)}
      });
    });
    r.peer.on('connection',link=>{
      if(!host){link.close();return}
      let id,challenge;
      const deny=()=>{link.send({kind:'closed'});setTimeout(()=>link.close(),150)};
      const handshake=setTimeout(()=>{if(!id)link.close()},15000);
      link.on('data',async msg=>{
        if(room!==r)return;
        if(!id){
          if(msg?.kind==='join'&&!r.started&&r.links.size<3){
            id=[1,2,3].find(i=>!r.links.has(i));r.links.set(id,link);r.keys[id]=randomHex();
            const available=r.slots.findIndex(v=>v===-1||v===-2);if(available!==-1)r.slots[available]=id;
            link.send({kind:'welcome',device:id,key:r.keys[id]});clearTimeout(handshake);hostLobby(r);return;
          }
          if(msg?.kind==='hello'&&!challenge&&r.started&&[1,2,3].includes(msg.id)&&validKey(msg.nonce)&&r.owners.includes(msg.id)&&!r.links.has(msg.id)){
            const n=randomHex(),args=[code,msg.id,msg.nonce,n];
            challenge={id:msg.id};
            challenge.expected=await proof(r.keys[msg.id],'guest',...args);
            link.send({kind:'challenge',nonce:n,mac:await proof(r.keys[msg.id],'host',...args)});return;
          }
          if(msg?.kind==='proof'&&validKey(msg.mac)&&msg.mac===challenge?.expected&&!r.links.has(challenge.id)){
            id=challenge.id;r.links.set(id,link);clearTimeout(handshake);sendReplay(r,link);return;
          }
          deny();return;
        }
        if(r.links.get(id)!==link)return;
        if(!r.started){if(msg?.kind==='enrolled'&&!r.enrolled.has(id)){r.enrolled.add(id);hostLobby(r)}return}
        if(msg?.kind==='leave'){finishRoom(r,`Device ${id} deliberately left the table.`,{forget:true,notify:true});return}
        if(msg?.kind==='ready'&&msg.seq===r.seq&&!r.synced.has(id)){r.synced.add(id);hostStatus(r);return}
        if(msg?.kind==='intent'&&msg.seq===r.seq&&!r.missing.length)acceptMove(r,id,msg.move);
      });
      const lost=()=>{
        clearTimeout(handshake);if(room!==r||r.links.get(id)!==link)return;
        r.links.delete(id);
        if(r.started){r.synced.delete(id);hostStatus(r);return}
        delete r.keys[id];r.enrolled.delete(id);
        r.slots=r.slots.map((v,i)=>v===id?(i<2?-1:-2):v);hostLobby(r);
      };
      link.on('close',lost);link.on('error',lost);
    });
  }catch(e){fail(e.message)}
}
function broadcast(r,msg){for(const link of r.links.values())link.send(msg)}
function startNetwork(r,c){
  if(!c||![undefined,'dockworks-1',currentEdition].includes(c.edition)||(c.edition===currentEdition?!validCharter(c.charter):c.charter!==undefined)||!Object.hasOwn(maps,c.map)||!(c.policy===undefined||['even','district','free'].includes(c.policy))||![0,5,15,30].includes(c.seconds)||
     !Number.isInteger(c.seed)||c.seed<0||c.seed>0xffffffff||!Array.isArray(c.owners)||
     c.owners.length<2||c.owners.length>4||!c.owners.every(n=>[-1,0,1,2,3].includes(n))||
     (!r.host&&!c.owners.includes(r.device)))throw Error('Invalid host settings');
  r.started=true;r.owners=c.owners;r.seconds=c.seconds;r.remaining=c.seconds*1000;
  initialize(c.owners.map(n=>n<0?'bot':'human'),c.map,c.seconds,c.seed,c.policy,c.edition??'launch',c.charter);
  $('modal').close();
}
function replay(r,move){
  if(!(playable.has(move?.action)||move?.action==='end'))throw Error('Invalid journal command');
  state=command(move);r.seq++;
}
function commit(r,move){
  const before=state;state=command(move);
  r.save.journal.push(move);r.save.remaining=r.remaining=r.seconds*1000;r.deadline=0;
  // A move becomes visible to players only after the atomic storage write succeeds.
  try{persist(r)}catch{finishRoom(r,'Move not recorded. Free browser storage and rehost the last saved turn.');return}
  r.seq++;
  broadcast(r,{kind:'commit',seq:r.seq,move});
  networkStep(r);
  liveFeedback(move,before,state);
}
function acceptMove(r,device,move){
  const actor=actingSeat(state);
  if(r.missing.length||!playable.has(move?.action)||move.actor!==actor||r.owners[actor]!==device||state.phase==='over'||state.phase==='end')return;
  const fields=move.action==='propose'?['to','give_deed','take_deed','give_cash','take_cash']:move.action==='bid'?['amount']:['build','sell','commission','salvage'].includes(move.action)?['tile']:[];
  if(fields.some(k=>!Number.isSafeInteger(move[k])&&!(k.endsWith('_deed')&&move[k]===null))){
    r.links.get(device)?.send({kind:'reject',seq:r.seq});return;
  }
  move=Object.fromEntries(['action','actor',...fields].map(k=>[k,move[k]]));
  if(r.deadline&&performance.now()>=r.deadline){commit(r,{action:'withdraw',actor});return}
  try{commit(r,move)}catch(e){
    if(device>0)r.links.get(device)?.send({kind:'reject',seq:r.seq});
    else {r.remaining=remaining(r);networkStep(r)}
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
  const timed=state.phase==='auction'&&clockSeconds&&owner>=0;
  if(r.missing.length){
    $('actions').textContent=`Table paused · Waiting for ${r.missing.map(n=>'Device '+n).join(', ')} to rejoin from the original browser.`;
    if(timed){
      const meter=makeBidMeter('Host bid clock',clockSeconds*1000);
      $('actions').prepend(meter.element);meter.update(r.remaining,true);
    }
    return;
  }
  if(r.leaving){$('actions').textContent='Waiting for leave confirmation…';return}
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
  if(timed){
    r.deadline=performance.now()+r.remaining;
    const meter=makeBidMeter('Host bid clock',clockSeconds*1000);$('actions').prepend(meter.element);
    const tick=()=>{
      const ms=r.deadline-performance.now();
      meter.update(ms);
      if(r.host&&ms<=0)commit(r,{action:'withdraw',actor});
    };
    const timer=setInterval(tick,100);signal.addEventListener('abort',()=>clearInterval(timer),{once:true});tick();
  }
  window.addEventListener('pagehide',()=>{
    const r=room;if(!r)return;
    if(r.host&&r.started&&r.hasSave&&r.deadline){
      r.save.remaining=remaining(r);try{persist(r)}catch{/* previous journal remains intact */}
    }
    room=null;r.step?.abort();clearTimeout(r.timeout);r.peer?.destroy();r.unlock?.();
  });
  window.addEventListener('pageshow',e=>{if(e.persisted&&!room&&$('setupBtn').textContent==='Network table')location.reload()});
}
