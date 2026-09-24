import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Screen } from '@/components/screen';
import { AssistantAnswer } from '@/components/assistant-answer';
import { MotionPressable } from '@/components/motion-pressable';
import { SparkyPresence } from '@/components/sparky-presence';
import { IconButton, PageHeader } from '@/components/ui';
import { streamAssistantReply, toolLabel } from '@/lib/assistant-api';
import { rememberEvAnswer, restoreEvAnswer } from '@/lib/ev-memory';
import { useAuth } from '@/providers/auth';
import { useToast } from '@/providers/toast';
import { palette, useAppTheme } from '@/theme';

type Message = {
  id: number;
  role: 'assistant' | 'user';
  text: string;
  escalate?: boolean;
  streaming?: boolean;
  failed?: boolean;
  /** Live lookup labels while the answer is being written; cleared when it lands. */
  activity?: string[];
  /** Tool names behind the finished answer, for the transparency line. */
  sources?: string[];
  /** Tier 3 — this text is a handover written by Python, not an answer from the model. */
  handover?: boolean;
};

const prompts = [
  { text: 'Why is my power bill so high?', icon: 'flash-outline' as const },
  { text: 'Which day was my highest usage?', icon: 'analytics-outline' as const },
  { text: 'Was that just the cold snap?', icon: 'partly-sunny-outline' as const },
  { text: 'Could another plan save me money?', icon: 'wallet-outline' as const },
];
const initialMessage: Message = { id: 1, role: 'assistant', text: 'Kia ora! I’m Sparky. What would you like to understand about your energy account?' };

