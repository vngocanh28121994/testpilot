import { useContext } from 'react';
import { ThemeContext, type Theme } from '@/components/ThemeProvider';

export type ThemeChoice = Theme;

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme phải nằm trong <ThemeProvider>.');
  return ctx;
}
