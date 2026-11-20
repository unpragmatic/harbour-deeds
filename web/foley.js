// All sound is synthesized on this device. No samples, timers or RNG in the engine.
let audio, bus, felt, sound=true;
const voices=new Set();
function stopFoley(){
  // Cancel the scheduled dock as well as sounds that are already playing.
  for(const source of voices)source.stop();voices.clear();
}
function soundButton(){
  const b=$('soundBtn');b.textContent=sound?'♪ On':'♪ Off';b.setAttribute('aria-pressed',String(sound));
}
function unlockSound(){
  if(!sound)return;
  if(!audio){
    const Context=window.AudioContext||window.webkitAudioContext;
    if(!Context){sound=false;soundButton();$('soundBtn').disabled=true;$('soundBtn').title='Audio unavailable';return}
    try{audio=new Context()}catch{sound=false;soundButton();$('soundBtn').disabled=true;return}
    bus=audio.createGain();bus.gain.value=.45;bus.connect(audio.destination);
    felt=audio.createBuffer(1,Math.ceil(audio.sampleRate*.2),audio.sampleRate);
    let seed=97;
    const data=felt.getChannelData(0);
    for(let i=0;i<data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data[i]=seed/2147483648-1}
  }
  bus.gain.value=.45;
  if(audio.state==='suspended')audio.resume().catch(e=>console.warn('Could not unlock table sound:',e));
}
function initSound(){
  try{sound=localStorage.getItem('harbor-sound')!=='off'}catch(e){console.warn('Sound preference unavailable:',e)}
  soundButton();
  for(const event of ['pointerdown','keydown'])document.addEventListener(event,unlockSound);
  $('soundBtn').onclick=()=>{
    sound=!sound;
    if(sound){unlockSound();if(audio)audio.resume().then(()=>foley('bell')).catch(e=>console.warn('Audio unavailable:',e))}
    else if(bus){stopFoley();bus.gain.value=0}
    soundButton();
    try{localStorage.setItem('harbor-sound',sound?'on':'off')}catch(e){console.warn('Could not save sound preference:',e)}
  };
}
function foley(kind,delayMs=0){
  if(!sound||audio?.state!=='running'||document.hidden)return;
  const t=audio.currentTime+delayMs/1000;
  function strike(type,from,to,delay,length,gain){
    const at=t+delay,v=audio.createGain(),noise=type==='noise';
    const source=noise?audio.createBufferSource():audio.createOscillator();
    const filter=noise?audio.createBiquadFilter():null;
    if(noise){
      source.buffer=felt;filter.type='bandpass';filter.Q.value=.75;
      filter.frequency.value=from;source.connect(filter);filter.connect(v);
    }else{
      source.type=type;source.frequency.setValueAtTime(from,at);
      source.frequency.exponentialRampToValueAtTime(to,at+length);source.connect(v);
    }
    v.gain.setValueAtTime(.0001,at);v.gain.exponentialRampToValueAtTime(gain,at+.004);
    v.gain.exponentialRampToValueAtTime(.0001,at+length);
    v.connect(bus);voices.add(source);source.start(at);source.stop(at+length+.002);
    source.onended=()=>{voices.delete(source);source.disconnect();filter?.disconnect();v.disconnect()};
  }
  const knock=(at,power,pitch)=>{strike('triangle',pitch,pitch*.45,at,.09,power);strike('noise',1400,0,at,.055,power*.9)};
  const chime=(at,pitch)=>{strike('sine',pitch,pitch*.992,at,.22,.14);strike('sine',pitch*2.7,pitch*2.69,at,.09,.045)};
  switch(kind){
    case 'dice': [0,.048,.12,.235,.355].forEach((at,i)=>knock(at,.23-i*.023,460-i*44));break;
    case 'cast': [0,.1,.24,.42,.56,.67,.75].forEach((at,i)=>knock(at,.21-i*.016,510-i*38));break;
    case 'depart': strike('noise',780,0,0,.19,.12);break;
    case 'dock': strike('noise',820,0,0,.17,.19);knock(.035,.21,186);chime(.12,587);break;
    case 'file': strike('noise',2100,0,0,.16,.22);knock(.14,.28,290);chime(.21,988);break;
    case 'sale': strike('noise',1650,0,0,.12,.22);knock(.08,.2,330);chime(.15,1175);chime(.24,880);break;
    case 'sold': knock(0,.35,210);strike('sine',119,78,.015,.19,.19);chime(.16,740);break;
    case 'noSale': knock(0,.22,275);knock(.19,.13,185);break;
    case 'district': [523,659,784].forEach((p,i)=>chime(i*.075,p));break;
    case 'gavel': knock(0,.35,240);knock(.125,.14,170);break;
    case 'build': knock(0,.25,290);knock(.11,.29,230);chime(.24,660);break;
    case 'paper': strike('noise',2500,0,0,.14,.27);knock(.12,.16,280);break;
    case 'coin': chime(0,1046);chime(.095,1396);break;
    case 'bid': knock(0,.16,520);chime(.038,740);break;
    case 'down': strike('triangle',350,145,0,.17,.22);break;
    case 'final': [392,494,587,784].forEach((n,i)=>chime(i*.09,n));break;
    case 'bell': chime(0,784);break;
  }
}
