// PreToolUse hook guarding the factory's session state against deletion.
//
// Every agent in a session shares one scratchpad directory, and that is where
// the factory's state files live: the overseer's factory-ledger.md and
// factory-request.md, the factory-review-<pr>.md review records, and any
// manager's factory-ledger-<unit>.md (agents/overseer.md, "Ledger"). The
// deletion rules that protect those files sit only in the overseer's own
// prompt — a worker's definition never mentions them, and one cleanup-minded
// subagent can wipe them all with a single glob (`rm -f .../scratchpad/*`).
// This hook is the mechanical backstop for that.
//
// For every caller with an agent_type — any subagent, factory or not,
// built-ins included — it denies an Edit/MultiEdit/Write of a factory
// state file (only the overseer and managers ever write them), and it
// denies a Bash command that:
//
//   - deletes, moves, or truncates a factory state file (factory-ledger.md,
//     factory-request.md, factory-review-*.md, factory-ledger-<unit>.md) in
//     any directory, via rm/unlink/shred, mv, tee, or an output redirect
//     whose parsed target is one; or
//   - deletes by glob: rm/unlink/shred with * ? [ in an argument, or find
//     with -delete and a glob in its arguments or patterns — in any
//     directory at all. PreToolUse input doesn't carry scratchpad_dir, so
//     the hook can't recognize the scratchpad by path; a glob delete is
//     never the only way to do legitimate work, so the rule is
//     directory-independent. Quoted globs are denied too: quotes are
//     stripped by the word splitter and unquoting is unrecoverable.
//
// The overseer is bound by the same deletion denials: its cleanup rule
// already says "exact absolute paths, never a glob; never the ledger, the
// request file, a review-record file, or a manager's ledger", so a denial
// only enforces its own prompt one level down. Its session-build-directory
// deletions are exact paths and pass. A plain main session has no
// agent_type and passes everything, as the lite-tier hook passes it: the
// user's own hands stay free.
//
// Normal work is unaffected: deleting files an agent created, by exact
// path, is allowed, and so is reading anything.
//
// Static shell parsing has limits; accepted and documented here: variable
// indirection (`rm -f "$LEDGER"`), backslash-escaped globs (denied as if
// they were globs), nested command strings (`eval "rm …"`, `sh -c …`),
// stdin-fed deletes (`... | xargs rm`, which carry no target words), and a
// bare `find DIR -delete` with no glob anywhere. A quoted delimiter makes
// a heredoc body literal data (skipped); an unquoted one keeps the body
// scanned, because command substitutions in it really do execute, so a
// literal dangerous-looking line there can still be denied. The defense in
// depth is the agent instructions plus the overseer's
// rebuild-from-transcript recovery.
//
// It fails open: any error (bad JSON, oversized stdin, a timeout) ends it
// with exit code 0 and nothing on stdout or stderr, so a broken hook can
// never block or break a session. It never outputs "allow"; a command it
// doesn't deny gets no output, so the normal permission flow decides. It
// never changes the tool input. No npm dependencies.

const PROTECTED_NAME = /^factory-(?:ledger|request|review)(?:-[^\s/]*)?\.md$/;

