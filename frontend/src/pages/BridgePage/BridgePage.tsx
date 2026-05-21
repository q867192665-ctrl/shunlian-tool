import React, { useState, useEffect, useCallback } from 'react';
import { Tabs, message as antMessage } from 'antd';
import {
  WarningOutlined,
  ApiOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  LinkOutlined,
  CopyOutlined,
  DesktopOutlined,
} from '@ant-design/icons';
import { useAppState } from '../../contexts/AppContext';
import styles from './BridgePage.module.css';

interface Bridge {
  name: string;
  'mtu'?: string;
  'actual-mtu'?: string;
  'l2mtu'?: string;
  'mac-address'?: string;
  'arp'?: string;
  'arp-timeout'?: string;
  'ageing-time'?: string;
  'vlan-filtering'?: string;
  'protocol-mode'?: string;
  'priority'?: string;
  running?: string;
  disabled?: string;
  comment?: string;
  '.id'?: string;
}

interface BridgePort {
  interface: string;
  bridge: string;
  'path-cost'?: string;
  priority?: string;
  'pvid'?: string;
  'edge'?: string;
  'point-to-point'?: string;
  'external-fdb'?: string;
  'learning'?: string;
  'forwarding'?: string;
  disabled?: string;
  comment?: string;
  '.id'?: string;
}

interface BridgeHost {
  'mac-address': string;
  'interface'?: string;
  bridge?: string;
  'vid'?: string;
  'on-ports'?: string;
  age?: string;
  dynamic?: string;
  local?: string;
  external?: string;
  '.id'?: string;
}

