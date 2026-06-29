import React, { useState, useEffect } from 'react';
import { ConfigProvider, theme, App as AntdApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { AppProvider, useAppState } from './contexts/AppContext';
import { WebSocketProvider, useWebSocket } from './contexts/WebSocketContext';
import { TerminalProvider, useTerminal } from './contexts/TerminalContext';
import { useTheme } from './hooks/useTheme';
import { Sidebar } from './components/organisms/Sidebar/Sidebar';
import { Header } from './components/organisms/Header/Header';
import { ReconnectModal } from './components/organisms/ReconnectModal/ReconnectModal';
import { ChangelogModal } from './components/organisms/ChangelogModal/ChangelogModal';
import { LoginPage } from './pages/LoginPage/LoginPage';
import { DashboardPage } from './pages/DashboardPage/DashboardPage';
import { BridgePage } from './pages/BridgePage/BridgePage';
import { WirelessPage } from './pages/WirelessPage/WirelessPage';
import { NetworkPage } from './pages/NetworkPage/NetworkPage';
import { FirewallPage } from './pages/FirewallPage/FirewallPage';
import { RoutePage } from './pages/RoutePage/RoutePage';
import { LogPage } from './pages/LogPage/LogPage';
import { FilePage } from './pages/FilePage/FilePage';
import { SystemPage } from './pages/SystemPage/SystemPage';
import { RebootPage } from './pages/RebootPage/RebootPage';
import { SpeedTestPage } from './pages/SpeedTestPage/SpeedTestPage';
import { FactoryResetPage } from './pages/FactoryResetPage/FactoryResetPage';
import { SystemDowngradePage } from './pages/SystemDowngradePage/SystemDowngradePage';
import { TerminalPage } from './pages/TerminalPage/TerminalPage';
import styles from './App.module.css';

const defaultRouterInfo = {
  name: 'No Device',
  ipAddress: '---',
  status: 'offline' as const,
  model: '---',
  osVersion: '---',
  username: '',
  password: '',
};

const AppContent: React.FC = () => {
  const { router, isLoggedIn, logout, setRouter } = useAppState();
  const { setCurrentPage, deviceOffline, offlineReason, forceReturnToLogin, handleReconnectSuccess } = useWebSocket();
  const { disconnectTerminal } = useTerminal();
  const [activeNav, setActiveNav] = useState('dashboard');
  const [networkTargetTab, setNetworkTargetTab] = useState<string | null>(null);
  const [changelogVisible, setChangelogVisible] = useState(false);

  useEffect(() => {
    if (!isLoggedIn) {
      setActiveNav('dashboard');
    }
  }, [isLoggedIn]);

  useEffect(() => {
    setCurrentPage(activeNav);
  }, [activeNav, setCurrentPage]);

  useEffect(() => {
    if (isLoggedIn) {
      const checkVersion = async () => {
        const seenVersion = localStorage.getItem('seenAppVersion');
        try {
          const res = await fetch('/api/app-version');
          const data = await res.json();
          const currentVersion = data.version || '1.0.0';
          
          if (seenVersion !== currentVersion) {
            setChangelogVisible(true);
            localStorage.setItem('seenAppVersion', currentVersion);
          }
        } catch (_) {}
      };
      checkVersion();
    }
  }, [isLoggedIn]);

  const handleNavigate = (nav: string) => {
    setActiveNav(nav);
    if (nav !== 'network') {
      setNetworkTargetTab(null);
    }
  };

  if (!isLoggedIn) {
    return <LoginPage />;
  }

  const renderContent = () => {
    switch (activeNav) {
      case 'dashboard': return <DashboardPage />;
      case 'bridge': return <BridgePage />;
      case 'wireless': return <WirelessPage />;
      case 'network': return <NetworkPage targetTab={networkTargetTab} onTargetTabConsumed={() => setNetworkTargetTab(null)} />;
      case 'firewall': return <FirewallPage />;
      case 'routing': return <RoutePage />;
      case 'logs': return <LogPage />;
      case 'files': return <FilePage />;
      case 'terminal': return <TerminalPage />;
      case 'reboot': return <RebootPage />;
      case 'factory-reset': return <FactoryResetPage />;
      case 'system-downgrade': return <SystemDowngradePage />;
      default: return <div className={styles.placeholder}><h1>请选择菜单项</h1></div>;
    }
  };

  const handleLogout = async () => {
    disconnectTerminal();
    if (router?.ipAddress) {
      try {
        await fetch('/api/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ip: router.ipAddress }),
        });
      } catch (e) {
        console.error('Logout API error:', e);
      }
    }
    logout();
    setActiveNav('dashboard');
  };

  const handleRouterNameChange = (name: string) => {
    if (router) {
      setRouter({ ...router, name });
    }
  };

  return (
    <div className={styles.app}>
      <Sidebar
        router={router || defaultRouterInfo}
        activeNav={activeNav}
        onNavigate={handleNavigate}
        onLogout={handleLogout}
        onRouterNameChange={handleRouterNameChange}
        onSetNetworkTargetTab={setNetworkTargetTab}
      />
      <main className={styles.main}>
        <Header currentPage={activeNav} />
        <div className={styles.content}>
          {/* SpeedTestPage 始终挂载，切换菜单时隐藏/显示，保留测速状态 */}
          <div style={{ display: activeNav === 'speedtest' ? 'contents' : 'none' }}>
            <SpeedTestPage />
          </div>
          {activeNav !== 'speedtest' && renderContent()}
        </div>
      </main>
      <ReconnectModal
        visible={deviceOffline}
        reason={offlineReason}
        onReturnToLogin={forceReturnToLogin}
        onReconnectSuccess={handleReconnectSuccess}
      />
      <ChangelogModal
        visible={changelogVisible}
        onClose={() => setChangelogVisible(false)}
      />
    </div>
  );
};

const AppWithWebSocket: React.FC = () => {
  const { router } = useAppState();
  return (
    <WebSocketProvider router={router}>
      <AppWithTerminal />
    </WebSocketProvider>
  );
};

const AppWithTerminal: React.FC = () => {
  const { router } = useAppState();
  const { deviceOffline } = useWebSocket();
  return (
    <TerminalProvider router={router} deviceOffline={deviceOffline}>
      <AppContent />
    </TerminalProvider>
  );
};

const App: React.FC = () => {
  const { theme: themeMode, setTheme: setThemeMode } = useTheme();
  const isDark = themeMode === 'dark';

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: isDark ? '#ff6b35' : '#5e72e4',
          colorBgContainer: isDark ? '#1a1a1a' : '#ffffff',
          colorBgElevated: isDark ? '#1f1f1f' : '#ffffff',
          colorBorder: isDark ? '#2d2d2d' : '#dee2e6',
          colorText: isDark ? '#ffffff' : '#32325d',
          colorTextSecondary: isDark ? '#a0a0a0' : '#525f7f',
          borderRadius: 6,
        },
        components: {
          Popconfirm: {
            colorBgElevated: isDark ? '#1a1a1a' : '#ffffff',
          },
          Popover: {
            colorBgElevated: isDark ? '#1a1a1a' : '#ffffff',
          },
        },
      }}
    >
      <AppProvider theme={themeMode} setTheme={setThemeMode}>
        <AntdApp>
          <AppWithWebSocket />
        </AntdApp>
      </AppProvider>
    </ConfigProvider>
  );
};

export default App;
