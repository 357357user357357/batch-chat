import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useI18n } from '@/i18n';
import { useTheme } from '@/hooks/use-theme';

/**
 * A single chat dialog listed in the drawer.
 *
 * This is intentionally a structural subset of the `Dialog` type used by the
 * chat screen, so the drawer stays decoupled from that screen.
 */
export type ChatDialogSummary = {
  id: string;
  title: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  updatedAt: number;
};

export type ChatDrawerProps = {
  visible: boolean;
  /** Dialogs in any order; the drawer sorts them newest-first. */
  dialogs: ChatDialogSummary[];
  /** Id of the currently open dialog, if any. */
  activeId: string | null;
  onClose: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
};

const PANEL_WIDTH = 320;

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const day = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${day} ${time}`;
}

/**
 * Left-side drawer with the list of chat dialogs — the same pattern RikkaHub
 * uses (a drawer sheet with the conversation list), triggered from a button
 * so you can jump between conversations without going back to the full list.
 */
export function ChatDrawer({
  visible,
  dialogs,
  activeId,
  onClose,
  onSelect,
  onNew,
  onDelete,
}: ChatDrawerProps) {
  const { t } = useI18n();
  const theme = useTheme();
  const { width: windowWidth } = useWindowDimensions();

  // The drawer is never wider than the screen it is shown on.
  const width = Math.min(PANEL_WIDTH, Math.floor(windowWidth * 0.85));

  // Keep the `Modal` mounted while the close animation plays out.
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.setValue(0);
      Animated.timing(progress, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start();
    } else if (mounted) {
      Animated.timing(progress, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, mounted, progress]);

  if (!mounted) return null;

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-width, 0],
  });

  const sorted = [...dialogs].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}>
      <View style={styles.overlay}>
        {/* Tap outside the panel to close. */}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: progress }]}>
          <Pressable
            onPress={onClose}
            accessibilityLabel={t('common.close')}
            style={[
              styles.backdrop,
              { backgroundColor: 'rgba(0,0,0,0.5)' },
            ]}
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.panel,
            {
              width,
              backgroundColor: theme.background,
              borderColor: theme.backgroundSelected,
              shadowColor: '#000000',
              transform: [{ translateX }],
            },
          ]}>
          <View
            style={[styles.header, { borderBottomColor: theme.backgroundSelected }]}>
            <ThemedText type="subtitle" numberOfLines={1} style={styles.headerTitle}>
              {t('chat.dialogs')}
            </ThemedText>
            <View style={styles.headerActions}>
              <Pressable onPress={onNew} hitSlop={8} style={styles.newButton}>
                <ThemedText type="smallBold" style={styles.newText}>
                  + {t('chat.newDialog')}
                </ThemedText>
              </Pressable>
              <Pressable onPress={onClose} hitSlop={8} style={styles.closeButton}>
                <ThemedText type="subtitle" style={styles.closeText}>
                  ×
                </ThemedText>
              </Pressable>
            </View>
          </View>
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled">
            {sorted.length === 0 ? (
              <ThemedText themeColor="textSecondary" type="small" style={styles.emptyHint}>
                {t('chat.noDialogs')}
              </ThemedText>
            ) : (
              sorted.map((dialog) => {
                const last = dialog.messages[dialog.messages.length - 1];
                const preview = last
                  ? last.role === 'user'
                    ? `${t('chat.you')}: ${last.content}`
                    : last.content
                  : '';
                const active = dialog.id === activeId;
                return (
                  <View
                    key={dialog.id}
                    style={[
                      styles.row,
                      {
                        backgroundColor: active
                          ? theme.backgroundSelected
                          : theme.backgroundElement,
                        borderColor: active ? '#3c87f7' : theme.backgroundSelected,
                      },
                    ]}>
                    <Pressable
                      onPress={() => onSelect(dialog.id)}
                      style={styles.rowMain}
                      accessibilityRole="button">
                      <View style={styles.rowTitleRow}>
                        <ThemedText type="smallBold" numberOfLines={1} style={styles.rowTitle}>
                          {dialog.title || t('chat.untitled')}
                        </ThemedText>
                        {active ? (
                          <ThemedText
                            type="code"
                            style={[styles.activeTag, { backgroundColor: '#3c87f7' }]}>
                            {t('chat.activeTag')}
                          </ThemedText>
                        ) : null}
                      </View>
                      <ThemedText type="code" themeColor="textSecondary" numberOfLines={1}>
                        {dialog.model}
                      </ThemedText>
                      {preview ? (
                        <ThemedText
                          type="small"
                          themeColor="textSecondary"
                          numberOfLines={2}
                          style={styles.preview}>
                          {preview}
                        </ThemedText>
                      ) : (
                        <ThemedText type="small" themeColor="textSecondary" style={styles.preview}>
                          {t('chat.emptyDialog')}
                        </ThemedText>
                      )}
                      <ThemedText type="code" themeColor="textSecondary">
                        {formatTime(dialog.updatedAt)}
                      </ThemedText>
                    </Pressable>
                    <Pressable
                      onPress={() => onDelete(dialog.id)}
                      hitSlop={8}
                      style={styles.deleteButton}
                      accessibilityLabel={t('common.delete')}>
                      <ThemedText type="small" themeColor="textSecondary">
                        ✕
                      </ThemedText>
                    </Pressable>
                  </View>
                );
              })
            )}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
  },
  panel: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    borderTopRightRadius: Spacing.three,
    borderBottomRightRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 12,
    overflow: 'hidden',
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    flex: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  newButton: {
    paddingVertical: Spacing.one,
  },
  newText: {
    color: '#3c87f7',
  },
  closeButton: {
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.half,
  },
  closeText: {
    fontSize: 28,
    lineHeight: 30,
  },
  listContent: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  emptyHint: {
    textAlign: 'center',
    paddingVertical: Spacing.four,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.one,
  },
  rowTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  rowTitle: {
    flex: 1,
  },
  activeTag: {
    color: '#ffffff',
    fontSize: 10,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.one,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  preview: {
    lineHeight: 18,
  },
  deleteButton: {
    padding: Spacing.one,
  },
});