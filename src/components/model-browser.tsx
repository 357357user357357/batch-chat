import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useI18n } from '@/i18n';
import { useTheme } from '@/hooks/use-theme';
import {
  isBatchModelId,
  listModels,
  type OpenRouterModelInfo,
} from '@/services/openrouter';

type SortKey = 'relevance' | 'newest' | 'priceAsc' | 'priceDesc' | 'context';
type FilterKey = 'all' | 'live' | 'batch';

const SORT_KEYS: SortKey[] = ['relevance', 'newest', 'priceAsc', 'priceDesc', 'context'];
const FILTER_KEYS: FilterKey[] = ['all', 'live', 'batch'];

function fmtPrice(price?: number): string {
  if (price == null) return '—';
  const per1m = price * 1_000_000;
  if (per1m >= 100) return String(Math.round(per1m));
  if (per1m >= 0.1) return per1m.toFixed(2);
  return per1m > 0 ? `${Math.round(per1m * 100)}¢` : '0';
}

/** Combined prompt+completion price, used for sorting. */
function priceScore(model: OpenRouterModelInfo): number {
  const prompt = model.pricing?.prompt ?? Number.MAX_VALUE;
  const completion = model.pricing?.completion ?? Number.MAX_VALUE;
  return Math.min(prompt, completion);
}

/**
 * A browsable catalog of every model OpenRouter exposes: both live and
 * :batch variants. Supports free-text search, live/batch filtering and
 * sorting by relevance (cheapest first), newest, price or context length.
 */
