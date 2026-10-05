/**
 * Voice client — microphone in, spoken verified answer out.
 *
 * Deliberately self-contained and UI-free. `AssistantPage` is being rewritten on
 * `feat/kea-57-wire-assistant` to answer from the real pipeline, so this module does
 * not touch it; wiring the existing mic button to voice is three lines in whichever
 * version of that page lands (see `docs/voice.md`).
 *
 * The wire protocol is defined in `services/api/app/voice/session.py`. Both ends of it
 * change together or not at all.
 */

import type { SourceRef } from "./client";
import { LocalWhisper } from "./local-whisper";

/** 16 kHz mono is what whisper.cpp wants; resampling server-side costs latency. */
const CAPTURE_SAMPLE_RATE = 16_000;

export interface VoiceReadiness {
  stt: { engine: string; model: string | null; available: boolean };
  tts: { engine: string; voice: string | null; sample_rate: number; available: boolean };
  vad: string;
  can_listen: boolean;
  client_transcription?: boolean;
  can_speak: boolean;
  sample_rate_in: number;
}

export interface VoiceTimings {
  stt_ms: number;
  plan_ms: number;
  model_ms: number;
  first_audio_ms: number;
  total_ms: number;
}

export interface VoiceHandlers {
  onStatus?: (message: string) => void;
  onListeningStopped?: () => void;
  onReady?: (r: VoiceReadiness) => void;
  onSpeechStart?: () => void;
  onTranscript?: (text: string) => void;
  /**
   * `meta` no longer carries an intent — there is no router deciding one before the
   * assistant has read anything, so there is nothing to report at this point in the
   * turn beyond whether a handoff is coming.
   */
  onMeta?: (escalate: boolean) => void;
  onAnswer?: (a: {
    text: string;
    /** Every lookup behind the answer. The type is imported rather than restated:
     *  voice runs the identical agent (ADR-0003), so it cites the identical sources,
     *  and two hand-written copies of one wire shape drift within a sprint. */
    sources: SourceRef[];
    escalate_to_human: boolean;
  }) => void;
  onDone?: (t: VoiceTimings) => void;
  onError?: (message: string, fatal: boolean) => void;
  onClose?: (reason: string, retryable: boolean) => void;
}

/**
 * KEA-55, and the single most likely way voice fails on demo day.
 *
 * `getUserMedia` does not throw a useful error on an insecure origin — on
 * `http://192.168.1.x` the whole `navigator.mediaDevices` object is `undefined`, so
 * the call dies with "Cannot read properties of undefined" and reads like a code bug.
 * Someone then spends the demo debugging the wrong thing.
 *
 * `localhost` is a secure context; a LAN IP is not. Either present from the host
 * machine or put a cert in front of it (`mkcert`), and test it the day voice is built.
 */
export function checkVoiceSupport(): { ok: true } | { ok: false; reason: string } {
  if (typeof window === "undefined") return { ok: false, reason: "not a browser" };

  if (!window.isSecureContext) {
    return {
      ok: false,
      reason:
        `Microphone access needs a secure context. This page is on ${window.location.origin}, ` +
        `which the browser does not trust. Use http://localhost:5173 on the demo machine, ` +
        `or put a certificate in front of it with mkcert.`,
    };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, reason: "This browser does not expose getUserMedia." };
  }
  if (typeof AudioContext === "undefined") {
    return { ok: false, reason: "This browser has no Web Audio support." };
  }
  return { ok: true };
}

/**
 * Downsampling happens in the worklet rather than on the main thread so a busy React
 * render cannot drop audio frames. Written inline and loaded as a blob so it needs no
 * Vite asset config — one less thing to be wrong on someone else's machine.
 */
const WORKLET_SOURCE = `
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channel = input[0];
    // Float32 -1..1 -> signed 16-bit, clamped. Values outside the range wrap rather
    // than clip if you skip the clamp, which sounds like loud static.
    const out = new Int16Array(channel.length);
    for (let i = 0; i < channel.length; i++) {
      const s = Math.max(-1, Math.min(1, channel[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    this.port.postMessage(out.buffer, [out.buffer]);
    return true;
  }
}
registerProcessor('kea-capture', CaptureProcessor);
`;

/**
 * Turn a close event into something a person can act on.
 *
 * `closed (1006)` was the old message and it is the least useful string in the app: 1006
 * means "the socket died and no close frame arrived", which covers the server being
 * restarted, the server never having been there, and the network dropping — three
 * different fixes. A policy close (1008) carries its own reason from the server and
 * should always be preferred over anything invented here.
 */
