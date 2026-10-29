#!/bin/sh
# Tests for the little-planet-factory PreToolUse ledger-guard hook.
#
# Feeds hook input JSON on stdin to the Bash PreToolUse command registered in
# plugins/little-planet-factory/hooks/hooks.json, run the way Claude Code runs
# it (through a shell, with CLAUDE_PLUGIN_ROOT set), and checks what it
# prints.
#
# Usage: sh tests/ledger-guard-hook.test.sh
# Needs node on PATH (the hook needs it too). Prints PASS/FAIL per test and
# exits non-zero if any test fails.

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
PLUGIN_ROOT="$REPO_ROOT/plugins/little-planet-factory"
HOOKS_JSON="$PLUGIN_ROOT/hooks/hooks.json"
WORKER=little-planet-factory:worker
MANAGER=little-planet-factory:manager
OVERSEER=little-planet-factory:overseer

if ! command -v node >/dev/null 2>&1; then
  echo "FAIL: node is required to run these tests" >&2
  exit 1
fi

# The test process may itself run inside a plugin hook environment.
unset LPF_TIER CLAUDE_PLUGIN_DATA

tmp_root=${TMPDIR:-/tmp}
WORK=$(mktemp -d "${tmp_root%/}/ledger-guard-test.XXXXXX") || exit 1
trap 'rm -rf "$WORK"' EXIT
trap 'exit 130' INT TERM
IN="$WORK/in.json"
OUT="$WORK/stdout"
ERR="$WORK/stderr"
REASON="$WORK/reason"

HOOK_CMD=$(node -e '
const config = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const group = (config.hooks.PreToolUse || []).find((g) => (g.matcher || "").split("|").includes("Bash"));
if (!group) throw new Error("no Bash PreToolUse group");
process.stdout.write(group.hooks[0].command);
' "$HOOKS_JSON") || { echo "FAIL: can't read the Bash PreToolUse command from $HOOKS_JSON" >&2; exit 1; }

# run_hook <stdin-file> [VAR=value ...]
run_hook() {
  hook_input=$1
  shift
  env "$@" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" /bin/sh -c "$HOOK_CMD" <"$hook_input" >"$OUT" 2>"$ERR"
  RC=$?
}

# bash_call <command> [caller agent_type, "-" to omit] [tool_name]:
# writes a PreToolUse Bash input to $IN and runs the hook.
bash_call() {
  caller=${2:-$WORKER}
  {
    printf '{"session_id":"abc123","transcript_path":"/nonexistent/t.jsonl","cwd":"%s","permission_mode":"default","hook_event_name":"PreToolUse",' "$WORK"
    [ "$caller" != "-" ] && printf '"agent_type":"%s",' "$caller"
    printf '"tool_name":"%s","tool_input":{"command":%s},"tool_use_id":"toolu_1"}' \
      "${3:-Bash}" "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1")"
  } >"$IN"
  run_hook "$IN"
}

T_OK=1
fail() {
  T_OK=0
  echo "    $1"
}

expect_silent() {
  [ "$RC" -eq 0 ] || fail "$1: exit code $RC, expected 0"
  [ -s "$OUT" ] && fail "$1: expected no stdout, got: $(head -c 300 "$OUT")"
  [ -s "$ERR" ] && fail "$1: expected no stderr, got: $(head -c 300 "$ERR")"
}

# Parses $OUT as a deny and writes permissionDecisionReason to $REASON.
extract_deny() {
  node -e '
const fs = require("fs");
const out = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const keys = Object.keys(out);
if (keys.length !== 1 || keys[0] !== "hookSpecificOutput") throw new Error("unexpected top-level keys " + keys);
const s = out.hookSpecificOutput;
const sk = Object.keys(s).sort().join();
if (sk !== "hookEventName,permissionDecision,permissionDecisionReason") throw new Error("unexpected keys " + sk);
if (s.hookEventName !== "PreToolUse") throw new Error("hookEventName is " + s.hookEventName);
if (s.permissionDecision !== "deny") throw new Error("permissionDecision is " + s.permissionDecision);
if (typeof s.permissionDecisionReason !== "string" || s.permissionDecisionReason === "") throw new Error("no reason");
fs.writeFileSync(process.argv[2], s.permissionDecisionReason);
' "$OUT" "$REASON" 2>"$WORK/extract-error"
}

