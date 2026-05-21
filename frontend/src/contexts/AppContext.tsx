import React, { createContext, useContext, useState, useCallback } from 'react';
import type { RouterInfo } from '../types/router';

interface AppState {
  router: RouterInfo | null;
  isLoggedIn: boolean;
  setRouter: (info: RouterInfo | null) => void;
  setLoggedIn: (value: boolean) => void;
  logout: () => void;
  forceLogout: () => Promise<void>;
}

const AppContext = createContext<AppState>({
  router: null,
  isLoggedIn: false,
  setRouter: () => {},
  setLoggedIn: () => {},
  logout: () => {},
  forceLogout: async () => {},
});

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [router, setRouter] = useState<RouterInfo | null>(null);
  const [isLoggedIn, setLoggedIn] = useState(false);

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
    <AppContext.Provider value={{ router, isLoggedIn, setRouter, setLoggedIn, logout, forceLogout }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppState = () => useContext(AppContext);
