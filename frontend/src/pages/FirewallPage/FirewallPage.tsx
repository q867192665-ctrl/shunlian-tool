import React, { useState, useEffect, useCallback } from 'react';
import { Tabs, message } from 'antd';
import {
  SafetyOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  WarningOutlined,
  ApiOutlined,
  DownloadOutlined,
  CopyOutlined
} from '@ant-design/icons';
import { useAppState } from '../../contexts/AppContext';
import api from '../../services/api';
import styles from './FirewallPage.module.css';

interface RawFirewallRule {
  '.id': string;
  chain: string;
  action: string;
  protocol?: string;
  'src-address'?: string;
  'dst-address'?: string;
  'src-port'?: string;
  'dst-port'?: string;
  'in-interface'?: string;
  'out-interface'?: string;
  'to-addresses'?: string;
  'to-ports'?: string;
  'new-routing-mark'?: string;
  'new-packet-mark'?: string;
  'passthrough'?: string;
  bytes?: string;
  packets?: string;
  disabled?: string;
  invalid?: string;
  dynamic?: string;
  comment?: string;
  list?: string;
  address?: string;
  'creation-time'?: string;
  timeout?: string;
}

interface FilterRule {
  id: string;
  chain: string;
  action: string;
  protocol?: string;
  srcAddress?: string;
  dstAddress?: string;
  srcPort?: string;
  dstPort?: string;
  inInterface?: string;
  outInterface?: string;
  bytes?: number;
  packets?: number;
  disabled: boolean;
  invalid: boolean;
  dynamic: boolean;
  comment?: string;
}

interface NatRule {
  id: string;
  chain: string;
  action: string;
  protocol?: string;
  srcAddress?: string;
  dstAddress?: string;
  srcPort?: string;
  dstPort?: string;
  toAddresses?: string;
  toPorts?: string;
  inInterface?: string;
  outInterface?: string;
  bytes?: number;
  packets?: number;
  disabled: boolean;
  invalid: boolean;
  dynamic: boolean;
  comment?: string;
}

interface MangleRule {
  id: string;
  chain: string;
  action: string;
  protocol?: string;
  srcAddress?: string;
  dstAddress?: string;
  newRoutingMark?: string;
  newPacketMark?: string;
  passthroughEnabled: boolean;
  bytes?: number;
  packets?: number;
  disabled: boolean;
  invalid: boolean;
  dynamic: boolean;
  comment?: string;
}

interface AddressList {
  id: string;
  list: string;
  address: string;
  creationTime?: string;
  timeout?: string;
  dynamic: boolean;
  disabled: boolean;
  comment?: string;
}

