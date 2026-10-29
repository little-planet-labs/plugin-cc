#!/bin/sh
# Tests for the little-planet-factory PreToolUse lite-tier hook.
#
# Feeds hook input JSON on stdin to the PreToolUse command registered in
# plugins/little-planet-factory/hooks/hooks.json, run the way Claude Code runs
# it (through a shell, with CLAUDE_PLUGIN_ROOT set), and checks what it prints.
#
# Usage: sh tests/lite-tier-hook.test.sh
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

# The test process may itself run inside a lite session.
unset LPF_TIER CLAUDE_PLUGIN_DATA

tmp_root=${TMPDIR:-/tmp}
WORK=$(mktemp -d "${tmp_root%/}/lite-tier-test.XXXXXX") || exit 1
trap 'rm -rf "$WORK"' EXIT
trap 'exit 130' INT TERM
mkdir -p "$WORK/outputs"
IN="$WORK/in.json"
OUT="$WORK/stdout"
ERR="$WORK/stderr"
REASON="$WORK/reason"
OUTPUT_COUNT=0

HOOK_CMD=$(node -e '
const config = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
process.stdout.write(config.hooks.PreToolUse[0].hooks[0].command);
' "$HOOKS_JSON") || { echo "FAIL: can't read the PreToolUse command from $HOOKS_JSON" >&2; exit 1; }

# run_hook <stdin-file> [VAR=value ...]
run_hook() {
  hook_input=$1
  shift
  env "$@" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" /bin/sh -c "$HOOK_CMD" <"$hook_input" >"$OUT" 2>"$ERR"
  RC=$?
  if [ -s "$OUT" ]; then
    OUTPUT_COUNT=$((OUTPUT_COUNT + 1))
    cp "$OUT" "$WORK/outputs/$OUTPUT_COUNT.json"
  fi
}

# spawn <tool_input JSON> [tool_name] [caller agent_type, "-" to omit]:
# writes a PreToolUse input to $IN. The caller defaults to the overseer.
spawn() {
  caller=${3-$OVERSEER}
  {
    printf '{"session_id":"abc123","transcript_path":"/nonexistent/t.jsonl","cwd":"%s","permission_mode":"default","hook_event_name":"PreToolUse",' "$WORK"
    [ "$caller" != "-" ] && printf '"agent_type":"%s",' "$caller"
    printf '"tool_name":"%s","tool_input":%s,"tool_use_id":"toolu_1"}' "${2:-Agent}" "$1"
  } >"$IN"
}

# Runs the spawn in lite: spawn_lite <tool_input JSON> [tool_name]
spawn_lite() {
  spawn "$@"
  run_hook "$IN" LPF_TIER=lite
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

hooks_json_registers_pre_tool_use() {
  node -e '
const config = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const groups = config.hooks.PreToolUse;
// group 0 is this hook; group 1 is the Bash ledger guard, covered by
// ledger-guard-hook.test.sh — it must stay in this order.
if (!Array.isArray(groups) || groups.length !== 2) throw new Error("expected two PreToolUse groups");
if (groups[0].matcher !== "Agent|Task") throw new Error("matcher is " + groups[0].matcher);
if (groups[0].hooks.length !== 1) throw new Error("expected one hook");
const hook = groups[0].hooks[0];
if (hook.type !== "command") throw new Error("hook type is " + hook.type);
if (!(hook.timeout > 0 && hook.timeout <= 10)) throw new Error("timeout is " + hook.timeout);
if (hook.command !== "sh \"${CLAUDE_PLUGIN_ROOT}/hooks/lite-tier.sh\"") throw new Error("command is " + hook.command);
' "$HOOKS_JSON" 2>"$WORK/extract-error" || fail "hooks.json: $(cat "$WORK/extract-error")"
}

full_tier_does_nothing() {
  for tier in "" full LITE " lite" "lite "; do
    spawn "{\"subagent_type\":\"$WORKER\",\"model\":\"opus\",\"description\":\"x\",\"prompt\":\"y\"}"
    run_hook "$IN" LPF_TIER="$tier"
    expect_silent "LPF_TIER '$tier', opus worker"
  done
  spawn "{\"subagent_type\":\"$WORKER\",\"model\":\"opus\"}"
  run_hook "$IN"
  expect_silent "LPF_TIER unset, opus worker"
  spawn '{"subagent_type":"general-purpose"}'
  run_hook "$IN"
  expect_silent "LPF_TIER unset, general-purpose without model"
}

worker_must_be_sonnet() {
  spawn_lite "{\"subagent_type\":\"$WORKER\",\"model\":\"opus\",\"description\":\"Build the parser\",\"prompt\":\"y\"}"
  expect_deny "worker on opus" 'Lite tier' 'sonnet' "$WORKER" '"opus"' 'model "sonnet"' '[full-tier]' 'approved for full tier'
  spawn_lite "{\"subagent_type\":\"$WORKER\",\"model\":\"sonnet\",\"description\":\"Build the parser\",\"prompt\":\"y\"}"
  expect_silent "worker on sonnet"
  spawn_lite "{\"subagent_type\":\"$WORKER\",\"description\":\"Build the parser\",\"prompt\":\"y\"}"
  expect_deny "worker with no model" 'sonnet' "$WORKER"
  for model in haiku fable Sonnet "sonnet " claude-sonnet-4-5 ""; do
    spawn_lite "{\"subagent_type\":\"$WORKER\",\"model\":\"$model\"}"
    expect_deny "worker on '$model'" 'sonnet' "$WORKER"
  done
  for bad in 42 null true '["sonnet"]' '{}'; do
    spawn_lite "{\"subagent_type\":\"$WORKER\",\"model\":$bad}"
    expect_deny "worker, model $bad" 'sonnet' "$WORKER"
  done
}

other_factory_agents_must_be_sonnet() {
  for agent in inspector researcher signoff; do
    spawn_lite "{\"subagent_type\":\"little-planet-factory:$agent\",\"model\":\"opus\"}"
    expect_deny "$agent on opus" 'sonnet' "little-planet-factory:$agent"
    spawn_lite "{\"subagent_type\":\"little-planet-factory:$agent\"}"
    expect_deny "$agent with no model" 'sonnet' "little-planet-factory:$agent"
    spawn_lite "{\"subagent_type\":\"little-planet-factory:$agent\",\"model\":\"sonnet\"}"
    expect_silent "$agent on sonnet"
  done
}

manager_passes_through() {
  for agent in "$MANAGER"; do
    for model in '' ',"model":"opus"' ',"model":"sonnet"' ',"model":"haiku"'; do
      spawn_lite "{\"subagent_type\":\"$agent\"$model,\"description\":\"Sub-task\"}"
      expect_silent "$agent, model '$model'"
    done
  done
  spawn_lite "{\"subagent_type\":\"$MANAGER\"}" Task
  expect_silent "manager through Task"
  # Only the factory's manager type passes.
  for agent in manager other-plugin:manager Little-Planet-Factory:manager; do
    spawn_lite "{\"subagent_type\":\"$agent\",\"model\":\"opus\"}"
    expect_deny "$agent on opus" "$agent"
    spawn_lite "{\"subagent_type\":\"$agent\"}"
    expect_deny "$agent with no model" "$agent"
  done
}

# Enforced only when the caller is a factory lead; anything else passes.
caller_scope() {
  opus_worker="{\"subagent_type\":\"$WORKER\",\"model\":\"opus\"}"
  for caller in - general-purpose other-plugin:helper other-plugin:overseer \
    little-planet-factory:worker little-planet-factory:inspector little-planet-factory:researcher \
    little-planet-factory:signoff Overseer ""; do
    spawn "$opus_worker" Agent "$caller"
    run_hook "$IN" LPF_TIER=lite
    expect_silent "caller '$caller', opus worker"
    spawn '{"subagent_type":"fork"}' Agent "$caller"
    run_hook "$IN" LPF_TIER=lite
    expect_silent "caller '$caller', fork"
  done
  for bad in 42 null true '["little-planet-factory:overseer"]' '{}'; do
    printf '{"agent_type":%s,"tool_name":"Agent","tool_input":%s}' "$bad" "$opus_worker" >"$IN"
    run_hook "$IN" LPF_TIER=lite
    expect_silent "caller agent_type $bad"
  done
  for caller in "$OVERSEER" "$MANAGER" overseer manager; do
    for tool in Agent Task; do
      spawn "$opus_worker" "$tool" "$caller"
      run_hook "$IN" LPF_TIER=lite
      expect_deny "caller '$caller', $tool, opus worker" "$WORKER"
      spawn "{\"subagent_type\":\"$WORKER\",\"model\":\"sonnet\"}" "$tool" "$caller"
      run_hook "$IN" LPF_TIER=lite
      expect_silent "caller '$caller', $tool, sonnet worker"
    done
    spawn '{"subagent_type":"general-purpose"}' Agent "$caller"
    run_hook "$IN" LPF_TIER=lite
    expect_deny "caller '$caller', general-purpose, no model" general-purpose
    spawn '{"subagent_type":"fork","model":"sonnet"}' Agent "$caller"
    run_hook "$IN" LPF_TIER=lite
    expect_deny "caller '$caller', fork" fork
    spawn "$opus_worker" Agent "$caller"
    run_hook "$IN"
    expect_silent "caller '$caller', LPF_TIER unset"
  done
}

# A fork inherits its caller's model and ignores the per-call one, so it's
# denied whatever model or marker it passes.
fork_is_always_denied() {
  for model in '' ',"model":"sonnet"' ',"model":"opus"' ',"model":"haiku"'; do
    for description in 'Fork it' '[full-tier] Fork it'; do
      spawn_lite "{\"subagent_type\":\"fork\"$model,\"description\":\"$description\"}"
      expect_deny "fork, model '$model', description '$description'" 'Lite tier' 'fork' "inherits the caller's model" 'ignores "model"' 'model "sonnet"'
    done
  done
  spawn_lite '{"subagent_type":"fork","model":"sonnet"}' Task
  expect_deny "fork through Task" 'fork'
  spawn '{"subagent_type":"fork","model":"opus"}'
  run_hook "$IN"
  expect_silent "fork, LPF_TIER unset"
}

non_factory_agents_must_be_sonnet() {
  for agent in general-purpose Explore Plan other-plugin:helper; do
    spawn_lite "{\"subagent_type\":\"$agent\",\"model\":\"opus\"}"
    expect_deny "$agent on opus" 'sonnet' "$agent"
    spawn_lite "{\"subagent_type\":\"$agent\"}"
    expect_deny "$agent with no model" 'sonnet' "$agent"
    spawn_lite "{\"subagent_type\":\"$agent\",\"model\":\"sonnet\"}"
    expect_silent "$agent on sonnet"
  done
}

missing_subagent_type_is_general_purpose() {
  spawn_lite '{"model":"opus","description":"x","prompt":"y"}'
  expect_deny "no subagent_type, opus" 'sonnet' 'general-purpose'
  spawn_lite '{"description":"x","prompt":"y"}'
  expect_deny "no subagent_type, no model" 'sonnet' 'general-purpose'
  for bad in '""' 42 null '["manager"]'; do
    spawn_lite "{\"subagent_type\":$bad,\"model\":\"opus\"}"
    expect_deny "subagent_type $bad" 'general-purpose'
  done
  spawn_lite '{"model":"sonnet"}'
  expect_silent "no subagent_type, sonnet"
  spawn_lite '{}'
  expect_deny "empty tool_input" 'general-purpose'
}

full_tier_marker_allows_opus_only() {
  spawn_lite "{\"subagent_type\":\"$WORKER\",\"model\":\"opus\",\"description\":\"[full-tier] Fix the sync merge\"}"
  expect_silent "[full-tier] worker on opus"
  spawn_lite "{\"subagent_type\":\"little-planet-factory:inspector\",\"model\":\"opus\",\"description\":\"Inspect sync [full-tier]\"}"
  expect_silent "[full-tier] inspector on opus"
  spawn_lite "{\"subagent_type\":\"$WORKER\",\"model\":\"sonnet\",\"description\":\"[full-tier] x\"}"
  expect_silent "[full-tier] worker on sonnet"
  for model in fable haiku Opus; do
    spawn_lite "{\"subagent_type\":\"$WORKER\",\"model\":\"$model\",\"description\":\"[full-tier] x\"}"
    expect_deny "[full-tier] worker on $model" "$model"
  done
  spawn_lite "{\"subagent_type\":\"$WORKER\",\"description\":\"[full-tier] x\"}"
  expect_deny "[full-tier] worker with no model" "$WORKER"
  # The marker must be exact, and in the description.
  for description in 'full-tier x' '[Full-Tier] x' '[full tier] x'; do
    spawn_lite "{\"subagent_type\":\"$WORKER\",\"model\":\"opus\",\"description\":\"$description\"}"
    expect_deny "description '$description', opus" "$WORKER"
  done
  spawn_lite "{\"subagent_type\":\"$WORKER\",\"model\":\"opus\",\"description\":\"x\",\"prompt\":\"[full-tier]\"}"
  expect_deny "marker only in the prompt" "$WORKER"
  spawn_lite "{\"subagent_type\":\"$WORKER\",\"model\":\"opus\",\"description\":[\"[full-tier]\"]}"
  expect_deny "non-string description" "$WORKER"
}

task_tool_name_is_handled() {
  spawn_lite "{\"subagent_type\":\"$WORKER\",\"model\":\"opus\"}" Task
  expect_deny "Task, worker on opus" 'sonnet' "$WORKER"
  spawn_lite "{\"subagent_type\":\"$WORKER\",\"model\":\"sonnet\"}" Task
  expect_silent "Task, worker on sonnet"
}

other_tools_are_ignored() {
  for tool in Bash Read Edit AgentX mcp__x__Agent; do
    spawn_lite "{\"subagent_type\":\"$WORKER\",\"model\":\"opus\",\"command\":\"ls\"}" "$tool"
    expect_silent "tool $tool"
  done
}

reason_quotes_offending_values() {
  spawn_lite '{"subagent_type":"weird \"type\" \\ name","model":"opus"}'
  expect_deny "type with characters JSON escapes" 'weird "type" \ name'
}

garbage_stdin_is_silent() {
  for garbage in 'not json {' '[1,2,3]' 'null' '"a string"' '42' '{"tool_name":' "$(printf '\377\376\000')"; do
    printf '%s' "$garbage" >"$IN"
    run_hook "$IN" LPF_TIER=lite
    expect_silent "stdin '$garbage'"
  done
  : >"$IN"
  run_hook "$IN" LPF_TIER=lite
  expect_silent "empty stdin"
  run_hook /dev/null LPF_TIER=lite
  expect_silent "stdin from /dev/null"
  for bad in 42 null '"x"' '["model"]'; do
    printf '{"agent_type":"%s","tool_name":"Agent","tool_input":%s}' "$OVERSEER" "$bad" >"$IN"
    run_hook "$IN" LPF_TIER=lite
    # A tool_input that isn't an object counts as an empty one: general-purpose
    # with no model, so it's denied rather than let through.
    expect_deny "tool_input $bad" 'general-purpose'
  done
}

oversized_stdin_is_silent() {
  node -e '
const pad = "x".repeat(1100 * 1024);
process.stdout.write(JSON.stringify({ agent_type: "little-planet-factory:overseer", tool_name: "Agent", tool_input: { subagent_type: "general-purpose", model: "opus", prompt: pad } }));
' >"$IN"
  run_hook "$IN" LPF_TIER=lite
  expect_silent "stdin over 1 MiB"
}

missing_node_is_silent() {
  d=$(mktemp -d "$WORK/case.XXXXXX")
  mkdir "$d/bin"
  ln -s "$(command -v sh)" "$d/bin/sh"
  if env PATH="$d/bin" /bin/sh -c 'command -v node' >/dev/null 2>&1; then
    fail "test setup: node is still reachable"
    return
  fi
  # With node this input is denied, so silence means the wrapper stopped.
  spawn "{\"subagent_type\":\"$WORKER\",\"model\":\"opus\"}"
  run_hook "$IN" LPF_TIER=lite PATH="$d/bin"
  expect_silent "no node on PATH"
}

never_allows() {
  for file in "$WORK"/outputs/*.json; do
    grep -q '"allow"' "$file" && fail "$(basename "$file") contains allow"
    grep -q 'updatedInput' "$file" && fail "$(basename "$file") contains updatedInput"
  done
  [ "$OUTPUT_COUNT" -gt 0 ] || fail "no outputs were recorded, so nothing was checked"
  echo "    checked $OUTPUT_COUNT outputs"
}

run_test hooks_json_registers_pre_tool_use
run_test full_tier_does_nothing
run_test worker_must_be_sonnet
run_test other_factory_agents_must_be_sonnet
run_test manager_passes_through
run_test fork_is_always_denied
run_test caller_scope
run_test non_factory_agents_must_be_sonnet
run_test missing_subagent_type_is_general_purpose
run_test full_tier_marker_allows_opus_only
run_test task_tool_name_is_handled
run_test other_tools_are_ignored
run_test reason_quotes_offending_values
run_test garbage_stdin_is_silent
run_test oversized_stdin_is_silent
run_test missing_node_is_silent
run_test never_allows

echo
echo "$PASSED passed, $FAILED failed"
[ "$FAILED" -eq 0 ]
