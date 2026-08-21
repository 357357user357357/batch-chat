import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';

import { MathAnswer } from '@/components/math-answer';
import { ModelChips } from '@/components/model-chips';
import { ModelBrowser } from '@/components/model-browser';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useI18n } from '@/i18n';
import { useTheme } from '@/hooks/use-theme';
import { chat, OPENROUTER_MODEL, type OpenRouterMessage } from '@/services/openrouter';
import { loadJSON, saveJSON } from '@/services/storage';

const STORAGE_KEY = 'openrouter.chat.v1';
/** Hard ceiling on how many messages are kept / persisted. */
const MAX_MESSAGES = 120;
/** How much recent context is sent in a request. */
const HISTORY_WINDOW = 20;

const SYSTEM_PROMPT =
  'You are a helpful assistant. Write mathematical formulas as LaTeX, using ' +
  '$$...$$ for display math and \\(...\\) for inline math.';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  error?: boolean;
};

let counter = 0;
function makeId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}

export default function ChatScreen() {
  const theme = useTheme();
  const { t } = useI18n();
  const safeAreaInsets = useSafeAreaInsets();
  const insets = {
    ...safeAreaInsets,
    bottom: safeAreaInsets.bottom + BottomTabInset + Spacing.three,
  };

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [model, setModel] = useState(OPENROUTER_MODEL);
  const [sending, setSending] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore the conversation from a previous app run.
  useEffect(() => {
    let cancelled = false;
    void loadJSON<{ messages?: ChatMessage[]; model?: string } | null>(STORAGE_KEY, null).then(
      (data) => {
        if (cancelled) return;
        if (data?.messages?.length) setMessages(data.messages.slice(-MAX_MESSAGES));
        if (typeof data?.model === 'string' && data.model) setModel(data.model);
        setHydrated(true);
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist every change (only after the initial load to avoid overwriting).
  useEffect(() => {
    if (!hydrated) return;
    void saveJSON(STORAGE_KEY, { messages, model });
  }, [messages, model, hydrated]);

  // Clear the copy feedback timer when the screen unmounts.
  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMessage: ChatMessage = { id: makeId(), role: 'user', content: text };
    const nextMessages = [...messages, userMessage].slice(-MAX_MESSAGES);
    setMessages(nextMessages);
    setInput('');
    setSending(true);

    const history: OpenRouterMessage[] = nextMessages.slice(-HISTORY_WINDOW).map((message) => ({
      role: message.role,
      content: message.content,
    }));

    try {
      const completion = await chat(
        [{ role: 'system', content: SYSTEM_PROMPT }, ...history],
        { model, temperature: 0.7, timeoutMs: 120_000 }
      );
      const reply = completion.choices?.[0]?.message?.content;
      if (!reply || !reply.trim()) throw new Error('Empty response from the model.');
      const replyMessage: ChatMessage = { id: makeId(), role: 'assistant', content: reply };
      setMessages((current) =>
        [...current, replyMessage].slice(-MAX_MESSAGES)
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorMessage: ChatMessage = {
        id: makeId(),
        role: 'assistant',
        content: message,
        error: true,
      };
      setMessages((current) => [...current, errorMessage].slice(-MAX_MESSAGES));
    } finally {
      setSending(false);
    }
  };

  const handleClear = () => {
    Alert.alert(t('chat.clear'), t('chat.clearConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('chat.clear'), style: 'destructive', onPress: () => setMessages([]) },
    ]);
  };

  const handleCopy = async (content: string, id: string) => {
    await Clipboard.setStringAsync(content);
    setCopiedId(id);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopiedId(null), 1600);
  };

  const contentPlatformStyle = Platform.select({
    android: {
      paddingTop: insets.top,
      paddingLeft: insets.left,
      paddingRight: insets.right,
    },
    web: {
      paddingTop: Spacing.six,
    },
  });

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.inner}>
        <View style={[styles.header, contentPlatformStyle]}>
          <View style={styles.headerLeft}>
            <ThemedText type="subtitle">{t('chat.title')}</ThemedText>
          </View>
          <Pressable onPress={handleClear} hitSlop={8} style={styles.clearButton}>
            <ThemedText type="small" themeColor="textSecondary">
              {t('chat.clear')}
            </ThemedText>
          </Pressable>
        </View>
<ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={[styles.messages]}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          keyboardShouldPersistTaps="handled">
          {messages.length === 0 && !sending ? (
            <ThemedText themeColor="textSecondary" type="small" style={styles.emptyHint}>
              {t('chat.empty')}
            </ThemedText>
          ) : null}

          {messages.map((message) =>
            message.role === 'user' ? (
              <View key={message.id} style={styles.userRow}>
                <ThemedView type="backgroundSelected" style={styles.userBubble}>
                  <ThemedText type="small" style={styles.userText}>
                    {message.content}
                  </ThemedText>
                </ThemedView>
              </View>
            ) : (
              <ThemedView key={message.id} type="backgroundElement" style={styles.assistantBubble}>
                {message.error ? (
                  <ThemedText type="small" style={styles.errorText}>
                    {t('chat.errorMessage', { message: message.content })}
                  </ThemedText>
                ) : (
                  <>
                    <MathAnswer text={message.content} />
                    <Pressable
                      onPress={() => void handleCopy(message.content, message.id)}
                      hitSlop={8}
                      style={styles.copyButton}>
                      <ThemedText type="code" themeColor={copiedId === message.id ? 'text' : 'textSecondary'}>
                        {copiedId === message.id ? `✓ ${t('chat.copied')}` : `⧉ ${t('chat.copy')}`}
                      </ThemedText>
                    </Pressable>
                  </>
                )}
              </ThemedView>
            )
          )}

          {sending ? (
            <View style={styles.thinkingRow}>
              <ActivityIndicator size="small" />
              <ThemedText type="small" themeColor="textSecondary">
                {t('chat.thinking', { model })}
              </ThemedText>
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.composerArea}>
          <ModelChips mode="live" value={model} onChange={setModel} visibleCount={6} />
          <Pressable
            onPress={() => setBrowseOpen((v) => !v)}
            hitSlop={8}
            style={styles.browseToggle}>
            <ThemedText type="code" themeColor="textSecondary">
              {browseOpen ? t('common.close') : t('models.title')}
            </ThemedText>
          </Pressable>
          {browseOpen ? (
            <ModelBrowser
              selectedId={model}
              onSelect={(id) => {
                setModel(id);
                setBrowseOpen(false);
              }}
            />
          ) : null}
          <View style={styles.composer}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder={t('chat.placeholder')}
              placeholderTextColor={theme.textSecondary}
              multiline
              maxLength={8000}
              style={[
                styles.input,
                {
                  color: theme.text,
                  backgroundColor: theme.background,
                  borderColor: theme.backgroundSelected,
                },
              ]}
            />
            <Pressable
              disabled={sending || input.trim().length === 0}
              onPress={() => void handleSend()}
              style={[styles.sendButton, (sending || input.trim().length === 0) && styles.sendDim]}>
              {sending ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <ThemedText type="smallBold" style={styles.sendText}>
                  {t('chat.send')}
                </ThemedText>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  inner: {
    flex: 1,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  clearButton: {
    paddingVertical: Spacing.one,
  },
  messages: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  emptyHint: {
    textAlign: 'center',
    paddingVertical: Spacing.four,
  },
  userRow: {
    alignItems: 'flex-end',
  },
  userBubble: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    maxWidth: '85%',
  },
  userText: {
    lineHeight: 20,
  },
  assistantBubble: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  copyButton: {
    alignSelf: 'flex-end',
    marginTop: Spacing.one,
    paddingVertical: 2,
  },
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  errorText: {
    color: '#e05252',
  },
  composerArea: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  browseToggle: {
    alignSelf: 'flex-start',
    paddingVertical: 2,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  sendButton: {
    backgroundColor: '#3c87f7',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three - 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDim: {
    opacity: 0.45,
  },
  sendText: {
    color: '#ffffff',
  },
});