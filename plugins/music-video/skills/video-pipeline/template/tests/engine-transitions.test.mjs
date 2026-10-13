// Transition geometry: a circle clears the farthest corner (x1.05) at its end
// and a contracting circle reaches radius exactly 0; staggered bars all finish
// on the transition end; every kind is whole (no styles) from its end; specs
// are validated.
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {circleGeometry, farCorner, normalizeTransition, transitionFrame, TRANSITIONS} from '../src/lib/transitions.js';

const size = {width: 1920, height: 1080};
const spec = (o) => ({...normalizeTransition(o), at: 10, end: 10 + (o.dur ?? 0.4)});

describe('transitions', () => {
  it('a circle grows from 0 to the farthest corner x1.05, measured from its centre', () => {
    const s = spec({kind: 'circle', dur: 0.5, x: 100, y: 200});
    assert.equal(circleGeometry(s, 9.9, 1920, 1080), null);
    assert.equal(circleGeometry(s, 10, 1920, 1080).r, 0);
    const R = Math.hypot(1820, 880) * 1.05;
    assert.ok(Math.abs(farCorner(100, 200, 1920, 1080) - R) < 1e-9);
    assert.equal(circleGeometry(s, 10.5, 1920, 1080).r, R);
  });

  it('a contracting circle reaches radius exactly 0 at the target, then shows nothing', () => {
    const s = spec({kind: 'circle', dur: 0.4, contractTo: {x: 1500, y: 300, at: 11, dur: 0.3}});
    const end = circleGeometry(s, 11.3 - 1e-9, 1920, 1080);
    assert.ok(end.r < 1e-3 && Math.abs(end.cx - 1500) < 1e-3);
    assert.equal(circleGeometry(s, 11.3, 1920, 1080), null);
  });

  it('staggered bars (5..9, default 7) all finish on the transition end', () => {
    for (const count of [5, 7, 9]) {
      const s = spec({kind: 'bars', dur: 0.4, count});
      const before = transitionFrame(s, 10.4 - 1e-6, size);
      assert.match(before.incoming.clipPath, /^path\('/);
      assert.equal((before.incoming.clipPath.match(/Z/g) ?? []).length, count);
      assert.equal(transitionFrame(s, 10.4, size).done, true);
    }
    const n = normalizeTransition({kind: 'bars'});
    assert.equal(n.count ?? 7, 7);
  });

  for (const kind of TRANSITIONS.filter((k) => k !== 'cut' && k !== 'iris')) {
    it(`${kind} leaves the incoming section untouched from its end on`, () => {
      const s = spec({kind, dur: 0.4});
      const f = transitionFrame(s, 10.4, size);
      assert.equal(f.done, true);
      assert.deepEqual(f.incoming, {clipPath: '', opacity: '', transform: '', filter: ''});
      assert.equal(f.outgoing, null);
      const mid = transitionFrame(s, 10.2, size);
      assert.equal(mid.done, false);
    });
  }

  it('a wipe with a blade edge carries the blade across; a circle with a ring leads with it', () => {
    const w = transitionFrame(spec({kind: 'wipe', from: 'left', edge: {color: '#fff', width: 12}}), 10.2, size);
    assert.ok(w.blade && w.blade.width === 12 && w.blade.height === 1080);
    const c = transitionFrame(spec({kind: 'circle', ring: {color: '#f00', width: 30}}), 10.2, size);
    assert.ok(c.ring && /circle\(/.test(c.ring.clipPath));
  });

  it('specs are validated, naming the field', () => {
    assert.throws(() => normalizeTransition({kind: 'swirl'}), /kind must be one of/);
    assert.throws(() => normalizeTransition({kind: 'bars', count: 4}), /count must be an integer from 5 to 9/);
    assert.throws(() => normalizeTransition({kind: 'wipe', from: 'north'}), /from must be one of left, right, top, bottom/);
    assert.throws(() => normalizeTransition({kind: 'fade', dur: 0}), /use kind 'cut'/);
    assert.throws(() => normalizeTransition({kind: 'fade', blur: 20}), /blur must be a sample count from 2 to 16/);
    assert.equal(normalizeTransition({kind: 'iris'}).kind, 'circle');
  });
});
