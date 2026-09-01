#!/usr/bin/env bash
# Build and fetch the local voice stack: whisper.cpp (STT), Piper (TTS), Silero (VAD).
#
# Everything lands in ml/voice/dist/, which is gitignored. Nothing is installed system
# wide, nothing needs root, and deleting that directory undoes all of it.
#
#   ./ml/voice/setup.sh                 # build + fetch everything, then print the env
#   ./ml/voice/setup.sh --model base.en # smaller/faster STT model
#   ./ml/voice/setup.sh --check         # report what is present, download nothing
#
# On macOS this builds whisper.cpp with Metal, which is the entire reason ADR-0003
# chose it over faster-whisper. On Linux it builds the CPU backend — fine for
# development, and the demo machine is the M4 Pro.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIST="$ROOT/ml/voice/dist"
SRC="$DIST/src"
BIN="$DIST/bin"
MODELS="$DIST/models"

# large-v3-turbo is the current best accuracy-per-millisecond for local STT and the
# M4 Pro has the memory bandwidth for it. q5_0 is the quantised build: ~547 MB instead
# of ~1.6 GB, with no accuracy loss anyone has been able to measure on clean speech.
# Override with --model on a machine that cannot spare the RAM.
WHISPER_MODEL_NAME="${KEA_SETUP_WHISPER_MODEL:-large-v3-turbo-q5_0}"

# en_GB rather than en_US: this is a New Zealand energy retailer, and an American voice
# reading NZ tariffs is the kind of detail a judge notices.
PIPER_VOICE_NAME="${KEA_SETUP_PIPER_VOICE:-en_GB-alba-medium}"

PIPER_RELEASE="2023.11.14-2"
CHECK_ONLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --model)  WHISPER_MODEL_NAME="$2"; shift 2 ;;
    --voice)  PIPER_VOICE_NAME="$2"; shift 2 ;;
    --check)  CHECK_ONLY=1; shift ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)  PLATFORM=macos_aarch64;  METAL=1 ;;
  Darwin-x86_64) PLATFORM=macos_x64;      METAL=0 ;;
  Linux-x86_64)  PLATFORM=linux_x86_64;   METAL=0 ;;
  Linux-aarch64) PLATFORM=linux_aarch64;  METAL=0 ;;
  *) echo "unsupported platform: $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

WHISPER_BIN="$BIN/whisper-cli"
WHISPER_MODEL="$MODELS/ggml-${WHISPER_MODEL_NAME}.bin"
PIPER_BIN="$BIN/piper/piper"
PIPER_VOICE="$MODELS/${PIPER_VOICE_NAME}.onnx"
SILERO="$MODELS/silero_vad.onnx"

