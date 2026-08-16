import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { loadString, saveString } from '@/services/storage';
import { translations, type Language, type TKey } from '@/i18n/strings';

const LANGUAGE_STORAGE_KEY = 'app.language';

export type Translate = (key: TKey, vars?: Record<string, string | number>) => string;

type I18nContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
  t: Translate;
};

const I18nContext = createContext<I18nContextValue>({
  language: 'en',
  setLanguage: () => {},
  toggleLanguage: () => {},
  t: (key) => key,
});

/**
 * Provides the active UI language. Defaults to English; the user's choice is
 * persisted through `src/services/storage.ts`.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('en');

  useEffect(() => {
    let cancelled = false;
    void loadString(LANGUAGE_STORAGE_KEY).then((saved) => {
      if (!cancelled && (saved === 'en' || saved === 'ru')) {
        setLanguageState(saved);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setLanguage = (next: Language) => {
    setLanguageState(next);
    void saveString(LANGUAGE_STORAGE_KEY, next);
  };

  const toggleLanguage = () => setLanguage(language === 'en' ? 'ru' : 'en');

  const value = useMemo<I18nContextValue>(() => {
    const t: Translate = (key, vars) => {
      let text: string = translations[language][key] ?? key;
      if (vars) {
        for (const [name, replacement] of Object.entries(vars)) {
          text = text.replaceAll(`{${name}}`, String(replacement));
        }
      }
      return text;
    };
    return { language, setLanguage, toggleLanguage, t };
  }, [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}