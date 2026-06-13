import { useState, useEffect, useCallback } from 'react';

type Theme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'app.theme';

function getInitialTheme(): Theme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') {
    return stored;
  }
  return 'dark';
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  const applyTheme = useCallback((newTheme: Theme) => {
    document.documentElement.setAttribute('data-theme', newTheme);
    setThemeState(newTheme);
  }, []);

  const setTheme = useCallback((newTheme: Theme) => {
    localStorage.setItem(THEME_STORAGE_KEY, newTheme);
    applyTheme(newTheme);
  }, [applyTheme]);

  useEffect(() => {
    applyTheme(getInitialTheme());
  }, [applyTheme]);

  return { theme, setTheme };
}