const GLOB = /[*?[]/;
const WRITE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write']);
// The only agents whose briefs ever have them write factory state files:
// the overseer (ledger, request, review records) and managers (their own
// factory-ledger-<unit>.md). A worker, inspector, researcher, or signoff
// with a state file in its Edit/Write path has a wrong brief.
const STATE_WRITERS = new Set([
  'little-planet-factory:overseer',
  'overseer',
  'little-planet-factory:manager',
  'manager',
]);
const DELETE_VERBS = new Set(['rm', 'unlink', 'shred']);
const MOVE_VERBS = new Set(['mv', 'tee']);
// Command prefixes: the word after one is still in command position.
const PREFIXES = new Set(['sudo', 'command', 'builtin', 'env', 'time', 'nice', 'nohup', 'xargs', 'exec', 'eval', '!']);
// Prefix options that take a separate value word: without consuming it,
// `nice -n 5 rm …` mistakes `5` for the executable and never inspects rm.
// Glued forms (-n5, --user=root) are one word and already skipped as flags.
const PREFIX_OPT_VALUES = {
  nice: new Set(['-n', '--adjustment']),
  sudo: new Set(['-u', '-g', '-U', '-h', '-p', '-C', '-T', '-t', '--user', '--group', '--other-user', '--host', '--prompt', '--chdir', '--command-timeout', '--timeout']),
  env: new Set(['-u', '-S', '-C', '--unset', '--chdir', '--split-string']),
  time: new Set(['-o', '-f', '--output', '--format']),
  xargs: new Set(['-n', '-s', '-P', '-I', '-L', '-E', '-e', '--max-args', '--max-chars', '--max-procs', '--replace', '--max-lines', '--eof']),
};
// Strings a token can be when it plays an operator role. The tokenizer
// emits them with op=true when they arrive unquoted; a quoted or escaped
// copy ('>', \>) is a plain word — see splitWords.
const OPERATOR_STRINGS = new Set([';', '|', '&', '(', ')', '`', '>', '<', '>>', '<<', '>|', '>&', '<&', '<<-', '\n']);
// Shell control words: whatever follows one is a fresh command, so it gets
// the same treatment as a word after ; — without this, `if ...; then rm x`
// has `then` swallow the command slot and `rm` passes uninspected.
const SHELL_KEYWORDS = new Set([
  'if', 'then', 'elif', 'else', 'fi',
  'for', 'in', 'while', 'until', 'do', 'done',
  'case', 'esac', '{', '}',
]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

const MAX_STDIN_BYTES = 1024 * 1024;
const SELF_TIMEOUT_MS = 5000;

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    process.stdin.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_STDIN_BYTES) {
        process.stdin.destroy();
        reject(new Error('stdin too large'));
        return;
      }
      chunks.push(chunk);
    });
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

function reasonProtected(name, action) {
  return (
    `little-planet-factory ledger guard: ${name} is the factory's session state — the overseer's ledger, ` +
    `request file, or review record. No agent may ${action} it; the overseer's own cleanup rule says the ` +
    `same, and subagents share the scratchpad it lives in. Reading it is fine. If it looks stale or in ` +
    `the way, report it instead.`
  );
}

function reasonGlob() {
  return (
    `little-planet-factory ledger guard: no glob or wildcard deletes. The session scratchpad is shared ` +
    `between agents, and a cleanup glob there wiped the overseer's factory ledger and request file. ` +
    `Delete files you created by exact path; bulk cleanup goes through the overseer.`
  );
}

