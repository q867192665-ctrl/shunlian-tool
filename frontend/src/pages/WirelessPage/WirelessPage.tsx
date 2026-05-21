import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Input, Select, Modal, message as antMessage, Tabs } from 'antd';
import {
  ReloadOutlined,
  WifiOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SignalFilled,
  DeleteOutlined,
  EditOutlined,
  WarningOutlined,
  SafetyOutlined,
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
  'tx-rate'?: string;
  'rx-rate'?: string;
  uptime?: string;
  'signal-strength'?: string;
}

interface SecurityProfile {
  name: string;
  mode?: string;
  'authentication-types'?: string;
  'unicast-ciphers'?: string;
  'group-ciphers'?: string;
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

  const wsDataAppliedRef = useRef(false);

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
        'tx-rate': c.tx_rate,
        'rx-rate': c.rx_rate,
        uptime: c.uptime,
        'signal-strength': c.tx_signal,
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
      const newValue = (editingInterface as any)[field.originalKey] || '';
      const oldValue = (originalInterface as any)[field.originalKey] || '';
      if (newValue !== oldValue) {
        changed[field.key] = newValue;
      }
    }
    
    return changed;
  };

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
          <button className={styles.retryButton} onClick={() => fetchData(true)}>
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
              <h2 className={styles.sectionTitle}>活跃接口</h2>
              <div className={styles.table}>
                <div className={styles.tableHeader}>
                  <div className={styles.tableCell}>名称</div>
                  <div className={styles.tableCell}>SSID</div>
                  <div className={styles.tableCell}>频段</div>
                  <div className={styles.tableCell}>频率</div>
                  <div className={styles.tableCell}>信道宽度</div>
                  <div className={styles.tableCell}>模式</div>
                  <div className={styles.tableCell}>协议</div>
                  <div className={styles.tableCell}>状态</div>
                  <div className={styles.tableCell}>操作</div>
                </div>
                {activeInterfaces.map((iface, index) => (
                  <div key={iface['.id'] || index} className={styles.tableRow}>
                    <div className={styles.tableCell}>
                      <span
                        className={`${styles.monospace} ${styles.copyable}`}
                        onClick={() => handleCopyToClipboard(iface.name, '接口名')}
                        title="点击复制"
                      >
                        {iface.name}
                      </span>
                    </div>
                    <div className={styles.tableCell}>
                      <span className={styles.ssidText}>{iface.ssid || '—'}</span>
                    </div>
                    <div className={styles.tableCell}>{iface.band || '—'}</div>
                    <div className={styles.tableCell}>
                      <span className={styles.monospace}>{iface.frequency || '—'}</span>
                    </div>
                    <div className={styles.tableCell}>
                      <span className={styles.monospace}>{iface['channel-width'] || '—'}</span>
                    </div>
                    <div className={styles.tableCell}>
                      {iface.mode ? (
                        <span className={`${styles.badge} ${styles.badgeInfo}`}>
                          {iface.mode}
                        </span>
                      ) : '—'}
                    </div>
                    <div className={styles.tableCell}>
                      {iface['wireless-protocol'] ? (
                        <span className={`${styles.badge} ${styles.badgeDefault}`}>
                          {iface['wireless-protocol']}
                        </span>
                      ) : '—'}
                    </div>
                    <div className={styles.tableCell}>
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
                    <div className={styles.tableCell}>名称</div>
                    <div className={styles.tableCell}>SSID</div>
                    <div className={styles.tableCell}>频段</div>
                    <div className={styles.tableCell}>频率</div>
                    <div className={styles.tableCell}>信道宽度</div>
                    <div className={styles.tableCell}>模式</div>
                    <div className={styles.tableCell}>协议</div>
                    <div className={styles.tableCell}>状态</div>
                    <div className={styles.tableCell}>操作</div>
                  </div>
                  {disabledInterfaces.map((iface, index) => (
                    <div key={iface['.id'] || index} className={styles.tableRow}>
                      <div className={styles.tableCell}>
                        <span
                          className={`${styles.monospace} ${styles.copyable}`}
                          onClick={() => handleCopyToClipboard(iface.name, '接口名')}
                          title="点击复制"
                        >
                          {iface.name}
                        </span>
                      </div>
                      <div className={styles.tableCell}>
                        <span className={styles.ssidText}>{iface.ssid || '—'}</span>
                      </div>
                      <div className={styles.tableCell}>{iface.band || '—'}</div>
                      <div className={styles.tableCell}>
                        <span className={styles.monospace}>{iface.frequency || '—'}</span>
                      </div>
                      <div className={styles.tableCell}>
                        <span className={styles.monospace}>{iface['channel-width'] || '—'}</span>
                      </div>
                      <div className={styles.tableCell}>
                        {iface.mode ? (
                          <span className={`${styles.badge} ${styles.badgeInfo}`}>
                            {iface.mode}
                          </span>
                        ) : '—'}
                      </div>
                      <div className={styles.tableCell}>
                        {iface['wireless-protocol'] ? (
                          <span className={`${styles.badge} ${styles.badgeDefault}`}>
                            {iface['wireless-protocol']}
                          </span>
                        ) : '—'}
                      </div>
                      <div className={styles.tableCell}>
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
                    <div className={styles.tableCell}>名称</div>
                    <div className={styles.tableCell}>SSID</div>
                    <div className={styles.tableCell}>频段</div>
                    <div className={styles.tableCell}>频率</div>
                    <div className={styles.tableCell}>信道宽度</div>
                    <div className={styles.tableCell}>模式</div>
                    <div className={styles.tableCell}>协议</div>
                    <div className={styles.tableCell}>状态</div>
                    <div className={styles.tableCell}>操作</div>
                  </div>
                  {inactiveInterfaces.map((iface, index) => (
                    <div key={iface['.id'] || index} className={styles.tableRow}>
                      <div className={styles.tableCell}>
                        <span
                          className={`${styles.monospace} ${styles.copyable}`}
                          onClick={() => handleCopyToClipboard(iface.name, '接口名')}
                          title="点击复制"
                        >
                          {iface.name}
                        </span>
                      </div>
                      <div className={styles.tableCell}>
                        <span className={styles.ssidText}>{iface.ssid || '—'}</span>
                      </div>
                      <div className={styles.tableCell}>{iface.band || '—'}</div>
                      <div className={styles.tableCell}>
                        <span className={styles.monospace}>{iface.frequency || '—'}</span>
                      </div>
                      <div className={styles.tableCell}>
                        <span className={styles.monospace}>{iface['channel-width'] || '—'}</span>
                      </div>
                      <div className={styles.tableCell}>
                        {iface.mode ? (
                          <span className={`${styles.badge} ${styles.badgeInfo}`}>
                            {iface.mode}
                          </span>
                        ) : '—'}
                      </div>
                      <div className={styles.tableCell}>
                        {iface['wireless-protocol'] ? (
                          <span className={`${styles.badge} ${styles.badgeDefault}`}>
                            {iface['wireless-protocol']}
                          </span>
                        ) : '—'}
                      </div>
                      <div className={styles.tableCell}>
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
              footer={[
                <button key="cancel" className={styles.winboxCancelBtn} onClick={() => {
                  setEditModalVisible(false);
                  setEditingInterface(null);
                  setOriginalInterface(null);
                }}>
                  取消
                </button>,
                <button key="ok" className={styles.winboxOkBtn} onClick={handleSaveEdit}>
                  应用
                </button>,
              ]}
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
                  <div className={styles.tableCell}>接口</div>
                  <div className={styles.tableCell}>MAC 地址</div>
                  <div className={styles.tableCell}>信号强度</div>
                  <div className={styles.tableCell}>发送速率</div>
                  <div className={styles.tableCell}>接收速率</div>
                  <div className={styles.tableCell}>在线时长</div>
                  <div className={styles.tableCell}>操作</div>
                </div>
                {clients.map((client, index) => (
                  <div key={`${client['mac-address']}-${index}`} className={styles.tableRow}>
                    <div
                      className={`${styles.tableCell} ${styles.copyable}`}
                      onClick={() => handleCopyToClipboard(client.interface, '接口')}
                      title="点击复制"
                    >
                      {client.interface}
                    </div>
                    <div className={styles.tableCell}>
                      <span
                        className={`${styles.monospace} ${styles.copyable}`}
                        onClick={() => handleCopyToClipboard(client['mac-address'], 'MAC地址')}
                        title="点击复制"
                      >
                        {client['mac-address']}
                      </span>
                    </div>
                    <div className={styles.tableCell}>
                      <span className={`${styles.signalBadge} ${isStrongSignal(client.signal || client['signal-strength']) ? styles.strongSignal : styles.weakSignal}`}>
                        <SignalFilled className={styles.signalIcon} />
                        {client.signal || client['signal-strength'] || '—'}
                      </span>
                    </div>
                    <div className={styles.tableCell}>
                      <span className={styles.monospace}>{client['tx-rate'] || '—'}</span>
                    </div>
                    <div className={styles.tableCell}>
                      <span className={styles.monospace}>{client['rx-rate'] || '—'}</span>
                    </div>
                    <div className={styles.tableCell}>{client.uptime || '—'}</div>
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
                ))}
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
                    {profiles.filter(p => p['authentication-types'] && p['authentication-types'] !== '--').length}
                  </div>
                  <div className={styles.summaryLabel}>已启用认证</div>
                </div>
              </div>
              <div className={styles.summaryCard}>
                <WarningOutlined className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>
                    {profiles.filter(p => !p['authentication-types'] || p['authentication-types'] === '--').length}
                  </div>
                  <div className={styles.summaryLabel}>开放认证</div>
                </div>
              </div>
            </div>

            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>加密配置</h2>
              <div className={styles.table}>
                <div className={styles.tableHeader}>
                  <div className={styles.tableCell}>名称</div>
                  <div className={styles.tableCell}>模式</div>
                  <div className={styles.tableCell}>认证类型</div>
                  <div className={styles.tableCell}>单播加密</div>
                  <div className={styles.tableCell}>组播加密</div>
                </div>
                {profiles.map((profile, index) => (
                  <div key={profile.name || index} className={styles.tableRow}>
                    <div className={styles.tableCell}>
                      <span
                        className={`${styles.monospace} ${styles.copyable}`}
                        onClick={() => handleCopyToClipboard(profile.name, '配置名')}
                        title="点击复制"
                      >
                        {profile.name}
                      </span>
                    </div>
                    <div className={styles.tableCell}>
                      {profile.mode && profile.mode !== '--' ? (
                        <span className={`${styles.badge} ${styles.badgeInfo}`}>
                          {profile.mode}
                        </span>
                      ) : '—'}
                    </div>
                    <div className={styles.tableCell}>
                      {profile['authentication-types'] && profile['authentication-types'] !== '--' ? (
                        <span className={`${styles.badge} ${styles.badgeSuccess}`}>
                          <SafetyOutlined className={styles.badgeIcon} />
                          {profile['authentication-types']}
                        </span>
                      ) : (
                        <span className={`${styles.badge} ${styles.badgeWarning}`}>
                          开放
                        </span>
                      )}
                    </div>
                    <div className={styles.tableCell}>
                      <span className={styles.monospace}>
                        {profile['unicast-ciphers'] && profile['unicast-ciphers'] !== '--'
                          ? profile['unicast-ciphers']
                          : '—'}
                      </span>
                    </div>
                    <div className={styles.tableCell}>
                      <span className={styles.monospace}>
                        {profile['group-ciphers'] && profile['group-ciphers'] !== '--'
                          ? profile['group-ciphers']
                          : '—'}
                      </span>
                    </div>
                  </div>
                ))}
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
          <button className={styles.refreshButton} onClick={() => fetchData(false)}>
            <ReloadOutlined className={styles.refreshIcon} />
            刷新
          </button>
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
    </div>
  );
};
