import React, { createContext, useContext, useRef, useEffect, useCallback, useState } from 'react';
import { message as antMessage } from 'antd';
import type { RouterInfo } from '../types/router';
import { useAppState } from './AppContext';

interface InterfaceApiData {
  name: string;
  type: string;
  mac_address?: string;
  running: boolean;
  disabled: boolean;
  rx_rate: number;
  tx_rate: number;
  rx_byte: number;
  tx_byte: number;
  slave: boolean;
}

interface InterfaceTraffic {
  [name: string]: {
    rx_bps: number;
    tx_bps: number;
  };
}

interface WirelessInterfaceData {
  '.id'?: string;
  name: string;
  running: boolean;
  disabled: boolean;
  mode: string;
  ssid: string;
  frequency: string;
  band: string;
  'channel-width'?: string;
  'wireless-protocol'?: string;
  [key: string]: any;
}

interface WirelessClientData {
  interface: string;
  mac: string;
  uptime: string;
  tx_signal: string;
  rx_signal: string;
  tx_signal_quality: string;
  rx_signal_quality: string;
  tx_rate: string;
  rx_rate: string;
}

interface SecurityProfileData {
  name: string;
  mode?: string;
  authentication_types?: string;
  unicast_ciphers?: string;
  group_ciphers?: string;
  authentication?: string;
  cipher?: string;
  password?: string;
}

interface LogEntry {
  time: string;
  topics: string;
  message: string;
  seq?: number;
}

interface WebSocketState {
  interfaces: InterfaceApiData[];
  trafficData: InterfaceTraffic;
  loading: boolean;
  error: string | null;
  currentPage: string;
  setCurrentPage: (page: string) => void;
  deviceOffline: boolean;
  offlineReason: string;
  forceReturnToLogin: () => void;
  handleReconnectSuccess: () => void;
  wirelessInterfaces: WirelessInterfaceData[];
  wirelessClients: WirelessClientData[];
  securityProfiles: SecurityProfileData[];
  wirelessLoading: boolean;
  startWirelessPolling: () => void;
  stopWirelessPolling: () => void;
  sendWsMessage: (message: Record<string, any>) => void;
  logs: LogEntry[];
  logsLoading: boolean;
  startLogsPolling: () => void;
  stopLogsPolling: () => void;
  ipAddresses: IpAddressData[];
}

interface IpAddressData {
  '.id'?: string;
  address: string;
  interface: string;
  network: string;
  disabled?: string;
  dynamic?: string;
  comment?: string;
  invalid?: string;
}

const WebSocketContext = createContext<WebSocketState>({
  interfaces: [],
  trafficData: {},
  loading: true,
  error: null,
  currentPage: 'dashboard',
  setCurrentPage: () => {},
  deviceOffline: false,
  offlineReason: '',
  forceReturnToLogin: () => {},
  handleReconnectSuccess: () => {},
  wirelessInterfaces: [],
  wirelessClients: [],
  securityProfiles: [],
  wirelessLoading: false,
  startWirelessPolling: () => {},
  stopWirelessPolling: () => {},
  sendWsMessage: () => {},
  logs: [],
  logsLoading: false,
  startLogsPolling: () => {},
  stopLogsPolling: () => {},
  ipAddresses: [],
});

