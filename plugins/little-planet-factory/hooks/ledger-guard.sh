#!/bin/sh
# PreToolUse hook guarding the factory's session state files. Runs
# ledger-guard.mjs with Node. It must never break or slow a session: without
# node on PATH it exits silently (failing open, so commands go through and
# the prompt rules alone apply), and it always exits 0 with nothing on
# stderr.

command -v node >/dev/null 2>&1 || exit 0

case "$0" in
  */*) hook_dir=${0%/*} ;;
  *) hook_dir=. ;;
esac

node "$hook_dir/ledger-guard.mjs" 2>/dev/null
exit 0
