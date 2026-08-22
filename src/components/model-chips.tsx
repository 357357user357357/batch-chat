import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useI18n } from '@/i18n';
import { useTheme } from '@/hooks/use-theme';
import { listModels, type OpenRouterModelInfo } from '@/services/openrouter';

export type ModelChipsProps = {
  /** 'batch' shows only `…:batch` models, 'live' shows regular ones. */
  mode: 'batch' | 'live';
  /** Currently selected model id. */
  value: string;
  onChange: (id: string) => void;
  /** How many chips to render before the custom input. */
  visibleCount?: number;
};

function fmtPrice(price?: number): string {
  if (price == null) return '—';
  const per1m = price * 1_000_000;
  if (per1m >= 100) return String(Math.round(per1m));
  if (per1m >= 0.1) return per1m.toFixed(2);
  return per1m > 0 ? `${Math.round(per1m * 100)}¢` : '0';
}

function isBatchModel(model: OpenRouterModelInfo): boolean {
  return model.id.trim().toLowerCase().endsWith(':batch');
}

/** How many interactive suggestions to show while typing. */
const MAX_SUGGESTIONS = 12;

/** Rank a model against a query so exact/prefix matches surface first (0 = best). */
function rankModel(model: OpenRouterModelInfo, q: string): number {
  const id = model.id.toLowerCase();
  const name = model.name.toLowerCase();
  const description = (model.description ?? '').toLowerCase();
  if (id === q) return 0;
  if (id.startsWith(q)) return 1;
  if (name.startsWith(q)) return 2;
  if (name.includes(q)) return 3;
  if (id.includes(q)) return 4;
  if (description.includes(q)) return 5;
  return 6;
}

/**
 * Model picker backed by the live OpenRouter model catalog
 * (`GET /api/v1/models`). Renders a row of selectable chips plus a search
 * input that filters the whole catalog — batch and non-batch models alike —
 * as the user types, with a clear "batch" badge. Any id can still be typed
 * manually (a "use custom id" fallback) when the API is unreachable.
 */
