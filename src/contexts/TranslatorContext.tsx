import { createContext, useContext } from 'react';
import { TranslatorContextType } from '@/types';

export const TranslatorContext = createContext<TranslatorContextType | null>(null);

export const useTranslatorContext = () => {
  const context = useContext(TranslatorContext);
  if (!context) throw new Error('useTranslatorContext must be used within a TranslatorProvider');
  return context;
};

