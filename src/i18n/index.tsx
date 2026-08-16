import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';

import { translations, type Language, type TKey } from '@/i18n/strings';

export type Translate = (key: TKey, vars?: Record<string, string | number>) => string;

type I18nContextValue = {
  language: Language;
  t: Translate;
};

const I18nContext = createContext<I18nContextValue>({
  language: 'en',
  t: (key) => key,
});

/**
 * Provides the app strings. English-only.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const value = useMemo<I18nContextValue>(() => {
    const language: Language = 'en';
    const t: Translate = (key, vars) => {
      let text: string = translations[language][key] ?? key;
      if (vars) {
        for (const [name, replacement] of Object.entries(vars)) {
          text = text.replaceAll(`{${name}}`, String(replacement));
        }
      }
      return text;
    };
    return { language, t };
  }, []);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}