# bash_call_file <file-with-command> [caller agent_type, "-" to omit]:
# like bash_call, but reads the command from a file — for multiline or
# quote-heavy payloads.
bash_call_file() {
  caller=${2:-$WORKER}
  {
    printf '{"session_id":"abc123","transcript_path":"/nonexistent/t.jsonl","cwd":"%s","permission_mode":"default","hook_event_name":"PreToolUse",' "$WORK"
    [ "$caller" != "-" ] && printf '"agent_type":"%s",' "$caller"
    printf '"tool_name":"%s","tool_input":{"command":%s},"tool_use_id":"toolu_1"}' \
      "Bash" "$(node -e 'process.stdout.write(JSON.stringify(require("fs").readFileSync(process.argv[1],"utf8")))' "$1")"
  } >"$IN"
  run_hook "$IN"
}

# write_call <tool_name> <file_path> [caller agent_type, "-" to omit]:
# writes a PreToolUse Edit/Write input to $IN and runs the hook.
write_call() {
  caller=${3:-$WORKER}
  {
    printf '{"session_id":"abc123","transcript_path":"/nonexistent/t.jsonl","cwd":"%s","permission_mode":"default","hook_event_name":"PreToolUse",' "$WORK"
    [ "$caller" != "-" ] && printf '"agent_type":"%s",' "$caller"
    printf '"tool_name":"%s","tool_input":{"file_path":%s,"content":"x","old_string":"a","new_string":"b"},"tool_use_id":"toolu_1"}' \
      "$1" "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$2")"
  } >"$IN"
  run_hook "$IN"
}

# expect_deny <label> [text the reason must contain ...]
expect_deny() {
  label=$1
  shift
  [ "$RC" -eq 0 ] || fail "$label: exit code $RC, expected 0"
  [ -s "$ERR" ] && fail "$label: expected no stderr, got: $(head -c 300 "$ERR")"
  if [ ! -s "$OUT" ]; then
    fail "$label: expected a deny, got no output"
    return
  fi
  if ! extract_deny; then
    fail "$label: output isn't a valid deny: $(cat "$WORK/extract-error")"
    return
  fi
  for text in "$@"; do
    grep -qF -- "$text" "$REASON" || fail "$label: reason lacks '$text': $(cat "$REASON")"
  done
}

PASSED=0
FAILED=0
run_test() {
  T_OK=1
  "$1"
  if [ "$T_OK" -eq 1 ]; then
    echo "PASS $1"
    PASSED=$((PASSED + 1))
  else
    echo "FAIL $1"
    FAILED=$((FAILED + 1))
  fi
}

# ---------------------------------------------------------------------------

hooks_json_registers_bash_guard() {
  node -e '
const config = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const groups = config.hooks.PreToolUse;
if (!Array.isArray(groups) || groups.length !== 2) throw new Error("expected two PreToolUse groups");
// The lite-tier test and hook rely on group order; keep this group second.
if (groups[0].matcher !== "Agent|Task") throw new Error("group 0 matcher is " + groups[0].matcher);
if (groups[1].matcher !== "Bash|Edit|MultiEdit|Write") throw new Error("group 1 matcher is " + groups[1].matcher);
const hook = groups[1].hooks[0];
if (hook.type !== "command") throw new Error("hook type is " + hook.type);
if (!hook.command.includes("ledger-guard.sh")) throw new Error("command is " + hook.command);
if (!(hook.timeout > 0 && hook.timeout <= 10)) throw new Error("timeout is " + hook.timeout);
' "$HOOKS_JSON" 2>"$WORK/extract-error" || fail "hooks.json: $(cat "$WORK/extract-error")"
}

# The incident this hook exists for: a worker's cleanup glob over the shared
# session scratchpad, plus the other glob shapes.
glob_deletes_are_denied() {
  bash_call 'rm -f /Users/x/.claude/scratchpad/sess-123/*'
  expect_deny "worker, the incident command" "glob" "overseer"
  bash_call 'rm -rf /tmp/build-cache/*'
  expect_deny "worker, rm -rf over a glob" "glob"
  bash_call 'rm *.log'
  expect_deny "worker, bare glob in cwd" "glob"
  bash_call 'cd /sessions/s1/scratchpad && rm -f *'
  expect_deny "worker, cd then glob" "glob"
  bash_call 'rm -f "/x/scratchpad/"*'
  expect_deny "worker, quoted directory with glob" "glob"
  bash_call 'rm -f "/x/scratchpad/*"'
  expect_deny "worker, whole glob quoted (conservative)" "glob"
  bash_call 'rm -f ?.md'
  expect_deny "worker, question-mark glob" "glob"
  bash_call 'rm -f /tmp/[ao].tmp'
  expect_deny "worker, character-class glob" "glob"
  bash_call 'find /x/scratchpad -name "*.tmp" -delete'
  expect_deny "worker, find -delete with a pattern" "glob"
  bash_call 'rm -f /a/* /b/*.log; rm /c/x'
  expect_deny "worker, glob in one of several targets" "glob"
}

