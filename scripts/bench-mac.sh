#!/usr/bin/env bash
#
#  Kea Energy — local model benchmark for Apple Silicon
#  Team HAKAS · share this file, it needs nothing else from the project
#
#  WHAT THIS ANSWERS
#    Which machine should run the demo, and which model size can we afford?
#    The voice feature lives or dies on these numbers.
#
#  WHY SPEED VARIES SO MUCH BETWEEN MACS
#    Generating each word means reading the *entire* model out of memory once.
#    So speed is set by memory bandwidth, not by how fast the chip computes:
#
#        words per second  ≈  memory bandwidth  ÷  model size
#
#    An M4 Pro moves roughly twice the data per second of a base M4, so it
#    generates roughly twice as fast on the same model. That is the whole story.
#
#  HOW TO RUN
#    1. Install Ollama (native app — NOT the Docker image, Docker can't reach the GPU):
#         brew install --cask ollama
#       ...then open it once from Applications so the background service starts.
#    2. chmod +x bench-mac.sh && ./bench-mac.sh
#    3. Send back the results file it writes at the end.
#
#  Takes about 10 minutes including downloads. Downloads are ~10 GB total.
#
set -uo pipefail

MODELS=("gemma3:4b" "qwen3:4b" "gemma3:12b")
RUNS=3
PROMPT="A household used 300 kilowatt hours in July, about 37 percent more than similar homes. Explain why their bill is high in three short sentences."
OUT="kea-bench-$(hostname -s | tr ' ' '-')-$(date +%Y%m%d-%H%M).txt"
API="http://localhost:11434"

# Voice needs the answer to arrive while the caller is still listening.
# Below this, spoken replies feel broken no matter how good they are.
VOICE_MIN_TPS=20

bold()  { printf "\033[1m%s\033[0m\n" "$*"; }
dim()   { printf "\033[2m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
red()   { printf "\033[31m%s\033[0m\n" "$*"; }

# ---------------------------------------------------------------- preflight

if [[ "$(uname -s)" != "Darwin" ]]; then
  red "This script is written for macOS. On Linux it will still run, but the"
  red "hardware detection below will be blank."
fi

if ! command -v ollama >/dev/null 2>&1; then
  red "Ollama isn't installed."
  echo
  echo "  brew install --cask ollama"
  echo
  echo "Then open Ollama once from your Applications folder and re-run this script."
  exit 1
fi

if ! curl -sf "$API/api/tags" >/dev/null 2>&1; then
  red "Ollama is installed but not running."
  echo
  echo "Open Ollama from Applications (it runs in the menu bar), then re-run this."
  exit 1
fi

# ---------------------------------------------------------------- hardware

CHIP=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "unknown")
MEM_GB=$(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1024 / 1024 / 1024 ))
CORES=$(sysctl -n hw.ncpu 2>/dev/null || echo "?")
MODEL_ID=$(sysctl -n hw.model 2>/dev/null || echo "unknown")
OSVER=$(sw_vers -productVersion 2>/dev/null || echo "n/a")

{
  echo "Kea Energy — local model benchmark"
  echo "Run at $(date '+%Y-%m-%d %H:%M %Z') on $(hostname -s)"
  echo
  echo "MACHINE"
  echo "  Chip          $CHIP"
  echo "  Model         $MODEL_ID"
  echo "  Memory        ${MEM_GB} GB unified"
  echo "  Cores         $CORES"
  echo "  macOS         $OSVER"
  echo
} > "$OUT"

bold "Machine"
echo "  $CHIP · ${MEM_GB} GB unified memory · macOS $OSVER"
echo

# macOS lets the GPU claim roughly 65-75% of unified memory by default.
USABLE=$(( MEM_GB * 70 / 100 ))
dim "  Roughly ${USABLE} GB of that is usable for model weights."
if (( MEM_GB < 24 )); then
  dim "  That comfortably fits models up to about 12B. Larger ones may not load."
else
  dim "  That fits anything we're likely to use, including a 27B model."
fi
echo

# ---------------------------------------------------------------- measure

