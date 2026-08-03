// Plain-Node test script, no framework/dependency -- run with:
//   node tests/cat-images.test.mjs
// Exits 0 if everything passes, 1 if anything fails.
import { pickCatImage } from '../cat-images.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok - ' + name);
  } catch (e) {
    failed++;
    console.log('  FAIL - ' + name);
    console.log('    ' + e.message);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

const MOODS = ['neutral', 'pleased', 'judging', 'playful'];

test('pickCatImage: always returns a pick with cat/name/file/src for every defined mood', () => {
  for (const mood of MOODS) {
    const pick = pickCatImage(mood);
    assert(pick, `expected a pick for mood "${mood}"`);
    assert(pick.cat === 'bots' || pick.cat === 'loki', `unexpected cat "${pick.cat}"`);
    assert(pick.name === 'Bots' || pick.name === 'Loki', `unexpected name "${pick.name}"`);
    assert(pick.src === `images/${pick.file}.png`, 'src should be built from file');
    assert(pick.file.startsWith(pick.cat), `file "${pick.file}" should start with cat "${pick.cat}"`);
  }
});

test('pickCatImage: an unrecognized mood returns null rather than throwing', () => {
  assert(pickCatImage('not-a-real-mood') === null, 'expected null for an unknown mood');
});

test('pickCatImage: never returns a currently-missing file', () => {
  // bots-door, bots-dark, bots-kitten-held, loki-post, loki-back are listed
  // as not-yet-added in cat-images.js as of this writing -- the picker must
  // filter them out rather than ever returning a broken image path. Sample
  // heavily since this is probabilistic.
  const missing = new Set(['bots-door', 'bots-dark', 'bots-kitten-held', 'loki-post', 'loki-back']);
  for (let i = 0; i < 500; i++) {
    const mood = MOODS[i % MOODS.length];
    const pick = pickCatImage(mood);
    if (pick) assert(!missing.has(pick.file), `picked a known-missing file: ${pick.file}`);
  }
});

test('pickCatImage: never repeats the same file twice in a row within the same cat+mood pool', () => {
  // A more direct test of the no-repeat rule: run many picks for a mood
  // where at least one cat's pool has exactly 2 options (loki-judging:
  // loki-upside, loki-closeup) and confirm we never see the same loki file
  // twice in a row across consecutive LOKI picks specifically.
  let lastLokiFile = null;
  let sawLokiTwice = false;
  for (let i = 0; i < 400; i++) {
    const pick = pickCatImage('judging');
    if (!pick || pick.cat !== 'loki') continue;
    if (lastLokiFile !== null) {
      sawLokiTwice = true;
      assert(pick.file !== lastLokiFile, `repeated "${pick.file}" back-to-back within loki-judging pool`);
    }
    lastLokiFile = pick.file;
  }
  assert(sawLokiTwice, 'test did not actually exercise consecutive loki-judging picks -- increase iterations');
});

test('pickCatImage: a pool with only one available option (after filtering missing files) never hangs or errors', () => {
  // bots-playful lists bots-kitten-basket and bots-kitten-held, but the
  // latter is currently missing -- leaving exactly one available option.
  // The picker must short-circuit rather than looping forever trying to
  // avoid "repeating" when there's nothing else to pick.
  for (let i = 0; i < 20; i++) {
    const pick = pickCatImage('playful');
    assert(pick, 'expected a pick even when a cat has only one available option');
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
