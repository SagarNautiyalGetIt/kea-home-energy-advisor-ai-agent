import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioPlayer, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { AppState, Platform, Text, View } from 'react-native';
import { AssistantAnswer } from '@/components/assistant-answer';
import { AuroraBackground } from '@/components/aurora-background';
import { AuroraMotion } from '@/components/aurora-motion';
import { Screen } from '@/components/screen';
import { SparkyPresence } from '@/components/sparky-presence';
import { PageHeader, PrimaryButton } from '@/components/ui';
import { apiJson, apiPath } from '@/lib/backend-client';
import { tactile } from '@/lib/haptics';
import { useAuth } from '@/providers/auth';
import { useAppTheme } from '@/theme';

type Turn = { transcript: string; answer: string; audio_wav_base64: string | null; speech_error?: string | null };

export default function VoiceScreen() {
  const { colors } = useAppTheme();
  const { session } = useAuth();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recording = useAudioRecorderState(recorder);
  const player = useAudioPlayer(null);
  const request = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioFile = useRef<File | null>(null);
  const generation = useRef(0);
  const starting = useRef(false);
  const [turn, setTurn] = useState<Turn | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    void apiJson<{ voice?: { ready?: boolean } }>('/api/health', { signal: controller.signal })
      .then(health => { if (!controller.signal.aborted) setAvailable(health.voice?.ready === true); })
      .catch(() => { if (!controller.signal.aborted) setAvailable(false); });
    return () => controller.abort();
  }, []));

  const stop = useCallback(() => {
    generation.current += 1;
    request.current?.abort();
    if (timer.current) clearTimeout(timer.current);
    player.pause();
    if (recorder.isRecording) void recorder.stop();
    setBusy(false);
    if (audioFile.current?.exists) audioFile.current.delete();
    audioFile.current = null;
  }, [player, recorder]);
  useFocusEffect(useCallback(() => {
    const listener = AppState.addEventListener('change', (state) => { if (state !== 'active') stop(); });
    return () => { listener.remove(); stop(); };
  }, [stop]));

  async function start() {
    if (starting.current || recorder.isRecording || busy) return;
    starting.current = true;
    const version = generation.current;
    setError(null); player.pause();
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (version !== generation.current) return;
      if (!permission.granted) throw new Error('Microphone permission is needed to talk. You can continue in chat.');
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      if (version !== generation.current) return;
      recorder.record(); tactile();
      timer.current = setTimeout(() => { void finish(); }, 45000);
    } catch (failure: unknown) { if (version === generation.current) setError(failure instanceof Error ? failure.message : 'Microphone unavailable.'); }
    finally { starting.current = false; }
  }
  async function finish() {
    if (busy || !session || !recorder.isRecording) return;
    if (timer.current) clearTimeout(timer.current);
    const version = generation.current;
    setBusy(true); setError(null);
    try {
      await recorder.stop();
      if (version !== generation.current) return;
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (version !== generation.current) return;
      if (!recorder.uri) throw new Error('No recording was captured. Please try again.');
      const form = new FormData();
      if (Platform.OS === 'web') {
        const blob = await fetch(recorder.uri).then((response) => response.blob());
        form.append('audio', blob, 'question.webm');
      } else form.append('audio', { uri: recorder.uri, name: 'question.m4a', type: 'audio/mp4' } as unknown as Blob);
      if (version !== generation.current) return;
      const controller = new AbortController(); request.current = controller;
      const next = await apiJson<Turn>(apiPath('/api/households/{customer_id}/voice/turn', { customer_id: session.customerId }), { method: 'POST', body: form, signal: controller.signal });
      if (generation.current !== version || controller.signal.aborted) return;
      setTurn(next); tactile('response');
      if (next.audio_wav_base64) {
        const uri = `data:audio/wav;base64,${next.audio_wav_base64}`;
        if (Platform.OS === 'web') player.replace({ uri });
        else {
          if (audioFile.current?.exists) audioFile.current.delete();
          const file = new File(Paths.cache, `kea-voice-${Date.now()}.wav`);
          file.write(Uint8Array.from(atob(next.audio_wav_base64), (character) => character.charCodeAt(0)));
          audioFile.current = file; player.replace({ uri: file.uri });
        }
        player.play();
      }
    } catch (failure: unknown) {
      if (generation.current === version) setError(failure instanceof Error ? failure.message : 'Voice could not complete.');
    } finally { if (generation.current === version) setBusy(false); }
  }
  return <AuroraMotion><Screen>
    <View style={{ position: 'relative', borderRadius: 24, overflow: 'hidden', padding: 16 }}>
      <AuroraBackground />
      <PageHeader title="Talk with Sparky" subtitle="Your Kea AI voice conversation" />
      <View style={{ alignItems: 'center', paddingVertical: 20 }}><SparkyPresence auroraTint size={180} mode={busy ? 'thinking' : recording.isRecording ? 'happy' : 'idle'} /></View>
      <Text accessibilityLiveRegion="polite" style={{ color: colors.text, textAlign: 'center', marginBottom: 14 }}>{busy ? 'Checking your account and preparing an answer…' : recording.isRecording ? 'Listening · tap Send when you finish' : 'Tap Speak, ask your question, then Send.'}</Text>
      {available !== true ? <Text style={{ color: colors.textMuted, marginBottom: 12 }}>{available === null ? 'Checking voice availability…' : 'Voice is unavailable on this service. You can continue with Sparky in chat.'}</Text> : null}
      <PrimaryButton label={recording.isRecording ? 'Send question' : 'Speak'} icon={recording.isRecording ? 'send' : 'mic'} disabled={busy || available !== true} onPress={() => { void (recording.isRecording ? finish() : start()); }} />
      <PrimaryButton label="Stop voice" icon="stop-circle-outline" variant="secondary" onPress={stop} />
      <PrimaryButton label="Continue in chat" variant="secondary" onPress={() => router.push('/assistant')} />
      <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 12 }}>Sparky is an AI. Each recording is sent when you choose Send or after 45 seconds. Audio stops when you leave this page.</Text>
    </View>
    {error ? <Text accessibilityLiveRegion="polite" style={{ color: colors.icons.alert, marginVertical: 12 }}>{error}</Text> : null}
    {turn ? <View style={{ marginTop: 16 }}><Text style={{ color: colors.textMuted, marginBottom: 8 }}>You: {turn.transcript}</Text><AssistantAnswer color={colors.text} text={turn.answer} />{turn.speech_error ? <Text style={{ color: colors.icons.alert, marginTop: 8 }}>{turn.speech_error}</Text> : null}</View> : null}
  </Screen></AuroraMotion>;
}
