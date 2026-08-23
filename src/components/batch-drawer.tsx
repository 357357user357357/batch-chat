import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useI18n } from '@/i18n';
import { useTheme } from '@/hooks/use-theme';

export type BatchDialogSummary = {
  id: string;
  model: string;
  prompts: string[];
  createdAt: number;
  /** Flattened questions + answers, used for search. */
  searchText?: string;
};

export type BatchDrawerProps = {
  visible: boolean;
  dialogs: BatchDialogSummary[];
  activeId: string | null;
  onClose: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
};

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const day = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${day} ${time}`;
}

/** Short, single-line label for a batch: its first (main) question. */
function labelFromPrompts(prompts: string[]): string {
  const first = (prompts.find((p) => p.trim()) ?? '').replace(/\s+/g, ' ').trim();
  return first.length > 42 ? `${first.slice(0, 42)}…` : first;
}

/**
 * Left-side drawer listing the batch dialogs, opened from a dropdown (☰) button.
 * It covers two-thirds of the screen so the open dialog stays visible behind it.
 */
export function BatchDrawer({
  visible,
  dialogs,
  activeId,
  onClose,
  onSelect,
  onNew,
  onDelete,
}: BatchDrawerProps) {
  const { t } = useI18n();
  const theme = useTheme();
  const { width: windowWidth } = useWindowDimensions();

  const width = Math.floor(windowWidth * (2 / 3));

  const [mounted, setMounted] = useState(visible);
  const [search, setSearch] = useState('');
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

  // Clear the search whenever the drawer is closed.
  useEffect(() => {
    if (!visible) setSearch('');
  }, [visible]);

  if (!mounted) return null;

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-width, 0],
  });

  const sorted = [...dialogs].sort((a, b) => b.createdAt - a.createdAt);

  const query = search.trim().toLowerCase();
  const filtered = query
    ? sorted.filter((dialog) =>
        (dialog.searchText ?? dialog.prompts.join(' ')).toLowerCase().includes(query)
      )
    : sorted;

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: progress }]}>
          <Pressable
            onPress={onClose}
            accessibilityLabel={t('common.close')}
            style={[styles.backdrop, { backgroundColor: 'rgba(0,0,0,0.5)' }]}
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
          <View style={[styles.header, { borderBottomColor: theme.backgroundSelected }]}>
            <ThemedText type="subtitle" numberOfLines={1} style={styles.headerTitle}>
              {t('batches.title')}
            </ThemedText>
            <View style={styles.headerActions}>
              <Pressable onPress={onNew} hitSlop={8} style={styles.newButton}>
                <ThemedText type="smallBold" style={styles.newText}>
                  + {t('batches.newBatch')}
                </ThemedText>
              </Pressable>
              <Pressable onPress={onClose} hitSlop={8} style={styles.closeButton}>
                <ThemedText type="subtitle" style={styles.closeText}>
                  ×
                </ThemedText>
              </Pressable>
            </View>
          </View>
          <View style={styles.searchWrap}>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder={t('batches.searchPlaceholder')}
              placeholderTextColor={theme.textSecondary}
              autoCorrect={false}
              style={[
                styles.searchInput,
                {
                  color: theme.text,
                  backgroundColor: theme.background,
                  borderColor: theme.backgroundSelected,
                },
              ]}
            />
          </View>
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled">
            {filtered.length === 0 ? (
              <ThemedText themeColor="textSecondary" type="small" style={styles.emptyHint}>
                {query ? t('common.noMatch') : t('batches.historyEmpty')}
              </ThemedText>
            ) : (
              filtered.map((dialog) => {
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
                          {labelFromPrompts(dialog.prompts) || t('batches.untitled')}
                        </ThemedText>
                        {active ? (
                          <ThemedText
                            type="code"
                            style={[styles.activeTag, { backgroundColor: '#3c87f7' }]}>
                            {t('batches.activeTag')}
                          </ThemedText>
                        ) : null}
                      </View>
                      <ThemedText type="code" themeColor="textSecondary" numberOfLines={1}>
                        {dialog.model}
                      </ThemedText>
                      <ThemedText type="code" themeColor="textSecondary">
                        {formatTime(dialog.createdAt)} ·{' '}
                        {t('batches.questionsCount', { count: dialog.prompts.length })}
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
  searchWrap: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  searchInput: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 15,
    minHeight: 44,
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
