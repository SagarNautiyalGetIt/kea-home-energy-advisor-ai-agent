import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Screen } from '@/components/screen';
import { AssistantAnswer } from '@/components/assistant-answer';
import { SparkyIntro } from '@/components/sparky-intro';
import { SparkyLogo, SparkyThinking } from '@/components/sparky-logo';
import { IconButton, PageHeader } from '@/components/ui';
import { streamAssistantReply, toolLabel } from '@/lib/assistant-api';
import { answerOnPhone, isPhoneModelEnabled, phoneModelStatus, stopPhoneAnswer } from '@/lib/local-sparky';
import { canAnswerWithLocalModel, LOCAL_EVIDENCE_LIMIT } from '@/lib/local-sparky-policy';
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
  origin?: 'phone' | 'service';
  /** Live lookup labels while the answer is being written; cleared when it lands. */
  activity?: string[];
  /** Tool names behind the finished answer, for the transparency line. */
  sources?: string[];
  /** Tier 3 — this text is a handover written by Python, not an answer from the model. */
  handover?: boolean;
};

const prompts = ['Why is my power bill so high?', 'Which day was my highest usage?', 'Was that just the cold snap?', 'Could another plan save me money?'];
const initialMessage: Message = { id: 1, role: 'assistant', text: 'Kia ora! I’m Sparky. What would you like to understand about your energy account?' };

