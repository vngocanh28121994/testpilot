import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark' | 'system';
export type ColorTheme = 'green' | 'techcombank';

const STORAGE_KEY = 'testpilot-theme';
const COLOR_STORAGE_KEY = 'testpilot-color-theme';

interface ThemeContextValue {
  theme: Theme;
  /** Theme thực sự đang áp — 'system' đã được phân giải. */
  resolved: 'light' | 'dark';
  setTheme: (t: Theme) => void;
  colorTheme: ColorTheme;
  setColorTheme: (colorTheme: ColorTheme) => void;
}

// eslint-disable-next-line react-refresh/only-export-components
export const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readStored(): Theme {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

function readStoredColorTheme(): ColorTheme {
  // `coral` là tên preset ở bản phát hành trước; giữ nó để người dùng đã chọn
  // màu đỏ không bị mất lựa chọn khi preset được chuẩn hoá theo Techcombank.
  const stored = localStorage.getItem(COLOR_STORAGE_KEY);
  return stored === 'techcombank' || stored === 'coral' ? 'techcombank' : 'green';
}

/**
 * Bản cũ chỉ có light theme; dark mode là thứ mới của đợt này.
 *
 * `index.html` đã đặt sẵn class `dark` để tránh nháy trắng lúc tải — provider
 * này chỉ chỉnh lại cho khớp lựa chọn đã lưu, chứ không phải nguồn đầu tiên.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStored);
  const [colorTheme, setColorThemeState] = useState<ColorTheme>(readStoredColorTheme);
  const [systemIsDark, setSystemIsDark] = useState(() => systemTheme() === 'dark');

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemIsDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved: 'light' | 'dark' =
    theme === 'system' ? (systemIsDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
  }, [resolved]);

  useEffect(() => {
    document.documentElement.dataset.colorTheme = colorTheme;
  }, [colorTheme]);

  const setTheme = useCallback((t: Theme) => {
    localStorage.setItem(STORAGE_KEY, t);
    setThemeState(t);
  }, []);

  const setColorTheme = useCallback((nextColorTheme: ColorTheme) => {
    localStorage.setItem(COLOR_STORAGE_KEY, nextColorTheme);
    setColorThemeState(nextColorTheme);
  }, []);

  const value = useMemo(
    () => ({ theme, resolved, setTheme, colorTheme, setColorTheme }),
    [theme, resolved, setTheme, colorTheme, setColorTheme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
