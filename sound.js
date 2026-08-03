// Plain HTML5 Audio playback for the two cat sound clips. Deliberately NOT
// the Web Audio API: a plain <audio> element respects the phone's hardware
// silent switch on iOS, where Web Audio API playback does not -- using
// <audio> is what makes "respect the silent switch" happen for free.

const QUIET_HOUR_START = 0;
const QUIET_HOUR_END = 8;
const MIN_GAP_MS = 400; // don't stack two sounds that fire close together

const CLIP_FILES = { meow: 'sounds/meow.mp3', chirrup: 'sounds/chirrup.mp3' };
const clips = {};

function getClip(name){
  if(!clips[name]){
    const el = new Audio(CLIP_FILES[name]);
    el.preload = 'auto';
    clips[name] = el;
  }
  return clips[name];
}

// Preload both up front so the first real play has no delay.
Object.keys(CLIP_FILES).forEach(getClip);

function isQuietHours(){
  const h = new Date().getHours();
  return h >= QUIET_HOUR_START && h < QUIET_HOUR_END;
}

export function isSoundEnabled(){
  return localStorage.getItem('accountability:soundEnabled') === '1';
}

export function setSoundEnabled(on){
  localStorage.setItem('accountability:soundEnabled', on ? '1' : '0');
}

let lastPlayAt = 0;

// Browsers block audio until the page has been interacted with, and Safari
// can throw for all sorts of other reasons (clip still loading, permission
// quirks) -- every caller here follows a tap, so this is expected to work,
// but a failure should never surface as an error to the user.
export function playSound(name){
  if(!isSoundEnabled() || isQuietHours()) return;
  const now = Date.now();
  if(now - lastPlayAt < MIN_GAP_MS) return;
  lastPlayAt = now;
  try{
    const el = getClip(name);
    el.currentTime = 0;
    const p = el.play();
    if(p && typeof p.catch === 'function') p.catch(()=>{});
  }catch(e){ /* sound is a nice-to-have -- never throw over it */ }
}
