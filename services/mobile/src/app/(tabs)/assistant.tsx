import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Screen } from '@/components/screen';
import { SparkyOrbit } from '@/components/sparky-orbit';
import { IconButton, PageHeader } from '@/components/ui';
import { sendAssistantFeedback, streamAssistantReply, toolLabel } from '@/lib/assistant-api';
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
  feedback?: 'like' | 'dislike';
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
  const { plan } = useLocalSearchParams<{ plan?: string | string[] }>();
  const scrollRef = useRef<ScrollView>(null);
  const nextId = useRef(2);
  const chatVersion = useRef(0);
  const requestRef = useRef<{ abort: () => void } | null>(null);
  // Threads the conversation server-side so a follow-up ("what about last month?") has
  // the turn before it to resolve against. Null until the first answer comes back.
  const conversationId = useRef<number | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([initialMessage]);
  const started = messages.length > 1;

  useEffect(() => {
    const planName = Array.isArray(plan) ? plan[0] : plan;
    if (!planName) return;
    const prefill = setTimeout(() => setText(`Which plan would you recommend? I am considering ${planName}.`), 0);
    return () => clearTimeout(prefill);
  }, [plan]);

  useEffect(() => () => requestRef.current?.abort(), []);

  const send = async (question: string) => {
    const clean = question.trim();
    if (!clean || busy) return;
    const version = chatVersion.current;
    const controller = new AbortController();
    requestRef.current = controller;
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
      await new Promise<void>((resolve) => {
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
      if (controller.signal.aborted || version !== chatVersion.current) return;
      const errorText = error instanceof Error ? error.message : 'Sparky could not answer right now. Please try again.';
      const failedReply: Message = { id: replyId, role: 'assistant', text: errorText, failed: true };
      setMessages((current) => current.some((message) => message.id === replyId)
        ? current.map((message) => message.id === replyId ? failedReply : message)
        : [...current, failedReply]);
    } finally {
      if (version === chatVersion.current) setBusy(false);
      if (requestRef.current === controller) requestRef.current = null;
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

  const setFeedback = (id: number, feedback: 'like' | 'dislike') => {
    setMessages((current) => current.map((message) => message.id === id ? { ...message, feedback: message.feedback === feedback ? undefined : feedback } : message));
    void sendAssistantFeedback(session?.customerId ?? '', id, feedback).catch((error: unknown) => showToast(error instanceof Error ? error.message : 'Feedback could not be saved.', 'warning'));
    void Haptics.selectionAsync();
  };

  return (
    <Screen contentStyle={styles.screen} scroll={false}>
      <PageHeader action={<IconButton icon="create-outline" label="New chat" onPress={newChat} />} title="Sparky AI" subtitle="Energy answers with clear limits" />
      {started ? (
        <ScrollView contentContainerStyle={styles.thread} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })} ref={scrollRef} showsVerticalScrollIndicator={false}>
          {messages.map((message) => (
            <View key={message.id} style={[styles.messageRow, message.role === 'user' && styles.userRow]}>
              {message.role === 'assistant' ? <View style={styles.avatar}><Ionicons color={palette.violet} name="sparkles" size={16} /></View> : null}
              <View style={[styles.bubble, message.role === 'user' ? styles.userBubble : { backgroundColor: colors.surface, borderColor: message.failed ? palette.red : colors.border }]}>
                <Text style={[styles.bubbleText, { color: message.role === 'user' ? '#FFFFFF' : colors.text }]}>{message.text}</Text>
                {message.escalate ? <Pressable accessibilityRole="button" onPress={() => router.push('/help')} style={styles.escalationAction}><Ionicons color="#FFFFFF" name="people-outline" size={17} /><Text style={styles.escalationText}>Contact Customer Care</Text></Pressable> : null}
                {message.role === 'assistant' && !message.streaming ? <View style={styles.replyActions}>
                  <Pressable accessibilityLabel="Copy reply" hitSlop={8} onPress={() => void copyReply(message)} style={styles.replyAction}><Ionicons color={colors.textMuted} name="copy-outline" size={15} /></Pressable>
                  <Pressable accessibilityLabel="Like reply" accessibilityState={{ selected: message.feedback === 'like' }} hitSlop={8} onPress={() => setFeedback(message.id, 'like')} style={styles.replyAction}><Ionicons color={message.feedback === 'like' ? palette.violet : colors.textMuted} name={message.feedback === 'like' ? 'thumbs-up' : 'thumbs-up-outline'} size={15} /></Pressable>
                  <Pressable accessibilityLabel="Dislike reply" accessibilityState={{ selected: message.feedback === 'dislike' }} hitSlop={8} onPress={() => setFeedback(message.id, 'dislike')} style={styles.replyAction}><Ionicons color={message.feedback === 'dislike' ? palette.violet : colors.textMuted} name={message.feedback === 'dislike' ? 'thumbs-down' : 'thumbs-down-outline'} size={15} /></Pressable>
                </View> : null}
              </View>
            </View>
          ))}
          {busy && !messages.some((message) => message.streaming) ? <View style={styles.thinking}><View style={styles.avatar}><Ionicons color={palette.violet} name="sparkles" size={16} /></View><View style={[styles.thinkingBubble, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={{ color: colors.textMuted }}>Sparky is thinking…</Text></View></View> : null}
        </ScrollView>
      ) : <View style={styles.startState}><SparkyOrbit size={168} /><Text style={[styles.startTitle, { color: colors.text }]}>How can I help you today?</Text></View>}

      {!started ? <View style={styles.prompts}>{prompts.map((prompt) => <Pressable key={prompt} onPress={() => void send(prompt)} style={[styles.prompt, { borderColor: colors.border }]}><Text style={styles.promptText}>{prompt}</Text></Pressable>)}</View> : null}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <View style={[styles.composer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Pressable accessibilityLabel="Attach document" onPress={() => showToast('Choose a document to attach', 'info')}><Ionicons color={colors.textMuted} name="add-circle-outline" size={25} /></Pressable>
          <TextInput blurOnSubmit={false} multiline onChangeText={setText} onSubmitEditing={() => void send(text)} placeholder="Ask about your energy…" placeholderTextColor={colors.textMuted} style={[styles.input, { color: colors.text }]} value={text} />
          <Pressable accessibilityLabel="Voice input" onPress={() => showToast('Voice input is currently unavailable', 'info')}><Ionicons color={colors.textMuted} name="mic-outline" size={23} /></Pressable>
          <Pressable accessibilityLabel="Send message" disabled={!text.trim() || busy} onPress={() => void send(text)} style={[styles.send, (!text.trim() || busy) && styles.sendDisabled]}><Ionicons color="#FFFFFF" name="arrow-up" size={20} /></Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingBottom: 8 }, startState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 18 }, startTitle: { marginTop: 10, fontSize: 21, lineHeight: 27, fontWeight: '900', textAlign: 'center' },
  thread: { flexGrow: 1, paddingVertical: 16, gap: 13 }, messageRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, maxWidth: '90%' }, userRow: { alignSelf: 'flex-end', justifyContent: 'flex-end' }, avatar: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#F0EDFF' },
  bubble: { maxWidth: '92%', borderWidth: 1, borderRadius: 18, borderBottomLeftRadius: 6, paddingHorizontal: 14, paddingVertical: 11 }, userBubble: { backgroundColor: palette.violet, borderColor: palette.violet, borderBottomLeftRadius: 18, borderBottomRightRadius: 6 }, bubbleText: { fontSize: 13, lineHeight: 19 }, replyActions: { flexDirection: 'row', alignItems: 'center', gap: 13, marginTop: 8 }, replyAction: { minWidth: 24, minHeight: 24, alignItems: 'center', justifyContent: 'center' },
  escalationAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 11, borderRadius: 13, backgroundColor: palette.violet, paddingHorizontal: 12 }, escalationText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' }, thinking: { flexDirection: 'row', alignItems: 'center', gap: 8 }, thinkingBubble: { borderWidth: 1, borderRadius: 17, paddingHorizontal: 14, paddingVertical: 11 },
  prompts: { alignItems: 'flex-end', gap: 8, paddingBottom: 10 }, prompt: { maxWidth: '84%', minHeight: 42, justifyContent: 'center', borderWidth: 1, borderRadius: 17, borderBottomRightRadius: 6, backgroundColor: '#FFFFFF', paddingHorizontal: 14, paddingVertical: 10 }, promptText: { color: palette.navy, fontSize: 12, lineHeight: 17, fontWeight: '700', textAlign: 'right' }, composer: { minHeight: 56, maxHeight: 118, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderRadius: 22, paddingHorizontal: 12, paddingVertical: 7 }, input: { flex: 1, maxHeight: 88, fontSize: 14, lineHeight: 19 }, send: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: palette.violet }, sendDisabled: { opacity: 0.35 },
});
