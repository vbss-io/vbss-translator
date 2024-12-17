export type Translation = {
  [key: string]: string;
};

export type TranslatorProviderType = {
  children: React.ReactNode;
  translations: Translation[];
  defaultLanguage?: string;
  persist?: boolean;
  persistKey?: string;
  autoDetectLanguage?: boolean
};

export type TranslatorContextType = {
  t: (key: string) => string;
  language: string;
  languages: string[];
  setLanguage: (language: string) => void;
};
