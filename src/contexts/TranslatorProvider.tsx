import { TranslatorContext } from "@/contexts/TranslatorContext";
import { Translation } from "@/types";
import { useState } from "react";

export const TranslatorProvider = ({
  children,
  defaultLanguage = 'en',
  translations,
}: {
  children: React.ReactNode;
  defaultLanguage?: string;
  translations: Translation[];
}) => {
  const [language, setLanguage] = useState<string>(defaultLanguage);

  const t = (text: string): string => {
    const translation = translations.find((item) => {
      const values = Object.values(item)
      return (values.some((value) => value === text))
    })
    return translation ? translation[language] : text;
  };

  return (
    <TranslatorContext.Provider value={{ t, language, setLanguage }}>
      {children}
    </TranslatorContext.Provider>
  );
};