export default function AssistantScreen() {
  const { colors } = useAppTheme();
  const { session } = useAuth();
  const { showToast } = useToast();
  const isDemoMode = process.env.EXPO_PUBLIC_USE_REAL_DATA === 'false';
  const { plan, question, billPrediction } = useLocalSearchParams<{ plan?: string | string[]; question?: string | string[]; billPrediction?: string | string[] }>();
  const scrollRef = useRef<ScrollView>(null);
  const nextId = useRef(2);
  const chatVersion = useRef(0);
  const requestRef = useRef<{ abort: () => void } | null>(null);
  // Threads the conversation server-side so a follow-up ("what about last month?") has
  // the turn before it to resolve against. Null until the first answer comes back.
  const conversationId = useRef<number | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  const [billPromptPending, setBillPromptPending] = useState(false);
  const [messages, setMessages] = useState<Message[]>([initialMessage]);
  const started = messages.length > 1;

  useEffect(() => {
    const planName = Array.isArray(plan) ? plan[0] : plan;
    const requestedQuestion = Array.isArray(question) ? question[0] : question;
    if (!planName && !requestedQuestion) return;
    const prefill = setTimeout(() => setText(requestedQuestion ?? `Which plan would you recommend? I am considering ${planName}.`), 0);
    return () => clearTimeout(prefill);
  }, [plan, question]);

  useEffect(() => {
    const fromBillPrediction = Array.isArray(billPrediction) ? billPrediction[0] : billPrediction;
    if (!fromBillPrediction) {
      setBillPromptPending(false);
      return;
    }
    setIntroDone(true);
    setBillPromptPending(true);
  }, [billPrediction]);

  useEffect(() => () => requestRef.current?.abort(), []);

  const send = async (question: string) => {
    const clean = question.trim();
    if (!clean || busy) return;
    setBillPromptPending(false);
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
      const phoneEnabled = await isPhoneModelEnabled();
      const phoneReady = phoneEnabled && (await phoneModelStatus()).phase === 'installed';
      let answeredOnPhone = false;
      if (phoneReady && canAnswerWithLocalModel(clean)) {
        try {
          requestRef.current = { abort: () => { void stopPhoneAnswer(); } };
          const answer = await answerOnPhone(clean, (chunk) => patch((m) => ({ ...m, text: m.text + chunk, streaming: true })));
          if (version !== chatVersion.current) return;
          patch((m) => ({ ...m, text: answer, streaming: false, origin: 'phone' }));
          completed = true;
          answeredOnPhone = true;
        } catch {
          patch((m) => ({ ...m, text: '' }));
          // The Kea service remains the connected fallback when a device fails
          // to load or run its local model.
        }
      }
      if (!answeredOnPhone) await new Promise<void>((resolve) => {
        const stream = streamAssistantReply(session?.customerId ?? '', clean, {
          onText: (chunk) => patch((m) => ({ ...m, text: m.text + chunk, streaming: true })),
          // That round turned out to be a lookup, so its text was a preamble.
          onReset: () => patch((m) => ({ ...m, text: '' })),
          onTool: (name) => patch((m) => ({ ...m, activity: [...(m.activity ?? []), toolLabel(name)] })),
          onDone: (result) => {
            completed = true;
            conversationId.current = result.conversation_id;
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
              origin: 'service',
            }));
            if (shouldEscalate) showToast('Customer Care hand-off ready', 'info');
            resolve();
          },
          onError: (failure) => {
            completed = true;
            patch((m) => ({ ...m, text: phoneReady ? `${failure}\n\n${LOCAL_EVIDENCE_LIMIT}` : failure, streaming: false, failed: true, activity: undefined }));
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
              {message.role === 'assistant' ? <SparkyLogo size={30} /> : null}
              <View style={[styles.bubble, message.role === 'user' ? styles.userBubble : { backgroundColor: colors.surface, borderColor: message.failed ? palette.red : colors.border }]}>
                {message.role === 'assistant'
                  ? <AssistantAnswer color={colors.text} text={message.text} />
                  : <Text style={[styles.bubbleText, { color: '#000000' }]}>{message.text}</Text>}
                {message.origin === 'phone' ? <Text style={[styles.sourceLine, { color: colors.textMuted }]}>On this phone · general guidance · no account data</Text> : null}
                {message.activity?.length ? <View>
                  {message.activity.map((entry, index) => <Text key={`${entry}-${index}`} style={[styles.sourceLine, { color: colors.textMuted }]}>Checking: {entry}</Text>)}
                </View> : null}
                {message.sources?.length ? <Text style={[styles.sourceLine, { color: colors.textMuted }]}>Checked: {message.sources.map(toolLabel).join(' · ')}</Text> : null}
                {message.handover ? <Text style={[styles.sourceLine, { color: colors.textMuted }]}>This demo has not sent your chat to staff.</Text> : null}
                {message.escalate ? <Pressable accessibilityRole="button" onPress={() => router.push('/help')} style={styles.escalationAction}><Ionicons color="#000000" name="people-outline" size={17} /><Text style={styles.escalationText}>See support guidance</Text></Pressable> : null}
                {message.role === 'assistant' && !message.streaming ? <View style={styles.replyActions}>
                  <Pressable accessibilityLabel="Copy reply" hitSlop={8} onPress={() => void copyReply(message)} style={styles.replyAction}><Ionicons color={colors.text} name="copy-outline" size={15} /></Pressable>
                </View> : null}
              </View>
            </View>
          ))}
          {busy && !messages.some((message) => message.streaming) ? <SparkyThinking bubbleStyle={{ backgroundColor: colors.surface, borderColor: colors.border }} textColor={colors.text} /> : null}
        </ScrollView>
      ) : introDone ? <View style={styles.startState}><SparkyLogo size={148} /><Text style={[styles.startTitle, { color: colors.text }]}>How can I help you today?</Text></View> : <SparkyIntro onDone={() => setIntroDone(true)} />}

      {introDone && (!started || billPromptPending) ? <View style={styles.prompts}>{prompts.filter((_, index) => !started || index === 0).map((prompt, index) => <Pressable key={prompt} onPress={() => void send(prompt)} style={[styles.prompt, billPromptPending && index === 0 && styles.billPrompt]}><Text style={styles.promptText}>{prompt}</Text></Pressable>)}</View> : null}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <View style={[styles.composer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TextInput blurOnSubmit={false} multiline onChangeText={setText} onSubmitEditing={() => void send(text)} placeholder="Ask about your energy…" placeholderTextColor={colors.text} style={[styles.input, { color: colors.text }]} value={text} />
          <Pressable accessibilityLabel="Contact support" onPress={() => router.push('/help')}>
            <Ionicons color={colors.text} name="person-outline" size={23} />
          </Pressable>
          <Pressable accessibilityLabel="Send message" disabled={!text.trim() || busy} onPress={() => void send(text)} style={[styles.send, (!text.trim() || busy) && styles.sendDisabled]}><Ionicons color="#000000" name="arrow-up" size={20} /></Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingBottom: 8 }, startState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 18 }, startTitle: { marginTop: 10, fontSize: 21, lineHeight: 27, fontWeight: '900', textAlign: 'center' },
  sourceLine: { marginTop: 8, fontSize: 12, lineHeight: 18 },
  thread: { flexGrow: 1, paddingVertical: 16, gap: 13 }, messageRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, maxWidth: '90%' }, userRow: { alignSelf: 'flex-end', justifyContent: 'flex-end' }, avatar: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#2C2C2E' },
  bubble: { maxWidth: '92%', borderWidth: 1, borderRadius: 18, borderBottomLeftRadius: 6, paddingHorizontal: 14, paddingVertical: 11 }, userBubble: { backgroundColor: palette.violet, borderColor: palette.violet, borderBottomLeftRadius: 18, borderBottomRightRadius: 6 }, bubbleText: { fontSize: 14, lineHeight: 20 }, replyActions: { flexDirection: 'row', alignItems: 'center', gap: 13, marginTop: 8 }, replyAction: { minWidth: 24, minHeight: 24, alignItems: 'center', justifyContent: 'center' },
  escalationAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 11, borderRadius: 13, backgroundColor: palette.violet, paddingHorizontal: 12 }, escalationText: { color: '#000000', fontSize: 12, fontWeight: '900' }, thinking: { flexDirection: 'row', alignItems: 'center', gap: 8 }, thinkingBubble: { borderWidth: 1, borderRadius: 17, paddingHorizontal: 14, paddingVertical: 11 },
  prompts: { alignItems: 'flex-end', gap: 8, paddingBottom: 10 }, prompt: { maxWidth: '84%', minHeight: 42, justifyContent: 'center', borderWidth: 1, borderColor: '#FFFFFF', borderRadius: 17, borderBottomRightRadius: 6, backgroundColor: 'transparent', paddingHorizontal: 14, paddingVertical: 10, shadowColor: '#FFFFFF', shadowOpacity: 0.34, shadowRadius: 7 }, promptText: { color: '#FFFFFF', fontSize: 12, lineHeight: 17, fontWeight: '700', textAlign: 'right' }, composer: { minHeight: 48, maxHeight: 100, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderRadius: 22, paddingHorizontal: 12, paddingVertical: 7 }, input: { flex: 1, maxHeight: 88, fontSize: 16, lineHeight: 22 }, send: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: palette.violet }, sendDisabled: { opacity: 0.35 },
  billPrompt: { borderColor: palette.red, borderWidth: 2, backgroundColor: 'rgba(232,33,39,0.16)', shadowColor: palette.red, shadowOpacity: 0.5 },
});