say()  { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*" >&2; }

report() {
  local label="$1" path="$2"
  if [ -e "$path" ]; then
    printf '  \033[32m*\033[0m %-14s %s\n' "$label" "$path"
  else
    printf '  \033[31mx\033[0m %-14s %s (missing)\n' "$label" "$path"
  fi
}

status() {
  say "voice stack for $PLATFORM"
  report whisper-cli "$WHISPER_BIN"
  report "stt model"  "$WHISPER_MODEL"
  report piper        "$PIPER_BIN"
  report "tts voice"  "$PIPER_VOICE"
  report "silero vad" "$SILERO"
}

if [ "$CHECK_ONLY" = 1 ]; then
  status
  exit 0
fi

mkdir -p "$SRC" "$BIN" "$MODELS"

# --- whisper.cpp -------------------------------------------------------------
# Pinned to a tag. whisper.cpp renamed its CLI from `main` to `whisper-cli` in 2024
# and changed CMake flags more than once; an unpinned clone means the build breaks on
# someone else's machine on a different day for reasons nobody can reproduce.
WHISPER_TAG="v1.7.4"

if [ ! -x "$WHISPER_BIN" ]; then
  say "building whisper.cpp $WHISPER_TAG (metal=$METAL)"
  if [ ! -d "$SRC/whisper.cpp/.git" ]; then
    git clone --depth 1 --branch "$WHISPER_TAG" \
      https://github.com/ggerganov/whisper.cpp.git "$SRC/whisper.cpp"
  fi
  # GGML_METAL, not WHISPER_METAL. v1.7.4 still accepts the old name but only through
  # a deprecation shim (`whisper_option_depr(WARNING WHISPER_METAL GGML_METAL)` at
  # CMakeLists.txt:111) that prints a warning and forwards. Depending on a forwarding
  # macro for the one flag that makes the demo machine fast is how you end up on stage
  # with a CPU build and no error anywhere to explain it.
  #
  # GGML_METAL_EMBED_LIBRARY compiles the Metal shaders into the binary. Without it
  # `ggml-metal.metal` has to sit beside the executable at runtime, and its absence is
  # a runtime abort rather than a build failure — the worst time to find out.
  cmake -S "$SRC/whisper.cpp" -B "$SRC/whisper.cpp/build" \
    -DCMAKE_BUILD_TYPE=Release \
    -DGGML_METAL="$([ "$METAL" = 1 ] && echo ON || echo OFF)" \
    -DGGML_METAL_EMBED_LIBRARY="$([ "$METAL" = 1 ] && echo ON || echo OFF)" \
    -DBUILD_SHARED_LIBS=OFF \
    -DWHISPER_BUILD_TESTS=OFF \
    -DWHISPER_BUILD_EXAMPLES=ON >/dev/null
  cmake --build "$SRC/whisper.cpp/build" --config Release -j "$(getconf _NPROCESSORS_ONLN)"

  found="$(find "$SRC/whisper.cpp/build" -name 'whisper-cli' -type f -perm -u+x | head -1)"
  [ -n "$found" ] || { echo "whisper-cli not found after build" >&2; exit 1; }
  cp "$found" "$WHISPER_BIN"

  # Belt and braces: if the embed flag was ignored for any reason, the shader beside the
  # binary is the documented fallback. Copying it costs nothing and removes a runtime abort.
  if [ "$METAL" = 1 ]; then
    find "$SRC/whisper.cpp" -name 'ggml-metal.metal' -exec cp {} "$BIN/" \; 2>/dev/null || true
  fi
else
  say "whisper-cli already built"
fi

if [ ! -f "$WHISPER_MODEL" ]; then
  say "downloading ggml-${WHISPER_MODEL_NAME}.bin"
  curl -fL --progress-bar -o "$WHISPER_MODEL" \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${WHISPER_MODEL_NAME}.bin"
else
  say "stt model already present"
fi

# --- Piper -------------------------------------------------------------------
if [ ! -x "$PIPER_BIN" ]; then
  say "downloading piper $PIPER_RELEASE for $PLATFORM"
  curl -fL --progress-bar -o "$DIST/piper.tar.gz" \
    "https://github.com/rhasspy/piper/releases/download/${PIPER_RELEASE}/piper_${PLATFORM}.tar.gz"
  tar -xzf "$DIST/piper.tar.gz" -C "$BIN"
  rm -f "$DIST/piper.tar.gz"
else
  say "piper already present"
fi

if [ ! -f "$PIPER_VOICE" ]; then
  say "downloading voice $PIPER_VOICE_NAME"
  # en_GB-alba-medium -> en_GB/alba/medium
  lang="${PIPER_VOICE_NAME%%-*}"
  rest="${PIPER_VOICE_NAME#*-}"
  name="${rest%-*}"
  quality="${rest##*-}"
  base="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/${lang}/${name}/${quality}/${PIPER_VOICE_NAME}"
  curl -fL --progress-bar -o "$PIPER_VOICE" "${base}.onnx"
  # The .json carries the sample rate. Without it the server assumes 22050 and a
  # 16 kHz voice plays back chipmunked — see tts._voice_sample_rate.
  curl -fL --progress-bar -o "${PIPER_VOICE}.json" "${base}.onnx.json"
else
  say "tts voice already present"
fi

# --- Silero VAD --------------------------------------------------------------
if [ ! -f "$SILERO" ]; then
  say "downloading silero VAD"
  curl -fL --progress-bar -o "$SILERO" \
    "https://raw.githubusercontent.com/snakers4/silero-vad/master/src/silero_vad/data/silero_vad.onnx"
else
  say "silero VAD already present"
fi

if ! "$ROOT/services/api/.venv/bin/python" -c "import onnxruntime" 2>/dev/null; then
  warn "onnxruntime is not installed — the energy fallback detector will be used."
  warn "  services/api/.venv/bin/pip install onnxruntime numpy"
fi

echo
status
echo
say "add to .env:"
cat <<ENV

KEA_VOICE_ENABLED=1
KEA_WHISPER_BIN=$WHISPER_BIN
KEA_WHISPER_MODEL=$WHISPER_MODEL
KEA_PIPER_BIN=$PIPER_BIN
KEA_PIPER_VOICE=$PIPER_VOICE
KEA_SILERO_VAD_MODEL=$SILERO
ENV
