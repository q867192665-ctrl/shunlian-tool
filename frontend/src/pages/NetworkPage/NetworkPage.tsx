import React, { useState, useEffect } from 'react';
import { Tabs, message as antMessage, Modal } from 'antd';
import {
  CommentOutlined,
  WarningOutlined,
  ApiOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  EditOutlined,
  SaveOutlined,
  CloseOutlined,
  CopyOutlined,
  PoweroffOutlined,
  EyeOutlined,
  UpOutlined,
  DownOutlined,
  PlusOutlined,
  DeleteOutlined
} from '@ant-design/icons';
import { InterfaceTypeIcon } from '../../components/atoms/InterfaceTypeIcon/InterfaceTypeIcon';
import { useAppState } from '../../contexts/AppContext';
import { useWebSocket } from '../../contexts/WebSocketContext';
import api from '../../services/api';
import styles from './NetworkPage.module.css';

interface InterfaceData {
  name: string;
  type: string;
  mac_address?: string;
  mtu?: string;
  running?: boolean;
  disabled?: boolean;
  comment?: string;
  tx_byte?: number;
  rx_byte?: number;
  rx_rate?: number;
  tx_rate?: number;
  slave?: boolean;
  '.id'?: string;
}

interface IpAddressData {
  interface: string;
  address: string;
  network: string;
  disabled?: string;
  dynamic?: string;
  comment?: string;
  invalid?: string;
  '.id'?: string;
}

interface RouteData {
  'dst-address': string;
  gateway: string;
  distance: string;
  'routing-table'?: string;
  active?: string;
  static?: string;
  'gateway-status'?: string;
  interface?: string;
  scope?: string;
  'target-scope'?: string;
  comment?: string;
  '.id'?: string;
}

interface ArpData {
  address: string;
  'mac-address': string;
  interface: string;
  status?: string;
  dynamic?: string;
  comment?: string;
  dhcp?: string;
  '.id'?: string;
}

interface InterfaceCardProps {
  iface: InterfaceData;
  onToggle: (ifaceName: string, currentlyDisabled: boolean) => Promise<void>;
  onSaveComment: (ifaceName: string, comment: string) => Promise<void>;
  isEditing: boolean;
  onEditStart: () => void;
  onEditEnd: () => void;
  contextMenu: {x: number; y: number} | null;
  onContextMenuOpen: (name: string, position: {x: number; y: number}) => void;
  onContextMenuClose: () => void;
}

