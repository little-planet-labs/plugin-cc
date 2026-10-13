// `pnpm serve [--port <n>]`
//
// A local static server for the interactive preview: open the printed
// http://127.0.0.1:<port>/index.html (ES modules don't load from file://).
// Serves only files allowed by the containment rule of scripts/lib/files.mjs
// (real path inside the real project root, no dot segment such as .venv or
// .cache), with Range support so the audio scrubs. Ctrl-C stops it.
import {createReadStream, realpathSync, statSync} from 'node:fs';
import {createServer} from 'node:http';
import {extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {CliError, runCli} from './lib/cli.mjs';
import {PROJECT_ROOT} from './lib/env.mjs';
import {projectFile} from './lib/files.mjs';

export const DEFAULT_PORT = 8770;

export const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.txt': 'text/plain; charset=utf-8',
});

/**
 * The real file a request path maps to, or null (404): missing, malformed, or
 * refused by the project containment rule (scripts/lib/files.mjs: the real
 * target must be inside the real project root, with no dot segment).
 * @param {string} root
 * @param {string} urlPath
 * @returns {string | null}
 */
export const resolveRequest = (root, urlPath) => {
  let path;
  try {
    path = decodeURIComponent(new URL(urlPath, 'http://localhost').pathname);
  } catch {
    return null;
  }
  const parts = path.split('/').filter(Boolean);
  return projectFile(root, parts.length ? parts.join('/') : 'index.html');
};

/**
 * Parse a single-range Range header against a file size.
 * @returns {{start: number, end: number} | 'invalid' | null} null: no (or ignorable) Range header.
 */
export const parseRange = (header, size) => {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid';
  let start;
  let end;
  if (m[1] === '') {
    const n = Number(m[2]);
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return 'invalid';
  return {start, end};
};

/**
 * Create (not start) the server.
 * @param {string} [root]
 */
export const createStaticServer = (root = PROJECT_ROOT) =>
  createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, {Allow: 'GET, HEAD'}).end();
      return;
    }
    const file = resolveRequest(root, req.url ?? '/');
    let st = null;
    try {
      st = file ? statSync(file) : null;
    } catch {
      st = null;
    }
    if (!file || !st || !st.isFile()) {
      res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'}).end('not found\n');
      return;
    }
    // The type follows the requested name ("/" is index.html); containment was checked on the real target.
    const requested = new URL(req.url ?? '/', 'http://localhost').pathname;
    const type = MIME[requested.endsWith('/') ? '.html' : extname(requested).toLowerCase()] ?? 'application/octet-stream';
    const headers = {'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store'};
    const range = parseRange(req.headers.range, st.size);
    if (range === 'invalid') {
      res.writeHead(416, {...headers, 'Content-Range': `bytes */${st.size}`}).end();
      return;
    }
    const {start, end} = range ?? {start: 0, end: st.size - 1};
    res.writeHead(range ? 206 : 200, {
      ...headers,
      'Content-Length': st.size === 0 ? 0 : end - start + 1,
      ...(range ? {'Content-Range': `bytes ${start}-${end}/${st.size}`} : {}),
    });
    if (req.method === 'HEAD' || st.size === 0) {
      res.end();
      return;
    }
    const stream = createReadStream(file, {start, end});
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });

export const parseServeArgs = (argv) => {
  let port = DEFAULT_PORT;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port' || arg.startsWith('--port=')) {
      const value = arg === '--port' ? argv[++i] : arg.slice('--port='.length);
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0 || n > 65535) throw new CliError(`--port needs a port number 0..65535 (got ${JSON.stringify(value)})`);
      port = n;
    } else {
      throw new CliError(`unexpected argument "${arg}". Usage: pnpm serve [--port <n>]`);
    }
  }
  return {port};
};

export const main = (argv, {root = PROJECT_ROOT} = {}) =>
  runCli('serve', async () => {
    const {port} = parseServeArgs(argv);
    const server = createStaticServer(root);
    const sockets = new Set();
    server.on('connection', (s) => {
      sockets.add(s);
      s.on('close', () => sockets.delete(s));
    });
    await new Promise((ok, fail) => {
      server.once('error', (err) =>
        fail(new CliError(err.code === 'EADDRINUSE' ? `port ${port} is in use; pick another with --port <n>` : `could not start: ${err.message}`)),
      );
      server.listen(port, '127.0.0.1', ok);
    });
    const actual = server.address().port;
    console.log(`serve: http://127.0.0.1:${actual}/index.html  (Ctrl-C to stop)`);
    // Stay up until SIGINT/SIGTERM; then close the server and every open connection.
    await new Promise((done) => {
      const stop = () => {
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
        for (const s of sockets) s.destroy();
        server.close(() => done());
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    });
    console.log('serve: stopped');
  });

// realpath: Node runs the main module from its real path, so a symlinked project path must still match.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
