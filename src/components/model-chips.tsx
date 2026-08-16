import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

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

/**
 * Model picker backed by the live OpenRouter model catalog
 * (`GET /api/v1/models`). Renders a row of selectable chips plus a free-text
 * input, so any model id can be typed even when the API is unreachable.
 */
export function ModelChips({ mode, value, onChange, visibleCount = 8 }: ModelChipsProps) {
  const { t } = useI18n();
  const theme = useTheme();
  const [models, setModels] = useState<OpenRouterModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const all = await listModels();
      const filtered = all.filter((model) =>
        mode === 'batch' ? model.id.endsWith(':batch') : !model.id.endsWith(':batch')
      );
      // Cheapest prompt price first — the interesting models end up on top.
      filtered.sort(
        (a, b) => (a.pricing?.prompt ?? Number.MAX_VALUE) - (b.pricing?.prompt ?? Number.MAX_VALUE)
      );
      setModels(filtered);
    } catch (err) {
      console.warn('[model-chips] load failed', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    void load();
  }, [load]);

  const chips = models.slice(0, visibleCount);

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

      {error && chips.length === 0 ? (
        <ThemedText type="small" style={styles.errorText}>
          {t('models.error')}
        </ThemedText>
      ) : null}

      {loading && chips.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {t('models.loading')}
        </ThemedText>
      ) : null}

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

      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={t(mode === 'batch' ? 'models.batch.customPlaceholder' : 'models.live.customPlaceholder')}
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        style={[
          styles.input,
          { color: theme.text, borderColor: theme.backgroundSelected, backgroundColor: theme.background },
        ]}
      />
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
  errorText: {
    color: '#e05252',
  },
});