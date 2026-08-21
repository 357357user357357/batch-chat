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

const DIALOGS_STORAGE_KEY = 'openrouter.dialogs.v1';
const LEGACY_STORAGE_KEY = 'openrouter.chat.v1';
/** Hard ceiling on how many messages are kept / persisted per dialog. */
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

type Dialog = {
  id: string;
  title: string;
  model: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
};

let counter = 0;
function makeId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}

/** Derive a short title from the first user message ('' when none yet). */
function titleFromMessages(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === 'user');
  if (!first) return '';
  const cleaned = first.content.replace(/\s+/g, ' ').trim();
  return cleaned.length > 42 ? `${cleaned.slice(0, 42)}…` : cleaned;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const day = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${day} ${time}`;
}

export default function ChatScreen() {
  const theme = useTheme();
  const { t } = useI18n();
  const safeAreaInsets = useSafeAreaInsets();
  const insets = {
    ...safeAreaInsets,
    bottom: safeAreaInsets.bottom + BottomTabInset + Spacing.three,
  };

  const [dialogs, setDialogs] = useState<Dialog[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeDialog = dialogs.find((dialog) => dialog.id === activeId) ?? null;
  const messages = activeDialog?.messages ?? [];
  const model = activeDialog?.model ?? OPENROUTER_MODEL;

  // Restore the dialog list (migrating the old single conversation, if any).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let list = await loadJSON<Dialog[] | null>(DIALOGS_STORAGE_KEY, null);
      if (!Array.isArray(list)) {
        list = [];
        const legacy = await loadJSON<{ messages?: ChatMessage[]; model?: string } | null>(
          LEGACY_STORAGE_KEY,
          null
        );
        if (legacy?.messages?.length) {
          const migrated = legacy.messages.slice(-MAX_MESSAGES);
          const now = Date.now();
          list.push({
            id: makeId(),
            title: titleFromMessages(migrated),
            model:
              typeof legacy.model === 'string' && legacy.model ? legacy.model : OPENROUTER_MODEL,
            messages: migrated,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
      if (cancelled) return;
      setDialogs(list);
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist every change (only after the initial load to avoid overwriting).
  useEffect(() => {
    if (!hydrated) return;
    void saveJSON(DIALOGS_STORAGE_KEY, dialogs);
  }, [dialogs, hydrated]);

  // Clear the copy feedback timer when the screen unmounts.
  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const handleNew = () => {
    const now = Date.now();
    const dialog: Dialog = {
      id: makeId(),
      title: '',
      model: OPENROUTER_MODEL,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    setDialogs((current) => [...current, dialog]);
    setActiveId(dialog.id);
    setInput('');
    setBrowseOpen(false);
  };

  const openDialog = (id: string) => {
    setActiveId(id);
    setBrowseOpen(false);
  };

  const goBack = () => {
    setActiveId(null);
    setBrowseOpen(false);
  };

  const setActiveModel = (id: string) => {
    setDialogs((current) =>
      current.map((dialog) =>
        dialog.id === activeId ? { ...dialog, model: id, updatedAt: Date.now() } : dialog
      )
    );
  };

  const handleDelete = () => {
    if (!activeId) return;
    Alert.alert(t('chat.delete'), t('chat.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          setDialogs((current) => current.filter((dialog) => dialog.id !== activeId));
          setActiveId(null);
        },
      },
    ]);
  };

  const handleClear = () => {
    if (!activeId) return;
    Alert.alert(t('chat.clear'), t('chat.clearConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('chat.clear'),
        style: 'destructive',
        onPress: () => {
          setDialogs((current) =>
            current.map((dialog) =>
              dialog.id === activeId ? { ...dialog, messages: [], title: '', updatedAt: Date.now() } : dialog
            )
          );
        },
      },
    ]);
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending || !activeId) return;

    const userMessage: ChatMessage = { id: makeId(), role: 'user', content: text };
    const currentMessages = activeDialog?.messages ?? [];
    const nextMessages = [...currentMessages, userMessage].slice(-MAX_MESSAGES);
    const nextTitle = activeDialog?.title || titleFromMessages(nextMessages);

    setDialogs((current) =>
      current.map((dialog) =>
        dialog.id === activeId
          ? { ...dialog, messages: nextMessages, title: nextTitle, updatedAt: Date.now() }
          : dialog
      )
    );
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
      setDialogs((current) =>
        current.map((dialog) =>
          dialog.id === activeId
            ? { ...dialog, messages: [...dialog.messages, replyMessage].slice(-MAX_MESSAGES), updatedAt: Date.now() }
            : dialog
        )
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorMessage: ChatMessage = { id: makeId(), role: 'assistant', content: message, error: true };
      setDialogs((current) =>
        current.map((dialog) =>
          dialog.id === activeId
            ? { ...dialog, messages: [...dialog.messages, errorMessage].slice(-MAX_MESSAGES), updatedAt: Date.now() }
            : dialog
        )
      );
    } finally {
      setSending(false);
    }
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

  const sortedDialogs = [...dialogs].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.inner}>
        {activeDialog ? (
          <>
            <View style={[styles.header, contentPlatformStyle]}>
              <View style={styles.headerLeft}>
                <Pressable onPress={goBack} hitSlop={8} style={styles.backButton}>
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    ‹ {t('chat.back')}
                  </ThemedText>
                </Pressable>
                <ThemedText type="smallBold" numberOfLines={1} style={styles.headerTitle}>
                  {activeDialog.title || t('chat.untitled')}
                </ThemedText>
              </View>
              <View style={styles.headerActions}>
                <Pressable onPress={handleClear} hitSlop={8} style={styles.clearButton}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('chat.clear')}
                  </ThemedText>
                </Pressable>
                <Pressable onPress={handleDelete} hitSlop={8} style={styles.clearButton}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('common.delete')}
                  </ThemedText>
                </Pressable>
              </View>
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
              <ModelChips mode="live" value={model} onChange={setActiveModel} visibleCount={6} />
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
                    setActiveModel(id);
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
          </>
        ) : (
          <>
            <View style={[styles.header, contentPlatformStyle]}>
              <View style={styles.headerLeft}>
                <ThemedText type="subtitle">{t('chat.title')}</ThemedText>
              </View>
              <Pressable onPress={handleNew} hitSlop={8} style={styles.newButton}>
                <ThemedText type="smallBold" style={styles.newText}>
                  + {t('chat.newDialog')}
                </ThemedText>
              </Pressable>
            </View>

            <ScrollView
              style={styles.flex}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled">
              {sortedDialogs.length === 0 ? (
                <ThemedText themeColor="textSecondary" type="small" style={styles.emptyHint}>
                  {t('chat.noDialogs')}
                </ThemedText>
              ) : (
                sortedDialogs.map((dialog) => {
                  const last = dialog.messages[dialog.messages.length - 1];
                  const preview = last
                    ? last.role === 'user'
                      ? `${t('chat.you')}: ${last.content}`
                      : last.content
                    : '';
                  return (
                    <Pressable
                      key={dialog.id}
                      onPress={() => openDialog(dialog.id)}
                      style={[styles.dialogCard, { borderColor: theme.backgroundSelected }]}>
                      <View style={styles.dialogRow}>
                        <ThemedText type="smallBold" numberOfLines={1} style={styles.dialogTitle}>
                          {dialog.title || t('chat.untitled')}
                        </ThemedText>
                        <ThemedText type="code" themeColor="textSecondary">
                          {formatTime(dialog.updatedAt)}
                        </ThemedText>
                      </View>
                      <ThemedText type="code" themeColor="textSecondary" numberOfLines={1}>
                        {dialog.model}
                      </ThemedText>
                      {preview ? (
                        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                          {preview}
                        </ThemedText>
                      ) : (
                        <ThemedText type="small" themeColor="textSecondary">
                          {t('chat.emptyDialog')}
                        </ThemedText>
                      )}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </>
        )}
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
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  headerTitle: {
    flex: 1,
  },
  backButton: {
    paddingVertical: Spacing.one,
  },
  clearButton: {
    paddingVertical: Spacing.one,
  },
  newButton: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  newText: {
    color: '#3c87f7',
  },
  listContent: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  dialogCard: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.one,
  },
  dialogRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  dialogTitle: {
    flex: 1,
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
