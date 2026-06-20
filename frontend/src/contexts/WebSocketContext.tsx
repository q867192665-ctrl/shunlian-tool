import React, { createContext, useContext, useRef, useEffect, useCallback, useState } from 'react';
import { App } from 'antd';
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
  '.id'?: string;
  interface: string;
  mac: string;
  uptime: string;
  tx_signal: string;
  rx_signal: string;
  tx_signal_quality: string;
  rx_signal_quality: string;
  tx_rate: string;
  rx_rate: string;
  radio_name: string;
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

interface FileInfo {
  name: string;
  full_path?: string;
  folder_path?: string;
  size: number;
  date: string;
  type?: string;
  is_folder?: boolean;
  is_disk?: boolean;
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
  bridges: BridgeData[];
  bridgePorts: BridgePortData[];
  bridgeHosts: BridgeHostData[];
  bridgeLoading: boolean;
  startBridgePolling: () => void;
  stopBridgePolling: () => void;
  startIpAddressesPolling: () => void;
  stopIpAddressesPolling: () => void;
  ipAddressesLoading: boolean;
  files: FileInfo[];
  filesLoading: boolean;
  downloading: string | null;
  setDownloading: (name: string | null) => void;
  setFiles: React.Dispatch<React.SetStateAction<FileInfo[]>>;
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

interface BridgeData {
  '.id'?: string;
  name?: string;
  'mac-address'?: string;
  'mtu'?: string;
  'actual-mtu'?: string;
  'l2mtu'?: string;
  'arp'?: string;
  'arp-timeout'?: string;
  'ageing-time'?: string;
  'vlan-filtering'?: string;
  'protocol-mode'?: string;
  'priority'?: string;
  running?: string;
  disabled?: string;
  comment?: string;
  [key: string]: any;
}

interface BridgePortData {
  '.id'?: string;
  interface?: string;
  bridge?: string;
  'path-cost'?: string;
  priority?: string;
  'pvid'?: string;
  'edge'?: string;
  'point-to-point'?: string;
  'external-fdb'?: string;
  learning?: string;
  forwarding?: string;
  disabled?: string;
  comment?: string;
  [key: string]: any;
}

interface BridgeHostData {
  '.id'?: string;
  'mac-address'?: string;
  interface?: string;
  bridge?: string;
  'vid'?: string;
  'on-ports'?: string;
  age?: string;
  dynamic?: string;
  local?: string;
  external?: string;
  [key: string]: any;
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
  bridges: [],
  bridgePorts: [],
  bridgeHosts: [],
  bridgeLoading: false,
  startBridgePolling: () => {},
  stopBridgePolling: () => {},
  startIpAddressesPolling: () => {},
  stopIpAddressesPolling: () => {},
  ipAddressesLoading: false,
  files: [],
  filesLoading: false,
  downloading: null,
  setDownloading: () => {},
  setFiles: () => {},
});