export const BridgePage: React.FC = () => {
  const { router } = useAppState();
  const routerIp = router?.ipAddress || '';

  const [activeTab, setActiveTab] = useState('bridges');
  const [bridges, setBridges] = useState<Bridge[]>([]);
  const [ports, setPorts] = useState<BridgePort[]>([]);
  const [hosts, setHosts] = useState<BridgeHost[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBridges = useCallback(async (isInitial: boolean = false) => {
    if (!routerIp) return;
    try {
      if (isInitial) setInitialLoading(true);
      setError(null);
      const resp = await fetch('/api/device/bridges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: routerIp }),
      });
      const data = await resp.json();
      console.log('Bridges API response:', data);
      if (data.status === 'success' && data.bridges) {
        setBridges(data.bridges);
      } else if (data.status === 'error') {
        if (isInitial) setError(data.message || '加载桥接口列表失败');
      }
    } catch (err) {
      console.error('Failed to fetch bridges:', err);
      if (isInitial) setError(err instanceof Error ? err.message : '加载桥接口列表失败');
    } finally {
      if (isInitial) setInitialLoading(false);
    }
  }, [routerIp]);

  const fetchPorts = useCallback(async (isInitial: boolean = false) => {
    if (!routerIp) return;
    try {
      if (isInitial) setInitialLoading(true);
      setError(null);
      const resp = await fetch('/api/device/bridge-ports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: routerIp }),
      });
      const data = await resp.json();
      if (data.status === 'success' && data.bridge_ports) {
        setPorts(data.bridge_ports);
      } else if (data.status === 'error') {
        if (isInitial) setError(data.message || '加载桥接端口失败');
      }
    } catch (err) {
      console.error('Failed to fetch bridge ports:', err);
      if (isInitial) setError(err instanceof Error ? err.message : '加载桥接端口失败');
    } finally {
      if (isInitial) setInitialLoading(false);
    }
  }, [routerIp]);

  const fetchHosts = useCallback(async (isInitial: boolean = false) => {
    if (!routerIp) return;
    try {
      if (isInitial) setInitialLoading(true);
      setError(null);
      const resp = await fetch('/api/device/bridge-hosts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: routerIp }),
      });
      const data = await resp.json();
      console.log('Bridge hosts API response:', data);
      if (data.status === 'success' && data.hosts) {
        setHosts(data.hosts);
      } else if (data.status === 'error') {
        if (isInitial) setError(data.message || '加载主机表失败');
      }
    } catch (err) {
      console.error('Failed to fetch bridge hosts:', err);
      if (isInitial) setError(err instanceof Error ? err.message : '加载主机表失败');
    } finally {
      if (isInitial) setInitialLoading(false);
    }
  }, [routerIp]);

  const fetchData = useCallback((isInitial: boolean = false) => {
    if (!routerIp) return;
    switch (activeTab) {
      case 'bridges':
        fetchBridges(isInitial);
        break;
      case 'ports':
        fetchPorts(isInitial);
        break;
      case 'hosts':
        fetchHosts(isInitial);
        break;
    }
  }, [activeTab, routerIp, fetchBridges, fetchPorts, fetchHosts]);

  useEffect(() => {
    fetchData(true);
    const interval = setInterval(() => fetchData(false), 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

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
    antMessage.info(`${label}: ${text}`);
  };

  const runningBridges = bridges.filter(b => b.running === 'true' && b.disabled !== 'true');
  const disabledBridges = bridges.filter(b => b.disabled === 'true');
  const dynamicHosts = hosts.filter(h => h.dynamic === 'true');

  const renderContent = () => {
    if (!routerIp) {
      return (
        <div className={styles.emptyState}>
          <WarningOutlined className={styles.errorIcon} />
          <p className={styles.errorText}>请先连接设备</p>
        </div>
      );
    }

    if (initialLoading && bridges.length === 0 && ports.length === 0 && hosts.length === 0) {
      return (
        <div className={styles.emptyState}>
          <div className={styles.spinner} />
          <p>加载桥接信息...</p>
        </div>
      );
    }

    if (error && bridges.length === 0 && ports.length === 0 && hosts.length === 0) {
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
      case 'bridges':
        return (
          <div className={styles.content}>
            <div className={styles.summaryCards}>
              <div className={styles.summaryCard}>
                <LinkOutlined className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>{bridges.length}</div>
                  <div className={styles.summaryLabel}>总桥接口数</div>
                </div>
              </div>
              <div className={styles.summaryCard}>
                <CheckCircleOutlined className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>{runningBridges.length}</div>
                  <div className={styles.summaryLabel}>运行中</div>
                </div>
              </div>
              <div className={styles.summaryCard}>
                <CloseCircleOutlined className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>{disabledBridges.length}</div>
                  <div className={styles.summaryLabel}>已禁用</div>
                </div>
              </div>
            </div>

            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>桥接口列表</h2>
              <div className={styles.table}>
                <div className={styles.tableHeader}>
                  <div className={styles.tableCell}>名称</div>
                  <div className={styles.tableCell}>MAC地址</div>
                  <div className={styles.tableCell}>MTU</div>
                  <div className={styles.tableCell}>ARP</div>
                  <div className={styles.tableCell}>协议模式</div>
                  <div className={styles.tableCell}>VLAN过滤</div>
                  <div className={styles.tableCell}>状态</div>
                </div>
                {bridges.map((bridge, index) => (
                  <div key={bridge['.id'] || index} className={styles.tableRow}>
                    <div className={styles.tableCell}>
                      <span
                        className={`${styles.monospace} ${styles.copyable}`}
                        onClick={() => handleCopyToClipboard(bridge.name, '桥接口名')}
                        title="点击复制"
                      >
                        {bridge.name}
                      </span>
                    </div>
                    <div className={styles.tableCell}>
                      <span className={styles.monospace}>{bridge['mac-address'] || '—'}</span>
                    </div>
                    <div className={styles.tableCell}>
                      <span className={styles.monospace}>{bridge['actual-mtu'] || bridge.mtu || '—'}</span>
                    </div>
                    <div className={styles.tableCell}>
                      {bridge.arp ? (
                        <span className={`${styles.badge} ${styles.badgeInfo}`}>
                          {bridge.arp}
                        </span>
                      ) : '—'}
                    </div>
                    <div className={styles.tableCell}>
                      {bridge['protocol-mode'] ? (
                        <span className={`${styles.badge} ${styles.badgeDefault}`}>
                          {bridge['protocol-mode']}
                        </span>
                      ) : '—'}
                    </div>
                    <div className={styles.tableCell}>
                      {bridge['vlan-filtering'] === 'true' ? (
                        <span className={`${styles.badge} ${styles.badgeSuccess}`}>
                          启用
                        </span>
                      ) : (
                        <span className={`${styles.badge} ${styles.badgeDefault}`}>
                          禁用
                        </span>
                      )}
                    </div>
                    <div className={styles.tableCell}>
                      {bridge.disabled === 'true' ? (
                        <span className={`${styles.badge} ${styles.badgeDefault}`}>
                          已禁用
                        </span>
                      ) : bridge.running === 'true' ? (
                        <span className={`${styles.badge} ${styles.badgeSuccess}`}>
                          <CheckCircleOutlined className={styles.badgeIcon} />
                          运行中
                        </span>
                      ) : (
                        <span className={`${styles.badge} ${styles.badgeWarning}`}>
                          已停止
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {bridges.length === 0 && (
                  <div className={styles.emptyRow}>
                    <span>暂无桥接口</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        );

      case 'ports':
        return (
          <div className={styles.content}>
            <div className={styles.summaryCards}>
              <div className={styles.summaryCard}>
                <ApiOutlined className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>{ports.length}</div>
                  <div className={styles.summaryLabel}>总端口数</div>
                </div>
              </div>
              <div className={styles.summaryCard}>
                <CheckCircleOutlined className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>{ports.filter(p => p.disabled !== 'true').length}</div>
                  <div className={styles.summaryLabel}>已启用</div>
                </div>
              </div>
              <div className={styles.summaryCard}>
                <CloseCircleOutlined className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>{ports.filter(p => p.disabled === 'true').length}</div>
                  <div className={styles.summaryLabel}>已禁用</div>
                </div>
              </div>
            </div>

            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>桥接端口</h2>
              <div className={styles.table}>
                <div className={styles.tableHeader}>
                  <div className={styles.tableCell}>接口</div>
                  <div className={styles.tableCell}>桥接口</div>
                  <div className={styles.tableCell}>PVID</div>
                  <div className={styles.tableCell}>路径开销</div>
                  <div className={styles.tableCell}>优先级</div>
                  <div className={styles.tableCell}>边缘端口</div>
                  <div className={styles.tableCell}>状态</div>
                </div>
                {ports.map((port, index) => (
                  <div key={port['.id'] || index} className={styles.tableRow}>
                    <div className={styles.tableCell}>
                      <span
                        className={`${styles.monospace} ${styles.copyable}`}
                        onClick={() => handleCopyToClipboard(port.interface, '接口名')}
                        title="点击复制"
                      >
                        {port.interface}
                      </span>
                    </div>
                    <div className={styles.tableCell}>
                      <span className={`${styles.badge} ${styles.badgeInfo}`}>
                        {port.bridge}
                      </span>
                    </div>
                    <div className={styles.tableCell}>
                      <span className={styles.monospace}>{port.pvid || '—'}</span>
                    </div>
                    <div className={styles.tableCell}>
                      <span className={styles.monospace}>{port['path-cost'] || '—'}</span>
                    </div>
                    <div className={styles.tableCell}>
                      <span className={styles.monospace}>{port.priority || '—'}</span>
                    </div>
                    <div className={styles.tableCell}>
                      {port.edge === 'true' ? (
                        <span className={`${styles.badge} ${styles.badgeSuccess}`}>
                          是
                        </span>
                      ) : (
                        <span className={`${styles.badge} ${styles.badgeDefault}`}>
                          否
                        </span>
                      )}
                    </div>
                    <div className={styles.tableCell}>
                      {port.disabled === 'true' ? (
                        <span className={`${styles.badge} ${styles.badgeDefault}`}>
                          已禁用
                        </span>
                      ) : (
                        <span className={`${styles.badge} ${styles.badgeSuccess}`}>
                          <CheckCircleOutlined className={styles.badgeIcon} />
                          启用
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {ports.length === 0 && (
                  <div className={styles.emptyRow}>
                    <span>暂无桥接端口</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        );

      case 'hosts':
        return (
          <div className={styles.content}>
            <div className={styles.summaryCards}>
              <div className={styles.summaryCard}>
                <DesktopOutlined className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>{hosts.length}</div>
                  <div className={styles.summaryLabel}>总主机数</div>
                </div>
              </div>
              <div className={styles.summaryCard}>
                <CheckCircleOutlined className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>{hosts.filter(h => h.dynamic !== 'true').length}</div>
                  <div className={styles.summaryLabel}>静态</div>
                </div>
              </div>
              <div className={styles.summaryCard}>
                <ApiOutlined className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>{dynamicHosts.length}</div>
                  <div className={styles.summaryLabel}>动态</div>
                </div>
              </div>
            </div>

            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>主机表 (MAC地址表)</h2>
              <div className={styles.table}>
                <div className={styles.tableHeader}>
                  <div className={styles.tableCell}>MAC地址</div>
                  <div className={styles.tableCell}>桥接口</div>
                  <div className={styles.tableCell}>接口</div>
                  <div className={styles.tableCell}>VLAN ID</div>
                  <div className={styles.tableCell}>年龄</div>
                  <div className={styles.tableCell}>类型</div>
                </div>
                {hosts.map((host, index) => (
                  <div key={host['.id'] || `${host['mac-address']}-${index}`} className={styles.tableRow}>
                    <div className={styles.tableCell}>
                      <span
                        className={`${styles.monospace} ${styles.copyable}`}
                        onClick={() => handleCopyToClipboard(host['mac-address'], 'MAC地址')}
                        title="点击复制"
                      >
                        {host['mac-address']}
                      </span>
                    </div>
                    <div className={styles.tableCell}>
                      <span className={`${styles.badge} ${styles.badgeInfo}`}>
                        {host.bridge || '—'}
                      </span>
                    </div>
                    <div className={styles.tableCell}>
                      <span className={styles.monospace}>{host.interface || host['on-ports'] || '—'}</span>
                    </div>
                    <div className={styles.tableCell}>
                      <span className={styles.monospace}>{host.vid || '—'}</span>
                    </div>
                    <div className={styles.tableCell}>
                      <span className={styles.monospace}>{host.age || '—'}</span>
                    </div>
                    <div className={styles.tableCell}>
                      {host.local === 'true' ? (
                        <span className={`${styles.badge} ${styles.badgeWarning}`}>
                          本地
                        </span>
                      ) : host.dynamic === 'true' ? (
                        <span className={`${styles.badge} ${styles.badgeDefault}`}>
                          动态
                        </span>
                      ) : (
                        <span className={`${styles.badge} ${styles.badgeSuccess}`}>
                          静态
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {hosts.length === 0 && (
                  <div className={styles.emptyRow}>
                    <span>暂无主机记录</span>
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
          <h1 className={styles.title}>桥接口</h1>
          <p className={styles.subtitle}>管理桥接口、桥接端口和主机表</p>
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
          { key: 'bridges', label: '桥接口', children: renderContent() },
          { key: 'ports', label: '端口', children: renderContent() },
          { key: 'hosts', label: '主机表', children: renderContent() },
        ]}
        className={styles.tabs}
      />
    </div>
  );
};