const InterfaceCard: React.FC<InterfaceCardProps> = ({
  iface,
  onToggle,
  onSaveComment,
  isEditing,
  onEditStart,
  onEditEnd,
  contextMenu,
  onContextMenuOpen,
  onContextMenuClose
}) => {
  const [editComment, setEditComment] = useState(iface.comment || '');
  const [isSaving, setIsSaving] = useState(false);
  const isDisabled = iface.disabled || false;
  const isRunning = iface.running || false;
  const isContextMenuOpen = contextMenu !== null;

  const status = isDisabled ? 'down' : (isRunning ? 'up' : 'down');

  const handleToggleStatus = async () => {
    setIsSaving(true);
    try {
      await onToggle(iface.name, isDisabled);
    } catch (error) {
      console.error('Failed to toggle interface status:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSaveComment(iface.name, editComment);
      onEditEnd();
    } catch (error) {
      console.error('Failed to save interface changes:', error);
      antMessage.error(`保存失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditComment(iface.comment || '');
    onEditEnd();
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();

    const menuWidth = 200;
    const menuHeight = 160;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let x = e.clientX;
    let y = e.clientY;

    if (x + menuWidth > viewportWidth) {
      x = viewportWidth - menuWidth - 10;
    }

    if (y + menuHeight > viewportHeight) {
      y = viewportHeight - menuHeight - 10;
    }

    if (x < 10) {
      x = 10;
    }

    if (y < 10) {
      y = 10;
    }

    onContextMenuOpen(iface.name, { x, y });
  };

  const handleCopyName = async () => {
    try {
      await navigator.clipboard.writeText(iface.name);
      antMessage.success(`已复制 "${iface.name}" 到剪贴板`);
      onContextMenuClose();
    } catch (err) {
      console.error('Failed to copy:', err);
      antMessage.error('复制到剪贴板失败');
    }
  };

  const handleContextEdit = () => {
    onEditStart();
    onContextMenuClose();
  };

  const handleContextToggle = async () => {
    onContextMenuClose();
    await handleToggleStatus();
  };

  const handleRefreshStats = () => {
    onContextMenuClose();
    antMessage.info('接口统计信息刷新中...');
  };

  React.useEffect(() => {
    const handleClick = () => onContextMenuClose();
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onContextMenuClose();
    };

    if (isContextMenuOpen) {
      document.addEventListener('click', handleClick);
      document.addEventListener('keydown', handleEscape);
      return () => {
        document.removeEventListener('click', handleClick);
        document.removeEventListener('keydown', handleEscape);
      };
    }
  }, [isContextMenuOpen, onContextMenuClose]);

  return (
    <div
      className={`${styles.interfaceCard} ${isEditing ? styles.interfaceCardEditing : ''}`}
      onContextMenu={handleContextMenu}
    >
      <div className={styles.interfaceHeader}>
        <div className={styles.interfaceTitle}>
          <span className={`${styles.statusIndicator} ${styles[status]}`} />
          <InterfaceTypeIcon type={iface.type} size={20} className={styles.interfaceTypeIcon} />
          <h3 className={styles.interfaceName}>{iface.name}</h3>
          <span className={styles.interfaceType}>{iface.type}</span>
        </div>
        <div className={styles.interfaceActions}>
          <button
            className={`${styles.toggleSwitch} ${!isDisabled ? styles.toggleActive : ''}`}
            onClick={handleToggleStatus}
            disabled={isSaving}
            aria-label={`切换接口 ${isDisabled ? '开启' : '关闭'}`}
          >
            <span className={styles.toggleTrack}>
              <span className={styles.toggleThumb} />
            </span>
            <span className={styles.toggleLabel}>
              {!isDisabled ? '开' : '关'}
            </span>
          </button>
          {!isEditing ? (
            <button
              className={styles.editButton}
              onClick={onEditStart}
              disabled={isSaving}
              title="编辑接口"
            >
              <EditOutlined />
            </button>
          ) : (
            <div className={styles.editActions}>
              <button
                className={styles.saveButton}
                onClick={handleSave}
                disabled={isSaving}
                title="保存更改"
              >
                <SaveOutlined />
              </button>
              <button
                className={styles.cancelButton}
                onClick={handleCancel}
                disabled={isSaving}
                title="取消"
              >
                <CloseOutlined />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className={styles.interfaceComment}>
        <CommentOutlined className={styles.commentIcon} />
        {isEditing ? (
          <input
            type="text"
            value={editComment}
            onChange={(e) => setEditComment(e.target.value)}
            className={styles.commentInput}
            placeholder="添加注释..."
            disabled={isSaving}
          />
        ) : (
          <span className={styles.commentText}>{iface.comment || '无注释'}</span>
        )}
      </div>

      {isContextMenuOpen && (
        <div
          className={styles.contextMenu}
          style={{
            left: `${contextMenu!.x}px`,
            top: `${contextMenu!.y}px`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button className={styles.contextMenuItem} onClick={handleCopyName}>
            <CopyOutlined className={styles.contextMenuIcon} />
            <span>复制名称</span>
          </button>
          <button className={styles.contextMenuItem} onClick={handleContextEdit}>
            <EditOutlined className={styles.contextMenuIcon} />
            <span>编辑接口</span>
          </button>
          <button className={styles.contextMenuItem} onClick={handleRefreshStats}>
            <ReloadOutlined className={styles.contextMenuIcon} />
            <span>刷新统计</span>
          </button>
          <div className={styles.contextMenuDivider} />
          <button className={styles.contextMenuItem} onClick={handleContextToggle}>
            <PoweroffOutlined className={styles.contextMenuIcon} />
            <span>{isDisabled ? '启用' : '禁用'}接口</span>
          </button>
          <button className={styles.contextMenuItem}>
            <EyeOutlined className={styles.contextMenuIcon} />
            <span>查看详情</span>
          </button>
        </div>
      )}
    </div>
  );
};

interface NetworkPageProps {
  targetTab?: string | null;
  onTargetTabConsumed?: () => void;
}

export const NetworkPage: React.FC<NetworkPageProps> = ({ targetTab, onTargetTabConsumed }) => {
  const { router } = useAppState();
  const { sendWsMessage, ipAddresses } = useWebSocket();
  const routerIp = router?.ipAddress || '';

  const [activeTab, setActiveTab] = useState('interfaces');
  const [interfaces, setInterfaces] = useState<InterfaceData[]>([]);
  const [routes, setRoutes] = useState<RouteData[]>([]);
  const [arpEntries, setArpEntries] = useState<ArpData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingInterfaceId, setEditingInterfaceId] = useState<string | null>(null);
  const [contextMenuState, setContextMenuState] = useState<{
    interfaceName: string;
    position: {x: number; y: number};
  } | null>(null);

  const [showIpAddModal, setShowIpAddModal] = useState(false);
  const [showIpEditModal, setShowIpEditModal] = useState(false);
  const [editingIpAddress, setEditingIpAddress] = useState<IpAddressData | null>(null);
  const [ipForm, setIpForm] = useState({
    ip: '',
    mask: '',
    interface: '',
    network: '',
    comment: ''
  });

  const maskToCidr = (mask: string): number => {
    if (!mask) return 0;
    if (/^\d+$/.test(mask)) {
      const cidr = parseInt(mask);
      return cidr >= 0 && cidr <= 32 ? cidr : 0;
    }
    const parts = mask.split('.');
    if (parts.length !== 4) return 0;
    let cidr = 0;
    for (const part of parts) {
      const num = parseInt(part);
      if (num === 255) cidr += 8;
      else if (num === 254) cidr += 7;
      else if (num === 252) cidr += 6;
      else if (num === 248) cidr += 5;
      else if (num === 240) cidr += 4;
      else if (num === 224) cidr += 3;
      else if (num === 192) cidr += 2;
      else if (num === 128) cidr += 1;
      else if (num === 0) break;
      else break;
    }
    return cidr;
  };

  const cidrToMask = (cidr: number): string => {
    if (cidr < 0 || cidr > 32) return '0.0.0.0';
    const mask: number[] = [];
    let remaining = cidr;
    for (let i = 0; i < 4; i++) {
      if (remaining >= 8) {
        mask.push(255);
        remaining -= 8;
      } else if (remaining > 0) {
        mask.push(256 - Math.pow(2, 8 - remaining));
        remaining = 0;
      } else {
        mask.push(0);
      }
    }
    return mask.join('.');
  };

  const calculateNetwork = (ip: string, mask: string): string => {
    if (!ip || !mask) return '';
    const ipParts = ip.split('.');
    if (ipParts.length !== 4) return '';
    const cidr = maskToCidr(mask);
    const maskParts = cidrToMask(cidr).split('.').map(Number);
    const networkParts = ipParts.map((part, i) => (parseInt(part) & maskParts[i]).toString());
    return networkParts.join('.');
  };

  const isValidIp = (ip: string): boolean => {
    const parts = ip.split('.');
    if (parts.length !== 4) return false;
    return parts.every(part => {
      const num = parseInt(part, 10);
      return !isNaN(num) && num >= 0 && num <= 255 && String(num) === part;
    });
  };

  const isValidMask = (mask: string): boolean => {
    if (/^\d+$/.test(mask)) {
      const cidr = parseInt(mask, 10);
      return cidr >= 0 && cidr <= 32;
    }
    const parts = mask.split('.');
    if (parts.length !== 4) return false;
    return parts.every(part => {
      const num = parseInt(part, 10);
      return !isNaN(num) && num >= 0 && num <= 255;
    });
  };

  const [showActiveInterfaces, setShowActiveInterfaces] = useState(() => {
    const saved = localStorage.getItem('network-show-active');
    return saved !== null ? JSON.parse(saved) : true;
  });
  const [showInactiveInterfaces, setShowInactiveInterfaces] = useState(() => {
    const saved = localStorage.getItem('network-show-inactive');
    return saved !== null ? JSON.parse(saved) : true;
  });

  useEffect(() => {
    localStorage.setItem('network-show-active', JSON.stringify(showActiveInterfaces));
  }, [showActiveInterfaces]);

  useEffect(() => {
    localStorage.setItem('network-show-inactive', JSON.stringify(showInactiveInterfaces));
  }, [showInactiveInterfaces]);

  useEffect(() => {
    if (targetTab) {
      setActiveTab(targetTab);
      if (onTargetTabConsumed) {
        onTargetTabConsumed();
      }
    }
  }, [targetTab, onTargetTabConsumed]);

  const fetchInterfaces = async () => {
    if (!routerIp) return;
    try {
      setLoading(true);
      setError(null);
      const data = await api.getNetworkInterfaces(routerIp);
      if (data.status === 'error') {
        setError((data as any).message || '加载接口失败');
        setInterfaces([]);
      } else {
        setInterfaces(data.interfaces || []);
      }
    } catch (err) {
      console.error('Failed to fetch interfaces:', err);
      setError(err instanceof Error ? err.message : '加载接口失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchRoutes = async () => {
    if (!routerIp) return;
    try {
      setLoading(true);
      setError(null);
      const data = await api.getRoutes(routerIp);
      setRoutes(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch routes:', err);
      setError(err instanceof Error ? err.message : '加载路由表失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchArpTable = async () => {
    if (!routerIp) return;
    try {
      setLoading(true);
      setError(null);
      const data = await api.getArpTable(routerIp);
      setArpEntries(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch ARP table:', err);
      setError(err instanceof Error ? err.message : '加载ARP表失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchData = () => {
    if (!routerIp) return;
    switch (activeTab) {
      case 'interfaces':
        fetchInterfaces();
        break;
      case 'addresses':
        setLoading(false);
        break;
      case 'routes':
        fetchRoutes();
        break;
      case 'arp':
        fetchArpTable();
        break;
    }
  };

  const handleToggleInterface = async (ifaceName: string, currentlyDisabled: boolean) => {
    if (!routerIp) return;
    try {
      const action = currentlyDisabled ? 'enable' : 'disable';
      const resp = await fetch(
        `${window.location.origin}/api/interface-toggle?ip=${encodeURIComponent(routerIp)}&interface=${encodeURIComponent(ifaceName)}&action=${action}`
      );
      const data = await resp.json();
      if (data.status === 'success') {
        antMessage.success(data.message);
        await fetchInterfaces();
      } else {
        antMessage.error(data.message || '操作失败');
      }
    } catch (err) {
      console.error('Failed to toggle interface:', err);
      antMessage.error('操作失败');
    }
  };

  const handleSaveComment = async (ifaceName: string, comment: string) => {
    if (!routerIp) return;
    try {
      const resp = await fetch(`${window.location.origin}/api/interface-comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: routerIp, interface: ifaceName, comment }),
      });
      const data = await resp.json();
      if (data.status === 'success') {
        antMessage.success(data.message);
        await fetchInterfaces();
      } else {
        antMessage.error(data.message || '保存注释失败');
      }
    } catch (err) {
      console.error('Failed to save comment:', err);
      antMessage.error('保存注释失败');
    }
  };

  const handleContextMenuOpen = (interfaceName: string, position: {x: number; y: number}) => {
    setContextMenuState({ interfaceName, position });
  };

  const handleContextMenuClose = () => {
    setContextMenuState(null);
  };

  const handleOpenIpAddModal = () => {
    setIpForm({
      ip: '',
      mask: '',
      interface: '',
      network: '',
      comment: ''
    });
    setShowIpAddModal(true);
  };

  const handleOpenIpEditModal = (addr: IpAddressData) => {
    setEditingIpAddress(addr);
    const addressParts = (addr.address || '').split('/');
    const ip = addressParts[0] || '';
    const mask = addressParts[1] || '';
    setIpForm({
      ip,
      mask,
      interface: addr.interface || '',
      network: addr.network || '',
      comment: addr.comment || ''
    });
    setShowIpEditModal(true);
  };

  const handleAddIpAddress = () => {
    if (!ipForm.ip.trim()) {
      antMessage.error('请输入IP地址');
      return;
    }
    if (!ipForm.mask.trim()) {
      antMessage.error('请输入子网掩码');
      return;
    }
    if (!isValidIp(ipForm.ip.trim())) {
      antMessage.error('IP地址格式无效，请输入正确的IP地址（如 192.168.1.1）');
      return;
    }
    if (!isValidMask(ipForm.mask.trim())) {
      antMessage.error('子网掩码格式无效，请输入正确的CIDR（如 24）或掩码（如 255.255.255.0）');
      return;
    }
    if (!ipForm.interface) {
      antMessage.error('请选择接口');
      return;
    }

    const cidr = maskToCidr(ipForm.mask);
    const address = `${ipForm.ip.trim()}/${cidr}`;
    const network = calculateNetwork(ipForm.ip, ipForm.mask);

    sendWsMessage({
      action: 'add_ip_address',
      address,
      interface: ipForm.interface,
      network,
      comment: ipForm.comment
    });
    setShowIpAddModal(false);
  };

  const handleEditIpAddress = () => {
    if (!editingIpAddress) return;
    if (!ipForm.ip.trim()) {
      antMessage.error('请输入IP地址');
      return;
    }
    if (!ipForm.mask.trim()) {
      antMessage.error('请输入子网掩码');
      return;
    }
    if (!isValidIp(ipForm.ip.trim())) {
      antMessage.error('IP地址格式无效，请输入正确的IP地址（如 192.168.1.1）');
      return;
    }
    if (!isValidMask(ipForm.mask.trim())) {
      antMessage.error('子网掩码格式无效，请输入正确的CIDR（如 24）或掩码（如 255.255.255.0）');
      return;
    }
    if (!ipForm.interface) {
      antMessage.error('请选择接口');
      return;
    }

    const cidr = maskToCidr(ipForm.mask);
    const address = `${ipForm.ip.trim()}/${cidr}`;
    const network = calculateNetwork(ipForm.ip, ipForm.mask);

    sendWsMessage({
      action: 'edit_ip_address',
      id: editingIpAddress['.id'],
      address,
      interface: ipForm.interface,
      network,
      comment: ipForm.comment
    });
    setShowIpEditModal(false);
    setEditingIpAddress(null);
  };

  const handleDeleteIpAddress = (addr: IpAddressData) => {
    if (!addr['.id']) return;
    
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除IP地址 ${addr.address} 吗？`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        sendWsMessage({
          action: 'delete_ip_address',
          id: addr['.id']
        });
      }
    });
  };

  useEffect(() => {
    fetchData();

    const interval = setInterval(fetchData, 3000);

    return () => clearInterval(interval);
  }, [activeTab, routerIp]);

  const ipMonitorStartedRef = React.useRef(false);

  useEffect(() => {
    if (activeTab === 'addresses' && routerIp && !ipMonitorStartedRef.current) {
      console.log('[NetworkPage] 启动IP地址监控');
      sendWsMessage({
        ip: routerIp,
        username: router?.username || '',
        password: router?.password || '',
        is_ip_addresses: true
      });
      ipMonitorStartedRef.current = true;
    }
  }, [activeTab, routerIp, router?.username, router?.password, sendWsMessage]);

  const activeInterfaces = interfaces.filter(i => !i.disabled && i.running);
  const inactiveInterfaces = interfaces.filter(i => i.disabled || !i.running);

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
          <div style={{ marginTop: '8px', fontSize: '11px', color: '#888' }}>
            选择上面的文本并按 Ctrl+C (Mac 上按 Cmd+C)
          </div>
        </div>
      ),
      duration: 8
    });
  };

  const renderContent = () => {
    if (!routerIp) {
      return (
        <div className={styles.emptyState}>
          <WarningOutlined className={styles.errorIcon} />
          <p className={styles.errorText}>请先连接设备</p>
        </div>
      );
    }

    if (loading && interfaces.length === 0 && ipAddresses.length === 0) {
      return (
        <div className={styles.emptyState}>
          <div className={styles.spinner} />
          <p>加载网络信息...</p>
        </div>
      );
    }

    if (error && interfaces.length === 0 && ipAddresses.length === 0) {
      return (
        <div className={styles.emptyState}>
          <WarningOutlined className={styles.errorIcon} />
          <p className={styles.errorText}>{error}</p>
          <button className={styles.retryButton} onClick={fetchData}>
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
                <ApiOutlined className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>{interfaces.length}</div>
                  <div className={styles.summaryLabel}>总接口数</div>
                </div>
              </div>
              <div className={styles.summaryCard}>
                <CheckCircleOutlined className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>{activeInterfaces.length}</div>
                  <div className={styles.summaryLabel}>活跃</div>
                </div>
              </div>
              <div className={styles.summaryCard}>
                <CloseCircleOutlined className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>{inactiveInterfaces.length}</div>
                  <div className={styles.summaryLabel}>非活跃</div>
                </div>
              </div>
            </div>

            {activeInterfaces.length > 0 && (
              <div className={styles.section}>
                <h2
                  className={`${styles.sectionTitle} ${styles.collapsible}`}
                  onClick={() => setShowActiveInterfaces(!showActiveInterfaces)}
                >
                  <span className={styles.sectionTitleContent}>
                    活跃接口
                    <span className={styles.sectionCount}>{activeInterfaces.length}</span>
                  </span>
                  <button
                    type="button"
                    className={styles.collapseButton}
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowActiveInterfaces(!showActiveInterfaces);
                    }}
                    aria-label={showActiveInterfaces ? '折叠活跃接口' : '展开活跃接口'}
                  >
                    {showActiveInterfaces ? <UpOutlined /> : <DownOutlined />}
                  </button>
                </h2>
                {showActiveInterfaces && (
                  <div className={styles.interfaceGrid}>
                    {activeInterfaces.map((iface) => (
                      <InterfaceCard
                        key={iface.name}
                        iface={iface}
                        onToggle={handleToggleInterface}
                        onSaveComment={handleSaveComment}
                        isEditing={editingInterfaceId === iface.name}
                        onEditStart={() => setEditingInterfaceId(iface.name)}
                        onEditEnd={() => setEditingInterfaceId(null)}
                        contextMenu={contextMenuState?.interfaceName === iface.name ? contextMenuState.position : null}
                        onContextMenuOpen={handleContextMenuOpen}
                        onContextMenuClose={handleContextMenuClose}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {inactiveInterfaces.length > 0 && (
              <div className={styles.section}>
                <h2
                  className={`${styles.sectionTitle} ${styles.collapsible}`}
                  onClick={() => setShowInactiveInterfaces(!showInactiveInterfaces)}
                >
                  <span className={styles.sectionTitleContent}>
                    非活跃接口
                    <span className={styles.sectionCount}>{inactiveInterfaces.length}</span>
                  </span>
                  <button
                    type="button"
                    className={styles.collapseButton}
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowInactiveInterfaces(!showInactiveInterfaces);
                    }}
                    aria-label={showInactiveInterfaces ? '折叠非活跃接口' : '展开非活跃接口'}
                  >
                    {showInactiveInterfaces ? <UpOutlined /> : <DownOutlined />}
                  </button>
                </h2>
                {showInactiveInterfaces && (
                  <div className={styles.interfaceGrid}>
                    {inactiveInterfaces.map((iface) => (
                      <InterfaceCard
                        key={iface.name}
                        iface={iface}
                        onToggle={handleToggleInterface}
                        onSaveComment={handleSaveComment}
                        isEditing={editingInterfaceId === iface.name}
                        onEditStart={() => setEditingInterfaceId(iface.name)}
                        onEditEnd={() => setEditingInterfaceId(null)}
                        contextMenu={contextMenuState?.interfaceName === iface.name ? contextMenuState.position : null}
                        onContextMenuOpen={handleContextMenuOpen}
                        onContextMenuClose={handleContextMenuClose}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );

      case 'addresses':
        return (
          <div className={styles.content}>
            <div className={styles.summaryCards}>
              <div className={styles.summaryCard}>
                <ApiOutlined className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>{ipAddresses.length}</div>
                  <div className={styles.summaryLabel}>总地址数</div>
                </div>
              </div>
              <div className={styles.summaryCard}>
                <CheckCircleOutlined className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>{ipAddresses.filter(a => a.dynamic !== 'true').length}</div>
                  <div className={styles.summaryLabel}>静态</div>
                </div>
              </div>
              <div className={styles.summaryCard}>
                <CloseCircleOutlined className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>{ipAddresses.filter(a => a.dynamic === 'true').length}</div>
                  <div className={styles.summaryLabel}>动态</div>
                </div>
              </div>
            </div>

            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>IP 地址</h2>
                <button className={styles.addButton} onClick={handleOpenIpAddModal}>
                  <PlusOutlined /> 添加IP
                </button>
              </div>
              <div className={styles.table}>
                <div className={styles.tableHeader}>
                  <div className={styles.tableCell}>地址</div>
                  <div className={styles.tableCell}>网络</div>
                  <div className={styles.tableCell}>接口</div>
                  <div className={styles.tableCell}>类型</div>
                  <div className={styles.tableCell}>注释</div>
                  <div className={styles.tableCell}>操作</div>
                </div>
                {ipAddresses.map((addr, index) => {
                  const isDynamic = addr.dynamic === 'true';
                  return (
                    <div key={addr['.id'] || index} className={styles.tableRow}>
                      <div className={styles.tableCell}>
                        <span
                          className={`${styles.monospace} ${styles.copyable}`}
                          onClick={() => handleCopyToClipboard(addr.address, '地址')}
                          title="点击复制"
                        >
                          {addr.address}
                        </span>
                      </div>
                      <div className={styles.tableCell}>
                        <span
                          className={`${styles.monospace} ${styles.copyable}`}
                          onClick={() => handleCopyToClipboard(addr.network, '网络')}
                          title="点击复制"
                        >
                          {addr.network}
                        </span>
                      </div>
                      <div
                        className={`${styles.tableCell} ${styles.copyable}`}
                        onClick={() => handleCopyToClipboard(addr.interface, '接口')}
                        title="点击复制"
                      >
                        {addr.interface}
                      </div>
                      <div className={styles.tableCell}>
                        {isDynamic ? (
                          <span className={`${styles.badge} ${styles.badgeWarning}`}>
                            <ReloadOutlined className={styles.badgeIcon} />
                            动态
                          </span>
                        ) : (
                          <span className={`${styles.badge} ${styles.badgeInfo}`}>
                            静态
                          </span>
                        )}
                      </div>
                      <div
                        className={`${styles.tableCell} ${addr.comment ? styles.copyable : ''}`}
                        onClick={() => addr.comment && handleCopyToClipboard(addr.comment, '注释')}
                        title={addr.comment ? '点击复制' : ''}
                      >
                        <span className={styles.commentText}>{addr.comment || '—'}</span>
                      </div>
                      <div className={styles.tableCell}>
                        <div className={styles.actionButtons}>
                          {!isDynamic && (
                            <>
                              <button
                                className={styles.actionButton}
                                onClick={() => handleOpenIpEditModal(addr)}
                                title="编辑"
                              >
                                <EditOutlined />
                              </button>
                              <button
                                className={`${styles.actionButton} ${styles.deleteButton}`}
                                onClick={() => handleDeleteIpAddress(addr)}
                                title="删除"
                              >
                                <DeleteOutlined />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );

      case 'routes':
        return (
          <div className={styles.content}>
            <div className={styles.summaryCards}>
              <div className={styles.summaryCard}>
                <ApiOutlined className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>{routes.length}</div>
                  <div className={styles.summaryLabel}>总路由数</div>
                </div>
              </div>
              <div className={styles.summaryCard}>
                <CheckCircleOutlined className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>{routes.filter(r => r.active === 'true').length}</div>
                  <div className={styles.summaryLabel}>活跃</div>
                </div>
              </div>
              <div className={styles.summaryCard}>
                <CloseCircleOutlined className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>{routes.filter(r => r.static === 'true').length}</div>
                  <div className={styles.summaryLabel}>静态</div>
                </div>
              </div>
            </div>

            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>路由表</h2>
              <div className={styles.table}>
                <div className={styles.tableHeader}>
                  <div className={styles.tableCell}>目标</div>
                  <div className={styles.tableCell}>网关</div>
                  <div className={styles.tableCell}>接口</div>
                  <div className={styles.tableCell}>距离</div>
                  <div className={styles.tableCell}>状态</div>
                  <div className={styles.tableCell}>类型</div>
                  <div className={styles.tableCell}>注释</div>
                </div>
                {routes.map((route, index) => (
                  <div key={route['.id'] || index} className={styles.tableRow}>
                    <div className={styles.tableCell}>
                      <span
                        className={`${styles.monospace} ${styles.copyable}`}
                        onClick={() => handleCopyToClipboard(route['dst-address'], '目标地址')}
                        title="点击复制"
                      >
                        {route['dst-address']}
                      </span>
                    </div>
                    <div className={styles.tableCell}>
                      <span
                        className={`${styles.monospace} ${styles.copyable}`}
                        onClick={() => handleCopyToClipboard(route.gateway, '网关')}
                        title="点击复制"
                      >
                        {route.gateway}
                      </span>
                      {route['gateway-status']?.includes('reachable') && (
                        <CheckCircleOutlined className={styles.statusIconGood} />
                      )}
                      {route['gateway-status']?.includes('unreachable') && (
                        <CloseCircleOutlined className={styles.statusIconBad} />
                      )}
                    </div>
                    <div
                      className={`${styles.tableCell} ${route.interface ? styles.copyable : ''}`}
                      onClick={() => route.interface && handleCopyToClipboard(route.interface, '接口')}
                      title={route.interface ? '点击复制' : ''}
                    >
                      {route.interface || '—'}
                    </div>
                    <div className={styles.tableCell}>{route.distance}</div>
                    <div className={styles.tableCell}>
                      <span className={`${styles.badge} ${route.active === 'true' ? styles.badgeSuccess : styles.badgeDefault}`}>
                        {route.active === 'true' ? '活跃' : '非活跃'}
                      </span>
                    </div>
                    <div className={styles.tableCell}>
                      <span className={`${styles.badge} ${route.static === 'true' ? styles.badgeInfo : styles.badgeWarning}`}>
                        {route.static === 'true' ? '静态' : '动态'}
                      </span>
                    </div>
                    <div
                      className={`${styles.tableCell} ${route.comment ? styles.copyable : ''}`}
                      onClick={() => route.comment && handleCopyToClipboard(route.comment, '注释')}
                      title={route.comment ? '点击复制' : ''}
                    >
                      <span className={styles.commentText}>{route.comment || '—'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );

      case 'arp':
        return (
          <div className={styles.content}>
            <div className={styles.summaryCards}>
              <div className={styles.summaryCard}>
                <ApiOutlined className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>{arpEntries.length}</div>
                  <div className={styles.summaryLabel}>总条目数</div>
                </div>
              </div>
              <div className={styles.summaryCard}>
                <CheckCircleOutlined className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>{arpEntries.filter(a => a.status === 'reachable').length}</div>
                  <div className={styles.summaryLabel}>可达</div>
                </div>
              </div>
              <div className={styles.summaryCard}>
                <CloseCircleOutlined className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>{arpEntries.filter(a => a.dynamic === 'true').length}</div>
                  <div className={styles.summaryLabel}>动态</div>
                </div>
              </div>
            </div>

            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>ARP 缓存</h2>
              <div className={styles.table}>
                <div className={styles.tableHeader}>
                  <div className={styles.tableCell}>IP 地址</div>
                  <div className={styles.tableCell}>MAC 地址</div>
                  <div className={styles.tableCell}>接口</div>
                  <div className={styles.tableCell}>状态</div>
                  <div className={styles.tableCell}>类型</div>
                  <div className={styles.tableCell}>DHCP</div>
                  <div className={styles.tableCell}>注释</div>
                </div>
                {arpEntries.map((entry, index) => (
                  <div key={entry['.id'] || index} className={styles.tableRow}>
                    <div className={styles.tableCell}>
                      <span
                        className={`${styles.monospace} ${styles.copyable}`}
                        onClick={() => handleCopyToClipboard(entry.address, 'IP地址')}
                        title="点击复制"
                      >
                        {entry.address}
                      </span>
                    </div>
                    <div className={styles.tableCell}>
                      <span
                        className={`${styles.monospace} ${styles.copyable}`}
                        onClick={() => handleCopyToClipboard(entry['mac-address'], 'MAC地址')}
                        title="点击复制"
                      >
                        {entry['mac-address']}
                      </span>
                    </div>
                    <div
                      className={`${styles.tableCell} ${styles.copyable}`}
                      onClick={() => handleCopyToClipboard(entry.interface, '接口')}
                      title="点击复制"
                    >
                      {entry.interface}
                    </div>
                    <div className={styles.tableCell}>
                      <span className={`${styles.badge} ${
                        entry.status === 'reachable' ? styles.badgeSuccess :
                        entry.status === 'stale' ? styles.badgeWarning :
                        styles.badgeDefault
                      }`}>
                        {entry.status || '—'}
                      </span>
                    </div>
                    <div className={styles.tableCell}>
                      <span className={`${styles.badge} ${entry.dynamic === 'true' ? styles.badgeWarning : styles.badgeInfo}`}>
                        {entry.dynamic === 'true' ? '动态' : '静态'}
                      </span>
                    </div>
                    <div className={styles.tableCell}>
                      {entry.dhcp === 'true' ? (
                        <CheckCircleOutlined className={styles.statusIconGood} />
                      ) : (
                        <span className={styles.textMuted}>—</span>
                      )}
                    </div>
                    <div
                      className={`${styles.tableCell} ${entry.comment ? styles.copyable : ''}`}
                      onClick={() => entry.comment && handleCopyToClipboard(entry.comment, '注释')}
                      title={entry.comment ? '点击复制' : ''}
                    >
                      <span className={styles.commentText}>{entry.comment || '—'}</span>
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
          <h1 className={styles.title}>网络</h1>
          <p className={styles.subtitle}>管理网络接口、IP地址、路由和ARP表</p>
        </div>
        <button className={styles.refreshButton} onClick={fetchData} disabled={!routerIp}>
          <ReloadOutlined className={styles.refreshIcon} />
          刷新
        </button>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'interfaces',
            label: '接口',
            children: renderContent(),
          },
          {
            key: 'addresses',
            label: 'IP 地址',
            children: renderContent(),
          },
          {
            key: 'routes',
            label: '路由表',
            children: renderContent(),
          },
          {
            key: 'arp',
            label: 'ARP 表',
            children: renderContent(),
          },
        ]}
      />

      {showIpAddModal && (
        <div className={styles.modalOverlay} onClick={() => setShowIpAddModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>
                <PlusOutlined /> 添加IP地址
              </h3>
              <button className={styles.modalClose} onClick={() => setShowIpAddModal(false)}>
                <CloseOutlined />
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.formRow}>
                <label className={styles.formLabel}>IP地址</label>
                <div className={styles.ipMaskRow}>
                  <input
                    type="text"
                    className={`${styles.formInput} ${styles.ipInput}`}
                    placeholder="例如: 192.168.1.1"
                    value={ipForm.ip}
                    onChange={(e) => {
                      const newIp = e.target.value;
                      const newNetwork = calculateNetwork(newIp, ipForm.mask);
                      setIpForm({ ...ipForm, ip: newIp, network: newNetwork });
                    }}
                  />
                  <span className={styles.separator}>/</span>
                  <input
                    type="text"
                    className={`${styles.formInput} ${styles.maskInput}`}
                    placeholder="24 或 255.255.255.0"
                    value={ipForm.mask}
                    onChange={(e) => {
                      const newMask = e.target.value;
                      const newNetwork = calculateNetwork(ipForm.ip, newMask);
                      setIpForm({ ...ipForm, mask: newMask, network: newNetwork });
                    }}
                  />
                </div>
              </div>
              <div className={styles.formRow}>
                <label className={styles.formLabel}>接口</label>
                <select
                  className={styles.formSelect}
                  value={ipForm.interface}
                  onChange={(e) => setIpForm({ ...ipForm, interface: e.target.value })}
                >
                  <option value="">选择接口</option>
                  {interfaces.map((iface) => (
                    <option key={iface.name} value={iface.name}>{iface.name}</option>
                  ))}
                </select>
              </div>
              <div className={styles.formRow}>
                <label className={styles.formLabel}>网络号</label>
                <input
                  type="text"
                  className={styles.formInput}
                  placeholder="自动计算"
                  value={ipForm.network}
                  readOnly
                />
              </div>
              <div className={styles.formRow}>
                <label className={styles.formLabel}>注释</label>
                <input
                  type="text"
                  className={styles.formInput}
                  placeholder="添加注释..."
                  value={ipForm.comment}
                  onChange={(e) => setIpForm({ ...ipForm, comment: e.target.value })}
                />
              </div>
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.cancelButton} onClick={() => setShowIpAddModal(false)}>
                取消
              </button>
              <button className={styles.confirmButton} onClick={handleAddIpAddress}>
                添加
              </button>
            </div>
          </div>
        </div>
      )}

      {showIpEditModal && editingIpAddress && (
        <div className={styles.modalOverlay} onClick={() => setShowIpEditModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>
                <EditOutlined /> 编辑IP地址
              </h3>
              <button className={styles.modalClose} onClick={() => setShowIpEditModal(false)}>
                <CloseOutlined />
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.formRow}>
                <label className={styles.formLabel}>IP地址</label>
                <div className={styles.ipMaskRow}>
                  <input
                    type="text"
                    className={`${styles.formInput} ${styles.ipInput}`}
                    placeholder="例如: 192.168.1.1"
                    value={ipForm.ip}
                    onChange={(e) => {
                      const newIp = e.target.value;
                      const newNetwork = calculateNetwork(newIp, ipForm.mask);
                      setIpForm({ ...ipForm, ip: newIp, network: newNetwork });
                    }}
                  />
                  <span className={styles.separator}>/</span>
                  <input
                    type="text"
                    className={`${styles.formInput} ${styles.maskInput}`}
                    placeholder="24 或 255.255.255.0"
                    value={ipForm.mask}
                    onChange={(e) => {
                      const newMask = e.target.value;
                      const newNetwork = calculateNetwork(ipForm.ip, newMask);
                      setIpForm({ ...ipForm, mask: newMask, network: newNetwork });
                    }}
                  />
                </div>
              </div>
              <div className={styles.formRow}>
                <label className={styles.formLabel}>接口</label>
                <select
                  className={styles.formSelect}
                  value={ipForm.interface}
                  onChange={(e) => setIpForm({ ...ipForm, interface: e.target.value })}
                >
                  <option value="">选择接口</option>
                  {interfaces.map((iface) => (
                    <option key={iface.name} value={iface.name}>{iface.name}</option>
                  ))}
                </select>
              </div>
              <div className={styles.formRow}>
                <label className={styles.formLabel}>网络号</label>
                <input
                  type="text"
                  className={styles.formInput}
                  placeholder="自动计算"
                  value={ipForm.network}
                  readOnly
                />
              </div>
              <div className={styles.formRow}>
                <label className={styles.formLabel}>注释</label>
                <input
                  type="text"
                  className={styles.formInput}
                  placeholder="添加注释..."
                  value={ipForm.comment}
                  onChange={(e) => setIpForm({ ...ipForm, comment: e.target.value })}
                />
              </div>
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.cancelButton} onClick={() => setShowIpEditModal(false)}>
                取消
              </button>
              <button className={styles.confirmButton} onClick={handleEditIpAddress}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
