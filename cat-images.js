// Mood-pool photo picker for Bots (ginger) and Loki (tabby). Each cat has
// its own complete set of four mood pools; a pick always resolves a CAT
// first (random, either one) and then an image from that cat's pool for
// the requested mood -- never a flat pool mixing both cats, since the
// pools are kept genuinely separate per cat.
const POOLS = {
  bots: {
    neutral: ['bots-close', 'bots-loaf', 'bots-blanket', 'bots-shelf', 'bots-rug'],
    pleased: ['bots-chin', 'bots-lookup', 'bots-lookup2', 'bots-paw', 'bots-door'],
    judging: ['bots-dark', 'bots-grumpy', 'bots-yawn', 'bots-yawn2', 'bots-cone'],
    playful: ['bots-kitten-basket', 'bots-kitten-held']
  },
  loki: {
    neutral: ['loki-bed', 'loki-stairs', 'loki-flowers', 'loki-post'],
    pleased: ['loki-tree', 'loki-back', 'loki-selfie'],
    judging: ['loki-upside', 'loki-closeup'],
    playful: ['loki-kitten-eyes', 'loki-kitten-tilt', 'loki-kitten-peek']
  }
};

// Filenames listed above that haven't actually landed in images/ yet, as of
// this writing -- filtered out at runtime so the picker never returns a
// broken image. Once a file is added, just delete its entry here (no need
// to touch the pools above).
const MISSING_FILES = new Set(['bots-door', 'bots-dark', 'bots-kitten-held', 'loki-post', 'loki-back']);

function availablePool(cat, mood){
  const list = (POOLS[cat] && POOLS[cat][mood]) || [];
  return list.filter(f => !MISSING_FILES.has(f));
}

// One "last shown" per specific cat+mood pool, so the no-repeat rule is
// scoped to exactly the pool a pick came from, not global across all cats
// and moods.
const lastPick = {};

// Picks a mood image, once per call -- callers must call this exactly once
// per EVENT (a life lost, a habit completed, a council starting) and hold
// on to the result, not call it again on every re-render, or the face will
// visibly change while the user is just scrolling.
export function pickCatImage(mood){
  const cats = Math.random() < 0.5 ? ['bots', 'loki'] : ['loki', 'bots'];
  for(const cat of cats){
    const pool = availablePool(cat, mood);
    if(!pool.length) continue;
    const key = cat + '-' + mood;
    let choice;
    if(pool.length === 1){
      choice = pool[0];
    } else {
      do{
        choice = pool[Math.floor(Math.random() * pool.length)];
      } while(choice === lastPick[key]);
    }
    lastPick[key] = choice;
    return { cat, name: cat === 'bots' ? 'Bots' : 'Loki', file: choice, src: `images/${choice}.png` };
  }
  return null; // both cats' pools empty for this mood (e.g. all missing) -- caller handles gracefully
}
