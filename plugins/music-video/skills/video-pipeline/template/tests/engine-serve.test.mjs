// `pnpm serve`: request paths map to files inside the project only (no
// traversal, no dot-folders), MIME types are right for the page's assets, and
// audio answers Range requests with 206 and the exact bytes.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, before, describe, it} from 'node:test';
import {createStaticServer, parseRange, parseServeArgs, resolveRequest} from '../scripts/serve.mjs';
import {PROJECT_ROOT} from '../scripts/lib/env.mjs';

describe('serve', () => {
  let root;
  let server;
  let base;
  let outside;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'mv-serve-'));
    mkdirSync(join(root, 'public/audio'), {recursive: true});
    mkdirSync(join(root, '.venv'), {recursive: true});
    writeFileSync(join(root, 'index.html'), '<!doctype html>');
    writeFileSync(join(root, 'a.js'), 'export {}');
    writeFileSync(join(root, 'a.json'), '{}');
    writeFileSync(join(root, 'f.woff2'), 'wOF2');
    writeFileSync(join(root, 'public/audio/track.wav'), Buffer.from(Array.from({length: 100}, (_, i) => i)));
    writeFileSync(join(root, '.venv/secret'), 'x');
    // Symlinks: out of the project (file and folder), into a dot-folder, and to a file inside.
    outside = mkdtempSync(join(tmpdir(), 'mv-serve-out-'));
    writeFileSync(join(outside, 'secret.txt'), 'outside');
    symlinkSync(join(outside, 'secret.txt'), join(root, 'leak.txt'));
    symlinkSync(outside, join(root, 'leakdir'));
    symlinkSync(join(root, '.venv/secret'), join(root, 'dotlink.txt'));
    symlinkSync(join(root, 'a.json'), join(root, 'alias.json'));
    symlinkSync(join(root, 'a.js'), join(root, 'script-alias.txt'));
    server = createStaticServer(root);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => {
    server.close();
    rmSync(root, {recursive: true, force: true});
    rmSync(outside, {recursive: true, force: true});
  });

  it('follows a symlink only when its real target is inside the project and not under a dot-folder', async () => {
    for (const p of ['/leak.txt', '/leakdir/secret.txt', '/dotlink.txt']) {
      assert.equal(resolveRequest(root, p), null, p);
      assert.equal((await fetch(base + p)).status, 404, p);
    }
    const ok = await fetch(`${base}/alias.json`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), '{}');
  });

  it('refuses paths outside the project and through dot-folders', async () => {
    for (const p of ['/%2e%2e/%2e%2e/etc/passwd', '/.venv/secret', '/x/../../etc/passwd', '/%00']) {
      const file = resolveRequest(root, p);
      assert.ok(file === null || file.startsWith(root), p);
      const res = await fetch(base + p);
      assert.equal(res.status, 404, p);
    }
  });

  it('takes the MIME type from the requested name, not the symlink target', async () => {
    const res = await fetch(`${base}/script-alias.txt`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/plain/);
    assert.equal(await res.text(), 'export {}');
  });

  it('serves the page assets with their MIME types', async () => {
    for (const [p, type] of [['/index.html', /text\/html/], ['/', /text\/html/], ['/a.js', /text\/javascript/], ['/a.json', /application\/json/], ['/f.woff2', /font\/woff2/], ['/public/audio/track.wav', /audio\/wav/]]) {
      const res = await fetch(base + p);
      assert.equal(res.status, 200, p);
      assert.match(res.headers.get('content-type'), type, p);
      await res.arrayBuffer();
    }
  });

  it('answers Range requests for audio with 206 and exactly those bytes; HEAD has no body', async () => {
    const res = await fetch(`${base}/public/audio/track.wav`, {headers: {Range: 'bytes=10-19'}});
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), 'bytes 10-19/100');
    assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    const bad = await fetch(`${base}/public/audio/track.wav`, {headers: {Range: 'bytes=500-'}});
    assert.equal(bad.status, 416);
    const head = await fetch(`${base}/public/audio/track.wav`, {method: 'HEAD'});
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), '100');
  });

  it('parses Range headers and --port', () => {
    assert.deepEqual(parseRange('bytes=-10', 100), {start: 90, end: 99});
    assert.deepEqual(parseRange('bytes=5-', 100), {start: 5, end: 99});
    assert.equal(parseRange('bytes=a-b', 100), 'invalid');
    assert.equal(parseRange(undefined, 100), null);
    assert.deepEqual(parseServeArgs(['--port', '9000']), {port: 9000});
    assert.deepEqual(parseServeArgs(['--port=0']), {port: 0});
    assert.throws(() => parseServeArgs(['--port=x']), /--port needs a port number/);
    assert.throws(() => parseServeArgs(['--bogus']), /unexpected argument/);
  });

  it('the CLI prints the preview URL, serves index.html, and exits on Ctrl-C (SIGINT) leaving no process', {timeout: 20_000}, async () => {
    const child = spawn(process.execPath, [join(PROJECT_ROOT, 'scripts/serve.mjs'), '--port', '0'], {stdio: ['ignore', 'pipe', 'pipe']});
    const url = await new Promise((resolve, reject) => {
      let out = '';
      child.stdout.on('data', (d) => {
        out += d;
        const m = /http:\/\/127\.0\.0\.1:\d+\/index\.html/.exec(out);
        if (m) resolve(m[0]);
      });
      child.on('close', () => reject(new Error(`serve exited early: ${out}`)));
    });
    const res = await fetch(url);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<div id="stage">/);
    const closed = new Promise((r) => child.on('close', (code, signal) => r({code, signal})));
    child.kill('SIGINT');
    const {code} = await closed;
    assert.equal(code, 130);
    assert.throws(() => process.kill(child.pid, 0), /ESRCH/);
  });
});