export function describeClose(e: CloseEvent): string {
  if (e.reason) return e.reason;
  switch (e.code) {
    case 1000:
      return "voice ended";
    case 1006:
      // The one that actually bites in development: uvicorn --reload restarts on every
      // file save and takes every open socket with it, with no close frame.
      return "the connection dropped — Kea may have restarted. Press the mic to reconnect.";
    case 1012:
      return "Kea restarted. Press the mic to reconnect.";
    case 1011:
      return "voice hit a server error. Press the mic to try again.";
    default:
      return `voice closed unexpectedly (${e.code})`;
  }
}

/** True when the socket died rather than being closed on purpose — worth retrying. */
export function isTransportDrop(code: number): boolean {
  return code === 1006 || code === 1012 || code === 1011;
}

export class VoiceClient {
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private readiness: VoiceReadiness | null = null;
  private whisper: LocalWhisper | null = null;
  private captured: Int16Array[] = [];
  private sampleCount = 0;
  private limitTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private transcribing = false;

  /** Playback scheduling. Clips must not overlap, so each is queued after the last. */
  private playbackContext: AudioContext | null = null;
  private playheadAt = 0;
  private pendingAudioHeader: { sample_rate: number } | null = null;

  constructor(
    private readonly customerId: string,
    private readonly handlers: VoiceHandlers = {},
  ) {}

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async connect(): Promise<void> {
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${scheme}://${window.location.host}/api/voice/stream`;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      this.ws = ws;

      const timer = setTimeout(() => {
        reject(new Error("Voice service did not become ready."));
        ws.close();
      }, 15_000);
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "hello", customer_id: this.customerId }));
      };
      // A close before open means the handshake was refused — most often the feature
      // flag is off. The server accepts and then closes precisely so `reason` survives.
      ws.onerror = () => { clearTimeout(timer); reject(new Error("voice websocket failed to open")); };
      ws.onclose = (e) => {
        clearTimeout(timer);
        this.cancelCapture();
        reject(new Error(describeClose(e)));
        this.handlers.onClose?.(describeClose(e), isTransportDrop(e.code));
      };
      ws.onmessage = (e) => {
        this.onMessage(e);
        if (this.readiness) { clearTimeout(timer); resolve(); }
      };
    });
  }

  private onMessage(event: MessageEvent): void {
    if (event.data instanceof ArrayBuffer) {
      const header = this.pendingAudioHeader;
      this.pendingAudioHeader = null;
      if (header) this.play(event.data, header.sample_rate);
      return;
    }

    const msg = JSON.parse(event.data as string);
    switch (msg.type) {
      case "ready":
        this.readiness = msg as VoiceReadiness;
        this.handlers.onReady?.(msg as VoiceReadiness);
        break;
      case "speech_start":
        this.handlers.onSpeechStart?.();
        break;
      case "transcript":
        this.handlers.onTranscript?.(msg.text);
        break;
      case "meta":
        this.handlers.onMeta?.(msg.escalate);
        break;
      case "audio":
        // The binary frame for this header is the next message, always.
        this.pendingAudioHeader = { sample_rate: msg.sample_rate };
        break;
      case "answer":
        this.handlers.onAnswer?.(msg);
        break;
      case "done":
        this.handlers.onDone?.(msg.latency);
        break;
      case "error":
        this.handlers.onError?.(msg.message, msg.fatal);
        break;
    }
  }

  /** Open the mic and start streaming. Throws with a readable reason if it cannot. */
  async startListening(): Promise<void> {
    const support = checkVoiceSupport();
    if (!support.ok) throw new Error(support.reason);
    if (!this.connected || !this.readiness) throw new Error("connect() first");
    if (this.stream || this.transcribing) throw new Error("Voice is still working. Please wait.");
    const generation = this.generation;
    if (this.readiness.client_transcription) {
      this.whisper ??= new LocalWhisper((message) => this.handlers.onStatus?.(message));
      await this.whisper.prepare();
      if (generation !== this.generation) return;
    }
    this.captured = [];
    this.sampleCount = 0;
    this.playbackContext ??= new AudioContext();
    await this.playbackContext.resume();

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: CAPTURE_SAMPLE_RATE,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    if (generation !== this.generation) {
      this.releaseMicrophone();
      return;
    }
    // Asking for 16 kHz here means the browser resamples, in C++, before we see a
    // sample. Doing it in JS afterwards is both slower and worse.
    this.audioContext = new AudioContext({ sampleRate: CAPTURE_SAMPLE_RATE });
    const blob = new Blob([WORKLET_SOURCE], { type: "application/javascript" });
    const workletUrl = URL.createObjectURL(blob);
    try {
      await this.audioContext.audioWorklet.addModule(workletUrl);
    } finally {
      URL.revokeObjectURL(workletUrl);
    }

    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.audioContext, "kea-capture");
    this.node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (this.readiness?.client_transcription) {
        const chunk = new Int16Array(e.data);
        const remaining = 30 * CAPTURE_SAMPLE_RATE - this.sampleCount;
        const accepted = chunk.subarray(0, Math.max(0, remaining));
        this.captured.push(accepted);
        this.sampleCount += accepted.length;
        if (this.sampleCount >= 30 * CAPTURE_SAMPLE_RATE) this.stopListening();
      } else if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(e.data);
    };
    source.connect(this.node);
    if (this.readiness.client_transcription) {
      this.limitTimer = setTimeout(() => this.stopListening(), 30_000);
      this.handlers.onStatus?.('Listening — tap the microphone to finish (30 seconds maximum).');
    }
    // Not connected to the destination: routing the mic to the speakers is feedback.
  }

  /** Release the mic and tell the server to transcribe whatever it is holding. */
  private releaseMicrophone(): void {
    if (this.limitTimer) clearTimeout(this.limitTimer);
    this.limitTimer = null;
    this.node?.port.close();
    this.node?.disconnect();
    this.node = null;

    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;

    void this.audioContext?.close();
    this.audioContext = null;

  }

  stopListening(): void {
    const wasListening = this.stream !== null;
    this.releaseMicrophone();
    if (!wasListening) return;
    this.handlers.onListeningStopped?.();
    if (this.readiness?.client_transcription) {
      const samples = new Float32Array(this.sampleCount);
      let offset = 0;
      for (const chunk of this.captured) {
        for (const sample of chunk) samples[offset++] = sample / 32768;
      }
      this.captured = [];
      this.sampleCount = 0;
      if (!samples.length) return;
      const generation = this.generation;
      this.transcribing = true;
      void this.whisper!.transcribe(samples).then((text) => {
        if (generation !== this.generation || !this.connected) return;
        this.handlers.onStatus?.('');
        if (text.trim()) {
          this.handlers.onTranscript?.(text.trim());
          this.ask(text.trim());
        } else this.handlers.onStatus?.('No speech detected. Try again or type your question.');
      }).catch((error: unknown) => {
        if (generation === this.generation) {
          this.handlers.onStatus?.('');
          this.handlers.onError?.(error instanceof Error ? error.message : 'Please type your question.', false);
        }
      }).finally(() => { this.transcribing = false; });
    } else if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "end" }));
    }
  }

  private cancelCapture(): void {
    this.generation++;
    this.releaseMicrophone();
    this.captured = [];
    this.sampleCount = 0;
    this.whisper?.cancel();
    this.whisper = null;
    this.readiness = null;
  }

  /** Same pipeline, no microphone. Useful on a machine with no mic, and in tests. */
  ask(message: string): void {
    if (!this.connected) throw new Error("connect() first");
    this.ws!.send(JSON.stringify({ type: "text", message }));
  }

  private play(pcm: ArrayBuffer, sampleRate: number): void {
    const samples = new Int16Array(pcm);
    // createBuffer throws on a zero length. An empty clip is what a failed synthesis
    // looks like from here, and it should be silence, not an exception in an event
    // handler where nothing is going to catch it.
    if (samples.length === 0) return;

    this.playbackContext ??= new AudioContext();
    const ctx = this.playbackContext;

    const buffer = ctx.createBuffer(1, samples.length, sampleRate);
    buffer.getChannelData(0).set(Float32Array.from(samples, (s) => s / 32768));

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    // Queue rather than play immediately: sentence two arrives while sentence one is
    // still being spoken, and starting it on arrival plays them on top of each other.
    const startAt = Math.max(ctx.currentTime, this.playheadAt);
    source.start(startAt);
    this.playheadAt = startAt + buffer.duration;
  }

  close(): void {
    this.cancelCapture();
    void this.playbackContext?.close();
    this.playbackContext = null;
    this.playheadAt = 0;
    this.ws?.close();
    this.ws = null;
  }
}
