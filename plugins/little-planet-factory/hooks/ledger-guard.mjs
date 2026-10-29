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
// bare `find DIR -delete` with no glob anywhere. The defense in depth is
// the agent instructions plus the overseer's rebuild-from-transcript
// recovery.
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
// Shell control words: whatever follows one is a fresh command, so it gets
// the same treatment as a word after ; — without this, `if ...; then rm x`
// has `then` swallow the command slot and `rm` passes uninspected.
const SHELL_KEYWORDS = new Set([
  'if', 'then', 'elif', 'else', 'fi',
  'for', 'in', 'while', 'until', 'do', 'done',
  'case', 'esac', '{', '}',
]);
const SEPARATORS = new Set([';', '|', '&', '(', ')', '`', '>', '<', '>>', '<<']);
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

// Splits a shell command into words and operator tokens. Quotes group but
// are stripped; a backslash outside quotes keeps the next character
// literally (an escaped glob character still reads as that character), and
// backslashes inside quotes are kept as-is. A newline separates commands
// like a semicolon, because it does. Operators are single tokens;
// >> and << are merged so the walker can read their targets. $ introduces
// nothing special: $(cmd) splits into the words "$", "(", "cmd" — and the
// walker treats the parenthesized part as a fresh command, which is all
// this hook needs. Quoted or escaped parentheses remain words in the stream;
// whether they mean shell grouping or find-expression grouping is for the
// walker's argument collection, not the tokenizer, to decide.
function splitWords(command) {
  const words = [];
  let word = '';
  let quote = null;
  const flush = () => {
    if (word !== '') {
      words.push(word);
      word = '';
    }
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote !== null) {
      if (c === quote) quote = null;
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c === '&' || c === '|' || c === ';' || c === '(' || c === ')' || c === '`') {
      flush();
      words.push(c);
      continue;
    }
    if (c === '>' || c === '<') {
      flush();
      if (command[i + 1] === c) {
        words.push(c + c);
        i++;
      } else {
        words.push(c);
      }
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') {
      flush();
      continue;
    }
    if (c === '\n') {
      flush();
      words.push(';');
      continue;
    }
    if (c === '\\' && i + 1 < command.length) {
      word += command[i + 1];
      i++;
      continue;
    }
    word += c;
  }
  flush();
  return words;
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
  const words = splitWords(command);
  let expectCommand = true;
  let mode = null; // 'delete' | 'move' while a destructive command's arguments are read
  let redirect = null; // 'out' | 'in' while a redirection's target word comes next

  for (let i = 0; i < words.length; i++) {
    const w = words[i];

    if (redirect !== null && !SEPARATORS.has(w)) {
      // A redirection's parsed target word: an output redirect onto a
      // protected file truncates or overwrites it; an input redirect reads
      // from it, which is fine. Parsing it as a word (quotes stripped,
      // spaces held inside quotes) is what keeps
      // grep -F "> factory-ledger.md" innocent and the real thing denied.
      if (redirect === 'out' && PROTECTED_NAME.test(basename(w))) {
        return reasonProtected(basename(w), 'truncate or overwrite');
      }
      redirect = null;
      continue;
    }
    redirect = null;

    if (SEPARATORS.has(w)) {
      if (w === '>' || w === '>>') {
        redirect = 'out';
      } else if (w === '<' || w === '<<') {
        redirect = 'in';
      } else {
        expectCommand = true;
        mode = null;
      }
      continue;
    }

    if (expectCommand) {
      if (w.startsWith('-') || ASSIGNMENT.test(w)) continue;
      const base = basename(w);
      if (SHELL_KEYWORDS.has(base) || PREFIXES.has(base)) continue;
      expectCommand = false;
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
          i + 1 < words.length &&
          (!SEPARATORS.has(words[i + 1]) || words[i + 1] === '(' || words[i + 1] === ')')
        ) {
          args.push(words[++i]);
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
