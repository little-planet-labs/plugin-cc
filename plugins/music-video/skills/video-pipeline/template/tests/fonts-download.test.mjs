// `pnpm fonts` against a local fake Google Fonts CSS2 server: it downloads
// every face listed (each weight, each unicode-range subset, shared variable
// files once), writes public/fonts/fonts.json, replaces an old manifest only
// when everything arrived, and fails cleanly on a 404 leaving no partial files
// (the previous fonts untouched, no temp folder). MV_FONTS_BASE points the CLI
// at the fake server.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, before, describe, it} from 'node:test';
import {cssUrl, downloadFonts, parseFontCss, USER_AGENT} from '../scripts/fonts.mjs';
import {PROJECT_ROOT} from '../scripts/lib/env.mjs';

const SUBSETS = {latin: 'U+0000-00FF, U+0131', 'latin-ext': 'U+0100-02BA, U+1E00-1EFF'};

/** A fake CSS2 API: one variable file per family+subset, served for every weight asked. Families named "Missing*" 400; files under /gone/ 404. */
const startFake = async () => {
  const requests = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    requests.push({path: url.pathname, query: url.search, ua: req.headers['user-agent']});
    if (url.pathname === '/css2') {
      const [family, axis] = url.searchParams.get('family').split(':');
      if (family.startsWith('Missing')) return res.writeHead(400).end('bad family');
      const weights = axis.replace('wght@', '').split(';').map(Number).filter((w) => !(family === 'Thin Sans' && w === 700));
      const dir = family.startsWith('Broken') ? 'gone' : 'files';
      const base = `http://127.0.0.1:${server.address().port}`;
      const css = weights
        .flatMap((w) =>
          Object.entries(SUBSETS).map(
            ([subset, range]) =>
              `/* ${subset} */\n@font-face {\n  font-family: '${family}';\n  font-style: normal;\n  font-weight: ${w};\n  font-display: swap;\n` +
              `  src: url(${base}/${dir}/${encodeURIComponent(family)}-${subset}.woff2) format('woff2');\n  unicode-range: ${range};\n}\n`,
          ),
        )
        .join('');
      return res.writeHead(200, {'Content-Type': 'text/css'}).end(css);
    }
    if (url.pathname.startsWith('/files/')) return res.writeHead(200, {'Content-Type': 'font/woff2'}).end(Buffer.concat([Buffer.from('wOF2'), Buffer.from(url.pathname)]));
    res.writeHead(404).end('nope');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {server, requests, base: `http://127.0.0.1:${server.address().port}`};
};

const project = (fonts) => {
  const root = mkdtempSync(join(tmpdir(), 'mv-fonts-'));
  mkdirSync(join(root, 'src'), {recursive: true});
  mkdirSync(join(root, 'public/fonts'), {recursive: true});
  writeFileSync(join(root, 'public/fonts/.gitkeep'), '');
  const brand = JSON.parse(readFileSync(join(PROJECT_ROOT, 'src/brand.json'), 'utf8'));
  writeFileSync(join(root, 'src/brand.json'), JSON.stringify({...brand, fonts}));
  return root;
};
const g = (family, weights) => ({family, source: 'google', weights});
const quiet = () => {};