export function ModelBrowser({
  onSelect,
  selectedId,
}: {
  onSelect?: (id: string) => void;
  selectedId?: string;
}) {
  const { t } = useI18n();
  const theme = useTheme();
  const [models, setModels] = useState<OpenRouterModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('relevance');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setModels(await listModels());
    } catch (err) {
      console.warn('[model-browser] load failed', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = models.filter((model) => {
      if (filter === 'live' && isBatchModelId(model.id)) return false;
      if (filter === 'batch' && !isBatchModelId(model.id)) return false;
      if (!q) return true;
      return (
        model.name.toLowerCase().includes(q) ||
        model.id.toLowerCase().includes(q) ||
        (model.description ?? '').toLowerCase().includes(q)
      );
    });

    list = [...list].sort((a, b) => {
      switch (sort) {
        case 'newest':
          return (b.created ?? 0) - (a.created ?? 0);
        case 'priceAsc':
          return priceScore(a) - priceScore(b);
        case 'priceDesc':
          return priceScore(b) - priceScore(a);
        case 'context':
          return (b.context_length ?? 0) - (a.context_length ?? 0);
        case 'relevance':
        default:
          return priceScore(a) - priceScore(b);
      }
    });
    return list;
  }, [models, query, sort, filter]);

  const shown = expanded ? visible : visible.slice(0, 40);

  const copyId = async (id: string) => {
    try {
      await Clipboard.setStringAsync(id);
    } catch (err) {
      console.warn('[model-browser] copy id failed', err);
    }
  };

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.headerRow}>
        <ThemedText type="smallBold">{t('models.title')}</ThemedText>
        <Pressable onPress={() => void load()} disabled={loading} hitSlop={8}>
          {loading ? (
            <ActivityIndicator size="small" />
          ) : (
            <ThemedText type="code" themeColor="textSecondary">
              {t('models.refresh')}
            </ThemedText>
          )}
        </Pressable>
      </View>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={t('models.searchPlaceholder')}
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        style={[
          styles.input,
          { color: theme.text, borderColor: theme.backgroundSelected, backgroundColor: theme.background },
        ]}
      />

      <View style={styles.chipRow}>
        {FILTER_KEYS.map((key) => {
          const active = filter === key;
          const label =
            key === 'all' ? t('models.filter.all') : key === 'live' ? t('models.filter.live') : t('models.filter.batch');
          return (
            <Pressable
              key={key}
              onPress={() => setFilter(key)}
              style={[styles.filterChip, active && styles.filterChipActive]}>
              <ThemedText type="code" themeColor={active ? 'text' : 'textSecondary'}>
                {label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.chipRow}>
        <ThemedText type="code" themeColor="textSecondary">
          {t('models.sort')}:
        </ThemedText>
        {SORT_KEYS.map((key) => {
          const active = sort === key;
          const label =
            key === 'relevance'
              ? t('models.sort.relevance')
              : key === 'newest'
                ? t('models.sort.newest')
                : key === 'priceAsc'
                  ? t('models.sort.priceAsc')
                  : key === 'priceDesc'
                    ? t('models.sort.priceDesc')
                    : t('models.sort.context');
          return (
            <Pressable
              key={key}
              onPress={() => setSort(key)}
              style={[styles.filterChip, active && styles.filterChipActive]}>
              <ThemedText type="code" themeColor={active ? 'text' : 'textSecondary'}>
                {label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      <ThemedText type="code" themeColor="textSecondary">
        {t('models.count', { count: visible.length })}
      </ThemedText>

      {error && models.length === 0 ? (
        <ThemedText type="small" style={styles.errorText}>
          {t('models.error')}
        </ThemedText>
      ) : null}

      {loading && models.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {t('models.loading')}
        </ThemedText>
      ) : null}

      <ScrollView style={styles.list} nestedScrollEnabled>
        {shown.map((model) => {
          const selected = selectedId === model.id;
          const isBatch = isBatchModelId(model.id);
          const created = model.created
            ? new Date(model.created * 1000).toLocaleDateString([], {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })
            : null;
          return (
            <Pressable
              key={model.id}
              style={[styles.row, selected && styles.rowSelected, { borderColor: theme.backgroundSelected }]}
              onPress={() => {
                onSelect?.(model.id);
                void copyId(model.id);
              }}>
              <View style={styles.rowMain}>
                <View style={styles.rowTitle}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {model.name}
                  </ThemedText>
                  {isBatch ? (
                    <ThemedText type="code" themeColor="textSecondary" style={styles.badge}>
                      batch
                    </ThemedText>
                  ) : null}
                </View>
                <ThemedText type="code" themeColor="textSecondary" numberOfLines={1}>
                  {model.id}
                </ThemedText>
                <ThemedText type="code" themeColor="textSecondary" numberOfLines={2}>
                  $ {fmtPrice(model.pricing?.prompt)} / $ {fmtPrice(model.pricing?.completion)}
                  {model.context_length ? ` · ${model.context_length.toLocaleString()} ctx` : ''}
                  {created ? ` · ${created}` : ''}
                </ThemedText>
                {model.description ? (
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                    {model.description}
                  </ThemedText>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      {visible.length > shown.length ? (
        <Pressable onPress={() => setExpanded((v) => !v)} hitSlop={8} style={styles.moreButton}>
          <ThemedText type="smallBold" style={styles.moreText}>
            {expanded ? t('models.showLess') : t('models.showMore', { count: visible.length })}
          </ThemedText>
        </Pressable>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Spacing.four,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 13,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    alignItems: 'center',
  },
  filterChip: {
    borderWidth: 1,
    borderColor: 'rgba(128,128,128,0.35)',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
  },
  filterChipActive: {
    borderColor: '#3c87f7',
    backgroundColor: 'rgba(60,135,247,0.18)',
  },
  list: {
    maxHeight: 360,
  },
  row: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one + 2,
    marginBottom: Spacing.one,
  },
  rowSelected: {
    borderColor: '#3c87f7',
    backgroundColor: 'rgba(60,135,247,0.12)',
  },
  rowMain: {
    gap: 2,
  },
  rowTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  badge: {
    borderWidth: 1,
    borderColor: 'rgba(128,128,128,0.5)',
    borderRadius: Spacing.one,
    paddingHorizontal: Spacing.one,
    fontSize: 10,
  },
  errorText: {
    color: '#e05252',
  },
  moreButton: {
    alignSelf: 'center',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  moreText: {
    color: '#3c87f7',
  },
});
