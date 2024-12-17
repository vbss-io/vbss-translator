import { useTranslatorContext } from '@/contexts/TranslatorContext';

export const useTranslator = () => {
  return useTranslatorContext();
};