// Splits a shell command into tokens: { t, op } where op marks real
// operator tokens (> >> >| >& < << <<- <& ; | & ( ) ` and the newline),
// and words carry a q flag when any of their characters arrived quoted or
// escaped. Quotes group but are stripped; an unquoted # at a word's start
// begins a comment that runs to the newline (before quote parsing, so an
// apostrophe in a comment can't swallow the script); a backslash outside
// quotes keeps the next character literally (an escaped glob still reads
// as a glob) except a backslash-newline, which is a line continuation and
// joins its word across lines, as the shell does. Backslashes inside
// quotes are kept as-is. Operators are single tokens whose composite forms
// are merged so the walker can read them: >> << <<-. $ introduces nothing
// special: $(cmd) splits into "$", "(", "cmd" — and the walker treats the
// parenthesized part as a fresh command, which is all this hook needs.
// Quoted or escaped parentheses remain word tokens; whether they mean
// shell grouping or find-expression grouping is for the walker's argument
// collection, not the tokenizer, to decide.
function splitWords(command) {
  const tokens = [];
  let word = '';
  let wordQuoted = false;
  const quote = { ch: null };
  const flush = () => {
    if (word !== '') {
      // A word made only of operator characters that arrived quoted or
      // escaped ('>', \>) is data — grep '>' ledger.md stays a read.
      tokens.push({ t: word, op: !wordQuoted && OPERATOR_STRINGS.has(word), q: wordQuoted });
      word = '';
      wordQuoted = false;
    }
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote.ch !== null) {
      if (c === quote.ch) quote.ch = null;
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote.ch = c;
      wordQuoted = true;
      continue;
    }
    if (c === '#' && word === '' && !wordQuoted) {
      while (i + 1 < command.length && command[i + 1] !== '\n') i++;
      continue;
    }
    if (c === '&' || c === '|' || c === ';' || c === '(' || c === ')' || c === '`') {
      flush();
      tokens.push({ t: c, op: true });
      continue;
    }
    if (c === '>' || c === '<') {
      flush();
      let merged = c;
      if (command[i + 1] === c) {
        merged = c + c;
        i++;
      }
      if (command[i + 1] === '|' || command[i + 1] === '&') {
        merged += command[i + 1];
        i++;
      }
      if (merged === '<<' && command[i + 1] === '-') {
        merged = '<<-';
        i++;
      }
      tokens.push({ t: merged, op: true });
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') {
      flush();
      continue;
    }
    if (c === '\n') {
      flush();
      tokens.push({ t: '\n', op: true });
      continue;
    }
    if (c === '\\' && i + 1 < command.length) {
      if (command[i + 1] === '\n') {
        i++; // line continuation: drop both characters, keep accumulating
        continue;
      }
      word += command[i + 1];
      wordQuoted = true;
      i++;
      continue;
    }
    word += c;
  }
  flush();
  return tokens;
}