export const WebSocketProvider: React.FC<{
  children: React.ReactNode;
  router: RouterInfo | null;
}> = ({ children, router }) => {
  const { message: antMessage } = App.useApp();
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
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const [bridges, setBridges] = useState<BridgeData[]>([]);
  const [bridgePorts, setBridgePorts] = useState<BridgePortData[]>([]);
  const [bridgeHosts, setBridgeHosts] = useState<BridgeHostData[]>([]);
  const [bridgeLoading, setBridgeLoading] = useState(false);
  const pendingBridgeStartRef = useRef(false);

  const [ipAddressesLoading, setIpAddressesLoading] = useState(false);
  const pendingIpAddressesStartRef = useRef(false);
  const ipAddressesActiveRef = useRef(false);

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
            const prevNames = new Set(prev.map((i: WirelessInterfaceData) => i.name));
            const newNames = new Set(data.interfaces.map((i: WirelessInterfaceData) => i.name));
            if (prevNames.size === newNames.size && prev.every(p => newNames.has(p.name))) {
              const hasChanges = data.interfaces.some((newIface: WirelessInterfaceData) => {
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
          setIpAddressesLoading(false);
        } else if (data.status === 'error') {
          setIpAddressesLoading(false);
        }
      } else if (data.type === 'ip_address_action') {
        if (data.status === 'success') {
          antMessage.success(data.message || '操作成功');
        } else if (data.status === 'error') {
          antMessage.error(data.message || '操作失败');
        }
      } else if (data.type === 'bridge_data') {
        if (data.status === 'success') {
          if (Array.isArray(data.bridges)) {
            setBridges(prev => {
              if (data.bridges.length === 0 && prev.length > 0) return prev;
              if (prev.length === 0) return data.bridges;
              if (prev.length !== data.bridges.length) return data.bridges;
              const BRIDGE_STABLE_KEYS = ['name', 'mtu', 'actual-mtu', 'l2mtu', 'mac-address', 'arp', 'arp-timeout', 'ageing-time', 'vlan-filtering', 'protocol-mode', 'priority', 'running', 'disabled', 'comment', '.id'];
              const prevIds = new Set(prev.map(b => b['.id'] || b.name));
              const newIds = new Set(data.bridges.map((b: BridgeData) => b['.id'] || b.name));
              if (prevIds.size === newIds.size && prev.every(p => newIds.has(p['.id'] || p.name))) {
                const hasChanges = data.bridges.some((newB: BridgeData) => {
                  const prevB = prev.find(p => (p['.id'] || p.name) === (newB['.id'] || newB.name));
                  if (!prevB) return true;
                  return BRIDGE_STABLE_KEYS.some(k => prevB[k] !== newB[k]);
                });
                if (!hasChanges) return prev;
              }
              return data.bridges;
            });
          }
          if (Array.isArray(data.bridge_ports)) {
            setBridgePorts(prev => {
              if (data.bridge_ports.length === 0 && prev.length > 0) return prev;
              if (prev.length === 0) return data.bridge_ports;
              if (prev.length !== data.bridge_ports.length) return data.bridge_ports;
              
              const STABLE_KEYS = ['interface', 'bridge', 'pvid', 'path-cost', 'priority', 'edge', 'disabled', 'comment', '.id'];
              
              const prevIds = new Set(prev.map(p => p['.id'] || p.interface));
              const newIds = new Set(data.bridge_ports.map((p: BridgePortData) => p['.id'] || p.interface));
              if (prevIds.size === newIds.size && prev.every(p => newIds.has(p['.id'] || p.interface))) {
                const hasChanges = data.bridge_ports.some((newP: BridgePortData) => {
                  const prevP = prev.find(p => (p['.id'] || p.interface) === (newP['.id'] || newP.interface));
                  if (!prevP) return true;
                  return STABLE_KEYS.some(k => prevP[k] !== newP[k]);
                });
                if (!hasChanges) return prev;
              }
              return data.bridge_ports;
            });
          }
          if (Array.isArray(data.hosts)) {
            setBridgeHosts(prev => {
              if (data.hosts.length === 0 && prev.length > 0) return prev;
              if (prev.length === 0) return data.hosts;
              if (prev.length !== data.hosts.length) return data.hosts;
              const HOST_STABLE_KEYS = ['mac-address', 'interface', 'bridge', 'vid', 'on-ports', 'dynamic', 'local', 'external', '.id'];
              const prevIds = new Set(prev.map(h => h['.id'] || h['mac-address']));
              const newIds = new Set(data.hosts.map((h: BridgeHostData) => h['.id'] || h['mac-address']));
              if (prevIds.size === newIds.size && prev.every(p => newIds.has(p['.id'] || p['mac-address']))) {
                const hasChanges = data.hosts.some((newH: BridgeHostData) => {
                  const prevH = prev.find(p => (p['.id'] || p['mac-address']) === (newH['.id'] || newH['mac-address']));
                  if (!prevH) return true;
                  return HOST_STABLE_KEYS.some(k => prevH[k] !== newH[k]);
                });
                if (!hasChanges) return prev;
              }
              return data.hosts;
            });
          }
          setBridgeLoading(false);
        } else if (data.status === 'error') {
          setBridgeLoading(false);
        } else if (data.status === 'device_offline') {
          setBridgeLoading(false);
        }
      } else if (data.type === 'bridge_action') {
        if (data.status === 'success') {
          antMessage.success(data.message || '操作成功');
        } else if (data.status === 'error') {
          antMessage.error(data.message || '操作失败');
        }
      } else if (data.type === 'bridge_port_action') {
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
          setLogsLoading(true);
          setLogs([]);
        } else if (data.status === 'cache_info') {
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
      } else if (data.type === 'file_list') {
        if (data.status === 'success' && Array.isArray(data.files)) {
          setFiles(data.files);
          setFilesLoading(false);
        } else if (data.status === 'error') {
          antMessage.error(data.message || '获取文件列表失败');
          setFilesLoading(false);
        }
      } else if (data.type === 'file_action') {
        if (data.status === 'success') {
          antMessage.success(data.message || '操作成功');
          if (data.action === 'delete' && data.file_name) {
            setFiles(prev => prev.filter(f => f.full_path !== data.file_name && f.name !== data.file_name));
          }
        } else if (data.status === 'error') {
          antMessage.error(data.message || '操作失败');
        }
      } else if (data.type === 'file_download') {
        if (data.status === 'success' && data.file_data) {
          const link = document.createElement('a');
          link.href = 'data:application/octet-stream;base64,' + data.file_data;
          link.download = data.file_name;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setDownloading(null);
        } else if (data.status === 'error') {
          antMessage.error(data.message || '下载失败');
          setDownloading(null);
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

      if (currentPageRef.current === 'bridge' || pendingBridgeStartRef.current) {
        console.log('[WebSocket] 当前在桥接口页面，自动启动桥接口轮询');
        pendingBridgeStartRef.current = false;
        ws.send(JSON.stringify({
          action: 'start_bridge_polling',
          ip: router.ipAddress,
          username: router.username || '',
          password: router.password || '',
        }));
      }

      if (pendingIpAddressesStartRef.current || ipAddressesActiveRef.current) {
        console.log('[WebSocket] 自动启动IP地址轮询');
        pendingIpAddressesStartRef.current = false;
        ws.send(JSON.stringify({
          action: 'start_ip_addresses_polling',
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
    console.log('[WebSocket] 发送消息:', message.action);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.log('[WebSocket] WebSocket 未连接，readyState:', wsRef.current?.readyState);
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

  const startBridgePolling = useCallback(() => {
    if (!router?.ipAddress) {
      console.log('[WebSocket] 启动桥接口轮询失败：缺少 IP 地址');
      return;
    }
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.log('[WebSocket] WebSocket未就绪，标记延迟启动桥接口轮询');
      pendingBridgeStartRef.current = true;
      return;
    }
    console.log('[WebSocket] 启动桥接口轮询');
    setBridgeLoading(true);
    wsRef.current.send(JSON.stringify({
      action: 'start_bridge_polling',
      ip: router.ipAddress,
      username: router.username || '',
      password: router.password || '',
    }));
  }, [router?.ipAddress, router?.username, router?.password]);

  const stopBridgePolling = useCallback(() => {
    console.log('[WebSocket] 停止桥接口轮询');
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'stop_bridge' }));
    }
    setBridgeLoading(false);
  }, []);

  const startIpAddressesPolling = useCallback(() => {
    if (!router?.ipAddress) {
      console.log('[WebSocket] 启动IP地址轮询失败：缺少 IP 地址');
      return;
    }
    ipAddressesActiveRef.current = true;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.log('[WebSocket] WebSocket未就绪，标记延迟启动IP地址轮询');
      pendingIpAddressesStartRef.current = true;
      return;
    }
    console.log('[WebSocket] 启动IP地址轮询');
    setIpAddressesLoading(true);
    wsRef.current.send(JSON.stringify({
      action: 'start_ip_addresses_polling',
      ip: router.ipAddress,
      username: router.username || '',
      password: router.password || '',
    }));
  }, [router?.ipAddress, router?.username, router?.password]);

  const stopIpAddressesPolling = useCallback(() => {
    console.log('[WebSocket] 停止IP地址轮询');
    ipAddressesActiveRef.current = false;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'stop_ip_addresses' }));
    }
    setIpAddressesLoading(false);
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
      stopLogsPolling();
      stopBridgePolling();
      stopIpAddressesPolling();
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
  }, [connect, router?.ipAddress, stopWirelessPolling, stopLogsPolling, stopBridgePolling, stopIpAddressesPolling]);

  useEffect(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (currentPage === 'dashboard') {
      wsRef.current.send(JSON.stringify({ action: 'resume_traffic' }));
    } else {
      wsRef.current.send(JSON.stringify({ action: 'pause_traffic' }));
    }
    // 切换到文件页面时通知后端
    if (currentPage === 'files') {
      wsRef.current.send(JSON.stringify({ action: 'page_change', page: 'files' }));
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
      bridges,
      bridgePorts,
      bridgeHosts,
      bridgeLoading,
      startBridgePolling,
      stopBridgePolling,
      startIpAddressesPolling,
      stopIpAddressesPolling,
      ipAddressesLoading,
      files,
      filesLoading,
      downloading,
      setDownloading,
      setFiles,
    }}>
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocket = () => useContext(WebSocketContext);