export const WebSocketProvider: React.FC<{
  children: React.ReactNode;
  router: RouterInfo | null;
}> = ({ children, router }) => {
  const [interfaces, setInterfaces] = useState<InterfaceApiData[]>([]);
  const [trafficData, setTrafficData] = useState<InterfaceTraffic>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [deviceOffline, setDeviceOffline] = useState(false);
  const [offlineReason, setOfflineReason] = useState('');

  const [wirelessInterfaces, setWirelessInterfaces] = useState<WirelessInterfaceData[]>([]);
  const [wirelessClients, setWirelessClients] = useState<WirelessClientData[]>([]);
  const [securityProfiles, setSecurityProfiles] = useState<SecurityProfileData[]>([]);
  const [wirelessLoading, setWirelessLoading] = useState(false);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [ipAddresses, setIpAddresses] = useState<IpAddressData[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const isCancelledRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingWirelessStartRef = useRef(false);
  const pendingLogsStartRef = useRef(false);
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;

  const { logout } = useAppState();

  const forceReturnToLogin = useCallback(async () => {
    console.log('[WebSocket] 用户确认离线，返回登录页面');
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      try { wsRef.current.close(); } catch {}
      wsRef.current = null;
    }
    setDeviceOffline(false);
    setOfflineReason('');
    logout();
  }, [logout]);

  const handleReconnectSuccess = useCallback(async () => {
    console.log('[WebSocket] 重连成功，恢复连接');
    try {
      await fetch('/api/reconnect-success', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: router?.ipAddress }),
      });
    } catch (e) {
      console.error('[WebSocket] 重连成功通知失败:', e);
    }
    setDeviceOffline(false);
    setOfflineReason('');
    setLoading(true);
    if (wsRef.current) {
      try { wsRef.current.close(); } catch {}
      wsRef.current = null;
    }
    isCancelledRef.current = false;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = setTimeout(() => {
      connectRef.current();
    }, 500);
  }, [router?.ipAddress]);

  const connectRef = useRef<() => void>(() => {});

  const handleMessage = useCallback((event: MessageEvent) => {
    if (isCancelledRef.current) return;
    try {
      const data = JSON.parse(event.data);

      if (data.status === 'device_offline') {
        setOfflineReason(data.message || '设备连接已断开');
        setDeviceOffline(true);
        return;
      }

      if (data.type === 'interface_list') {
        if (data.status === 'connected') {
          setLoading(false);
          setError(null);
        } else if (data.status === 'success' && Array.isArray(data.interfaces)) {
          setInterfaces(data.interfaces);
          setLoading(false);
          setError(null);
        } else if (data.status === 'error') {
          setError(data.message || 'Failed to load interfaces');
        } else if (data.status === 'device_offline') {
          setOfflineReason(data.message || '设备连接已断开');
          setDeviceOffline(true);
        }
      } else if (data.type === 'interface_traffic') {
        if (data.status === 'success' && data.traffic) {
          setTrafficData(data.traffic);
        }
      } else if (data.type === 'wireless_interfaces') {
        if (data.status === 'success' && Array.isArray(data.interfaces)) {
          setWirelessInterfaces(prev => {
            if (!data.interfaces || data.interfaces.length === 0) return prev;
            if (prev.length === 0) return data.interfaces;
            const prevNames = new Set(prev.map(i => i.name));
            const newNames = new Set(data.interfaces.map(i => i.name));
            if (prevNames.size === newNames.size && prev.every(p => newNames.has(p.name))) {
              const hasChanges = data.interfaces.some(newIface => {
                const prevIface = prev.find(p => p.name === newIface.name);
                if (!prevIface) return true;
                return prevIface.running !== newIface.running ||
                       prevIface.disabled !== newIface.disabled ||
                       prevIface.ssid !== newIface.ssid ||
                       prevIface.frequency !== newIface.frequency ||
                       prevIface.band !== newIface.band ||
                       prevIface['channel-width'] !== newIface['channel-width'] ||
                       prevIface['wireless-protocol'] !== newIface['wireless-protocol'];
              });
              if (!hasChanges) return prev;
            }
            return data.interfaces;
          });
          setWirelessLoading(false);
        } else if (data.status === 'error') {
          setWirelessLoading(false);
        }
      } else if (data.type === 'wireless_clients' && data.status === 'success' && Array.isArray(data.clients)) {
        setWirelessClients(data.clients);
      } else if (data.type === 'security_profiles' && data.status === 'success' && Array.isArray(data.profiles)) {
        setSecurityProfiles(data.profiles);
      } else if (data.type === 'ip_addresses') {
        if (data.status === 'success' && Array.isArray(data.addresses)) {
          setIpAddresses(data.addresses);
        }
      } else if (data.type === 'ip_address_action') {
        if (data.status === 'success') {
          antMessage.success(data.message || '操作成功');
        } else if (data.status === 'error') {
          antMessage.error(data.message || '操作失败');
        }
      } else if (data.type === 'logs') {
        if (data.status === 'batch' && Array.isArray(data.logs)) {
          setLogs(prev => {
            const newLogs = data.logs.map((l: LogEntry) => ({
              time: l.time || '--',
              topics: l.topics || '--',
              message: l.message || '--',
              seq: l.seq,
            }));
            if (data.offset === 0) {
              return newLogs;
            }
            return [...prev, ...newLogs];
          });
          setLogsLoading(false);
        } else if (data.status === 'connected') {
          setLogsLoading(true);
        } else if (data.status === 'downloading') {
          // 只在下载时清空日志
          setLogsLoading(true);
          setLogs([]);
        } else if (data.status === 'cache_info') {
          // 有缓存时清空旧数据，准备接收缓存日志
          setLogsLoading(true);
          setLogs([]);
        } else if (data.status === 'ftp_done') {
          setLogsLoading(false);
        } else if (data.status === 'incremental' && Array.isArray(data.logs)) {
          setLogs(prev => {
            const maxSeq = prev.reduce((max, l) => l.seq != null ? Math.max(max, l.seq) : max, -1);
            const newLogs = data.logs.filter((l: LogEntry) => l.seq == null || l.seq > maxSeq).map((l: LogEntry) => ({
              time: l.time || '--',
              topics: l.topics || '--',
              message: l.message || '--',
              seq: l.seq,
            }));
            if (newLogs.length === 0) return prev;
            return [...prev, ...newLogs];
          });
        } else if (data.status === 'error') {
          setLogsLoading(false);
        }
      }
    } catch (e) {
      console.error('Failed to parse WebSocket message:', e);
    }
  }, []);

  const connect = useCallback(() => {
    if (isCancelledRef.current || !router?.ipAddress) return;

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // 开发环境（Vite 5173）使用代理路径，生产环境直接连接 32996 端口
    const isDev = window.location.port === '5173';
    const wsUrl = isDev ? `${wsProtocol}//${window.location.host}/ws` : `${wsProtocol}//${window.location.hostname}:32996`;

    console.log('[WebSocket] 尝试连接:', wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (isCancelledRef.current) {
        ws.close();
        return;
      }
      console.log('[WebSocket] 单连接已建立');
      ws.send(JSON.stringify({
        ip: router.ipAddress,
        username: router.username || '',
        password: router.password || '',
        action: 'start_interface_polling',
      }));
      
      if (pendingWirelessStartRef.current) {
        console.log('[WebSocket] 发送待处理的无线轮询请求');
        ws.send(JSON.stringify({
          action: 'start_wireless_polling',
          ip: router.ipAddress,
          username: router.username || '',
          password: router.password || '',
        }));
        pendingWirelessStartRef.current = false;
      }
      
      if (currentPageRef.current === 'wireless') {
        console.log('[WebSocket] 当前在无线页面，自动启动无线轮询');
        ws.send(JSON.stringify({
          action: 'start_wireless_polling',
          ip: router.ipAddress,
          username: router.username || '',
          password: router.password || '',
        }));
      }
      
      if (currentPageRef.current === 'logs' || pendingLogsStartRef.current) {
        console.log('[WebSocket] 当前在日志页面，自动启动日志轮询');
        pendingLogsStartRef.current = false;
        ws.send(JSON.stringify({
          action: 'start_logs_polling',
          ip: router.ipAddress,
          username: router.username || '',
          password: router.password || '',
        }));
      }
    };

    ws.onmessage = handleMessage;

    ws.onclose = () => {
      wsRef.current = null;
      if (!isCancelledRef.current && router?.ipAddress) {
        console.log('[WebSocket] 连接意外断开，触发离线检测');
        setOfflineReason('WebSocket 连接已断开');
        setDeviceOffline(true);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [router?.ipAddress, router?.username, router?.password, handleMessage]);

  connectRef.current = connect;

  const sendWsMessage = useCallback((message: Record<string, any>) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const startWirelessPolling = useCallback(() => {
    if (!router?.ipAddress) {
      console.log('[WebSocket] 启动无线轮询失败：缺少 IP 地址');
      return;
    }
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.log('[WebSocket] WebSocket 未连接，设置待处理标志');
      pendingWirelessStartRef.current = true;
      return;
    }
    console.log('[WebSocket] 启动无线轮询', { ip: router.ipAddress, hasUsername: !!router.username });
    setWirelessLoading(true);
    wsRef.current.send(JSON.stringify({
      action: 'start_wireless_polling',
      ip: router.ipAddress,
      username: router.username || '',
      password: router.password || '',
    }));
  }, [router?.ipAddress, router?.username, router?.password]);

  const stopWirelessPolling = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }
    console.log('[WebSocket] 停止无线轮询');
    wsRef.current.send(JSON.stringify({ action: 'stop_wireless' }));
    setWirelessLoading(false);
  }, []);

  const startLogsPolling = useCallback(() => {
    if (!router?.ipAddress) {
      console.log('[WebSocket] 启动日志轮询失败：缺少 IP 地址');
      return;
    }
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.log('[WebSocket] WebSocket未就绪，标记延迟启动日志轮询');
      pendingLogsStartRef.current = true;
      return;
    }
    console.log('[WebSocket] 启动日志轮询', { ip: router.ipAddress, username: router.username });
    // 不清空日志，等后端返回缓存状态再决定
    // 如果后端有缓存，会直接推送缓存日志
    // 如果后端没有缓存，会发送 downloading 状态，此时再清空
    wsRef.current.send(JSON.stringify({
      action: 'start_logs_polling',
      ip: router.ipAddress,
      username: router.username || '',
      password: router.password || '',
    }));
  }, [router?.ipAddress, router?.username, router?.password]);

  const stopLogsPolling = useCallback(() => {
    console.log('[WebSocket] 停止日志轮询');
    wsRef.current?.send(JSON.stringify({ action: 'stop_logs' }));
    setLogsLoading(false);
  }, []);

  
  useEffect(() => {
    console.log('[WebSocket] useEffect 触发, router:', router);
    if (!router?.ipAddress) {
      console.log('[WebSocket] router.ipAddress 为空，跳过连接');
      return;
    }

    console.log('[WebSocket] 准备连接 WebSocket');
    isCancelledRef.current = false;
    setDeviceOffline(false);
    setOfflineReason('');
    setLoading(true);
    connect();

    return () => {
      isCancelledRef.current = true;
      stopWirelessPolling();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        try {
          if (wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ action: 'stop' }));
          }
        } catch {}
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, router?.ipAddress, stopWirelessPolling]);

  useEffect(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (currentPage === 'dashboard') {
      wsRef.current.send(JSON.stringify({ action: 'resume_traffic' }));
    } else {
      wsRef.current.send(JSON.stringify({ action: 'pause_traffic' }));
    }
  }, [currentPage]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      if (document.hidden) {
        wsRef.current.send(JSON.stringify({ action: 'pause_traffic' }));
      } else if (currentPage === 'dashboard') {
        wsRef.current.send(JSON.stringify({ action: 'resume_traffic' }));
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [currentPage]);

  return (
    <WebSocketContext.Provider value={{
      interfaces,
      trafficData,
      loading,
      error,
      currentPage,
      setCurrentPage,
      deviceOffline,
      offlineReason,
      forceReturnToLogin,
      handleReconnectSuccess,
      wirelessInterfaces,
      wirelessClients,
      securityProfiles,
      wirelessLoading,
      startWirelessPolling,
      stopWirelessPolling,
      sendWsMessage,
      logs,
      logsLoading,
      startLogsPolling,
      stopLogsPolling,
      ipAddresses,
    }}>
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocket = () => useContext(WebSocketContext);