export default function AssistantScreen() {
  const { colors } = useAppTheme();
  const { session } = useAuth();
  const { showToast } = useToast();
  const isDemoMode = process.env.EXPO_PUBLIC_USE_REAL_DATA === 'false';
  const { plan, question } = useLocalSearchParams<{ plan?: string | string[]; question?: string | string[] }>();
  const scrollRef = useRef<ScrollView>(null);
  const nextId = useRef(2);
  const chatVersion = useRef(0);
  const requestRef = useRef<{ abort: () => void } | null>(null);
  // Threads the conversation server-side so a follow-up ("what about last month?") has
  // the turn before it to resolve against. Null until the first answer comes back.
  const conversationId = useRef<number | null>(null);
  const evRestore = useRef<Promise<void>>(Promise.resolve());
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([initialMessage]);
  const started = messages.length > 1;

  useEffect(() => {
    const planName = Array.isArray(plan) ? plan[0] : plan;
    const requestedQuestion = Array.isArray(question) ? question[0] : question;
    if (!planName && !requestedQuestion) return;
    const prefill = setTimeout(() => setText(requestedQuestion ?? `Which plan would you recommend? I am considering ${planName}.`), 0);
    return () => clearTimeout(prefill);
  }, [plan, question]);

  useEffect(() => () => requestRef.current?.abort(), []);

  useEffect(() => {
    evRestore.current = session?.customerId ? restoreEvAnswer(session.customerId).catch(() => undefined) : Promise.resolve();
  }, [session?.customerId]);

  const send = async (question: string) => {
    const clean = question.trim();
    if (!clean || busy) return;
    const version = chatVersion.current;
    setText('');
    setBusy(true);
    const user: Message = { id: nextId.current++, role: 'user', text: clean };
    const replyId = nextId.current++;
    setMessages((current) => [...current, user]);
    void Haptics.selectionAsync();
    let completed = false;
    let shouldEscalate = false;

    const patch = (fn: (m: Message) => Message) =>
      setMessages((current) => current.some((m) => m.id === replyId)
        ? current.map((m) => (m.id === replyId ? fn(m) : m))
        : [...current, fn({ id: replyId, role: 'assistant', text: '', streaming: true })]);

    try {
      await evRestore.current;
      await new Promise<void>((resolve) => {
        const stream = streamAssistantReply(session?.customerId ?? '', clean, {
          onText: (chunk) => patch((m) => ({ ...m, text: m.text + chunk, streaming: true })),
          // That round turned out to be a lookup, so its text was a preamble.
          onReset: () => patch((m) => ({ ...m, text: '' })),
          onTool: (name) => patch((m) => ({ ...m, activity: [...(m.activity ?? []), toolLabel(name)] })),
          onDone: (result) => {
            completed = true;
            conversationId.current = result.conversation_id;
            if (session?.customerId) void rememberEvAnswer(session.customerId).catch(() => undefined);
            shouldEscalate = result.escalate_to_human;
            patch((m) => ({
              ...m,
              streaming: false,
              activity: undefined,
              sources: result.sources?.filter((source) => source.ok).map((source) => source.tool),
              escalate: shouldEscalate,
              // Tier 3 means the text above is a handover written by Python, not an
              // answer — the UI labels it so nobody reads it as advice.
              handover: result.tier === 3,
            }));
            if (shouldEscalate) showToast('Customer Care hand-off ready', 'info');
            resolve();
          },
          onError: (failure) => {
            completed = true;
            patch((m) => ({ ...m, text: failure, streaming: false, failed: true, activity: undefined }));
            resolve();
          },
        }, conversationId.current);
        requestRef.current = { abort: () => { stream.cancel(); resolve(); } };
      });
      if (!completed) throw new Error('Sparky did not complete the response. Please try again.');
    } catch (error: unknown) {
      if (version !== chatVersion.current) return;
      const errorText = error instanceof Error ? error.message : 'Sparky could not answer right now. Please try again.';
      const failedReply: Message = { id: replyId, role: 'assistant', text: errorText, failed: true };
      setMessages((current) => current.some((message) => message.id === replyId)
        ? current.map((message) => message.id === replyId ? failedReply : message)
        : [...current, failedReply]);
    } finally {
      if (version === chatVersion.current) setBusy(false);
      if (version === chatVersion.current) requestRef.current = null;
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 40);
    }
  };

  const newChat = () => {
    requestRef.current?.abort();
    requestRef.current = null;
    conversationId.current = null;
    chatVersion.current += 1;
    nextId.current = 2;
    setMessages([initialMessage]);
    setText('');
    setBusy(false);
    Keyboard.dismiss();
    void Haptics.selectionAsync();
  };

  const copyReply = async (message: Message) => {
    await Clipboard.setStringAsync(message.text);
    showToast('Reply copied', 'info');
  };

  return (
    <Screen contentStyle={styles.screen} scroll={false}>
      <PageHeader action={<IconButton icon="create-outline" label="New chat" onPress={newChat} />} title="Sparky AI" subtitle={isDemoMode ? 'Preview data on screens · live assistant needs the API' : 'Energy answers with clear limits'} />
      {started ? (
        <ScrollView contentContainerStyle={styles.thread} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })} ref={scrollRef} showsVerticalScrollIndicator={false}>
          {messages.map((message) => (
            <View key={message.id} style={[styles.messageRow, message.role === 'user' && styles.userRow]}>
              {message.role === 'assistant' ? <View style={styles.avatar}><SparkyPresence mode={message.streaming ? 'replying' : 'idle'} size={34} /></View> : null}
              <View style={[styles.bubble, message.role === 'user' ? styles.userBubble : { backgroundColor: colors.surface, borderColor: message.failed ? palette.red : colors.border }]}>
                {message.role === 'assistant'
                  ? <AssistantAnswer color={colors.text} text={message.text} />
                  : <Text style={[styles.bubbleText, { color: '#000000' }]}>{message.text}</Text>}
                {message.sources?.length ? <Text style={[styles.sourceLine, { color: colors.textMuted }]}>Checked: {message.sources.map(toolLabel).join(' · ')}</Text> : null}
                {message.escalate ? <Pressable accessibilityRole="button" onPress={() => router.push('/help')} style={styles.escalationAction}><Ionicons color="#000000" name="people-outline" size={17} /><Text style={styles.escalationText}>Contact Customer Care</Text></Pressable> : null}
                {message.role === 'assistant' && !message.streaming ? <View style={styles.replyActions}>
                  <Pressable accessibilityLabel="Copy reply" hitSlop={8} onPress={() => void copyReply(message)} style={styles.replyAction}><Ionicons color={colors.text} name="copy-outline" size={15} /></Pressable>
                </View> : null}
              </View>
            </View>
          ))}
          {busy && !messages.some((message) => message.streaming) ? <View style={styles.thinking}><View style={styles.avatar}><SparkyPresence mode="thinking" size={34} /></View><View style={[styles.thinkingBubble, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={{ color: colors.text }}>Checking your energy…</Text></View></View> : null}
        </ScrollView>
      ) : <View style={styles.startState}><SparkyPresence size={184} /><Text style={styles.startEyebrow}>SPARKY · YOUR ENERGY GUIDE</Text><Text style={[styles.startTitle, { color: colors.text }]}>Let’s make sense of your energy.</Text><Text style={[styles.startSubtitle, { color: colors.textMuted }]}>Short answers grounded in your meter, bills and connected devices when available.</Text></View>}

      {!started ? <View style={styles.prompts}>{prompts.map((prompt) => <MotionPressable accessibilityRole="button" key={prompt.text} onPress={() => void send(prompt.text)} style={styles.prompt}><Ionicons color="#F4F5F7" name={prompt.icon} size={18} /><Text style={[styles.promptText, { color: colors.text }]}>{prompt.text}</Text><Ionicons color="#71717A" name="arrow-up-outline" size={14} /></MotionPressable>)}</View> : null}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <View style={[styles.composer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TextInput blurOnSubmit={false} multiline onChangeText={setText} onSubmitEditing={() => void send(text)} placeholder="Ask about your energy…" placeholderTextColor={colors.text} style={[styles.input, { color: colors.text }]} value={text} />
          <Pressable accessibilityLabel="Contact support" onPress={() => router.push('/help')}>
            <Ionicons color={colors.text} name="person-outline" size={23} />
          </Pressable>
          <MotionPressable accessibilityLabel="Send message" disabled={!text.trim() || busy} onPress={() => void send(text)} style={[styles.send, (!text.trim() || busy) && styles.sendDisabled]}><Ionicons color="#071921" name="arrow-up" size={20} /></MotionPressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingBottom: 8 }, startState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14 }, startEyebrow: { color: '#A1A1AA', fontSize: 10, fontWeight: '800', letterSpacing: 1.6, marginTop: 2 }, startTitle: { marginTop: 10, fontSize: 25, lineHeight: 31, fontWeight: '800', textAlign: 'center', maxWidth: 320 }, startSubtitle: { marginTop: 9, fontSize: 13, lineHeight: 19, textAlign: 'center', maxWidth: 320 },
  sourceLine: { marginTop: 8, fontSize: 10, lineHeight: 15 },
  thread: { flexGrow: 1, paddingVertical: 16, gap: 13 }, messageRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, maxWidth: '90%' }, userRow: { alignSelf: 'flex-end', justifyContent: 'flex-end' }, avatar: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  bubble: { maxWidth: '92%', borderWidth: 1, borderRadius: 18, borderBottomLeftRadius: 6, paddingHorizontal: 14, paddingVertical: 11 }, userBubble: { backgroundColor: '#38BDF8', borderColor: '#38BDF8', borderBottomLeftRadius: 18, borderBottomRightRadius: 6 }, bubbleText: { fontSize: 13, lineHeight: 19 }, replyActions: { flexDirection: 'row', alignItems: 'center', gap: 13, marginTop: 8 }, replyAction: { minWidth: 24, minHeight: 24, alignItems: 'center', justifyContent: 'center' },
  escalationAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 11, borderRadius: 13, backgroundColor: palette.violet, paddingHorizontal: 12 }, escalationText: { color: '#000000', fontSize: 11, fontWeight: '900' }, thinking: { flexDirection: 'row', alignItems: 'center', gap: 8 }, thinkingBubble: { borderWidth: 1, borderRadius: 17, paddingHorizontal: 14, paddingVertical: 11 },
  prompts: { gap: 8, paddingBottom: 12 }, prompt: { minHeight: 48, alignItems: 'center', flexDirection: 'row', gap: 11, borderWidth: 1, borderColor: '#27272A', borderRadius: 15, backgroundColor: '#18181B', paddingHorizontal: 14, paddingVertical: 10 }, promptText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: '700' }, composer: { minHeight: 48, maxHeight: 100, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderRadius: 22, paddingHorizontal: 12, paddingVertical: 7 }, input: { flex: 1, maxHeight: 88, fontSize: 14, lineHeight: 19 }, send: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#38BDF8' }, sendDisabled: { opacity: 0.35 },
});
