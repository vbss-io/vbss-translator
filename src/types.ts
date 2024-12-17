export type Translation = {
  [key: string]: string;
};

export type TranslatorContextType = {
  t: (key: string) => string;
  language: string;
  setLanguage: (language: string) => void;
};