# Ollama returns timings in nanoseconds on a normal (non-streaming) request.
# We read them straight out of the JSON rather than timing the shell, which
# would include process startup and give noisy numbers.
measure() {  # $1 = model -> "tps ttft_ms total_ms out_tokens"
  local model="$1" body
  body=$(curl -sf "$API/api/generate" -d "{
      \"model\": \"$model\",
      \"prompt\": $(printf '%s' "$PROMPT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),
      \"stream\": false,
      \"options\": {\"temperature\": 0.2, \"num_predict\": 120}
    }" 2>/dev/null) || return 1

  printf '%s' "$body" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(1)
ns = 1_000_000_000
ev_n  = d.get("eval_count") or 0
ev_d  = d.get("eval_duration") or 0
load  = d.get("load_duration") or 0
pev   = d.get("prompt_eval_duration") or 0
total = d.get("total_duration") or 0
tps   = (ev_n / (ev_d / ns)) if ev_d else 0
ttft  = (load + pev) / 1_000_000          # ms until the first word appears
print(f"{tps:.1f} {ttft:.0f} {total/1_000_000:.0f} {ev_n}")
' || return 1
}

median() { printf '%s\n' "$@" | sort -n | awk '{a[NR]=$1} END{print (NR%2)?a[(NR+1)/2]:(a[NR/2]+a[NR/2+1])/2}'; }

echo "MODEL RESULTS" >> "$OUT"
bold "Testing ${#MODELS[@]} models, $RUNS runs each"
dim "First run of each includes loading the model from disk — that one is discarded."
echo

BEST_MODEL=""; BEST_TPS=0

for model in "${MODELS[@]}"; do
  bold "── $model"

  if ! ollama list 2>/dev/null | awk '{print $1}' | grep -qx "$model"; then
    echo "   downloading (this can take a few minutes)..."
    if ! ollama pull "$model" >/dev/null 2>&1; then
      red "   couldn't download — skipping"
      echo "  $model: DOWNLOAD FAILED" >> "$OUT"
      echo
      continue
    fi
  fi

  # Warm-up run, discarded: it pays the cost of loading weights from disk.
  measure "$model" >/dev/null 2>&1

  tps_all=(); ttft_all=()
  ok=1
  for _ in $(seq 1 $RUNS); do
    if ! read -r tps ttft _total _ntok < <(measure "$model"); then ok=0; break; fi
    tps_all+=("$tps"); ttft_all+=("$ttft")
    printf "   %6s words/sec   %5s ms to first word\n" "$tps" "$ttft"
  done

  if (( ok == 0 )) || (( ${#tps_all[@]} == 0 )); then
    red "   model wouldn't run — likely not enough memory on this machine"
    echo "  $model: FAILED TO RUN (probably out of memory)" >> "$OUT"
    echo
    continue
  fi

  m_tps=$(median "${tps_all[@]}")
  m_ttft=$(median "${ttft_all[@]}")
  spoken=$(python3 -c "print(f'{60/max($m_tps,0.01):.1f}')")

  echo
  printf "   median: "
  if (( $(python3 -c "print(1 if $m_tps >= $VOICE_MIN_TPS else 0)") )); then
    green "$m_tps words/sec — fast enough for the voice feature"
  else
    red "$m_tps words/sec — too slow for voice on this machine"
  fi
  dim "   a 60-word spoken answer would take about ${spoken}s to generate"
  echo

  {
    echo "  $model"
    echo "    speed              $m_tps words/sec (median of $RUNS)"
    echo "    time to first word $m_ttft ms"
    echo "    60-word answer     ${spoken}s"
    echo "    voice-capable      $( (( $(python3 -c "print(1 if $m_tps >= $VOICE_MIN_TPS else 0)") )) && echo YES || echo NO )"
  } >> "$OUT"

  if (( $(python3 -c "print(1 if $m_tps > $BEST_TPS else 0)") )); then
    BEST_TPS=$m_tps; BEST_MODEL=$model
  fi
done

# ---------------------------------------------------------------- verdict

{
  echo
  echo "SUMMARY"
  echo "  Fastest model here   ${BEST_MODEL:-none completed} (${BEST_TPS} words/sec)"
  echo "  Voice threshold      ${VOICE_MIN_TPS} words/sec"
  echo
  echo "Send this whole file back to Akash."
} >> "$OUT"

echo
bold "Done"
echo "  Results written to: $OUT"
echo
dim "  Send that file back. We compare it against the other Mac and pick"
dim "  whichever machine runs the demo — and the smallest model that's still"
dim "  good enough, because smaller is faster and faster is better for voice."
echo
