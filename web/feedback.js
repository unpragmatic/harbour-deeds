// Presentation only: live accepted moves call this, journal replay never does.
const motifs={dice:[170,250,195],coin:[660,880],build:[245,330,490],bid:[475],gavel:[190,135],down:[315,240],paper:[410,490],bell:[550,825],final:[392,494,587,784]};
let audio, sound=false, cueTimer;
function refreshSound(){
  const b=document.getElementById('soundBtn');
  b.textContent=sound?'♪ On':'♪ Off';b.setAttribute('aria-pressed',String(sound));
}
function initFeedback(){
  try{sound=localStorage.getItem('harbor-sound')==='on'}catch{/* storage optional */}
  refreshSound();
  const unlock=()=>{
    if(!sound)return;
    try{
      audio??=new AudioContext();
      if(audio.state==='suspended')audio.resume().catch(()=>{sound=false;refreshSound()});
    }catch{sound=false;refreshSound();document.getElementById('soundBtn').title='Audio unavailable in this browser'}
  };
  document.addEventListener('pointerdown',unlock);document.addEventListener('keydown',unlock);
  document.getElementById('soundBtn').onclick=()=>{
    sound=!sound;unlock();refreshSound();
    try{localStorage.setItem('harbor-sound',sound?'on':'off')}catch{/* session preference still works */}
    tone('bell');
  };
}
function tone(kind){
  if(!sound||audio?.state!=='running'||document.hidden)return;
  for(const [i,hz] of (motifs[kind]||[]).entries()){
    const o=audio.createOscillator(),v=audio.createGain(),t=audio.currentTime+i*.065;
    o.type=kind==='dice'||kind==='gavel'?'triangle':'sine';o.frequency.value=hz;
    v.gain.setValueAtTime(.0001,t);v.gain.exponentialRampToValueAtTime(.055,t+.009);v.gain.exponentialRampToValueAtTime(.0001,t+.12);
    o.connect(v);v.connect(audio.destination);o.start(t);o.stop(t+.13);o.onended=()=>{o.disconnect();v.disconnect()};
  }
}
function liveFeedback(move,before,after){
  const action=move.action,entry=uxInventory.commands[action],actor=move.actor;
  let cue=entry[2],label=entry[0],tile=move.tile??before.auction?.tile??after.players[actor]?.pos;
  if(after.phase==='over'){cue='final';label='Final accounts settled'}
  else if(action==='roll'){
    const delta=after.players[actor].cash-before.players[actor].cash;
    label=`Rolled ${after.dice.join(' + ')}${delta?` · ${delta>0?'+':'−'}${money(Math.abs(delta))}`:''}`;
    if(after.last_card!=null){label+=` · ${rules.cards[after.last_card].title}`;cue='paper'}
  }else if(action==='buy'){label=`Deed purchased · ${rules.tiles[tile].name}`}
  else if(action==='bid'){label=`Bid placed · ${money(move.amount)}`}
  else if(action==='build'){label=`${rules.tiles[tile].name} · level ${after.levels[tile]}`}
  else if(action==='withdraw'&&!after.auction){label=before.auction.leader===null?'Auction closed · no sale':`Sold for ${money(before.auction.high_bid)}`;cue='gavel'}
  if(cue==='quiet')return;
  tone(cue);
  const receipt=document.getElementById('receipt');
  receipt.textContent=label;receipt.hidden=false;
  clearTimeout(cueTimer);cueTimer=setTimeout(()=>receipt.hidden=true,1450);
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
    receipt.animate?.([{opacity:.3,transform:'translateY(3px)'},{opacity:1,transform:'none'}],{duration:160});
    document.getElementById(`tile-${tile}`)?.animate?.([{boxShadow:'inset 0 0 0 4px #d39732'},{boxShadow:'inset 0 0 0 1px transparent'}],{duration:460});
  }
}