export const FirewallPage: React.FC = () => {
  const { router } = useAppState();
  const [activeTab, setActiveTab] = useState('filter');
  const [filterRules, setFilterRules] = useState<FilterRule[]>([]);
  const [natRules, setNatRules] = useState<NatRule[]>([]);
  const [mangleRules, setMangleRules] = useState<MangleRule[]>([]);
  const [addressLists, setAddressLists] = useState<AddressList[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const parseBytes = (bytes?: string): number => {
    if (!bytes) return 0;
    return parseInt(bytes, 10) || 0;
  };

  const parseBool = (val?: string): boolean => val === 'true';

  const transformFilterRule = (raw: RawFirewallRule): FilterRule => ({
    id: raw['.id'],
    chain: raw.chain,
    action: raw.action,
    protocol: raw.protocol,
    srcAddress: raw['src-address'],
    dstAddress: raw['dst-address'],
    srcPort: raw['src-port'],
    dstPort: raw['dst-port'],
    inInterface: raw['in-interface'],
    outInterface: raw['out-interface'],
    bytes: parseBytes(raw.bytes),
    packets: parseBytes(raw.packets),
    disabled: parseBool(raw.disabled),
    invalid: parseBool(raw.invalid),
    dynamic: parseBool(raw.dynamic),
    comment: raw.comment,
  });

  const transformNatRule = (raw: RawFirewallRule): NatRule => ({
    id: raw['.id'],
    chain: raw.chain,
    action: raw.action,
    protocol: raw.protocol,
    srcAddress: raw['src-address'],
    dstAddress: raw['dst-address'],
    srcPort: raw['src-port'],
    dstPort: raw['dst-port'],
    toAddresses: raw['to-addresses'],
    toPorts: raw['to-ports'],
    inInterface: raw['in-interface'],
    outInterface: raw['out-interface'],
    bytes: parseBytes(raw.bytes),
    packets: parseBytes(raw.packets),
    disabled: parseBool(raw.disabled),
    invalid: parseBool(raw.invalid),
    dynamic: parseBool(raw.dynamic),
    comment: raw.comment,
  });

  const transformMangleRule = (raw: RawFirewallRule): MangleRule => ({
    id: raw['.id'],
    chain: raw.chain,
    action: raw.action,
    protocol: raw.protocol,
    srcAddress: raw['src-address'],
    dstAddress: raw['dst-address'],
    newRoutingMark: raw['new-routing-mark'],
    newPacketMark: raw['new-packet-mark'],
    passthroughEnabled: parseBool(raw['passthrough']),
    bytes: parseBytes(raw.bytes),
    packets: parseBytes(raw.packets),
    disabled: parseBool(raw.disabled),
    invalid: parseBool(raw.invalid),
    dynamic: parseBool(raw.dynamic),
    comment: raw.comment,
  });

  const transformAddressList = (raw: RawFirewallRule): AddressList => ({
    id: raw['.id'],
    list: raw.list || '',
    address: raw.address || '',
    creationTime: raw['creation-time'],
    timeout: raw.timeout,
    dynamic: parseBool(raw.dynamic),
    disabled: parseBool(raw.disabled),
    comment: raw.comment,
  });

  const fetchFilterRules = useCallback(async (isInitial: boolean = false) => {
    if (!router?.ipAddress) return;
    try {
      if (isInitial) setInitialLoading(true);
      setError(null);
      const data = await api.getFirewallFilterRules(router.ipAddress);
      setFilterRules(data.map(transformFilterRule));
    } catch (err) {
      console.error('Failed to fetch filter rules:', err);
      if (isInitial) setError(err instanceof Error ? err.message : 'Failed to load filter rules');
    } finally {
      if (isInitial) setInitialLoading(false);
    }
  }, [router?.ipAddress]);

  const fetchNatRules = useCallback(async (isInitial: boolean = false) => {
    if (!router?.ipAddress) return;
    try {
      if (isInitial) setInitialLoading(true);
      setError(null);
      const data = await api.getFirewallNatRules(router.ipAddress);
      setNatRules(data.map(transformNatRule));
    } catch (err) {
      console.error('Failed to fetch NAT rules:', err);
      if (isInitial) setError(err instanceof Error ? err.message : 'Failed to load NAT rules');
    } finally {
      if (isInitial) setInitialLoading(false);
    }
  }, [router?.ipAddress]);

  const fetchMangleRules = useCallback(async (isInitial: boolean = false) => {
    if (!router?.ipAddress) return;
    try {
      if (isInitial) setInitialLoading(true);
      setError(null);
      const data = await api.getFirewallMangleRules(router.ipAddress);
      setMangleRules(data.map(transformMangleRule));
    } catch (err) {
      console.error('Failed to fetch mangle rules:', err);
      if (isInitial) setError(err instanceof Error ? err.message : 'Failed to load mangle rules');
    } finally {
      if (isInitial) setInitialLoading(false);
    }
  }, [router?.ipAddress]);

  const fetchAddressLists = useCallback(async (isInitial: boolean = false) => {
    if (!router?.ipAddress) return;
    try {
      if (isInitial) setInitialLoading(true);
      setError(null);
      const data = await api.getFirewallAddressLists(router.ipAddress);
      setAddressLists(data.map(transformAddressList));
    } catch (err) {
      console.error('Failed to fetch address lists:', err);
      if (isInitial) setError(err instanceof Error ? err.message : 'Failed to load address lists');
    } finally {
      if (isInitial) setInitialLoading(false);
    }
  }, [router?.ipAddress]);

  const fetchData = useCallback((isInitial: boolean = false) => {
    switch (activeTab) {
      case 'filter':
        fetchFilterRules(isInitial);
        break;
      case 'nat':
        fetchNatRules(isInitial);
        break;
      case 'mangle':
        fetchMangleRules(isInitial);
        break;
      case 'address-list':
        fetchAddressLists(isInitial);
        break;
    }
  }, [activeTab, fetchFilterRules, fetchNatRules, fetchMangleRules, fetchAddressLists]);

  useEffect(() => {
    fetchData(true);
    const interval = setInterval(() => fetchData(false), 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleCopyToClipboard = async (text: string, label: string) => {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        message.success(`${label} 已复制到剪贴板`);
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
        message.success(`${label} 已复制: ${text}`);
        return;
      }
    } catch (err) {
      console.error('execCommand failed:', err);
    }
    message.info(`${label}: ${text}`);
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const getCurrentTabData = () => {
    switch (activeTab) {
      case 'filter':
        return { type: '过滤规则', data: filterRules };
      case 'nat':
        return { type: 'NAT规则', data: natRules };
      case 'mangle':
        return { type: 'Mangle规则', data: mangleRules };
      case 'address-list':
        return { type: '地址列表', data: addressLists };
      default:
        return { type: '未知', data: [] };
    }
  };

  const handleExportRules = () => {
    const { type, data } = getCurrentTabData();
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `firewall-${activeTab}-${timestamp}.json`;

    const exportData = {
      exported: new Date().toISOString(),
      type,
      count: data.length,
      rules: data
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    message.success(`Exported ${data.length} ${type.toLowerCase()} to ${filename}`);
  };

  const handleCopyCurrentTab = async () => {
    const { type, data } = getCurrentTabData();

    const exportData = {
      exported: new Date().toISOString(),
      type,
      count: data.length,
      rules: data
    };

    const text = JSON.stringify(exportData, null, 2);

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        message.success(`Copied ${data.length} ${type.toLowerCase()} to clipboard`);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        message.success(`Copied ${data.length} ${type.toLowerCase()} to clipboard`);
      }
    } catch (err) {
      console.error('Failed to copy:', err);
      message.error('Failed to copy to clipboard');
    }
  };

  const renderFilterContent = () => {
    if (initialLoading && filterRules.length === 0) {
      return (
        <div className={styles.emptyState}>
          <div className={styles.spinner} />
          <p>加载防火墙配置中...</p>
        </div>
      );
    }

    if (error && filterRules.length === 0) {
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

    return (
      <div className={styles.content}>
        <div className={styles.summaryCards}>
          <div className={styles.summaryCard}>
            <ApiOutlined className={styles.summaryIcon} />
            <div className={styles.summaryContent}>
              <div className={styles.summaryValue}>{filterRules.length}</div>
              <div className={styles.summaryLabel}>总规则数</div>
            </div>
          </div>
          <div className={styles.summaryCard}>
            <CheckCircleOutlined className={styles.summaryIcon} />
            <div className={styles.summaryContent}>
              <div className={styles.summaryValue}>{filterRules.filter(r => !r.disabled).length}</div>
              <div className={styles.summaryLabel}>已启用</div>
            </div>
          </div>
          <div className={styles.summaryCard}>
            <CloseCircleOutlined className={styles.summaryIcon} />
            <div className={styles.summaryContent}>
              <div className={styles.summaryValue}>{filterRules.filter(r => r.action === 'drop' || r.action === 'reject').length}</div>
              <div className={styles.summaryLabel}>丢弃/拒绝</div>
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>过滤规则</h2>
          <div className={styles.table}>
            <div className={styles.tableHeader}>
              <div className={styles.tableCell}>链</div>
              <div className={styles.tableCell}>动作</div>
              <div className={styles.tableCell}>协议</div>
              <div className={styles.tableCell}>源地址</div>
              <div className={styles.tableCell}>目标地址</div>
              <div className={styles.tableCell}>接口</div>
              <div className={styles.tableCell}>流量</div>
              <div className={styles.tableCell}>备注</div>
            </div>
            {filterRules.map((rule) => (
              <div key={rule.id} className={`${styles.tableRow} ${rule.disabled ? styles.disabled : ''}`}>
                <div className={styles.tableCell}>
                  <span className={`${styles.badge} ${styles.badgeInfo}`}>
                    {rule.chain}
                  </span>
                </div>
                <div className={styles.tableCell}>
                  <span className={`${styles.badge} ${
                    rule.action === 'accept' ? styles.badgeSuccess :
                    rule.action === 'drop' || rule.action === 'reject' ? styles.badgeDanger :
                    styles.badgeWarning
                  }`}>
                    {rule.action}
                  </span>
                </div>
                <div className={styles.tableCell}>{rule.protocol || '—'}</div>
                <div className={styles.tableCell}>
                  {rule.srcAddress ? (
                    <span
                      className={`${styles.monospace} ${styles.copyable}`}
                      onClick={() => handleCopyToClipboard(rule.srcAddress!, '源地址')}
                      title="点击复制"
                    >
                      {rule.srcAddress}
                    </span>
                  ) : '—'}
                  {rule.srcPort && <div className={styles.portText}>:{rule.srcPort}</div>}
                </div>
                <div className={styles.tableCell}>
                  {rule.dstAddress ? (
                    <span
                      className={`${styles.monospace} ${styles.copyable}`}
                      onClick={() => handleCopyToClipboard(rule.dstAddress!, '目标地址')}
                      title="点击复制"
                    >
                      {rule.dstAddress}
                    </span>
                  ) : '—'}
                  {rule.dstPort && <div className={styles.portText}>:{rule.dstPort}</div>}
                </div>
                <div className={styles.tableCell}>
                  {rule.inInterface && <div>In: {rule.inInterface}</div>}
                  {rule.outInterface && <div>Out: {rule.outInterface}</div>}
                  {!rule.inInterface && !rule.outInterface && '—'}
                </div>
                <div className={styles.tableCell}>
                  <div>{formatBytes(rule.bytes || 0)}</div>
                  <div className={styles.textMuted}>{rule.packets || 0} pkts</div>
                </div>
                <div
                  className={`${styles.tableCell} ${rule.comment ? styles.copyable : ''}`}
                  onClick={() => rule.comment && handleCopyToClipboard(rule.comment, '备注')}
                  title={rule.comment ? '点击复制' : ''}
                >
                  <span className={styles.commentText}>{rule.comment || '—'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderNatContent = () => {
    if (initialLoading && natRules.length === 0) {
      return (
        <div className={styles.emptyState}>
          <div className={styles.spinner} />
          <p>加载NAT配置中...</p>
        </div>
      );
    }

    return (
      <div className={styles.content}>
        <div className={styles.summaryCards}>
          <div className={styles.summaryCard}>
            <ApiOutlined className={styles.summaryIcon} />
            <div className={styles.summaryContent}>
              <div className={styles.summaryValue}>{natRules.length}</div>
              <div className={styles.summaryLabel}>总规则数</div>
            </div>
          </div>
          <div className={styles.summaryCard}>
            <CheckCircleOutlined className={styles.summaryIcon} />
            <div className={styles.summaryContent}>
              <div className={styles.summaryValue}>{natRules.filter(r => r.chain === 'srcnat').length}</div>
              <div className={styles.summaryLabel}>源NAT</div>
            </div>
          </div>
          <div className={styles.summaryCard}>
            <CloseCircleOutlined className={styles.summaryIcon} />
            <div className={styles.summaryContent}>
              <div className={styles.summaryValue}>{natRules.filter(r => r.chain === 'dstnat').length}</div>
              <div className={styles.summaryLabel}>目标NAT</div>
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>NAT规则</h2>
          <div className={styles.table}>
            <div className={styles.tableHeader}>
              <div className={styles.tableCell}>链</div>
              <div className={styles.tableCell}>动作</div>
              <div className={styles.tableCell}>协议</div>
              <div className={styles.tableCell}>源地址</div>
              <div className={styles.tableCell}>目标地址</div>
              <div className={styles.tableCell}>转换</div>
              <div className={styles.tableCell}>流量</div>
              <div className={styles.tableCell}>备注</div>
            </div>
            {natRules.map((rule) => (
              <div key={rule.id} className={`${styles.tableRow} ${rule.disabled ? styles.disabled : ''}`}>
                <div className={styles.tableCell}>
                  <span className={`${styles.badge} ${styles.badgeInfo}`}>
                    {rule.chain}
                  </span>
                </div>
                <div className={styles.tableCell}>
                  <span className={`${styles.badge} ${styles.badgeSuccess}`}>
                    {rule.action}
                  </span>
                </div>
                <div className={styles.tableCell}>{rule.protocol || '—'}</div>
                <div className={styles.tableCell}>
                  {rule.srcAddress ? (
                    <span
                      className={`${styles.monospace} ${styles.copyable}`}
                      onClick={() => handleCopyToClipboard(rule.srcAddress!, '源地址')}
                      title="点击复制"
                    >
                      {rule.srcAddress}
                    </span>
                  ) : '—'}
                  {rule.srcPort && <div className={styles.portText}>:{rule.srcPort}</div>}
                </div>
                <div className={styles.tableCell}>
                  {rule.dstAddress ? (
                    <span
                      className={`${styles.monospace} ${styles.copyable}`}
                      onClick={() => handleCopyToClipboard(rule.dstAddress!, '目标地址')}
                      title="点击复制"
                    >
                      {rule.dstAddress}
                    </span>
                  ) : '—'}
                  {rule.dstPort && <div className={styles.portText}>:{rule.dstPort}</div>}
                </div>
                <div className={styles.tableCell}>
                  {rule.toAddresses && <div>→ {rule.toAddresses}</div>}
                  {rule.toPorts && <div className={styles.portText}>:{rule.toPorts}</div>}
                  {!rule.toAddresses && !rule.toPorts && '—'}
                </div>
                <div className={styles.tableCell}>
                  <div>{formatBytes(rule.bytes || 0)}</div>
                  <div className={styles.textMuted}>{rule.packets || 0} 包</div>
                </div>
                <div
                  className={`${styles.tableCell} ${rule.comment ? styles.copyable : ''}`}
                  onClick={() => rule.comment && handleCopyToClipboard(rule.comment, '备注')}
                  title={rule.comment ? '点击复制' : ''}
                >
                  <span className={styles.commentText}>{rule.comment || '—'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderMangleContent = () => {
    if (initialLoading && mangleRules.length === 0) {
      return (
        <div className={styles.emptyState}>
          <div className={styles.spinner} />
          <p>加载Mangle配置中...</p>
        </div>
      );
    }

    return (
      <div className={styles.content}>
        <div className={styles.summaryCards}>
          <div className={styles.summaryCard}>
            <ApiOutlined className={styles.summaryIcon} />
            <div className={styles.summaryContent}>
              <div className={styles.summaryValue}>{mangleRules.length}</div>
              <div className={styles.summaryLabel}>总规则数</div>
            </div>
          </div>
          <div className={styles.summaryCard}>
            <CheckCircleOutlined className={styles.summaryIcon} />
            <div className={styles.summaryContent}>
              <div className={styles.summaryValue}>{mangleRules.filter(r => !r.disabled).length}</div>
              <div className={styles.summaryLabel}>已启用</div>
            </div>
          </div>
          <div className={styles.summaryCard}>
            <CloseCircleOutlined className={styles.summaryIcon} />
            <div className={styles.summaryContent}>
              <div className={styles.summaryValue}>{mangleRules.filter(r => r.passthroughEnabled).length}</div>
              <div className={styles.summaryLabel}>穿透</div>
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Mangle规则</h2>
          <div className={styles.table}>
            <div className={styles.tableHeader}>
              <div className={styles.tableCell}>链</div>
              <div className={styles.tableCell}>动作</div>
              <div className={styles.tableCell}>协议</div>
              <div className={styles.tableCell}>源地址</div>
              <div className={styles.tableCell}>目标地址</div>
              <div className={styles.tableCell}>标记</div>
              <div className={styles.tableCell}>流量</div>
              <div className={styles.tableCell}>备注</div>
            </div>
            {mangleRules.map((rule) => (
              <div key={rule.id} className={`${styles.tableRow} ${rule.disabled ? styles.disabled : ''}`}>
                <div className={styles.tableCell}>
                  <span className={`${styles.badge} ${styles.badgeInfo}`}>
                    {rule.chain}
                  </span>
                </div>
                <div className={styles.tableCell}>
                  <span className={`${styles.badge} ${styles.badgeWarning}`}>
                    {rule.action}
                  </span>
                </div>
                <div className={styles.tableCell}>{rule.protocol || '—'}</div>
                <div className={styles.tableCell}>
                  {rule.srcAddress ? (
                    <span className={styles.monospace}>{rule.srcAddress}</span>
                  ) : '—'}
                </div>
                <div className={styles.tableCell}>
                  {rule.dstAddress ? (
                    <span className={styles.monospace}>{rule.dstAddress}</span>
                  ) : '—'}
                </div>
                <div className={styles.tableCell}>
                  {rule.newRoutingMark && <div>路由: {rule.newRoutingMark}</div>}
                  {rule.newPacketMark && <div>数据包: {rule.newPacketMark}</div>}
                  {!rule.newRoutingMark && !rule.newPacketMark && '—'}
                </div>
                <div className={styles.tableCell}>
                  <div>{formatBytes(rule.bytes || 0)}</div>
                  <div className={styles.textMuted}>{rule.packets || 0} 包</div>
                </div>
                <div className={styles.tableCell}>
                  <span className={styles.commentText}>{rule.comment || '—'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderAddressListContent = () => {
    if (initialLoading && addressLists.length === 0) {
      return (
        <div className={styles.emptyState}>
          <div className={styles.spinner} />
          <p>加载地址列表中...</p>
        </div>
      );
    }

    const listNames = [...new Set(addressLists.map(a => a.list))];

    return (
      <div className={styles.content}>
        <div className={styles.summaryCards}>
          <div className={styles.summaryCard}>
            <ApiOutlined className={styles.summaryIcon} />
            <div className={styles.summaryContent}>
              <div className={styles.summaryValue}>{addressLists.length}</div>
              <div className={styles.summaryLabel}>总条目数</div>
            </div>
          </div>
          <div className={styles.summaryCard}>
            <CheckCircleOutlined className={styles.summaryIcon} />
            <div className={styles.summaryContent}>
              <div className={styles.summaryValue}>{listNames.length}</div>
              <div className={styles.summaryLabel}>列表数</div>
            </div>
          </div>
          <div className={styles.summaryCard}>
            <CloseCircleOutlined className={styles.summaryIcon} />
            <div className={styles.summaryContent}>
              <div className={styles.summaryValue}>{addressLists.filter(a => a.dynamic).length}</div>
              <div className={styles.summaryLabel}>动态</div>
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>地址列表</h2>
          <div className={styles.table}>
            <div className={styles.tableHeader}>
              <div className={styles.tableCell}>列表</div>
              <div className={styles.tableCell}>地址</div>
              <div className={styles.tableCell}>创建时间</div>
              <div className={styles.tableCell}>超时</div>
              <div className={styles.tableCell}>类型</div>
              <div className={styles.tableCell}>备注</div>
            </div>
            {addressLists.map((item) => (
              <div key={item.id} className={`${styles.tableRow} ${item.disabled ? styles.disabled : ''}`}>
                <div className={styles.tableCell}>
                  <span className={`${styles.badge} ${styles.badgeInfo}`}>
                    {item.list}
                  </span>
                </div>
                <div className={styles.tableCell}>
                  <span
                    className={`${styles.monospace} ${styles.copyable}`}
                    onClick={() => handleCopyToClipboard(item.address, '地址')}
                    title="点击复制"
                  >
                    {item.address}
                  </span>
                </div>
                <div className={styles.tableCell}>{item.creationTime || '—'}</div>
                <div className={styles.tableCell}>{item.timeout || '—'}</div>
                <div className={styles.tableCell}>
                  <span className={`${styles.badge} ${item.dynamic ? styles.badgeWarning : styles.badgeSuccess}`}>
                    {item.dynamic ? '动态' : '静态'}
                  </span>
                </div>
                <div className={styles.tableCell}>
                  <span className={styles.commentText}>{item.comment || '—'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const tabItems = [
    { key: 'filter', label: '过滤规则', children: renderFilterContent() },
    { key: 'nat', label: 'NAT规则', children: renderNatContent() },
    { key: 'mangle', label: 'Mangle规则', children: renderMangleContent() },
    { key: 'address-list', label: '地址列表', children: renderAddressListContent() },
  ];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerContent}>
          <SafetyOutlined className={styles.headerIcon} />
          <div>
            <h1 className={styles.title}>防火墙</h1>
            <p className={styles.subtitle}>管理防火墙规则、NAT、Mangle 和地址列表</p>
          </div>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.refreshButton} onClick={() => fetchData(false)}>
            <ReloadOutlined className={styles.refreshIcon} />
            刷新
          </button>
          <button className={styles.refreshButton} onClick={handleCopyCurrentTab}>
            <CopyOutlined className={styles.refreshIcon} />
            复制
          </button>
          <button className={styles.refreshButton} onClick={handleExportRules}>
            <DownloadOutlined className={styles.refreshIcon} />
            导出
          </button>
        </div>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={tabItems}
        className={styles.tabs}
      />
    </div>
  );
};