state_file_deletes_are_denied() {
  bash_call 'rm -f /x/scratchpad/factory-ledger.md'
  expect_deny "worker, the ledger, absolute" "factory-ledger.md" "session state"
  bash_call 'rm /x/scratchpad/factory-request.md'
  expect_deny "worker, the request file" "factory-request.md"
  bash_call 'unlink factory-review-42.md'
  expect_deny "worker, a review record, relative" "factory-review-42.md"
  bash_call 'shred -u ../factory-ledger-ui-panel.md'
  expect_deny "worker, a manager ledger" "factory-ledger-ui-panel.md"
  bash_call 'cd /x/scratchpad && rm factory-ledger.md'
  expect_deny "worker, cd then delete" "factory-ledger.md"
  bash_call 'sudo rm -f factory-ledger.md'
  expect_deny "worker, through sudo" "factory-ledger.md"
  bash_call 'env FOO=1 rm -f factory-ledger.md'
  expect_deny "worker, through env assignment" "factory-ledger.md"
  bash_call 'ls /x | xargs rm factory-ledger.md'
  expect_deny "worker, through xargs" "factory-ledger.md"
  bash_call "$(printf 'ls /tmp\nrm -f /x/factory-request.md\n')"
  expect_deny "worker, second line of a multi-line command" "factory-request.md"
}

state_file_moves_and_truncations_are_denied() {
  bash_call 'mv factory-ledger.md /tmp/'
  expect_deny "worker, moving the ledger away" "factory-ledger.md" "move or overwrite"
  bash_call 'mv /tmp/notes.md factory-request.md'
  expect_deny "worker, renaming over the request file" "factory-request.md"
  bash_call 'echo cleared > factory-ledger.md'
  expect_deny "worker, truncate by redirect" "factory-ledger.md" "truncate or overwrite"
  bash_call 'echo cleared >> factory-ledger.md'
  expect_deny "worker, append by redirect" "factory-ledger.md"
  bash_call 'some-test 2> factory-review-9.md'
  expect_deny "worker, stderr onto a review record" "factory-review-9.md"
  bash_call 'echo cleared > "factory-ledger.md"'
  expect_deny "worker, quoted redirect target" "factory-ledger.md"
  bash_call 'echo cleared > ./factory-ledger.md'
  expect_deny "worker, dot-slash redirect target" "factory-ledger.md"
  bash_call 'echo x | tee factory-request.md'
  expect_deny "worker, through tee" "factory-request.md"
}

