// All sound is synthesized on this device. No samples, timers or RNG in the engine.
let audio, bus, felt, sound=true;
function soundButton(){
  const b=$('soundBtn');b.textContent=sound?'♪ On':'♪ Off';b.setAttribute('aria-pressed',String(sound));
}
function unlockSound(){
  if(!sound)return;
  if(!audio){
    const Context=window.AudioContext||window.webkitAudioContext;
    if(!Context){sound=false;soundButton();$('soundBtn').disabled=true;$('soundBtn').title='Audio unavailable';return}
    audio=new Context();bus=audio.createGain();bus.gain.value=.5;bus.connect(audio.destination);
    felt=audio.createBuffer(1,Math.ceil(audio.sampleRate*.2),audio.sampleRate);
    let seed=97;
    const data=felt.getChannelData(0);
    for(let i=0;i<data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data[i]=seed/2147483648-1}
  }
  bus.gain.value=.5;
  if(audio.state==='suspended')audio.resume().catch(e=>console.warn('Could not unlock table sound:',e));
}
function initSound(){
  try{sound=localStorage.getItem('harbor-sound')!=='off'}catch(e){console.warn('Sound preference unavailable:',e)}
  soundButton();
  for(const event of ['pointerdown','keydown'])document.addEventListener(event,unlockSound);
  $('soundBtn').onclick=()=>{
    sound=!sound;
    if(sound){unlockSound();if(audio)audio.resume().then(()=>foley('bell')).catch(e=>console.warn('Audio unavailable:',e))}
    else if(bus)bus.gain.value=0;
    soundButton();
    try{localStorage.setItem('harbor-sound',sound?'on':'off')}catch(e){console.warn('Could not save sound preference:',e)}
  };
}
function foley(kind){
  if(!sound||audio?.state!=='running'||document.hidden)return;
  const t=audio.currentTime;
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
    v.connect(bus);source.start(at);source.stop(at+length+.002);
    source.onended=()=>{source.disconnect();filter?.disconnect();v.disconnect()};
  }
  const knock=(at,power,pitch)=>{strike('triangle',pitch,pitch*.45,at,.09,power);strike('noise',1400,0,at,.055,power*.9)};
  const chime=(at,pitch)=>{strike('sine',pitch,pitch*.992,at,.22,.14);strike('sine',pitch*2.7,pitch*2.69,at,.09,.045)};
  switch(kind){
    case 'dice': [0,.048,.12,.235,.355].forEach((at,i)=>knock(at,.23-i*.023,460-i*44));break;
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
