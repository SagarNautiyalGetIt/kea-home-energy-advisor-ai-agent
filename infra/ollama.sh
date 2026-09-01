#!/usr/bin/env bash
# Bring up the local model. Idempotent — safe to run when it is already running.
#
#   ./infra/ollama.sh start    # start the daemon if needed, pull the model if missing
#   ./infra/ollama.sh status
#   ./infra/ollama.sh stop
#
# Ollama runs NATIVE, never in Docker: the container has no access to the Apple GPU,
# and on Apple Silicon that is the whole reason the model is fast enough to demo.
#
# ## Why this script exists
#
# `make dev` used to start Postgres, the API and the web server, and then leave the
# model to whoever remembered. The result is an app that looks fully up — /health says
# ok, the dashboard renders real figures — while every assistant answer silently falls
# back to the bullet-list template. That failure is invisible unless you know what a
# narrated answer is supposed to look like.
#
# ## Finding the binary
#
# In PATH order, then the per-user install. There is deliberately no download here:
# fetching 1.4 GB as a side effect of `make dev` is not something a Makefile should do
# behind your back. If nothing is installed it prints the command and exits non-zero.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${OLLAMA_PORT:-11434}"
HOST="http://localhost:$PORT"
LOG="$ROOT/.ollama.log"

# The model the API will ask for. Matches app/hardware.py's floor; on Apple Silicon the
# API picks a larger one, so override to match:  KEA_OLLAMA_MODEL=gemma3:27b make ollama
MODEL="${KEA_OLLAMA_MODEL:-gemma3:4b}"

find_ollama() {
  if command -v ollama >/dev/null 2>&1; then command -v ollama; return; fi
  for candidate in "$HOME/.local/ollama/bin/ollama" "/usr/local/bin/ollama" \
                   "/opt/homebrew/bin/ollama" "/Applications/Ollama.app/Contents/Resources/ollama"; do
    [ -x "$candidate" ] && { echo "$candidate"; return; }
  done
  return 1
}

running() { curl -sf -m 2 "$HOST/api/tags" >/dev/null 2>&1; }

start() {
  local bin
  if ! bin="$(find_ollama)"; then
    cat >&2 <<'EOS'
ollama is not installed.

  macOS:  brew install ollama          (or the app from ollama.com)
  Linux:  mkdir -p ~/.local/ollama && cd ~/.local/ollama \
            && curl -fL https://github.com/ollama/ollama/releases/latest/download/ollama-linux-amd64.tar.zst \
               | tar --zstd -x

Note the asset is .tar.zst, not .tgz — the older ollama.com/download/*.tgz URL
now redirects to a release asset that no longer exists and 404s.
EOS
    return 1
  fi

  if running; then
    echo "ollama already running on :$PORT"
  else
    echo "starting ollama ($bin) ..."
    nohup "$bin" serve >"$LOG" 2>&1 &
    for _ in $(seq 1 40); do running && break; sleep 1; done
    running || { echo "ollama did not come up — see $LOG" >&2; return 1; }
    echo "ollama ready on :$PORT"
  fi

  if "$bin" list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "$MODEL"; then
    echo "model $MODEL present"
  else
    echo "pulling $MODEL (this is a few GB the first time) ..."
    "$bin" pull "$MODEL"
  fi
}

case "${1:-start}" in
  start)  start ;;
  status)
    if running; then
      echo "ollama: up on :$PORT"
      curl -sf "$HOST/api/tags" | python3 -c 'import json,sys;[print("  "+m["name"]) for m in json.load(sys.stdin).get("models",[])]' 2>/dev/null || true
    else
      echo "ollama: down"; exit 1
    fi ;;
  stop)   pkill -f "ollama serve" && echo "stopped" || echo "was not running" ;;
  *)      echo "usage: $0 {start|status|stop}" >&2; exit 2 ;;
esac