function basename(path) {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

// Judgment for one find invocation, already limited to -delete runs: a
// glob anywhere in its arguments (targets or patterns — both are words) or
// a protected basename as a target.
function denyReasonInFind(args) {
  if (!args.includes('-delete')) return null;
  for (const arg of args) {
    if (arg.startsWith('-')) continue;
    if (PROTECTED_NAME.test(basename(arg))) return reasonProtected(basename(arg), 'delete');
    if (GLOB.test(arg)) return reasonGlob();
  }
  return null;
}

// The deny reason for a command, or null when the hook allows it through
// to the normal permission flow.
function reasonWrite(name) {
  return (
    `little-planet-factory ledger guard: ${name} is the factory's session state — the overseer's ledger, ` +
    `request file, or review record. Only the overseer and managers write these; other agents never do. ` +
    `If your brief told you to update it, report that back — the brief is wrong.`
  );
}

function denyReason(command) {
  const tokens = splitWords(command);
  let expectCommand = true;
  let mode = null; // 'delete' | 'move' while a destructive command's arguments are read
  let redirect = null; // 'out' | 'in' | 'heredoc' while a redirection's target word comes next
  let heredoc = null; // { delim, literal } once a heredoc's delimiter is read
  let skippingHeredoc = false; // a quoted-delimiter heredoc body is data, not commands
  let atLineStart = true; // for spotting the heredoc terminator
  let optValuePending = false; // the current prefix option's value word comes next
  const prefixStack = []; // nested command prefixes (sudo nice), innermost last
  const currentPrefix = () =>
    prefixStack.length === 0 ? null : prefixStack[prefixStack.length - 1];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    if (skippingHeredoc) {
      // Literal heredoc data. Ends at a line whose only word is the
      // delimiter (leading whitespace tolerated, covering <<-).
      if (tok.op) {
        if (tok.t === '\n') atLineStart = true;
        continue;
      }
      if (atLineStart && tok.t === heredoc.delim) {
        skippingHeredoc = false;
        heredoc = null;
        expectCommand = true;
      }
      atLineStart = false;
      continue;
    }

    if (tok.op) {
      const t = tok.t;
      if (t === '>' || t === '>>' || t === '>|' || t === '>&') {
        redirect = 'out';
      } else if (t === '<' || t === '<&') {
        redirect = 'in';
      } else if (t === '<<' || t === '<<-') {
        redirect = 'heredoc';
      } else {
        redirect = null;
        expectCommand = true;
        mode = null;
        optValuePending = false;
        prefixStack.length = 0;
        // The first newline after the delimiter begins the body. A quoted
        // delimiter makes the body literal; an unquoted one keeps it
        // scanned, because command substitutions in it really do execute.
        if (t === '\n' && heredoc !== null) {
          skippingHeredoc = heredoc.literal;
          if (!heredoc.literal) heredoc = null;
        }
      }
      continue;
    }

    const w = tok.t;

    if (redirect !== null) {
      // A redirection's parsed target word: an output redirect onto a
      // protected file truncates or overwrites it; an input redirect reads
      // from it, which is fine. A heredoc's target is its delimiter.
      const base = basename(w);
      if (redirect === 'out' && PROTECTED_NAME.test(base)) {
        return reasonProtected(base, 'truncate or overwrite');
      }
      if (redirect === 'heredoc') heredoc = { delim: w, literal: tok.q };
      redirect = null;
      continue;
    }

    if (expectCommand) {
      if (optValuePending) {
        optValuePending = false;
        continue;
      }
      if (w.startsWith('-')) {
        // A prefix's option with a separate value (nice -n 5, sudo -u root,
        // xargs -n 1): skip its value too, or it eats the command slot.
        if (PREFIX_OPT_VALUES[currentPrefix()]?.has(w)) optValuePending = true;
        continue;
      }
      if (ASSIGNMENT.test(w)) continue;
      const base = basename(w);
      if (SHELL_KEYWORDS.has(base)) continue;
      if (PREFIXES.has(base)) {
        prefixStack.push(base);
        continue;
      }
      expectCommand = false;
      prefixStack.length = 0;
      if (DELETE_VERBS.has(base)) {
        mode = 'delete';
      } else if (MOVE_VERBS.has(base)) {
        mode = 'move';
      } else if (base === 'find') {
        // Judge a find invocation whole: -delete can come after a glob
        // pattern in its expression, and ( ... ) group that expression —
        // escaped or quoted, they tokenize the same — so they're collected
        // as arguments rather than stopping the collection.
        const args = [];
        while (
          i + 1 < tokens.length &&
          (!tokens[i + 1].op || tokens[i + 1].t === '(' || tokens[i + 1].t === ')')
        ) {
          args.push(tokens[++i].t);
        }
        const found = denyReasonInFind(args);
        if (found !== null) return found;
      }
      continue;
    }

    if (mode === null || w.startsWith('-')) continue;

    const base = basename(w);
    if (PROTECTED_NAME.test(base)) {
      return reasonProtected(base, mode === 'delete' ? 'delete' : 'move or overwrite');
    }
    if (mode === 'delete' && GLOB.test(w)) return reasonGlob();
  }
  return null;
}

async function main() {
  const raw = await readStdin();
  const input = JSON.parse(raw);
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  const toolName = input.tool_name;
  if (toolName !== 'Bash' && !WRITE_TOOLS.has(toolName)) return;
  // No agent_type: a plain main session. Pass through, like lite-tier.
  if (typeof input.agent_type !== 'string' || input.agent_type === '') return;
  const toolInput =
    input.tool_input && typeof input.tool_input === 'object' && !Array.isArray(input.tool_input)
      ? input.tool_input
      : {};

  let reason = null;
  if (toolName === 'Bash') {
    if (typeof toolInput.command !== 'string' || toolInput.command === '') return;
    reason = denyReason(toolInput.command);
  } else if (!STATE_WRITERS.has(input.agent_type)) {
    const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : '';
    if (PROTECTED_NAME.test(basename(filePath))) reason = reasonWrite(basename(filePath));
  }
  if (reason === null) return;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
}

process.exitCode = 0;
process.stdout.on('error', () => {});
process.on('uncaughtException', () => process.exit(0));
process.on('unhandledRejection', () => process.exit(0));
setTimeout(() => process.exit(0), SELF_TIMEOUT_MS).unref();

main().catch(() => {});