describe('pnpm fonts', () => {
  let fake;
  before(async () => {
    fake = await startFake();
  });
  after(() => fake.server.close());

  it('downloads every face for every Google family and weight (shared files once) and writes the manifest', async () => {
    const root = project({display: g('Test Sans', [400, 700]), body: g('Test Sans', [400, 500])});
    try {
      fake.requests.length = 0;
      const r = await downloadFonts({root, base: fake.base, log: quiet});
      assert.equal(r.faces, 3 * 2, '3 weights x 2 subsets');
      assert.equal(r.files, 2, 'one variable file per subset');
      const manifest = JSON.parse(readFileSync(join(root, 'public/fonts/fonts.json'), 'utf8'));
      assert.deepEqual(manifest.families, {'Test Sans': [400, 500, 700]});
      for (const w of [400, 500, 700]) {
        for (const range of Object.values(SUBSETS)) {
          const face = manifest.faces.find((f) => f.weight === w && f.unicodeRange === range);
          assert.ok(face, `face ${w} ${range}`);
          assert.equal(face.family, 'Test Sans');
          assert.match(face.file, /^public\/fonts\/test-sans-latin(?:-ext)?-[0-9a-f]{10}\.woff2$/);
          assert.equal(readFileSync(join(root, face.file)).subarray(0, 4).toString(), 'wOF2');
        }
      }
      const css = fake.requests.filter((q) => q.path === '/css2');
      assert.equal(css.length, 1, 'display and body share one request');
      assert.equal(css[0].query, '?family=Test+Sans:wght@400;500;700&display=swap');
      assert.ok(fake.requests.every((q) => q.ua === USER_AGENT), 'a browser User-Agent (so the API returns woff2)');
      assert.deepEqual(readdirSync(join(root, 'public/fonts')).filter((f) => f.startsWith('.fonts-tmp')), []);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it('replaces an old manifest only on success, removing the files only the old one listed', async () => {
    const root = project({display: g('Test Sans', [400]), body: g('Other Mono', [500])});
    try {
      writeFileSync(join(root, 'public/fonts/old-face.woff2'), 'wOF2old');
      writeFileSync(join(root, 'public/fonts/fonts.json'), JSON.stringify({version: 1, faces: [{family: 'Old', weight: 400, style: 'normal', file: 'public/fonts/old-face.woff2'}]}));
      const r = await downloadFonts({root, base: fake.base, log: quiet});
      assert.equal(r.faces, 4);
      assert.equal(existsSync(join(root, 'public/fonts/old-face.woff2')), false);
      const manifest = JSON.parse(readFileSync(join(root, 'public/fonts/fonts.json'), 'utf8'));
      assert.deepEqual(Object.keys(manifest.families).sort(), ['Other Mono', 'Test Sans']);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  for (const [label, fonts, error] of [
    ['a 404 on a font file', {display: g('Test Sans', [400]), body: g('Broken Sans', [400])}, /font file for "Broken Sans" 400: .*\/gone\/.* answered HTTP 404/],
    ['an unknown family (CSS 400)', {display: g('Test Sans', [400]), body: g('Missing Sans', [400])}, /Google Fonts CSS for "Missing Sans": .* answered HTTP 400/],
    ['a weight the family does not have', {display: g('Thin Sans', [400, 700]), body: g('Thin Sans', [400])}, /no woff2 face for "Thin Sans" weight 700/],
  ]) {
    it(`fails cleanly on ${label}: previous fonts untouched, no partial files, no temp folder`, async () => {
      const root = project(fonts);
      try {
        writeFileSync(join(root, 'public/fonts/old-face.woff2'), 'wOF2old');
        const oldManifest = JSON.stringify({version: 1, faces: [{family: 'Old', weight: 400, style: 'normal', file: 'public/fonts/old-face.woff2'}]});
        writeFileSync(join(root, 'public/fonts/fonts.json'), oldManifest);
        const before = readdirSync(join(root, 'public/fonts')).sort();
        await assert.rejects(downloadFonts({root, base: fake.base, log: quiet}), error);
        assert.deepEqual(readdirSync(join(root, 'public/fonts')).sort(), before);
        assert.equal(readFileSync(join(root, 'public/fonts/fonts.json'), 'utf8'), oldManifest);
      } finally {
        rmSync(root, {recursive: true, force: true});
      }
    });
  }

  it('the CLI honours MV_FONTS_BASE and exits 1 with a plain message on failure', async () => {
    const root = project({display: g('Broken Sans', [400]), body: g('Broken Sans', [400])});
    try {
      cpSync(join(PROJECT_ROOT, 'scripts'), join(root, 'scripts'), {recursive: true});
      cpSync(join(PROJECT_ROOT, 'src/lib'), join(root, 'src/lib'), {recursive: true});
      const run = (env) =>
        new Promise((resolve) => {
          const child = spawn(process.execPath, [join(root, 'scripts/fonts.mjs')], {env: {...process.env, ...env}, stdio: ['ignore', 'pipe', 'pipe']});
          let out = '';
          child.stdout.on('data', (d) => (out += d));
          child.stderr.on('data', (d) => (out += d));
          child.on('close', (code) => resolve({code, out}));
        });
      const bad = await run({MV_FONTS_BASE: fake.base});
      assert.equal(bad.code, 1);
      assert.match(bad.out, /^fonts: font file for "Broken Sans" 400: .* answered HTTP 404/m);
      assert.deepEqual(readdirSync(join(root, 'public/fonts')), ['.gitkeep']);
      writeFileSync(join(root, 'src/brand.json'), JSON.stringify({...JSON.parse(readFileSync(join(root, 'src/brand.json'), 'utf8')), fonts: {display: g('Test Sans', [400]), body: g('Test Sans', [400])}}));
      const good = await run({MV_FONTS_BASE: fake.base});
      assert.equal(good.code, 0, good.out);
      assert.match(good.out, /fonts: 2 faces \(2 files\) for Test Sans 400 -> public\/fonts\//);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it('a brand with only local fonts downloads nothing', async () => {
    const root = project({display: {family: 'Brand', source: 'local', weights: [400], files: {400: 'public/brand/b.woff2'}}, body: {family: 'Brand', source: 'local', weights: [400]}});
    try {
      const r = await downloadFonts({root, base: fake.base, log: quiet});
      assert.deepEqual(r, {faces: 0, files: 0, manifest: null});
      assert.deepEqual(readdirSync(join(root, 'public/fonts')), ['.gitkeep']);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });
});

describe('Google Fonts CSS parsing', () => {
  it('reads family, weight, style, woff2 url, unicode-range and the subset comment of each face', () => {
    const css = "/* cyrillic */\n@font-face {\n  font-family: 'Open Sans';\n  font-style: normal;\n  font-weight: 600;\n  font-stretch: 100%;\n  src: url(https://x/a.woff2) format('woff2');\n  unicode-range: U+0301, U+0400-045F;\n}\n";
    assert.deepEqual(parseFontCss(css), [{family: 'Open Sans', style: 'normal', weight: 600, url: 'https://x/a.woff2', unicodeRange: 'U+0301, U+0400-045F', subset: 'cyrillic'}]);
  });
  it('builds the css2 URL with + for spaces and ; between weights', () => {
    assert.equal(cssUrl('https://fonts.googleapis.com/', 'Mona Sans', [400, 900]), 'https://fonts.googleapis.com/css2?family=Mona+Sans:wght@400;900&display=swap');
  });
});