# Copilot review findings on PR #4: compound-syntax command slots, grouped
# find expressions, and redirection parsing under quoting.
compound_syntax_and_quoting() {
  bash_call 'if [ -f factory-ledger.md ]; then rm factory-ledger.md; fi'
  expect_deny "conditional delete after then" "factory-ledger.md"
  bash_call 'for d in a b; do rm -f factory-request.md; done'
  expect_deny "loop body delete after do" "factory-request.md"
  bash_call 'if true; then rm -f /x/scratchpad/*; fi'
  expect_deny "conditional glob cleanup after then" "glob"
  bash_call 'while read f; do rm -rf /x/*; done < /tmp/list'
  expect_deny "loop body glob after do" "glob"
  bash_call 'case $f in *) rm -f *;; esac'
  expect_deny "rm in a case arm" "glob"
  bash_call '{ rm -f /x/*; }'
  expect_deny "delete inside a brace group" "glob"
  bash_call '! rm -f /x/scratchpad/*'
  expect_deny "negated glob delete" "glob"
  bash_call 'exec rm -f factory-ledger.md'
  expect_deny "through exec" "factory-ledger.md"
  bash_call 'eval rm -f /x/*'
  expect_deny "through eval, unquoted" "glob"

  bash_call 'find . -type f \( -name "*.md" -o -name "*.tmp" \) -delete'
  expect_deny "find, escaped-paren group with -delete" "glob"
  bash_call 'find . "(" -name "*.tmp" ")" -delete'
  expect_deny "find, quoted-paren group with -delete" "glob"
  bash_call 'find /x \( -name "factory-ledger.md" \) -delete'
  expect_deny "find, protected name in a group" "factory-ledger.md"

  bash_call 'printf x > "/tmp/my scratchpad/factory-ledger.md"'
  expect_deny "redirect target with a quoted space" "factory-ledger.md" "truncate or overwrite"
  bash_call ': > "$DIR"/factory-ledger.md'
  expect_deny "colon truncate, composite quoting" "factory-ledger.md"

  # The regex-based redirect check these replace could not tell quoted text
  # from an operator: these must pass.
  bash_call 'grep -F "> factory-ledger.md" README.md'
  expect_silent "grep -F of a redirect-looking string"
  bash_call 'printf "rm factory-ledger.md"'
  expect_silent "printf of a delete-looking string"
  bash_call 'cat < factory-ledger.md'
  expect_silent "input redirect reads the ledger"
  bash_call 'while read l; do echo "$l"; done < factory-request.md'
  expect_silent "loop reading the request file"
  bash_call 'if [ -f factory-ledger.md ]; then echo yes; fi'
  expect_silent "test -f on the ledger"
  bash_call 'case $f in factory-ledger.md) echo hit;; esac'
  expect_silent "case pattern naming the ledger"
  bash_call 'echo hi > /tmp/ordinary.md'
  expect_silent "redirect onto an ordinary file"
}

benign_commands_pass() {
  bash_call 'rm -f /Users/x/.claude/scratchpad/sess-123/worker-script.sh'
  expect_silent "worker, own temp file by exact path"
  bash_call 'rm -rf /tmp/dd-slot-1'
  expect_silent "worker, exact directory path"
  bash_call 'rm -rf /x/scratchpad'
  expect_silent "worker, exact scratchpad path (no glob)"
  bash_call 'mv /tmp/a.md /tmp/b.md'
  expect_silent "worker, ordinary mv"
  bash_call 'mv src/*.generated.ts archive/'
  expect_silent "worker, mv with a glob is not a delete"
  bash_call 'ls /x/scratchpad'
  expect_silent "worker, ls"
  bash_call 'cat factory-ledger.md'
  expect_silent "worker, reading the ledger"
  bash_call 'grep -n "rm" factory-ledger.md'
  expect_silent "worker, grep containing rm"
  bash_call 'find . -name "*.tmp"'
  expect_silent "worker, find without -delete"
  bash_call 'find /x -type f -name "*.log"'
  expect_silent "worker, read-only find with a pattern"
  bash_call 'echo "use rm -f * carefully"'
  expect_silent "worker, glob inside an echo string"
  bash_call 'echo factory-ledger.md'
  expect_silent "worker, echoing a ledger name"
  bash_call 'git status && git diff --stat'
  expect_silent "worker, git reads"
}