export function ModelChips({ mode, value, onChange, visibleCount = 8 }: ModelChipsProps) {
  const { t } = useI18n();
  const theme = useTheme();
  const [models, setModels] = useState<OpenRouterModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setModels(await listModels());
    } catch (err) {
      console.warn('[model-chips] load failed', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Quick-pick chips (current mode only), cheapest prompt price first.
  const chips = useMemo(() => {
    const inMode = models.filter((model) =>
      mode === 'batch' ? isBatchModel(model) : !isBatchModel(model)
    );
    inMode.sort(
      (a, b) => (a.pricing?.prompt ?? Number.MAX_VALUE) - (b.pricing?.prompt ?? Number.MAX_VALUE)
    );
    return inMode.slice(0, visibleCount);
  }, [models, mode, visibleCount]);

  // Interactive suggestions across the whole catalog (batch + live together).
  const q = query.trim().toLowerCase();
  const suggestions = useMemo(() => {
    if (!q) return [];
    return models
      .filter(
        (model) =>
          model.name.toLowerCase().includes(q) ||
          model.id.toLowerCase().includes(q) ||
          (model.description ?? '').toLowerCase().includes(q)
      )
      .map((model) => ({ model, rank: rankModel(model, q) }))
      .sort(
        (a, b) =>
          a.rank - b.rank ||
          (a.model.pricing?.prompt ?? Number.MAX_VALUE) -
            (b.model.pricing?.prompt ?? Number.MAX_VALUE)
      )
      .slice(0, MAX_SUGGESTIONS)
      .map((entry) => entry.model);
  }, [models, q]);

  const selectedModel = models.find((model) => model.id === value) ?? null;
  const showDropdown = q.length > 0;

  const selectModel = (id: string) => {
    onChange(id);
    setQuery('');
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <ThemedText type="code" themeColor="textSecondary">
          {t(mode === 'batch' ? 'models.batch.choiceHint' : 'models.live.choiceHint')}
        </ThemedText>
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

      {showDropdown ? (
        <View style={[styles.dropdown, { borderColor: theme.backgroundSelected }]}>
          {suggestions.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.noMatch}>
              {t('models.noMatch')}
            </ThemedText>
          ) : (
            <ScrollView
              style={styles.suggestList}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled>
              {suggestions.map((model) => {
                const selected = value === model.id;
                const batch = isBatchModel(model);
                return (
                  <Pressable
                    key={model.id}
                    onPress={() => selectModel(model.id)}
                    style={[
                      styles.suggestRow,
                      selected && styles.suggestRowSelected,
                      { borderColor: theme.backgroundSelected },
                    ]}>
                    <View style={styles.suggestMain}>
                      <View style={styles.suggestTitle}>
                        <ThemedText type="smallBold" numberOfLines={1} style={styles.suggestName}>
                          {model.name}
                        </ThemedText>
                        {batch ? (
                          <ThemedText type="code" themeColor="textSecondary" style={styles.badge}>
                            batch
                          </ThemedText>
                        ) : null}
                      </View>
                      <ThemedText type="code" themeColor="textSecondary" numberOfLines={1}>
                        {model.id} · $
                        {`${fmtPrice(model.pricing?.prompt)} / $${fmtPrice(model.pricing?.completion)}`}
                      </ThemedText>
                    </View>
                    {selected ? (
                      <ThemedText type="smallBold" style={styles.copied}>
                        ✓
                      </ThemedText>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          {!models.some((model) => model.id === query.trim()) ? (
            <Pressable onPress={() => selectModel(query.trim())} style={styles.customRow}>
              <ThemedText type="small" style={styles.customText}>
                {t('models.useCustom', { id: query.trim() })}
              </ThemedText>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <View>
          <View style={styles.chips}>
            {chips.map((model) => {
              const selected = value === model.id;
              return (
                <Pressable
                  key={model.id}
                  onPress={() => onChange(model.id)}
                  style={[
                    styles.chip,
                    selected && styles.chipSelected,
                    { borderColor: theme.backgroundSelected },
                  ]}>
                  <ThemedText
                    type="smallBold"
                    themeColor={selected ? 'text' : 'textSecondary'}
                    numberOfLines={1}>
                    {model.name}
                  </ThemedText>
                  <ThemedText type="code" themeColor="textSecondary" numberOfLines={1}>
                    {model.id} · $
                    {`${fmtPrice(model.pricing?.prompt)} / $${fmtPrice(model.pricing?.completion)}`}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>

          {value ? (
            <ThemedText type="code" themeColor="textSecondary" numberOfLines={1}>
              {t('models.selected', {
                model: selectedModel ? `${selectedModel.name} (${selectedModel.id})` : value,
              })}
            </ThemedText>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    flexGrow: 1,
    flexBasis: '45%',
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one + 2,
    gap: 1,
  },
  chipSelected: {
    borderColor: '#3c87f7',
    backgroundColor: 'rgba(60,135,247,0.18)',
  },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 13,
  },
  dropdown: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    overflow: 'hidden',
  },
  suggestList: {
    maxHeight: 320,
  },
  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderBottomWidth: 1,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one + 2,
  },
  suggestRowSelected: {
    backgroundColor: 'rgba(60,135,247,0.12)',
  },
  suggestMain: {
    flex: 1,
    gap: 1,
  },
  suggestTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  suggestName: {
    flexShrink: 1,
  },
  badge: {
    borderWidth: 1,
    borderColor: 'rgba(128,128,128,0.5)',
    borderRadius: Spacing.one,
    paddingHorizontal: Spacing.one,
    fontSize: 10,
  },
  copied: {
    color: '#3c87f7',
  },
  noMatch: {
    padding: Spacing.two,
  },
  customRow: {
    borderTopWidth: 1,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  customText: {
    color: '#3c87f7',
  },
  errorText: {
    color: '#e05252',
  },
});