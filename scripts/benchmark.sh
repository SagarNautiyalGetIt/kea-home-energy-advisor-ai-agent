#!/usr/bin/env bash
# Day 1 benchmark — measure generation throughput on this machine.
#
# Token generation is bandwidth-bound, not compute-bound: producing each token means
# reading every weight from memory once. So roughly
#
#     tokens/sec  ~=  memory bandwidth / model size  x  0.5-0.7 efficiency
#
# which is why a 48 GB Apple Silicon machine beats a CPU laptop by an order of
# magnitude, and why the number below decides whether the voice path is viable.
#
# Record every result in the shared table with the machine's chip and memory.
# Voice needs roughly 20+ tok/s to feel responsive with sentence-streamed TTS.

set -euo pipefail

MODELS=("${@:-gemma3:4b qwen3:4b}")
PROMPT="Explain in three short sentences why a household power bill rose 40 percent."

if ! command -v ollama >/dev/null 2>&1; then
  echo "ollama not found."
  echo "  macOS:  brew install --cask ollama     # native, NOT the Docker image"
  echo "  Linux:  curl -fsSL https://ollama.com/install.sh | sh"
  exit 1
fi

echo "machine: $(uname -m)  $(uname -s)"
if [[ "$(uname -s)" == "Darwin" ]]; then
  echo "chip:    $(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo unknown)"
  echo "memory:  $(( $(sysctl -n hw.memsize) / 1024 / 1024 / 1024 )) GB unified"
fi
echo

for model in ${MODELS[*]}; do
  echo "── $model ────────────────────────────────"
  if ! ollama list | grep -q "^${model%%:*}"; then
    echo "not pulled — run: ollama pull $model"
    echo
    continue
  fi
  ollama run "$model" --verbose "$PROMPT" 2>&1 | grep -E "eval rate|total duration|load duration" || true
  echo
done

cat <<'EOF'
Reading the output:
  eval rate      tokens/sec generated — the number that matters for voice
  load duration  cold-start cost; warm the model at app startup so this never
                 lands in front of a judge

Rule for Day 6: ship the smallest model that passes the golden set.
Bigger is slower, and slower is worse for voice.
EOF