# Copilot round 2 on PR #4: clobber redirects, line continuations, prefix
# option values, comments, quoted operator words, and heredoc bodies.
token_identity_comments_heredocs() {
  bash_call ': >| factory-ledger.md'
  expect_deny "clobber redirect onto the ledger" "factory-ledger.md" "truncate or overwrite"
  bash_call 'echo x >& factory-request.md'
  expect_deny "both-streams redirect onto the request file" "factory-request.md"
  bash_call "$(printf 'rm -f \\\nfactory-ledger.md')"
  expect_deny "backslash-newline continuation into the ledger" "factory-ledger.md"
  bash_call "$(printf 'rm -f x \\\n  /x/scratchpad/*')"
  expect_deny "indented continuation into a glob" "glob"
  bash_call 'nice -n 5 rm -f factory-ledger.md'
  expect_deny "nice -n with a separate value" "factory-ledger.md"
  bash_call 'sudo -u root rm -f factory-ledger.md'
  expect_deny "sudo -u with a separate value" "factory-ledger.md"
  bash_call 'xargs -n 1 rm -f factory-ledger.md'
  expect_deny "xargs -n with a separate value" "factory-ledger.md"
  bash_call 'sudo nice -n 5 rm -f factory-ledger.md'
  expect_deny "nested prefixes with an option value" "factory-ledger.md"
  bash_call "$(printf '# Clean up the worker%ss files\nrm -f /tmp/cache/*' "'")"
  expect_deny "comment with an apostrophe, then a real glob delete" "glob"

  cat >"$WORK/heredoc-quoted" <<'OUTER'
cat > /tmp/cleanup.sh <<'EOF'
rm -f /tmp/cache/*
EOF
echo done
OUTER
  bash_call_file "$WORK/heredoc-quoted"
  expect_silent "quoted heredoc body holding a glob delete is data"
  cat >"$WORK/heredoc-dashed" <<'OUTER'
cat > /tmp/cleanup.sh <<-'EOF'
rm -f /tmp/cache/*
EOF
OUTER
  bash_call_file "$WORK/heredoc-dashed"
  expect_silent "quoted <<- heredoc body is data too"
  cat >"$WORK/heredoc-unquoted" <<'OUTER'
cat > /tmp/x.sh <<EOF
rm -f /tmp/cache/*
EOF
OUTER
  bash_call_file "$WORK/heredoc-unquoted"
  expect_deny "unquoted heredoc body (substitutions execute) still scanned" "glob"

  # Benign neighbors of the same syntax.
  bash_call 'grep "^[>%]" factory-ledger.md'
  expect_silent "quoted > inside a pattern word"
  bash_call "grep '>' factory-ledger.md"
  expect_silent "standalone quoted > argument is data, not an operator"
  bash_call 'echo x 2>&1'
  expect_silent "stderr dup, no file target"
  bash_call 'echo -n no-newline'
  expect_silent "echo -n"
  bash_call 'time -p ls factory-ledger.md'
  expect_silent "-p flag without a value"
}


state_file_writes_are_denied() {
  write_call Edit /x/scratchpad/factory-ledger.md
  expect_deny "worker, Edit the ledger" "factory-ledger.md" "brief is wrong"
  write_call Write /x/scratchpad/factory-request.md
  expect_deny "worker, Write the request file" "factory-request.md"
  write_call MultiEdit /x/scratchpad/factory-review-3.md
  expect_deny "worker, MultiEdit a review record" "factory-review-3.md"
  write_call Write /x/factory-ledger-ingest.md little-planet-factory:researcher
  expect_deny "researcher, Write a manager-shaped ledger" "factory-ledger-ingest.md"

  # The only writers the ledger format has: the overseer and managers.
  write_call Write /x/scratchpad/factory-ledger.md "$OVERSEER"
  expect_silent "overseer writing its ledger"
  write_call Write "$WORK/factory-request.md" overseer
  expect_silent "bare overseer writing the request file"
  write_call Edit /x/scratchpad/factory-ledger-ui-panel.md "$MANAGER"
  expect_silent "manager writing its own ledger"
  write_call Write /x/scratchpad/factory-ledger.md -
  expect_silent "plain session writing a same-named file"

  # Near-miss names are not state files.
  write_call Write /x/factory-ledgering.md
  expect_silent "worker, factory-ledgering.md isn't state"
  write_call Write /x/factory-ledger.md.bak
  expect_silent "worker, factory-ledger.md.bak isn't state"
  write_call Write /x/factory-ledger.md.txt
  expect_silent "worker, factory-ledger.md.txt isn't state"
}

bare_and_builtin_agent_types_are_denied() {
  bash_call 'rm -f /x/scratchpad/*' worker
  expect_deny "bare worker" "glob"
  bash_call 'rm -f /x/scratchpad/*' "$MANAGER"
  expect_deny "namespaced manager" "glob"
  bash_call 'rm -f /x/factory-ledger.md' manager
  expect_deny "bare manager, ledger" "factory-ledger.md"
  bash_call 'rm -f /x/scratchpad/*' little-planet-factory:inspector
  expect_deny "namespaced inspector" "glob"
  bash_call 'rm -f /x/scratchpad/*' little-planet-factory:researcher
  expect_deny "namespaced researcher" "glob"
  bash_call 'rm -f /x/scratchpad/*' little-planet-factory:signoff
  expect_deny "namespaced signoff" "glob"
  bash_call 'rm -f /x/scratchpad/*' general-purpose
  expect_deny "built-in general-purpose" "glob"
  bash_call 'rm -f /x/factory-request.md' some-other-plugin:cleanup
  expect_deny "another plugin's agent, request file" "factory-request.md"
}

# The hook binds the overseer too — its own cleanup rule already says exact
# paths only, never a glob, and never the state files — and leaves the
# user's plain (agent-less) session alone.
overseer_bound_user_session_free() {
  bash_call 'rm -f /x/scratchpad/*' "$OVERSEER"
  expect_deny "overseer, glob wipe" "glob"
  bash_call 'rm -f /x/scratchpad/factory-ledger.md' "$OVERSEER"
  expect_deny "overseer, the ledger" "factory-ledger.md"
  bash_call 'rm -rf /x/scratchpad/dd-session-1' "$OVERSEER"
  expect_silent "overseer, exact session build directory"
  bash_call 'rm -f /x/scratchpad/dd-1.txt /x/scratchpad/dd-2.txt' "$OVERSEER"
  expect_silent "overseer, several exact paths"
  bash_call 'rm -f /x/scratchpad/*' -
  expect_silent "no agent_type, glob"
  bash_call 'rm -f /x/factory-ledger.md' -
  expect_silent "no agent_type, the ledger"
}

malformed_inputs_pass() {
  for garbage in 'not json {' '[1,2,3]' 'null' '"a string"' '42'; do
    printf '%s' "$garbage" >"$IN"
    run_hook "$IN"
    expect_silent "stdin '$garbage'"
  done
  : >"$IN"
  run_hook "$IN"
  expect_silent "empty stdin"
  run_hook /dev/null
  expect_silent "stdin from /dev/null"
  # Tools outside the matcher aren't this hook's concern even with a
  # dangerous-looking payload.
  bash_call 'rm -f /x/scratchpad/*' "$WORKER" NotebookEdit
  expect_silent "tool_name NotebookEdit"
  printf '{"tool_name":"Write","agent_type":"%s","tool_input":{"file_path":42}}' "$WORKER" >"$IN"
  run_hook "$IN"
  expect_silent "file_path is a number"
  printf '{"tool_name":"Bash","agent_type":"%s","tool_input":{"command":42}}' "$WORKER" >"$IN"
  run_hook "$IN"
  expect_silent "command is a number"
  printf '{"tool_name":"Bash","agent_type":"%s"}' "$WORKER" >"$IN"
  run_hook "$IN"
  expect_silent "no tool_input"
  printf '{"tool_name":"Bash","agent_type":"%s","tool_input":{"command":""}}' "$WORKER" >"$IN"
  run_hook "$IN"
  expect_silent "empty command"
}

missing_node_is_silent() {
  d=$(mktemp -d "$WORK/nonode.XXXXXX")
  mkdir "$d/bin"
  ln -s "$(command -v sh)" "$d/bin/sh"
  if env PATH="$d/bin" /bin/sh -c 'command -v node' >/dev/null 2>&1; then
    fail "test setup: node is still reachable"
    return
  fi
  # With node this input would be denied, so silence means the wrapper
  # stopped because node is missing.
  bash_call 'rm -f /x/factory-ledger.md'
  cp "$IN" "$d/in.json"
  run_hook "$d/in.json" PATH="$d/bin"
  expect_silent "no node on PATH"
}

standalone_mjs_denies_the_incident() {
  # The registered wrapper resolves the .mjs next to itself; run it directly
  # too so a copy or symlink of either file can't drift apart silently.
  bash_call 'rm -f /x/scratchpad/*'
  cp "$IN" "$WORK/direct.json"
  run_hook "$WORK/direct.json"
  expected=$OUT
  node "$PLUGIN_ROOT/hooks/ledger-guard.mjs" <"$WORK/direct.json" >"$WORK/direct-out" 2>"$WORK/direct-err"
  rc=$?
  [ "$rc" -eq 0 ] || fail "direct .mjs: exit code $rc"
  [ -s "$WORK/direct-err" ] && fail "direct .mjs: stderr: $(head -c 300 "$WORK/direct-err")"
  [ "$(cksum <"$expected")" = "$(cksum <"$WORK/direct-out")" ] || fail "direct .mjs output differs from the wrapper's"
}

run_test hooks_json_registers_bash_guard
run_test glob_deletes_are_denied
run_test state_file_deletes_are_denied
run_test state_file_moves_and_truncations_are_denied
run_test compound_syntax_and_quoting
run_test token_identity_comments_heredocs
run_test state_file_writes_are_denied
run_test benign_commands_pass
run_test bare_and_builtin_agent_types_are_denied
run_test overseer_bound_user_session_free
run_test malformed_inputs_pass
run_test missing_node_is_silent
run_test standalone_mjs_denies_the_incident

echo
echo "$PASSED passed, $FAILED failed"
[ "$FAILED" -eq 0 ]
