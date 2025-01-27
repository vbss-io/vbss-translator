import { TranslatorContext } from "@/contexts/TranslatorContext";
import { TranslatorProviderType } from "@/types";
import { useEffect, useState } from "react";

const getBrowserLanguage = (fallback: string) => {
  const lang = navigator?.language?.split('-')?.[0];
  return lang || fallback;
}

const getPersistedLanguage = (key: string) => {
  return localStorage.getItem(key);
}

const setPersistedLanguage  = (persistKey: string, lang: string) => {
  localStorage.setItem(persistKey, lang);
}

export const TranslatorProvider = ({
  children,
  translations,
  defaultLanguage = 'en',
  persist = false,
  persistKey = 'language',
  autoDetectLanguage = false
}: TranslatorProviderType) => {
  const persistedLanguage = persist ? getPersistedLanguage(persistKey) : null
  const autoDetectedLanguage = autoDetectLanguage ? getBrowserLanguage(defaultLanguage) : null
  const [language, setLanguage] = useState<string>(persistedLanguage ?? autoDetectedLanguage ?? defaultLanguage);

  useEffect(() => {
    if (persist) {
      setPersistedLanguage(persistKey, language)
    }
  }, [language, persist, persistKey])

  const languages = Object.keys(translations[0] || {})

  const t = (text: string): string => {
    const translation = translations.find((item) => {
      const values = Object.values(item)
      return (values.some((value) => value.toLocaleLowerCase() === text.toLocaleLowerCase()))
    })

    if (!translation?.[language]) {
      console.warn(`[Translator Debug] Missing translation "${language}" for: '${text}'`);
      return text
    }

    return translation[language]
  };

  return (
    <TranslatorContext.Provider value={{ t, language, languages, setLanguage }}>
      {children}
    </TranslatorContext.Provider>
  );
};
