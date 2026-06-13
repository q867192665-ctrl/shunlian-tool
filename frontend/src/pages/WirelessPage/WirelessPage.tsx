import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Input, Select, Modal, message as antMessage, Tabs } from 'antd';
import {
  WifiOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SignalFilled,
  DeleteOutlined,
  EditOutlined,
  WarningOutlined,
  SafetyOutlined,
  SearchOutlined,
  StopOutlined,
  PlusOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import { useAppState } from '../../contexts/AppContext';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { Toggle } from '../../components/atoms/Toggle/Toggle';
import { WinboxEditor } from './WinboxEditor';
import styles from './WirelessPage.module.css';

const { TextArea } = Input;
const { Option } = Select;

interface WirelessInterface {
  name: string;
  type?: string;
  mac_address?: string;
  ssid?: string;
  band?: string;
  frequency?: string;
  'channel-width'?: string;
  'wireless-protocol'?: string;
  mode?: string;
  running?: boolean;
  disabled?: boolean;
  comment?: string;
  '.id'?: string;
}

interface WirelessClient {
  '.id'?: string;
  interface: string;
  'mac-address': string;
  signal?: string;
  'rx-signal'?: string;
  'tx-rate'?: string;
  'rx-rate'?: string;
  uptime?: string;
  'signal-strength'?: string;
  'tx-signal-quality'?: string;
  'rx-signal-quality'?: string;
  'radio-name'?: string;
}

interface SecurityProfile {
  name: string;
  mode?: string;
  'authentication-types'?: string;
  'unicast-ciphers'?: string;
  'group-ciphers'?: string;
}

interface ScanResult {
  address: string;
  ssid: string;
  channel: string;
  signal_strength: string;
  noise: string;
  snr: string;
  radio_name: string;
}

interface ScanInterface {
  name: string;
  id: string;
  frequency: string;
  band: string;
  running: boolean;
  disabled: boolean;
}

export const WirelessPage: React.FC = () => {
  const { router } = useAppState();
  const routerIp = router?.ipAddress || '';
  const { wirelessInterfaces, wirelessClients, securityProfiles, wirelessLoading, startWirelessPolling, stopWirelessPolling } = useWebSocket();

  const [activeTab, setActiveTab] = useState('interfaces');
  const [interfaces, setInterfaces] = useState<WirelessInterface[]>([]);
  const [clients, setClients] = useState<WirelessClient[]>([]);
  const [profiles, setProfiles] = useState<SecurityProfile[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingInterface, setEditingInterface] = useState<WirelessInterface | null>(null);
  const [originalInterface, setOriginalInterface] = useState<WirelessInterface | null>(null);
  const [toggleLoading, setToggleLoading] = useState<string | null>(null);
  const [editLoading, setEditLoading] = useState(false);

  // 干扰扫描相关状态
  const [scanModalVisible, setScanModalVisible] = useState(false);
  const [scanInterfaces, setScanInterfaces] = useState<ScanInterface[]>([]);
  const [selectedScanInterface, setSelectedScanInterface] = useState<string>('');
  const [selectedScanInterfaceName, setSelectedScanInterfaceName] = useState<string>('');
  const [scanBackground, setScanBackground] = useState(false);
  const [scanScanning, setScanScanning] = useState(false);
  const [scanResults, setScanResults] = useState<Record<string, ScanResult>>({});
  const [scanSortField, setScanSortField] = useState<keyof ScanResult>('signal_strength');
  const [scanSortDirection, setScanSortDirection] = useState<'asc' | 'desc'>('desc');
  const scanWsRef = useRef<WebSocket | null>(null);
  const scanResultTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // 右键菜单相关状态
  const [contextMenuVisible, setContextMenuVisible] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const [selectedScanResult, setSelectedScanResult] = useState<ScanResult | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // 加密配置相关状态
  const [securityAddModalVisible, setSecurityAddModalVisible] = useState(false);
  const [securityEditModalVisible, setSecurityEditModalVisible] = useState(false);
  const [editingProfile, setEditingProfile] = useState<SecurityProfile | null>(null);
  const [securityForm, setSecurityForm] = useState({ name: '', auth: 'wpa2', cipher: 'aes', password: '' });
  const [securityEditForm, setSecurityEditForm] = useState({ name: '', auth: 'wpa2', cipher: 'aes', password: '' });
  const [securityLoading, setSecurityLoading] = useState(false);

  const wsDataAppliedRef = useRef(false);

  // 组件卸载时清理扫描WebSocket连接
  useEffect(() => {
    return () => {
      if (scanWsRef.current) {
        if (scanWsRef.current.readyState === WebSocket.OPEN) {
          try { scanWsRef.current.send(JSON.stringify({ action: 'stop_scan' })); } catch {}
          scanWsRef.current.close();
        }
        scanWsRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!routerIp) return;
    const timer = setTimeout(() => {
      startWirelessPolling();
    }, 500);
    return () => {
      clearTimeout(timer);
      stopWirelessPolling();
    };
  }, [routerIp]);

  useEffect(() => {
    if (wirelessInterfaces.length > 0) {
      setInterfaces(prevInterfaces => {
        const updatedInterfaces = wirelessInterfaces.map((wsIface) => {
          const existingIface = prevInterfaces.find(i => i.name === wsIface.name);
          return {
            ...wsIface,
            '.id': existingIface?.['.id'] || wsIface['.id'] || '',
            'channel-width': wsIface['channel-width'] || existingIface?.['channel-width'] || '',
            'wireless-protocol': wsIface['wireless-protocol'] || existingIface?.['wireless-protocol'] || '',
          };
        });
        
        const prevNames = new Set(prevInterfaces.map(i => i.name));
        const updatedNames = new Set(updatedInterfaces.map(i => i.name));
        
        const hasChanges = prevNames.size !== updatedNames.size || 
          prevInterfaces.some(prev => {
            const updated = updatedInterfaces.find(u => u.name === prev.name);
            if (!updated) return true;
            return prev.running !== updated.running || 
                   prev.disabled !== updated.disabled ||
                   prev.ssid !== updated.ssid ||
                   prev.frequency !== updated.frequency ||
                   prev.band !== updated.band ||
                   prev['channel-width'] !== updated['channel-width'] ||
                   prev['wireless-protocol'] !== updated['wireless-protocol'];
          });
        
        if (hasChanges) {
          return updatedInterfaces;
        }
        
        return prevInterfaces;
      });
      
      if (!wsDataAppliedRef.current) {
        wsDataAppliedRef.current = true;
        setInitialLoading(false);
        setError(null);
      }
    }
  }, [wirelessInterfaces]);

  useEffect(() => {
    if (wirelessClients.length > 0) {
      const mapped: WirelessClient[] = wirelessClients.map(c => ({
        interface: c.interface,
        'mac-address': c.mac,
        signal: c.tx_signal,
        'rx-signal': c.rx_signal,
        'tx-rate': c.tx_rate,
        'rx-rate': c.rx_rate,
        uptime: c.uptime,
        'signal-strength': c.tx_signal,
        'tx-signal-quality': c.tx_signal_quality,
        'rx-signal-quality': c.rx_signal_quality,
        'radio-name': c.radio_name || '',
      }));
      setClients(mapped);
      setInitialLoading(false);
      setError(null);
    }
  }, [wirelessClients]);

  useEffect(() => {
    if (securityProfiles.length > 0) {
      const mapped: SecurityProfile[] = securityProfiles.map(p => ({
        name: p.name,
        mode: p.mode || '',
        'authentication-types': p.authentication_types || p.authentication || '',
        'unicast-ciphers': p.unicast_ciphers || p.cipher || '',
        'group-ciphers': p.group_ciphers || p.cipher || '',
      }));
      setProfiles(mapped);
      setInitialLoading(false);
      setError(null);
    }
  }, [securityProfiles]);

  const fetchAllData = useCallback(async () => {
    if (!routerIp) return;
    try {
      const [ifaceResp, clientResp, profileResp] = await Promise.all([
        fetch(`/api/wireless-interfaces?ip=${encodeURIComponent(routerIp)}`),
        fetch('/api/device/wireless-clients', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ip: routerIp }),
        }),
        fetch('/api/device/security-profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ip: routerIp }),
        }),
      ]);
      const ifaceData = await ifaceResp.json();
      if (ifaceData.success && ifaceData.interfaces) {
        setInterfaces(ifaceData.interfaces);
      }
      const clientData = await clientResp.json();
      if (clientData.status === 'success' && clientData.clients) {
        setClients(clientData.clients);
      }
      const profileData = await profileResp.json();
      if (profileData.status === 'success' && profileData.security_profiles) {
        setProfiles(profileData.security_profiles);
      }
      setInitialLoading(false);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch wireless data:', err);
      if (interfaces.length === 0) {
        setError(err instanceof Error ? err.message : '加载无线信息失败');
      }
      setInitialLoading(false);
    }
  }, [routerIp]);

  useEffect(() => {
    if (!routerIp) return;
    fetchAllData();
  }, [routerIp, fetchAllData]);

  useEffect(() => {
    if (!routerIp || !editModalVisible) return;
    const interval = setInterval(async () => {
      fetchAllData();
    }, 5000);
    return () => clearInterval(interval);
  }, [routerIp, editModalVisible, fetchAllData]);

  const handleCopyToClipboard = async (text: string, label: string) => {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        antMessage.success(`${label} 已复制到剪贴板`);
        return;
      } catch (err) {
        console.warn('Clipboard API failed, trying fallback...', err);
      }
    }
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      if (successful) {
        antMessage.success(`${label} 已复制: ${text}`);
        return;
      }
    } catch (err) {
      console.error('execCommand failed:', err);
    }
    antMessage.info({
      content: (
        <div>
          <strong>{label}:</strong>
          <div style={{
            marginTop: '8px',
            padding: '8px',
            background: '#1a1a1a',
            borderRadius: '4px',
            fontFamily: 'monospace',
            fontSize: '12px',
            color: '#ff6b35',
            userSelect: 'all',
            cursor: 'text'
          }}>
            {text}
          </div>
        </div>
      ),
      duration: 8
    });
  };

  const parseSignalStrength = (signal: string | undefined): number | null => {
    if (!signal) return null;
    const match = signal.match(/-?\d+/);
    if (match) {
      return parseInt(match[0], 10);
    }
    return null;
  };

  const isStrongSignal = (signal: string | undefined): boolean => {
    const value = parseSignalStrength(signal);
    if (value === null) return false;
    return value > -70;
  };

  const handleRemoveClient = async (clientId: string, macAddress: string) => {
    console.log('handleRemoveClient called with:', { clientId, macAddress, routerIp });
    if (!routerIp || !clientId) {
      console.log('Early return: routerIp or clientId is empty');
      return;
    }
    try {
      const resp = await fetch('/api/device/wireless-client/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: routerIp, client_id: clientId }),
      });
      const data = await resp.json();
      console.log('Remove response:', data);
      if (data.status === 'success') {
        antMessage.success(`已踢除终端 ${macAddress}`);
        await new Promise(resolve => setTimeout(resolve, 500));
        await fetchAllData();
      } else {
        antMessage.error(data.message || '踢除终端失败');
      }
    } catch (err) {
      console.error('Failed to remove wireless client:', err);
      antMessage.error('踢除终端失败');
    }
  };

  const handleToggleInterface = async (interfaceId: string, currentDisabled: boolean) => {
    if (!routerIp || !interfaceId) {
      return;
    }
    setToggleLoading(interfaceId);
    try {
      const resp = await fetch('/api/wireless-interface/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          ip: routerIp, 
          interface_id: interfaceId,
          disabled: !currentDisabled 
        }),
      });
      const data = await resp.json();
      if (data.success) {
        antMessage.success(currentDisabled ? '接口已启用' : '接口已禁用');
        await new Promise(resolve => setTimeout(resolve, 500));
        await fetchAllData();
      } else {
        antMessage.error(data.message || '操作失败');
      }
    } catch (err) {
      console.error('Failed to toggle wireless interface:', err);
      antMessage.error('操作失败');
    } finally {
      setToggleLoading(null);
    }
  };

  const handleEditInterface = async (iface: WirelessInterface) => {
    if (!routerIp) {
      return;
    }
    
    setEditLoading(true);
    setEditingInterface(null);
    setOriginalInterface(null);
    setEditModalVisible(true);
    
    try {
      await fetchAllData();
      
      if (iface['.id']) {
        const resp = await fetch(`/api/wireless-interface?ip=${encodeURIComponent(routerIp)}&interface_id=${encodeURIComponent(iface['.id'])}`);
        const data = await resp.json();
        if (data.success && data.interface) {
          setEditingInterface(data.interface);
          setOriginalInterface(data.interface);
        } else {
          const currentIface = interfaces.find(i => i.name === iface.name);
          const ifaceData = currentIface || { ...iface };
          setEditingInterface(ifaceData);
          setOriginalInterface(ifaceData);
        }
      } else {
        const currentIface = interfaces.find(i => i.name === iface.name);
        const ifaceData = currentIface || { ...iface };
        setEditingInterface(ifaceData);
        setOriginalInterface(ifaceData);
      }
    } catch (err) {
      console.error('Failed to fetch interface details:', err);
      const currentIface = interfaces.find(i => i.name === iface.name);
      const ifaceData = currentIface || { ...iface };
      setEditingInterface(ifaceData);
      setOriginalInterface(ifaceData);
    } finally {
      setEditLoading(false);
    }
  };

  const getChangedFields = () => {
    if (!editingInterface || !originalInterface) {
      return {};
    }
    
    const changed: Record<string, string> = {};
    
    const fields: { key: string; originalKey: string }[] = [
      { key: 'name', originalKey: 'name' },
      { key: 'ssid', originalKey: 'ssid' },
      { key: 'band', originalKey: 'band' },
      { key: 'frequency', originalKey: 'frequency' },
      { key: 'channel_width', originalKey: 'channel-width' },
      { key: 'wireless_protocol', originalKey: 'wireless-protocol' },
      { key: 'mode', originalKey: 'mode' },
      { key: 'security_profile', originalKey: 'security-profile' },
      { key: 'hide_ssid', originalKey: 'hide-ssid' },
      { key: 'tx_power', originalKey: 'tx-power' },
      { key: 'tx_power_mode', originalKey: 'tx-power-mode' },
      { key: 'rate_set', originalKey: 'rate-set' },
      { key: 'wps_mode', originalKey: 'wps-mode' },
      { key: 'arp', originalKey: 'arp' },
      { key: 'mtu', originalKey: 'mtu' },
      { key: 'comment', originalKey: 'comment' },
      { key: 'radio_name', originalKey: 'radio-name' },
      { key: 'scan_list', originalKey: 'scan-list' },
      { key: 'skip_dfs_channels', originalKey: 'skip-dfs-channels' },
      { key: 'frequency_mode', originalKey: 'frequency-mode' },
      { key: 'country', originalKey: 'country' },
      { key: 'installation', originalKey: 'installation' },
      { key: 'bridge_mode', originalKey: 'bridge-mode' },
      { key: 'vlan_mode', originalKey: 'vlan-mode' },
      { key: 'vlan_id', originalKey: 'vlan-id' },
      { key: 'default_ap_tx_limit', originalKey: 'default-ap-tx-limit' },
      { key: 'default_client_tx_limit', originalKey: 'default-client-tx-limit' },
      { key: 'default_authenticate', originalKey: 'default-authenticate' },
      { key: 'default_forwarding', originalKey: 'default-forwarding' },
      { key: 'multicast_helper', originalKey: 'multicast-helper' },
      { key: 'multicast_buffering', originalKey: 'multicast-buffering' },
      { key: 'keepalive_frames', originalKey: 'keepalive-frames' },
      { key: 'area', originalKey: 'area' },
      { key: 'max_station_count', originalKey: 'max-station-count' },
      { key: 'burst_time', originalKey: 'burst-time' },
      { key: 'hw_retries', originalKey: 'hw-retries' },
      { key: 'adaptive_noise_immunity', originalKey: 'adaptive-noise-immunity' },
      { key: 'preamble_mode', originalKey: 'preamble-mode' },
      { key: 'allow_shared_key', originalKey: 'allow-shared-key' },
      { key: 'disconnect_timeout', originalKey: 'disconnect-timeout' },
      { key: 'on_fail_retry_time', originalKey: 'on-fail-retry-time' },
      { key: 'update_stats_interval', originalKey: 'update-stats-interval' },
      { key: 'supported_rates_b', originalKey: 'supported-rates-b' },
      { key: 'supported_rates_ag', originalKey: 'supported-rates-a/g' },
      { key: 'basic_rates_b', originalKey: 'basic-rates-b' },
      { key: 'basic_rates_ag', originalKey: 'basic-rates-a/g' },
    ];
    
    for (const field of fields) {
      let newValue = (editingInterface as any)[field.originalKey] || '';
      const oldValue = (originalInterface as any)[field.originalKey] || '';
      if (field.originalKey === 'scan-list' && newValue === '') {
        newValue = 'default';
      }
      if (newValue !== oldValue) {
        changed[field.key] = newValue;
      }
    }
    
    return changed;
  };

  // ==================== 干扰扫描功能 ====================

  const getScanWsUrl = useCallback(() => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const isDev = window.location.port === '5173';
    return isDev ? `${wsProtocol}//${window.location.host}/ws` : `${wsProtocol}//${window.location.hostname}:32996`;
  }, []);

  const loadScanInterfaces = useCallback(() => {
    if (!router) return;
    const wsUrl = getScanWsUrl();
    const ws = new WebSocket(wsUrl);
    let closed = false;
    ws.onopen = () => {
      ws.send(JSON.stringify({
        action: 'get_wireless_interfaces_list',
        ip: router.ipAddress,
        username: router.username || '',
        password: router.password || '',
      }));
    };
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'wireless_interfaces_list') {
          const ifaces: ScanInterface[] = data.interfaces || [];
          setScanInterfaces(ifaces);
          const firstRunning = ifaces.find((i: ScanInterface) => i.running);
          const selected = firstRunning || ifaces[0];
          if (selected) {
            setSelectedScanInterface(selected.id || selected.name);
            setSelectedScanInterfaceName(selected.name);
          }
          if (!closed) { ws.close(); closed = true; }
        } else if (data.type === 'error') {
          antMessage.error(data.message || '获取无线接口列表失败');
          if (!closed) { ws.close(); closed = true; }
        }
      } catch (e) {
        console.error('解析接口列表失败:', e);
      }
    };
    ws.onerror = () => { if (!closed) { ws.close(); closed = true; } };
    ws.onclose = () => { closed = true; };
    // 超时保护：10秒未返回则关闭
    setTimeout(() => { if (!closed && ws.readyState !== WebSocket.CLOSED) { ws.close(); closed = true; } }, 10000);
  }, [router, getScanWsUrl]);

  const startScan = useCallback(() => {
    if (!router || !selectedScanInterface) {
      antMessage.warning('请选择扫描接口');
      return;
    }

    // 如果已有扫描连接，先关闭
    if (scanWsRef.current) {
      if (scanWsRef.current.readyState === WebSocket.OPEN) {
        scanWsRef.current.send(JSON.stringify({ action: 'stop_scan' }));
        scanWsRef.current.close();
      }
      scanWsRef.current = null;
    }

    setScanResults({});
    setScanScanning(true);

    const wsUrl = getScanWsUrl();
    const ws = new WebSocket(wsUrl);
    scanWsRef.current = ws;

    ws.onopen = () => {
      // 连接建立后再次确认引用未被替换
      if (scanWsRef.current !== ws) {
        ws.close();
        return;
      }
      ws.send(JSON.stringify({
        action: 'start_interference_scan',
        ip: router.ipAddress,
        username: router.username || '',
        password: router.password || '',
        interface_name: selectedScanInterface,
        background: scanBackground,
      }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'scan_result' && data.result) {
          const address = data.result.address || '--';
          setScanResults(prev => ({
            ...prev,
            [address]: {
              address,
              ssid: data.result.ssid || '--',
              channel: data.result.channel || '--',
              signal_strength: data.result.signal_strength || '--',
              noise: data.result.noise || '--',
              snr: data.result.snr || '--',
              radio_name: data.result.radio_name || '--',
            },
          }));
        } else if (data.type === 'error') {
          antMessage.error(data.message || '扫描失败');
          // 后端返回错误，扫描已终止，关闭连接
          ws.close();
        }
      } catch (e) {
        console.error('解析扫描结果失败:', e);
      }
    };

    ws.onerror = () => {
      antMessage.error('扫描连接失败');
      setScanScanning(false);
      if (scanWsRef.current === ws) {
        scanWsRef.current = null;
      }
    };

    ws.onclose = () => {
      // 后端主动关闭（扫描完成/异常/stop_scan），前端同步状态
      setScanScanning(false);
      if (scanWsRef.current === ws) {
        scanWsRef.current = null;
      }
    };
  }, [router, selectedScanInterface, scanBackground, getScanWsUrl]);

  const stopScan = useCallback(() => {
    const ws = scanWsRef.current;
    if (ws) {
      scanWsRef.current = null; // 先置空，防止 onclose 回调中重复处理
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ action: 'stop_scan' }));
        } catch { /* 忽略发送失败 */ }
        ws.close();
      }
    }
    setScanScanning(false);
  }, []);

  const closeScanModal = useCallback(() => {
    stopScan();
    setScanModalVisible(false);
    setScanResults({});
    setScanInterfaces([]);
    setSelectedScanInterface('');
    setSelectedScanInterfaceName('');
  }, [stopScan]);

  const sortScanResults = useCallback((field: keyof ScanResult) => {
    if (scanSortField === field) {
      setScanSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setScanSortField(field);
      setScanSortDirection('desc');
    }
  }, [scanSortField]);

  // 频率到信道号映射
  const freqToChannel = (freq: string): string => {
    if (!freq || freq === '--') return freq;
    const f = parseInt(freq);
    if (isNaN(f)) return freq;
    // 2.4GHz 信道映射
    const ghz2: Record<number, number> = { 2412:1,2417:2,2422:3,2427:4,2432:5,2437:6,2442:7,2447:8,2452:9,2457:10,2462:11,2467:12,2472:13,2484:14 };
    if (ghz2[f]) return `${f}（${ghz2[f]}）`;
    // 5GHz 信道映射
    const ghz5: Record<number, number> = { 5180:36,5200:40,5220:44,5240:48,5260:52,5280:56,5300:60,5320:64,5500:100,5520:104,5540:108,5560:112,5580:116,5600:120,5620:124,5640:128,5660:132,5680:136,5700:140,5720:144,5745:149,5765:153,5785:157,5805:161,5825:165 };
    if (ghz5[f]) return `${f}（${ghz5[f]}）`;
    return freq;
  };

  // 干扰扫描右键菜单
  const handleScanRowContextMenu = (e: React.MouseEvent, item: ScanResult) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedScanResult(item);
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
    setContextMenuVisible(true);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuVisible && contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenuVisible(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [contextMenuVisible]);

  const handleConnectFromScan = async (item: ScanResult) => {
    setContextMenuVisible(false);
    if (!routerIp) {
      antMessage.error('设备 IP 不可用');
      return;
    }
    try {
      const resp = await fetch('/api/wireless-interface/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip: routerIp,
          interface_id: selectedScanInterface,
          ssid: item.ssid,
          mode: 'station',
          wireless_protocol: '802.11',
        }),
      });
      const data = await resp.json();
      if (data.success) {
        antMessage.success(`已连接到 ${item.ssid}`);
        await new Promise(resolve => setTimeout(resolve, 500));
        await fetchAllData();
      } else {
        antMessage.error(translateMikrotikError(data.message));
      }
    } catch (err) {
      antMessage.error('连接失败');
    }
  };

  const getSortedScanResults = useCallback((): ScanResult[] => {
    const results = Object.values(scanResults);
    const numericFields: (keyof ScanResult)[] = ['signal_strength', 'noise', 'snr'];
    results.sort((a, b) => {
      let aVal: string | number = a[scanSortField] || '';
      let bVal: string | number = b[scanSortField] || '';
      if (numericFields.includes(scanSortField)) {
        aVal = parseInt(aVal as string) || -999;
        bVal = parseInt(bVal as string) || -999;
      }
      if (aVal < bVal) return scanSortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return scanSortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return results;
  }, [scanResults, scanSortField, scanSortDirection]);

  const renderSortIcon = (field: keyof ScanResult) => {
    if (scanSortField !== field) return null;
    return scanSortDirection === 'asc' ? ' ↑' : ' ↓';
  };

  // ==================== 结束干扰扫描功能 ====================

  // ==================== 加密配置功能 ====================

  const authToTypes = (auth: string): string => {
    switch (auth) {
      case 'wpa': return 'wpa-psk';
      case 'wpa2': return 'wpa2-psk';
      case 'wpa/wpa2': return 'wpa-psk,wpa2-psk';
      default: return 'wpa2-psk';
    }
  };

  const typesToAuth = (types: string): string => {
    if (types.includes('wpa2') && types.includes('wpa')) return 'wpa/wpa2';
    if (types.includes('wpa2')) return 'wpa2';
    if (types.includes('wpa')) return 'wpa';
    return 'wpa2';
  };

  const cipherToValue = (cipher: string): string => {
    if (!cipher) return 'aes';
    const lower = cipher.toLowerCase();
    if (lower.includes('aes') && lower.includes('tkip')) return 'aes/tkip';
    if (lower.includes('tkip')) return 'tkip';
    return 'aes';
  };

  const cipherToApi = (cipher: string): { unicast: string; group: string } => {
    switch (cipher) {
      case 'aes': return { unicast: 'aes-ccm', group: 'aes-ccm' };
      case 'tkip': return { unicast: 'tkip', group: 'tkip' };
      case 'aes/tkip': return { unicast: 'aes-ccm,tkip', group: 'aes-ccm,tkip' };
      default: return { unicast: 'aes-ccm', group: 'aes-ccm' };
    }
  };

  const translateMikrotikError = (msg: string): string => {
    if (!msg) return '操作失败';
    if (msg.includes('already exists')) return '同名配置已存在';
    if (msg.includes('not found')) return '未找到该配置';
    if (msg.includes('in use') || msg.includes('referenced')) return '该配置正在使用中，无法删除';
    if (msg.includes('invalid')) return '参数无效';
    return msg;
  };

  const formatWirelessMode = (mode: string): string => {
    const modeMap: Record<string, string> = {
      'ap-bridge': 'AP（点对多点）',
      'bridge': 'PTP（点对点）',
      'station': 'Station（标准三层）',
      'station-bridge': 'Station（二层）',
      'station-pseudobridge': 'Station（对接）',
      'station-wds': 'Station（WDS）',
    };
    return modeMap[mode] || mode;
  };

  const handleAddSecurityProfile = async () => {
    if (!routerIp) { antMessage.error('设备 IP 不可用'); return; }
    if (!securityForm.name.trim()) { antMessage.warning('请输入配置名称'); return; }
    if (!securityForm.password || securityForm.password.length < 8) { antMessage.warning('密码至少需要8位'); return; }

    setSecurityLoading(true);
    try {
      const { unicast, group } = cipherToApi(securityForm.cipher);
      const resp = await fetch('/api/security-profile/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip: routerIp,
          username: router?.username || 'admin',
          password: router?.password || '',
          name: securityForm.name.trim(),
          authTypes: authToTypes(securityForm.auth),
          unicastCiphers: unicast,
          groupCiphers: group,
          wpaKey: securityForm.password,
          wpa2Key: securityForm.password,
        }),
      });
      const result = await resp.json();
      if (result.success) {
        antMessage.success('添加成功');
        setSecurityAddModalVisible(false);
        setSecurityForm({ name: '', auth: 'wpa2', cipher: 'aes', password: '' });
        fetchAllData();
      } else {
        antMessage.error(translateMikrotikError(result.message));
      }
    } catch (err) {
      antMessage.error('添加失败');
    } finally {
      setSecurityLoading(false);
    }
  };

  const handleEditSecurityProfile = async () => {
    if (!routerIp || !editingProfile) { antMessage.error('参数不足'); return; }
    if (!securityEditForm.name.trim()) { antMessage.warning('请输入配置名称'); return; }
    if (securityEditForm.password && securityEditForm.password.length < 8) { antMessage.warning('密码至少需要8位'); return; }

    setSecurityLoading(true);
    try {
      const { unicast, group } = cipherToApi(securityEditForm.cipher);
      const body: Record<string, string> = {
        ip: routerIp,
        username: router?.username || 'admin',
        password: router?.password || '',
        originalName: editingProfile.name,
        name: securityEditForm.name.trim(),
        authTypes: authToTypes(securityEditForm.auth),
        unicastCiphers: unicast,
        groupCiphers: group,
      };
      if (securityEditForm.password) {
        body.wpaKey = securityEditForm.password;
        body.wpa2Key = securityEditForm.password;
      }
      const resp = await fetch('/api/security-profile/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await resp.json();
      if (result.success) {
        antMessage.success('修改成功');
        setSecurityEditModalVisible(false);
        setEditingProfile(null);
        fetchAllData();
      } else {
        antMessage.error(translateMikrotikError(result.message));
      }
    } catch (err) {
      antMessage.error('修改失败');
    } finally {
      setSecurityLoading(false);
    }
  };

  const handleDeleteSecurityProfile = (profile: SecurityProfile) => {
    if (profile.name === 'default') {
      antMessage.warning('默认配置不可删除');
      return;
    }
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除加密配置 "${profile.name}" 吗？`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          const resp = await fetch('/api/security-profile/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ip: routerIp,
              username: router?.username || 'admin',
              password: router?.password || '',
              name: profile.name,
            }),
          });
          const result = await resp.json();
          if (result.success) {
            antMessage.success('删除成功');
            fetchAllData();
          } else {
            antMessage.error(translateMikrotikError(result.message));
          }
        } catch (err) {
          antMessage.error('删除失败');
        }
      },
    });
  };

  const handleToggleSecurityProfile = async (profile: SecurityProfile, enable: boolean) => {
    const mode = enable ? 'dynamic-keys' : 'none';
    const action = enable ? '启用' : '禁用';
    try {
      const resp = await fetch('/api/security-profile/set-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip: routerIp,
          username: router?.username || 'admin',
          password: router?.password || '',
          name: profile.name,
          mode,
        }),
      });
      const result = await resp.json();
      if (result.success) {
        antMessage.success(`${action}成功`);
        fetchAllData();
      } else {
        antMessage.error(translateMikrotikError(result.message));
      }
    } catch (err) {
      antMessage.error(`${action}失败`);
    }
  };

  const openEditSecurityModal = (profile: SecurityProfile) => {
    setEditingProfile(profile);
    const authTypes = profile['authentication-types'] || '';
    const unicastCiphers = profile['unicast-ciphers'] || '';
    setSecurityEditForm({
      name: profile.name,
      auth: typesToAuth(authTypes),
      cipher: cipherToValue(unicastCiphers),
      password: '',
    });
    setSecurityEditModalVisible(true);
  };

  // ==================== 结束加密配置功能 ====================

  const handleSaveEdit = async () => {
    if (!routerIp) {
      antMessage.error('设备 IP 不可用');
      return;
    }
    if (!editingInterface) {
      antMessage.error('没有正在编辑的接口');
      return;
    }
    if (!editingInterface['.id']) {
      antMessage.error('接口 ID 不可用，无法保存');
      return;
    }
    
    const changedFields = getChangedFields();
    const hasChanges = Object.keys(changedFields).length > 0;
    
    if (!hasChanges) {
      setEditModalVisible(false);
      setEditingInterface(null);
      setOriginalInterface(null);
      return;
    }
    
    try {
      const resp = await fetch('/api/wireless-interface/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip: routerIp,
          interface_id: editingInterface['.id'],
          ...changedFields,
        }),
      });
      const data = await resp.json();
      if (data.success) {
        antMessage.success('接口配置已更新');
        setEditModalVisible(false);
        setEditingInterface(null);
        setOriginalInterface(null);
        await fetchAllData();
      } else {
        antMessage.error(data.message || '更新失败');
      }
    } catch (err) {
      console.error('Failed to update wireless interface:', err);
      antMessage.error('更新失败');
    }
  };

  const activeInterfaces = interfaces.filter(i => !i.disabled && i.running);
  const disabledInterfaces = interfaces.filter(i => i.disabled);
  const inactiveInterfaces = interfaces.filter(i => !i.disabled && !i.running);

  const renderContent = () => {
    if (!routerIp) {
      return (
        <div className={styles.emptyState}>
          <WarningOutlined className={styles.errorIcon} />
          <p className={styles.errorText}>请先连接设备</p>
        </div>
      );
    }

    if (initialLoading && interfaces.length === 0 && clients.length === 0 && profiles.length === 0) {
      return (
        <div className={styles.emptyState}>
          <div className={styles.spinner} />
          <p>加载无线信息...</p>
        </div>
      );
    }

    if (error && interfaces.length === 0 && clients.length === 0 && profiles.length === 0) {
      return (
        <div className={styles.emptyState}>
          <WarningOutlined className={styles.errorIcon} />
          <p className={styles.errorText}>{error}</p>
          <button className={styles.retryButton} onClick={() => fetchAllData()}>
            重试
          </button>
        </div>
      );
    }

    switch (activeTab) {
      case 'interfaces':
        return (
          <div className={styles.content}>
            <div className={styles.summaryCards}>
              <div className={styles.summaryCard}>
                <WifiOutlined className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>{interfaces.length}</div>
                  <div className={styles.summaryLabel}>总接口数</div>
                </div>
              </div>
              <div className={styles.summaryCard}>
                <CheckCircleOutlined className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>{activeInterfaces.length}</div>
                  <div className={styles.summaryLabel}>运行中</div>
                </div>
              </div>
              <div className={styles.summaryCard}>
                <CloseCircleOutlined className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>{disabledInterfaces.length}</div>
                  <div className={styles.summaryLabel}>已禁用</div>
                </div>
              </div>
            </div>

            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>活跃接口</h2>
                <button
                  className={styles.sectionButton}
                  onClick={() => {
                    setScanModalVisible(true);
                    loadScanInterfaces();
                  }}
                >
                  <SearchOutlined className={styles.refreshIcon} />
                  干扰扫描
                </button>
              </div>
              <div className={styles.table}>
                <div className={styles.tableHeader}>
                  <div className={styles.tableCellCenter}>名称</div>
                  <div className={styles.tableCellCenter}>SSID</div>
                  <div className={styles.tableCellCenter}>频段</div>
                  <div className={styles.tableCellCenter}>频率</div>
                  <div className={styles.tableCellCenter}>信道宽度</div>
                  <div className={styles.tableCellCenter}>模式</div>
                  <div className={styles.tableCellCenter}>协议</div>
                  <div className={styles.tableCellCenter}>状态</div>
                  <div className={styles.tableCell}>操作</div>
                </div>
                {activeInterfaces.map((iface, index) => (
                  <div key={iface['.id'] || index} className={styles.tableRow}>
                    <div className={styles.tableCellCenter}>
                      <span
                        className={`${styles.monospace} ${styles.copyable}`}
                        onClick={() => handleCopyToClipboard(iface.name, '接口名')}
                        title="点击复制"
                      >
                        {iface.name}
                      </span>
                    </div>
                    <div className={styles.tableCellCenter}>
                      <span className={styles.ssidText}>{iface.ssid || '—'}</span>
                    </div>
                    <div className={styles.tableCellCenter}>{iface.band || '—'}</div>
                    <div className={styles.tableCellCenter}>
                      <span className={styles.monospace}>{iface.frequency || '—'}</span>
                    </div>
                    <div className={styles.tableCellCenter}>
                      <span className={styles.monospace}>{iface['channel-width'] || '—'}</span>
                    </div>
                    <div className={styles.tableCellCenter}>
                      {iface.mode ? (
                        <span className={`${styles.badge} ${styles.badgeInfo}`}>
                          {formatWirelessMode(iface.mode)}
                        </span>
                      ) : '—'}
                    </div>
                    <div className={styles.tableCellCenter}>
                      {iface['wireless-protocol'] ? (
                        <span className={`${styles.badge} ${styles.badgeDefault}`}>
                          {iface['wireless-protocol']}
                        </span>
                      ) : '—'}
                    </div>
                    <div className={styles.tableCellCenter}>
                      <span className={`${styles.badge} ${styles.badgeSuccess}`}>
                        <CheckCircleOutlined className={styles.badgeIcon} />
                        运行中
                      </span>
                    </div>
                    <div className={styles.tableCell}>
                      <div className={styles.actionButtons}>
                        <Toggle
                          checked={!iface.disabled}
                          onChange={() => handleToggleInterface(iface['.id'] || '', iface.disabled || false)}
                          disabled={toggleLoading === iface['.id']}
                          aria-label={`切换接口 ${iface.name} 状态`}
                        />
                        <button
                          className={styles.editButton}
                          onClick={() => handleEditInterface(iface)}
                          title="编辑接口"
                        >
                          <EditOutlined />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {activeInterfaces.length === 0 && (
                  <div className={styles.emptyRow}>
                    <span>暂无活跃接口</span>
                  </div>
                )}
              </div>
            </div>

            {disabledInterfaces.length > 0 && (
              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>已禁用接口</h2>
                <div className={styles.table}>
                  <div className={styles.tableHeader}>
                    <div className={styles.tableCellCenter}>名称</div>
                    <div className={styles.tableCellCenter}>SSID</div>
                    <div className={styles.tableCellCenter}>频段</div>
                    <div className={styles.tableCellCenter}>频率</div>
                    <div className={styles.tableCellCenter}>信道宽度</div>
                    <div className={styles.tableCellCenter}>模式</div>
                    <div className={styles.tableCellCenter}>协议</div>
                    <div className={styles.tableCellCenter}>状态</div>
                    <div className={styles.tableCell}>操作</div>
                  </div>
                  {disabledInterfaces.map((iface, index) => (
                    <div key={iface['.id'] || index} className={styles.tableRow}>
                      <div className={styles.tableCellCenter}>
                        <span
                          className={`${styles.monospace} ${styles.copyable}`}
                          onClick={() => handleCopyToClipboard(iface.name, '接口名')}
                          title="点击复制"
                        >
                          {iface.name}
                        </span>
                      </div>
                      <div className={styles.tableCellCenter}>
                        <span className={styles.ssidText}>{iface.ssid || '—'}</span>
                      </div>
                      <div className={styles.tableCellCenter}>{iface.band || '—'}</div>
                      <div className={styles.tableCellCenter}>
                        <span className={styles.monospace}>{iface.frequency || '—'}</span>
                      </div>
                      <div className={styles.tableCellCenter}>
                        <span className={styles.monospace}>{iface['channel-width'] || '—'}</span>
                      </div>
                      <div className={styles.tableCellCenter}>
                        {iface.mode ? (
                          <span className={`${styles.badge} ${styles.badgeInfo}`}>
                            {formatWirelessMode(iface.mode)}
                          </span>
                        ) : '—'}
                      </div>
                      <div className={styles.tableCellCenter}>
                        {iface['wireless-protocol'] ? (
                          <span className={`${styles.badge} ${styles.badgeDefault}`}>
                            {iface['wireless-protocol']}
                          </span>
                        ) : '—'}
                      </div>
                      <div className={styles.tableCellCenter}>
                        <span className={`${styles.badge} ${styles.badgeDefault}`}>
                          已禁用
                        </span>
                      </div>
                      <div className={styles.tableCell}>
                        <div className={styles.actionButtons}>
                          <Toggle
                            checked={!iface.disabled}
                            onChange={() => handleToggleInterface(iface['.id'] || '', iface.disabled || false)}
                            disabled={toggleLoading === iface['.id']}
                            aria-label={`切换接口 ${iface.name} 状态`}
                          />
                          <button
                            className={styles.editButton}
                            onClick={() => handleEditInterface(iface)}
                            title="编辑接口"
                          >
                            <EditOutlined />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {inactiveInterfaces.length > 0 && (
              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>未运行接口</h2>
                <div className={styles.table}>
                  <div className={styles.tableHeader}>
                    <div className={styles.tableCellCenter}>名称</div>
                    <div className={styles.tableCellCenter}>SSID</div>
                    <div className={styles.tableCellCenter}>频段</div>
                    <div className={styles.tableCellCenter}>频率</div>
                    <div className={styles.tableCellCenter}>信道宽度</div>
                    <div className={styles.tableCellCenter}>模式</div>
                    <div className={styles.tableCellCenter}>协议</div>
                    <div className={styles.tableCellCenter}>状态</div>
                    <div className={styles.tableCell}>操作</div>
                  </div>
                  {inactiveInterfaces.map((iface, index) => (
                    <div key={iface['.id'] || index} className={styles.tableRow}>
                      <div className={styles.tableCellCenter}>
                        <span
                          className={`${styles.monospace} ${styles.copyable}`}
                          onClick={() => handleCopyToClipboard(iface.name, '接口名')}
                          title="点击复制"
                        >
                          {iface.name}
                        </span>
                      </div>
                      <div className={styles.tableCellCenter}>
                        <span className={styles.ssidText}>{iface.ssid || '—'}</span>
                      </div>
                      <div className={styles.tableCellCenter}>{iface.band || '—'}</div>
                      <div className={styles.tableCellCenter}>
                        <span className={styles.monospace}>{iface.frequency || '—'}</span>
                      </div>
                      <div className={styles.tableCellCenter}>
                        <span className={styles.monospace}>{iface['channel-width'] || '—'}</span>
                      </div>
                      <div className={styles.tableCellCenter}>
                        {iface.mode ? (
                          <span className={`${styles.badge} ${styles.badgeInfo}`}>
                            {formatWirelessMode(iface.mode)}
                          </span>
                        ) : '—'}
                      </div>
                      <div className={styles.tableCellCenter}>
                        {iface['wireless-protocol'] ? (
                          <span className={`${styles.badge} ${styles.badgeDefault}`}>
                            {iface['wireless-protocol']}
                          </span>
                        ) : '—'}
                      </div>
                      <div className={styles.tableCellCenter}>
                        <span className={`${styles.badge} ${styles.badgeWarning}`}>
                          未运行
                        </span>
                      </div>
                      <div className={styles.tableCell}>
                        <div className={styles.actionButtons}>
                          <Toggle
                            checked={!iface.disabled}
                            onChange={() => handleToggleInterface(iface['.id'] || '', iface.disabled || false)}
                            disabled={toggleLoading === iface['.id']}
                            aria-label={`切换接口 ${iface.name} 状态`}
                          />
                          <button
                            className={styles.editButton}
                            onClick={() => handleEditInterface(iface)}
                            title="编辑接口"
                          >
                            <EditOutlined />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Modal
              title={`无线接口 - ${editingInterface?.name || ''}`}
              open={editModalVisible}
              onOk={handleSaveEdit}
              onCancel={() => {
                setEditModalVisible(false);
                setEditingInterface(null);
                setOriginalInterface(null);
              }}
              okText="应用"
              cancelText="取消"
              width={850}
              footer={
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                  <button className={styles.modalCancelBtn} onClick={() => {
                    setEditModalVisible(false);
                    setEditingInterface(null);
                    setOriginalInterface(null);
                  }}>
                    取消
                  </button>
                  <button className={styles.modalConfirmBtn} onClick={handleSaveEdit}>
                    应用
                  </button>
                </div>
              }
            >
              {editLoading ? (
                <div className={styles.loadingContainer}>
                  <div className={styles.spinner} />
                  <p>加载接口配置...</p>
                </div>
              ) : editingInterface && (
                <WinboxEditor
                  key={editingInterface['.id'] || editingInterface.name}
                  interface={editingInterface}
                  onChange={setEditingInterface}
                  routerIp={routerIp}
                  securityProfiles={securityProfiles}
                />
              )}
            </Modal>
          </div>
        );

      case 'clients':
        return (
          <div className={styles.content}>
            <div className={styles.summaryCards}>
              <div className={styles.summaryCard}>
                <SignalFilled className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>{clients.length}</div>
                  <div className={styles.summaryLabel}>连接终端</div>
                </div>
              </div>
              <div className={styles.summaryCard}>
                <CheckCircleOutlined className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>
                    {clients.filter(c => isStrongSignal(c.signal || c['signal-strength'])).length}
                  </div>
                  <div className={styles.summaryLabel}>强信号</div>
                </div>
              </div>
              <div className={styles.summaryCard}>
                <WarningOutlined className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>
                    {clients.filter(c => {
                      const signal = c.signal || c['signal-strength'];
                      if (!signal) return false;
                      return !isStrongSignal(signal);
                    }).length}
                  </div>
                  <div className={styles.summaryLabel}>弱信号</div>
                </div>
              </div>
            </div>

            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>终端列表</h2>
              <div className={styles.table}>
                <div className={styles.tableHeader}>
                  <div className={styles.tableCell}>接口名称</div>
                  <div className={styles.tableCellCenter}>射频名称</div>
                  <div className={styles.tableCellCenter}>设备地址</div>
                  <div className={styles.tableCellCenter}>信号强度</div>
                  <div className={styles.tableCellCenter}>传输速率</div>
                  <div className={styles.tableCellCenter}>信号质量</div>
                  <div className={styles.tableCellCenter}>连接时长</div>
                  <div className={styles.tableCell}>操作</div>
                </div>
                {clients.map((client, index) => {
                  const hasTxSignal = !!(client.signal || client['signal-strength']);
                  const hasRxSignal = !!client['rx-signal'];
                  const hasBothSignals = hasTxSignal && hasRxSignal;
                  const displaySignal = hasTxSignal ? (client.signal || client['signal-strength']) : client['rx-signal'];
                  
                  return (
                    <div key={`${client['mac-address']}-${index}`} className={`${styles.tableRow} ${!isStrongSignal(displaySignal) ? styles.weakSignalRow : ''}`}>
                      <div
                        className={`${styles.tableCell} ${styles.copyable}`}
                        onClick={() => handleCopyToClipboard(client.interface, '接口')}
                        title="点击复制"
                      >
                        {client.interface}
                      </div>
                      <div className={styles.tableCellCenter}>
                        {client['radio-name'] || '—'}
                      </div>
                      <div className={styles.tableCellCenter}>
                        <span
                          className={`${styles.monospace} ${styles.copyable}`}
                          onClick={() => handleCopyToClipboard(client['mac-address'], 'MAC地址')}
                          title="点击复制"
                        >
                          {client['mac-address']}
                        </span>
                      </div>
                      <div className={styles.tableCellCenter}>
                        <span className={`${styles.signalBadge} ${isStrongSignal(displaySignal) ? styles.strongSignal : styles.weakSignal}`}>
                          <SignalFilled className={styles.signalIcon} />
                          <span>
                            {hasBothSignals ? (
                              <>
                                {parseSignalStrength(client.signal || client['signal-strength']) ?? '—'}
                                <span style={{ opacity: 0.5, margin: '0 2px' }}>/</span>
                                {parseSignalStrength(client['rx-signal']) ?? '—'}
                              </>
                            ) : (
                              <>{parseSignalStrength(displaySignal) ?? '—'}</>
                            )}
                          </span>
                        </span>
                      </div>
                      <div className={styles.tableCellCenter}>
                        <span className={styles.monospace}>
                          {hasBothSignals ? (
                            <>
                              {client['tx-rate'] || '—'}
                              <span style={{ opacity: 0.5, margin: '0 2px' }}>/</span>
                              {client['rx-rate'] || '—'}
                            </>
                          ) : (
                            <>{client['tx-rate'] || client['rx-rate'] || '—'}</>
                          )}
                        </span>
                      </div>
                      <div className={styles.tableCellCenter}>
                        <span className={styles.monospace}>
                          {hasBothSignals ? (
                            <>
                              {client['tx-signal-quality'] || '—'}
                              <span style={{ opacity: 0.5, margin: '0 2px' }}>/</span>
                              {client['rx-signal-quality'] || '—'}
                            </>
                          ) : (
                            <>{client['tx-signal-quality'] || client['rx-signal-quality'] || '—'}</>
                          )}
                        </span>
                      </div>
                      <div className={styles.tableCellCenter}>{client.uptime || '—'}</div>
                      <div className={styles.tableCell}>
                        <button
                          className={styles.deleteButton}
                          title="踢除终端"
                          onClick={() => {
                            const mac = client['mac-address'];
                            const clientId = client['.id'] || '';
                            Modal.confirm({
                              title: '确认踢除',
                              content: `确定要踢除终端 ${mac} 吗？`,
                              okText: '踢除',
                              okType: 'danger',
                              cancelText: '取消',
                              onOk: () => handleRemoveClient(clientId, mac)
                            });
                          }}
                        >
                          <DeleteOutlined />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {clients.length === 0 && (
                  <div className={styles.emptyRow}>
                    <span>暂无连接的终端</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        );

      case 'security':
        return (
          <div className={styles.content}>
            <div className={styles.summaryCards}>
              <div className={styles.summaryCard}>
                <SafetyOutlined className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>{profiles.length}</div>
                  <div className={styles.summaryLabel}>配置总数</div>
                </div>
              </div>
              <div className={styles.summaryCard}>
                <CheckCircleOutlined className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>
                    {profiles.filter(p => p.mode && p.mode !== 'none' && p.mode !== '--').length}
                  </div>
                  <div className={styles.summaryLabel}>已启用认证</div>
                </div>
              </div>
              <div className={styles.summaryCard}>
                <WarningOutlined className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>
                    {profiles.filter(p => !p.mode || p.mode === 'none' || p.mode === '--').length}
                  </div>
                  <div className={styles.summaryLabel}>未启用认证</div>
                </div>
              </div>
            </div>

            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>加密配置</h2>
                <button
                  className={styles.sectionButton}
                  onClick={() => {
                    setSecurityForm({ name: '', auth: 'wpa2', cipher: 'aes', password: '' });
                    setSecurityAddModalVisible(true);
                  }}
                >
                  <PlusOutlined /> 添加
                </button>
              </div>
              <div className={styles.table}>
                <div className={styles.tableHeader}>
                  <div className={styles.tableCellCenter}>名称</div>
                  <div className={styles.tableCellCenter}>模式</div>
                  <div className={styles.tableCellCenter}>认证类型</div>
                  <div className={styles.tableCellCenter}>单播加密</div>
                  <div className={styles.tableCellCenter}>组播加密</div>
                  <div className={styles.tableCell}>操作</div>
                </div>
                {profiles.map((profile, index) => {
                  const isEnabled = profile.mode === 'dynamic-keys';
                  return (
                    <div key={profile.name || index} className={styles.tableRow}>
                      <div className={styles.tableCellCenter}>
                        <span
                          className={`${styles.monospace} ${styles.copyable}`}
                          onClick={() => handleCopyToClipboard(profile.name, '配置名')}
                          title="点击复制"
                        >
                          {profile.name}
                        </span>
                      </div>
                      <div className={styles.tableCellCenter}>
                        {profile.mode && profile.mode !== '--' ? (
                          <span className={`${styles.badge} ${styles.badgeInfo}`}>
                            {profile.mode}
                          </span>
                        ) : '—'}
                      </div>
                      <div className={styles.tableCellCenter}>
                        {profile.mode && profile.mode !== 'none' && profile.mode !== '--' ? (
                          <span className={`${styles.badge} ${styles.badgeSuccess}`}>
                            <SafetyOutlined className={styles.badgeIcon} />
                            {profile['authentication-types'] && profile['authentication-types'] !== '--'
                              ? profile['authentication-types']
                              : profile.mode}
                          </span>
                        ) : (
                          <span className={`${styles.badge} ${styles.badgeWarning}`}>
                            未启用
                          </span>
                        )}
                      </div>
                      <div className={styles.tableCellCenter}>
                        <span className={styles.monospace}>
                          {profile['unicast-ciphers'] && profile['unicast-ciphers'] !== '--'
                            ? profile['unicast-ciphers']
                            : '—'}
                        </span>
                      </div>
                      <div className={styles.tableCellCenter}>
                        <span className={styles.monospace}>
                          {profile['group-ciphers'] && profile['group-ciphers'] !== '--'
                            ? profile['group-ciphers']
                            : '—'}
                        </span>
                      </div>
                      <div className={styles.tableCell}>
                        <div className={styles.actionButtons}>
                          <Toggle
                            checked={isEnabled}
                            onChange={(checked) => handleToggleSecurityProfile(profile, checked)}
                            aria-label={`切换加密配置 ${profile.name}`}
                          />
                          <button
                            className={styles.actionButton}
                            onClick={() => openEditSecurityModal(profile)}
                            title="编辑"
                          >
                            <EditOutlined />
                          </button>
                          <button
                            className={`${styles.actionButton} ${styles.deleteButton}`}
                            onClick={() => handleDeleteSecurityProfile(profile)}
                            title="删除"
                          >
                            <DeleteOutlined />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {profiles.length === 0 && (
                  <div className={styles.emptyRow}>
                    <span>暂无加密配置</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerContent}>
          <h1 className={styles.title}>无线</h1>
          <p className={styles.subtitle}>管理无线接口、终端连接和安全配置</p>
        </div>
        <div className={styles.headerActions}>
        </div>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          { key: 'interfaces', label: '无线接口', children: renderContent() },
          { key: 'clients', label: '终端列表', children: renderContent() },
          { key: 'security', label: '加密配置', children: renderContent() },
        ]}
        className={styles.tabs}
      />

      {/* 添加加密配置 Modal */}
      <Modal
        title="添加加密配置"
        open={securityAddModalVisible}
        onCancel={() => setSecurityAddModalVisible(false)}
        onOk={handleAddSecurityProfile}
        okText="添加"
        cancelText="取消"
        confirmLoading={securityLoading}
        width={460}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>配置名称</label>
            <Input
              value={securityForm.name}
              onChange={e => setSecurityForm(f => ({ ...f, name: e.target.value }))}
              placeholder="输入配置名称"
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>认证类型</label>
            <Select
              value={securityForm.auth}
              onChange={v => setSecurityForm(f => ({ ...f, auth: v }))}
              style={{ width: '100%' }}
            >
              <Select.Option value="wpa2">WPA2-PSK</Select.Option>
              <Select.Option value="wpa">WPA-PSK</Select.Option>
              <Select.Option value="wpa/wpa2">WPA/WPA2-PSK</Select.Option>
            </Select>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>加密算法</label>
            <Select
              value={securityForm.cipher}
              onChange={v => setSecurityForm(f => ({ ...f, cipher: v }))}
              style={{ width: '100%' }}
            >
              <Select.Option value="aes">AES-CCM</Select.Option>
              <Select.Option value="tkip">TKIP</Select.Option>
              <Select.Option value="aes/tkip">AES-CCM/TKIP</Select.Option>
            </Select>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>密码</label>
            <Input.Password
              value={securityForm.password}
              onChange={e => setSecurityForm(f => ({ ...f, password: e.target.value }))}
              placeholder="至少8位密码"
            />
          </div>
        </div>
      </Modal>

      {/* 编辑加密配置 Modal */}
      <Modal
        title="编辑加密配置"
        open={securityEditModalVisible}
        onCancel={() => { setSecurityEditModalVisible(false); setEditingProfile(null); }}
        onOk={handleEditSecurityProfile}
        okText="保存"
        cancelText="取消"
        confirmLoading={securityLoading}
        width={460}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>配置名称</label>
            <Input
              value={securityEditForm.name}
              onChange={e => setSecurityEditForm(f => ({ ...f, name: e.target.value }))}
              placeholder="输入配置名称"
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>认证类型</label>
            <Select
              value={securityEditForm.auth}
              onChange={v => setSecurityEditForm(f => ({ ...f, auth: v }))}
              style={{ width: '100%' }}
            >
              <Select.Option value="wpa2">WPA2-PSK</Select.Option>
              <Select.Option value="wpa">WPA-PSK</Select.Option>
              <Select.Option value="wpa/wpa2">WPA/WPA2-PSK</Select.Option>
            </Select>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>加密算法</label>
            <Select
              value={securityEditForm.cipher}
              onChange={v => setSecurityEditForm(f => ({ ...f, cipher: v }))}
              style={{ width: '100%' }}
            >
              <Select.Option value="aes">AES-CCM</Select.Option>
              <Select.Option value="tkip">TKIP</Select.Option>
              <Select.Option value="aes/tkip">AES-CCM/TKIP</Select.Option>
            </Select>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>新密码（留空则不修改）</label>
            <Input.Password
              value={securityEditForm.password}
              onChange={e => setSecurityEditForm(f => ({ ...f, password: e.target.value }))}
              placeholder="至少8位密码"
            />
          </div>
        </div>
      </Modal>

      <Modal
        title="干扰扫描"
        open={scanModalVisible}
        onCancel={closeScanModal}
        footer={null}
        width={900}
        destroyOnClose
      >
        <div className={styles.scanControls}>
          <div className={styles.scanControlRow}>
            <label className={styles.scanLabel}>扫描接口</label>
            <Select
              value={selectedScanInterfaceName || undefined}
              onChange={(val) => {
                setSelectedScanInterfaceName(val);
                const iface = scanInterfaces.find(i => i.name === val);
                if (iface) setSelectedScanInterface(iface.id || iface.name);
              }}
              style={{ width: 200 }}
              placeholder="选择接口"
              disabled={scanScanning}
            >
              {scanInterfaces.map(iface => (
                <Select.Option key={iface.name} value={iface.name}>
                  {iface.name} {iface.running ? '(运行中)' : iface.disabled ? '(已禁用)' : '(未运行)'}
                </Select.Option>
              ))}
            </Select>
            <label className={styles.scanCheckboxLabel}>
              <input
                type="checkbox"
                checked={scanBackground}
                onChange={e => setScanBackground(e.target.checked)}
                disabled={scanScanning}
              />
              后台扫描
            </label>
          </div>
          <div className={styles.scanControlRow}>
            {!scanScanning ? (
              <button
                className={styles.scanStartBtn}
                onClick={startScan}
                disabled={!selectedScanInterface}
              >
                <SearchOutlined /> 开始扫描
              </button>
            ) : (
              <button className={styles.scanStopBtn} onClick={stopScan}>
                <StopOutlined /> 停止扫描
              </button>
            )}
            {scanScanning && (
              <span className={styles.scanStatus}>扫描中... 已发现 {Object.keys(scanResults).length} 个信号</span>
            )}
            {!scanScanning && Object.keys(scanResults).length > 0 && (
              <span className={styles.scanStatus}>扫描完成，共发现 {Object.keys(scanResults).length} 个信号</span>
            )}
          </div>
        </div>

        {(scanScanning || Object.keys(scanResults).length > 0) && (
          <div className={styles.scanResults}>
            <div className={styles.scanTable}>
              <div className={styles.scanTableHeader}>
                <div className={styles.scanTableCell} onClick={() => sortScanResults('address')} style={{ cursor: 'pointer' }}>
                  MAC地址{renderSortIcon('address')}
                </div>
                <div className={styles.scanTableCell} onClick={() => sortScanResults('ssid')} style={{ cursor: 'pointer' }}>
                  SSID{renderSortIcon('ssid')}
                </div>
                <div className={styles.scanTableCell} onClick={() => sortScanResults('radio_name')} style={{ cursor: 'pointer' }}>
                  Radio名称{renderSortIcon('radio_name')}
                </div>
                <div className={styles.scanTableCell} onClick={() => sortScanResults('channel')} style={{ cursor: 'pointer' }}>
                  信道{renderSortIcon('channel')}
                </div>
                <div className={styles.scanTableCell} onClick={() => sortScanResults('signal_strength')} style={{ cursor: 'pointer' }}>
                  信号强度{renderSortIcon('signal_strength')}
                </div>
                <div className={styles.scanTableCell} onClick={() => sortScanResults('noise')} style={{ cursor: 'pointer' }}>
                  噪声{renderSortIcon('noise')}
                </div>
                <div className={styles.scanTableCell} onClick={() => sortScanResults('snr')} style={{ cursor: 'pointer' }}>
                  信噪比{renderSortIcon('snr')}
                </div>
              </div>
              {getSortedScanResults().map(item => (
                <div key={item.address} className={styles.scanTableRow} onContextMenu={(e) => handleScanRowContextMenu(e, item)}>
                  <div className={styles.scanTableCell}>
                    <span
                      className={`${styles.monospace} ${styles.copyable}`}
                      onClick={() => handleCopyToClipboard(item.address, 'MAC地址')}
                      title="点击复制"
                    >
                      {item.address}
                    </span>
                  </div>
                  <div className={styles.scanTableCell}>
                    <span
                      className={`${styles.ssidText} ${styles.copyable}`}
                      onClick={() => handleCopyToClipboard(item.ssid, 'SSID')}
                      title="点击复制"
                    >
                      {item.ssid}
                    </span>
                  </div>
                  <div className={styles.scanTableCell}>
                    <span className={styles.monospace}>{item.radio_name}</span>
                  </div>
                  <div className={styles.scanTableCell}>
                    <span className={styles.monospace}>{item.channel || '—'}</span>
                  </div>
                  <div className={styles.scanTableCell}>
                    <span className={styles.monospace}>{item.signal_strength}</span>
                  </div>
                  <div className={styles.scanTableCell}>
                    <span className={styles.monospace}>{item.noise}</span>
                  </div>
                  <div className={styles.scanTableCell}>
                    <span className={styles.monospace}>{item.snr}</span>
                  </div>
                </div>
              ))}
              {Object.keys(scanResults).length === 0 && scanScanning && (
                <div className={styles.emptyRow}>
                  <span>正在扫描，请等待...</span>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* 干扰扫描右键菜单 */}
      {contextMenuVisible && selectedScanResult && (
        <div
          ref={contextMenuRef}
          className={styles.contextMenu}
          style={{ left: contextMenuPosition.x, top: contextMenuPosition.y }}
        >
          <div
            className={styles.contextMenuItem}
            onClick={() => handleConnectFromScan(selectedScanResult)}
          >
            <LinkOutlined />
            <span>连接</span>
          </div>
        </div>
      )}
    </div>
  );
};
