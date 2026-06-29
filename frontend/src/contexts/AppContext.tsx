import React, { createContext, useContext, useState, useCallback } from 'react';
import type { RouterInfo } from '../types/router';

type Theme = 'light' | 'dark';

interface AppState {
  router: RouterInfo | null;
  isLoggedIn: boolean;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  setRouter: (info: RouterInfo | null) => void;
  setLoggedIn: (value: boolean) => void;
  logout: () => void;
  forceLogout: () => Promise<void>;
  // 高级选项状态：仅内存保留，刷新浏览器/重开浏览器后自动清除
  debugModeEnabled: boolean;
  setDebugModeEnabled: (value: boolean) => void;
  compatModeEnabled: boolean;
  setCompatModeEnabled: (value: boolean) => void;
}

const AppContext = createContext<AppState>({
  router: null,
  isLoggedIn: false,
  theme: 'dark',
  setTheme: () => {},
  setRouter: () => {},
  setLoggedIn: () => {},
  logout: () => {},
  forceLogout: async () => {},
  debugModeEnabled: false,
  setDebugModeEnabled: () => {},
  compatModeEnabled: false,
  setCompatModeEnabled: () => {},
});

export const AppProvider: React.FC<{ children: React.ReactNode; theme: Theme; setTheme: (theme: Theme) => void }> = ({ children, theme, setTheme }) => {
  const [router, setRouter] = useState<RouterInfo | null>(null);
  const [isLoggedIn, setLoggedIn] = useState(false);
  const [debugModeEnabled, setDebugModeEnabled] = useState(false);
  const [compatModeEnabled, setCompatModeEnabled] = useState(false);

  const logout = useCallback(() => {
    setRouter(null);
    setLoggedIn(false);
  }, []);

  const forceLogout = useCallback(async () => {
    const routerIp = router?.ipAddress;

    if (routerIp) {
      try {
        await fetch('/api/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ip: routerIp }),
        });
      } catch (e) {
        console.error('[AppContext] 强制登出 API 调用失败:', e);
      }
    }

    setRouter(null);
    setLoggedIn(false);
  }, [router?.ipAddress]);

  return (
    <AppContext.Provider value={{ router, isLoggedIn, theme, setTheme, setRouter, setLoggedIn, logout, forceLogout, debugModeEnabled, setDebugModeEnabled, compatModeEnabled, setCompatModeEnabled }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppState = () => useContext(AppContext);
