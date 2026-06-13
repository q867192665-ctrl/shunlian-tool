import React, { useState, useEffect, useCallback } from 'react';
import { Tabs, Modal, Input, Select, message as antMessage } from 'antd';
import {
  WarningOutlined,
  ApiOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LinkOutlined,
  CopyOutlined,
  DesktopOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { useAppState } from '../../contexts/AppContext';
import { useWebSocket } from '../../contexts/WebSocketContext';
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

const translateMikrotikError = (msg: string): string => {
  if (msg.includes('already exists')) return '同名桥接口已存在';
  if (msg.includes('not found')) return '未找到该桥接口';
  if (msg.includes('in use') || msg.includes('referenced')) return '该桥接口正在使用中，无法删除';
  if (msg.includes('invalid')) return '参数无效';
  if (msg.includes('must be')) return '参数格式错误';
  if (msg.includes('no such')) return '指定项不存在';
  return msg;
};

/** 将 MikroTik 返回的优先级值去除 0x 前缀（如有） */
const formatPriority = (val: string | undefined): string => {
  if (!val) return '';
  if (val.startsWith('0x') || val.startsWith('0X')) {
    return val.slice(2);
  }
  return val;
};

/** 将用户输入的优先级值添加 0x 前缀后发送给 MikroTik */
const toMikrotikPriority = (val: string): string => {
  if (!val) return '';
  if (val.startsWith('0x') || val.startsWith('0X')) return val;
  return '0x' + val;
};

/** 规范化 VLAN 过滤值：将 true/false 转为 yes/no */
const normalizeVlanFiltering = (val: string | undefined): string => {
  if (val === 'true') return 'yes';
  if (val === 'false') return 'no';
  return val || 'no';
};

export const BridgePage: React.FC = () => {
  const { router } = useAppState();
  const {
    bridges, bridgePorts, bridgeHosts, bridgeLoading,
    startBridgePolling, stopBridgePolling, sendWsMessage,
    interfaces,
  } = useWebSocket();
  const routerIp = router?.ipAddress || '';

  const [activeTab, setActiveTab] = useState('bridges');
  const [bridgeError, setBridgeError] = useState<string | null>(null);

  // 桥接口 CRUD 弹窗状态
  const [bridgeAddModalVisible, setBridgeAddModalVisible] = useState(false);
  const [bridgeEditModalVisible, setBridgeEditModalVisible] = useState(false);
  const [editingBridge, setEditingBridge] = useState<Bridge | null>(null);
  const [bridgeForm, setBridgeForm] = useState({
    name: '',
    'protocol-mode': 'stp',
    'vlan-filtering': 'no',
    'arp': 'enabled',
    'priority': '32768',
    'ageing-time': '',
    comment: '',
  });
  const [bridgeLoading2, setBridgeLoading2] = useState(false);

  // 桥接端口 CRUD 弹窗状态
  const [portAddModalVisible, setPortAddModalVisible] = useState(false);
  const [portEditModalVisible, setPortEditModalVisible] = useState(false);
  const [editingPort, setEditingPort] = useState<BridgePort | null>(null);
  const [portForm, setPortForm] = useState({
    interface: '',
    bridge: '',
    'pvid': '1',
    'path-cost': '',
    priority: '',
    edge: 'no',
    comment: '',
  });
  const [portLoading2, setPortLoading2] = useState(false);

  // 启动/停止 WebSocket 轮询
  useEffect(() => {
    if (routerIp) {
      startBridgePolling();
    }
    return () => {
      stopBridgePolling();
    };
  }, [routerIp, startBridgePolling, stopBridgePolling]);

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

  // ============== 桥接口 CRUD 操作 ==============

  const handleAddBridge = async () => {
    if (!routerIp) {
      antMessage.error('设备 IP 不可用');
      return;
    }
    if (!bridgeForm.name.trim()) {
      antMessage.warning('请输入桥接口名称');
      return;
    }
    setBridgeLoading2(true);
    try {
      const params: Record<string, string> = {};
      if (bridgeForm['protocol-mode']) params['protocol-mode'] = bridgeForm['protocol-mode'];
      if (bridgeForm['vlan-filtering']) params['vlan-filtering'] = bridgeForm['vlan-filtering'];
      if (bridgeForm.arp) params['arp'] = bridgeForm.arp;
      if (bridgeForm.priority) params['priority'] = toMikrotikPriority(bridgeForm.priority);
      if (bridgeForm['ageing-time']) params['ageing-time'] = bridgeForm['ageing-time'];
      if (bridgeForm.comment) params['comment'] = bridgeForm.comment;

      sendWsMessage({
        action: 'add_bridge',
        ip: routerIp,
        username: router?.username || '',
        password: router?.password || '',
        name: bridgeForm.name.trim(),
        params,
      });
      setBridgeAddModalVisible(false);
      setBridgeForm({
        name: '',
        'protocol-mode': 'stp',
        'vlan-filtering': 'no',
        'arp': 'enabled',
        'priority': '32768',
        'ageing-time': '',
        comment: '',
      });
    } catch (err) {
      antMessage.error('添加桥接口失败');
    } finally {
      setBridgeLoading2(false);
    }
  };

  const openEditBridgeModal = (bridge: Bridge) => {
    setEditingBridge(bridge);
    setBridgeForm({
      name: bridge.name || '',
      'protocol-mode': bridge['protocol-mode'] || 'stp',
      'vlan-filtering': normalizeVlanFiltering(bridge['vlan-filtering']),
      'arp': bridge.arp || 'enabled',
      'priority': formatPriority(bridge.priority) || '32768',
      'ageing-time': bridge['ageing-time'] || '',
      comment: bridge.comment || '',
    });
    setBridgeEditModalVisible(true);
  };

  const handleEditBridge = async () => {
    if (!routerIp || !editingBridge) {
      antMessage.error('参数不足');
      return;
    }
    if (!bridgeForm.name.trim()) {
      antMessage.warning('请输入桥接口名称');
      return;
    }
    setBridgeLoading2(true);
    try {
      const params: Record<string, string> = {};
      // 对比变更字段
      if (bridgeForm.name !== editingBridge.name) params['name'] = bridgeForm.name.trim();
      if (bridgeForm['protocol-mode'] !== (editingBridge['protocol-mode'] || 'stp')) params['protocol-mode'] = bridgeForm['protocol-mode'];
      if (bridgeForm['vlan-filtering'] !== normalizeVlanFiltering(editingBridge['vlan-filtering'])) params['vlan-filtering'] = bridgeForm['vlan-filtering'];
      if (bridgeForm.arp !== (editingBridge.arp || 'enabled')) params['arp'] = bridgeForm.arp;
      if (bridgeForm.priority !== formatPriority(editingBridge.priority || '32768')) params['priority'] = toMikrotikPriority(bridgeForm.priority);
      if (bridgeForm['ageing-time'] !== (editingBridge['ageing-time'] || '')) params['ageing-time'] = bridgeForm['ageing-time'];
      if (bridgeForm.comment !== (editingBridge.comment || '')) params['comment'] = bridgeForm.comment;

      if (Object.keys(params).length === 0) {
        setBridgeEditModalVisible(false);
        setBridgeLoading2(false);
        return;
      }

      sendWsMessage({
        action: 'edit_bridge',
        ip: routerIp,
        username: router?.username || '',
        password: router?.password || '',
        bridge_id: editingBridge['.id'],
        params,
      });
      setBridgeEditModalVisible(false);
    } catch (err) {
      antMessage.error('修改桥接口失败');
    } finally {
      setBridgeLoading2(false);
    }
  };

  const handleDeleteBridge = (bridge: Bridge) => {
    if (!bridge['.id']) {
      antMessage.error('无法获取桥接口ID');
      return;
    }
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除桥接口 "${bridge.name}" 吗？删除后该桥接口下的所有端口配置也将被移除。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => {
        sendWsMessage({
          action: 'delete_bridge',
          ip: routerIp,
          username: router?.username || '',
          password: router?.password || '',
          bridge_id: bridge['.id'],
        });
      },
    });
  };

  // ============== 桥接端口 CRUD 操作 ==============

  const handleAddBridgePort = async () => {
    if (!routerIp) {
      antMessage.error('设备 IP 不可用');
      return;
    }
    if (!portForm.interface.trim()) {
      antMessage.warning('请输入接口名称');
      return;
    }
    if (!portForm.bridge.trim()) {
      antMessage.warning('请输入桥接口名称');
      return;
    }
    setPortLoading2(true);
    try {
      const params: Record<string, string> = {};
      if (portForm['pvid']) params['pvid'] = portForm['pvid'];
      if (portForm['path-cost']) params['path-cost'] = portForm['path-cost'];
      if (portForm.priority) params['priority'] = toMikrotikPriority(portForm.priority);
      if (portForm.edge) params['edge'] = portForm.edge;
      if (portForm.comment) params['comment'] = portForm.comment;

      sendWsMessage({
        action: 'add_bridge_port',
        ip: routerIp,
        username: router?.username || '',
        password: router?.password || '',
        interface: portForm.interface.trim(),
        bridge: portForm.bridge.trim(),
        params,
      });
      setPortAddModalVisible(false);
      setPortForm({
        interface: '',
        bridge: '',
        'pvid': '1',
        'path-cost': '',
        priority: '',
        edge: 'no',
        comment: '',
      });
    } catch (err) {
      antMessage.error('添加桥接端口失败');
    } finally {
      setPortLoading2(false);
    }
  };

  const openEditPortModal = (port: BridgePort) => {
    setEditingPort(port);
    setPortForm({
      interface: port.interface || '',
      bridge: port.bridge || '',
      'pvid': port.pvid || '1',
      'path-cost': port['path-cost'] || '',
      priority: formatPriority(port.priority) || '',
      edge: port.edge || 'no',
      comment: port.comment || '',
    });
    setPortEditModalVisible(true);
  };

  const handleEditBridgePort = async () => {
    if (!routerIp || !editingPort) {
      antMessage.error('参数不足');
      return;
    }
    setPortLoading2(true);
    try {
      const params: Record<string, string> = {};
      if (portForm.bridge !== (editingPort.bridge || '')) params['bridge'] = portForm.bridge.trim();
      if (portForm['pvid'] !== (editingPort.pvid || '1')) params['pvid'] = portForm['pvid'];
      if (portForm['path-cost'] !== (editingPort['path-cost'] || '')) params['path-cost'] = portForm['path-cost'];
      if (portForm.priority !== formatPriority(editingPort.priority || '')) params['priority'] = toMikrotikPriority(portForm.priority);
      if (portForm.edge !== (editingPort.edge || 'no')) params['edge'] = portForm.edge;
      if (portForm.comment !== (editingPort.comment || '')) params['comment'] = portForm.comment;

      if (Object.keys(params).length === 0) {
        setPortEditModalVisible(false);
        setPortLoading2(false);
        return;
      }

      sendWsMessage({
        action: 'edit_bridge_port',
        ip: routerIp,
        username: router?.username || '',
        password: router?.password || '',
        port_id: editingPort['.id'],
        params,
      });
      setPortEditModalVisible(false);
    } catch (err) {
      antMessage.error('修改桥接端口失败');
    } finally {
      setPortLoading2(false);
    }
  };

  const handleDeleteBridgePort = (port: BridgePort) => {
    if (!port['.id']) {
      antMessage.error('无法获取端口ID');
      return;
    }
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除桥接端口 "${port.interface}" 吗？`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => {
        sendWsMessage({
          action: 'delete_bridge_port',
          ip: routerIp,
          username: router?.username || '',
          password: router?.password || '',
          port_id: port['.id'],
        });
      },
    });
  };

  // ============== 渲染逻辑 ==============

  const runningBridges = (bridges as Bridge[]).filter((b: Bridge) => b.running === 'true' && b.disabled !== 'true');
  const disabledBridges = (bridges as Bridge[]).filter((b: Bridge) => b.disabled === 'true');
  const dynamicHosts = (bridgeHosts as BridgeHost[]).filter((h: BridgeHost) => h.dynamic === 'true');

  const renderContent = () => {
    if (!routerIp) {
      return (
        <div className={styles.emptyState}>
          <WarningOutlined className={styles.errorIcon} />
          <p className={styles.errorText}>请先连接设备</p>
        </div>
      );
    }

    if (bridgeLoading && bridges.length === 0 && bridgePorts.length === 0 && bridgeHosts.length === 0) {
      return (
        <div className={styles.emptyState}>
          <div className={styles.spinner} />
          <p>加载桥接信息...</p>
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
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>桥接口列表</h2>
                <button
                  className={styles.sectionButton}
                  onClick={() => {
                    setBridgeForm({
                      name: '',
                      'protocol-mode': 'stp',
                      'vlan-filtering': 'no',
                      'arp': 'enabled',
                      'priority': '32768',
                      'ageing-time': '',
                      comment: '',
                    });
                    setBridgeAddModalVisible(true);
                  }}
                >
                  <PlusOutlined /> 添加
                </button>
              </div>
              <div className={styles.table}>
                <div className={styles.tableHeader}>
                  <div className={styles.tableCellCenter}>名称</div>
                  <div className={styles.tableCellCenter}>MAC地址</div>
                  <div className={styles.tableCellCenter}>MTU</div>
                  <div className={styles.tableCellCenter}>ARP</div>
                  <div className={styles.tableCellCenter}>协议模式</div>
                  <div className={styles.tableCellCenter}>VLAN过滤</div>
                  <div className={styles.tableCellCenter}>状态</div>
                  <div className={styles.tableCell}>操作</div>
                </div>
                {(bridges as Bridge[]).map((bridge: Bridge, index: number) => (
                  <div key={bridge['.id'] || index} className={styles.tableRow}>
                    <div className={styles.tableCellCenter}>
                      <span
                        className={`${styles.monospace} ${styles.copyable}`}
                        onClick={() => handleCopyToClipboard(bridge.name, '桥接口名')}
                        title="点击复制"
                      >
                        {bridge.name}
                      </span>
                    </div>
                    <div className={styles.tableCellCenter}>
                      <span className={styles.monospace}>{bridge['mac-address'] || '—'}</span>
                    </div>
                    <div className={styles.tableCellCenter}>
                      <span className={styles.monospace}>{bridge['actual-mtu'] || bridge.mtu || '—'}</span>
                    </div>
                    <div className={styles.tableCellCenter}>
                      {bridge.arp ? (
                        <span className={`${styles.badge} ${styles.badgeInfo}`}>
                          {bridge.arp}
                        </span>
                      ) : '—'}
                    </div>
                    <div className={styles.tableCellCenter}>
                      {bridge['protocol-mode'] ? (
                        <span className={`${styles.badge} ${styles.badgeDefault}`}>
                          {bridge['protocol-mode']}
                        </span>
                      ) : '—'}
                    </div>
                    <div className={styles.tableCellCenter}>
                      {bridge['vlan-filtering'] === 'true' || bridge['vlan-filtering'] === 'yes' ? (
                        <span className={`${styles.badge} ${styles.badgeSuccess}`}>
                          启用
                        </span>
                      ) : (
                        <span className={`${styles.badge} ${styles.badgeDefault}`}>
                          禁用
                        </span>
                      )}
                    </div>
                    <div className={styles.tableCellCenter}>
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
                    <div className={styles.tableCell}>
                      <div className={styles.actionButtons}>
                        <button
                          className={styles.actionButton}
                          onClick={() => openEditBridgeModal(bridge)}
                          title="编辑"
                        >
                          <EditOutlined />
                        </button>
                        <button
                          className={`${styles.actionButton} ${styles.deleteButton}`}
                          onClick={() => handleDeleteBridge(bridge)}
                          title="删除"
                        >
                          <DeleteOutlined />
                        </button>
                      </div>
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
                  <div className={styles.summaryValue}>{bridgePorts.length}</div>
                  <div className={styles.summaryLabel}>总端口数</div>
                </div>
              </div>
              <div className={styles.summaryCard}>
                <CheckCircleOutlined className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>{(bridgePorts as BridgePort[]).filter((p: BridgePort) => p.disabled !== 'true').length}</div>
                  <div className={styles.summaryLabel}>已启用</div>
                </div>
              </div>
              <div className={styles.summaryCard}>
                <CloseCircleOutlined className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>{(bridgePorts as BridgePort[]).filter((p: BridgePort) => p.disabled === 'true').length}</div>
                  <div className={styles.summaryLabel}>已禁用</div>
                </div>
              </div>
            </div>

            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>桥接端口</h2>
                <button
                  className={styles.sectionButton}
                  onClick={() => {
                    setPortForm({
                      interface: '',
                      bridge: '',
                      'pvid': '1',
                      'path-cost': '',
                      priority: '',
                      edge: 'no',
                      comment: '',
                    });
                    setPortAddModalVisible(true);
                  }}
                >
                  <PlusOutlined /> 添加
                </button>
              </div>
              <div className={styles.table}>
                <div className={styles.tableHeader}>
                  <div className={styles.tableCellCenter}>接口</div>
                  <div className={styles.tableCellCenter}>桥接口</div>
                  <div className={styles.tableCellCenter}>PVID</div>
                  <div className={styles.tableCellCenter}>路径开销</div>
                  <div className={styles.tableCellCenter}>优先级</div>
                  <div className={styles.tableCellCenter}>边缘端口</div>
                  <div className={styles.tableCellCenter}>状态</div>
                  <div className={styles.tableCell}>操作</div>
                </div>
                {(bridgePorts as BridgePort[]).map((port: BridgePort, index: number) => (
                  <div key={port['.id'] || index} className={styles.tableRow}>
                    <div className={styles.tableCellCenter}>
                      <span
                        className={`${styles.monospace} ${styles.copyable}`}
                        onClick={() => handleCopyToClipboard(port.interface, '接口名')}
                        title="点击复制"
                      >
                        {port.interface}
                      </span>
                    </div>
                    <div className={styles.tableCellCenter}>
                      <span className={`${styles.badge} ${styles.badgeInfo}`}>
                        {port.bridge}
                      </span>
                    </div>
                    <div className={styles.tableCellCenter}>
                      <span className={styles.monospace}>{port.pvid || '—'}</span>
                    </div>
                    <div className={styles.tableCellCenter}>
                      <span className={styles.monospace}>{port['path-cost'] || '—'}</span>
                    </div>
                    <div className={styles.tableCellCenter}>
                      <span className={styles.monospace}>{formatPriority(port.priority) || '—'}</span>
                    </div>
                    <div className={styles.tableCellCenter}>
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
                    <div className={styles.tableCellCenter}>
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
                    <div className={styles.tableCell}>
                      <div className={styles.actionButtons}>
                        <button
                          className={styles.actionButton}
                          onClick={() => openEditPortModal(port)}
                          title="编辑"
                        >
                          <EditOutlined />
                        </button>
                        <button
                          className={`${styles.actionButton} ${styles.deleteButton}`}
                          onClick={() => handleDeleteBridgePort(port)}
                          title="删除"
                        >
                          <DeleteOutlined />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {bridgePorts.length === 0 && (
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
                  <div className={styles.summaryValue}>{bridgeHosts.length}</div>
                  <div className={styles.summaryLabel}>总主机数</div>
                </div>
              </div>
              <div className={styles.summaryCard}>
                <CheckCircleOutlined className={styles.summaryIcon} />
                <div className={styles.summaryContent}>
                  <div className={styles.summaryValue}>{(bridgeHosts as BridgeHost[]).filter((h: BridgeHost) => h.dynamic !== 'true').length}</div>
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
              <div className={`${styles.table} ${styles.hostsTable}`}>
                <div className={styles.tableHeader}>
                  <div className={styles.tableCellCenter}>MAC地址</div>
                  <div className={styles.tableCellCenter}>桥接口</div>
                  <div className={styles.tableCellCenter}>接口</div>
                  <div className={styles.tableCellCenter}>VLAN ID</div>
                  <div className={styles.tableCellCenter}>年龄</div>
                  <div className={styles.tableCellCenter}>类型</div>
                </div>
                {(bridgeHosts as BridgeHost[]).map((host: BridgeHost, index: number) => (
                  <div key={host['.id'] || `${host['mac-address']}-${index}`} className={styles.tableRow}>
                    <div className={styles.tableCellCenter}>
                      <span
                        className={`${styles.monospace} ${styles.copyable}`}
                        onClick={() => handleCopyToClipboard(host['mac-address'], 'MAC地址')}
                        title="点击复制"
                      >
                        {host['mac-address']}
                      </span>
                    </div>
                    <div className={styles.tableCellCenter}>
                      <span className={`${styles.badge} ${styles.badgeInfo}`}>
                        {host.bridge || '—'}
                      </span>
                    </div>
                    <div className={styles.tableCellCenter}>
                      <span className={styles.monospace}>{host.interface || host['on-ports'] || '—'}</span>
                    </div>
                    <div className={styles.tableCellCenter}>
                      <span className={styles.monospace}>{host.vid || '—'}</span>
                    </div>
                    <div className={styles.tableCellCenter}>
                      <span className={styles.monospace}>{host.age || '—'}</span>
                    </div>
                    <div className={styles.tableCellCenter}>
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
                {bridgeHosts.length === 0 && (
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

      {/* 添加桥接口 Modal */}
      <Modal
        title="添加桥接口"
        open={bridgeAddModalVisible}
        onCancel={() => setBridgeAddModalVisible(false)}
        onOk={handleAddBridge}
        okText="添加"
        cancelText="取消"
        confirmLoading={bridgeLoading2}
        width={460}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>名称</label>
            <Input
              value={bridgeForm.name}
              onChange={e => setBridgeForm(f => ({ ...f, name: e.target.value }))}
              placeholder="输入桥接口名称"
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>协议模式</label>
            <Select
              value={bridgeForm['protocol-mode']}
              onChange={v => setBridgeForm(f => ({ ...f, 'protocol-mode': v }))}
              style={{ width: '100%' }}
            >
              <Select.Option value="none">无</Select.Option>
              <Select.Option value="stp">STP</Select.Option>
              <Select.Option value="rstp">RSTP</Select.Option>
              <Select.Option value="mstp">MSTP</Select.Option>
            </Select>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>VLAN过滤</label>
            <Select
              value={bridgeForm['vlan-filtering']}
              onChange={v => setBridgeForm(f => ({ ...f, 'vlan-filtering': v }))}
              style={{ width: '100%' }}
            >
              <Select.Option value="no">禁用</Select.Option>
              <Select.Option value="yes">启用</Select.Option>
            </Select>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>ARP</label>
            <Select
              value={bridgeForm.arp}
              onChange={v => setBridgeForm(f => ({ ...f, arp: v }))}
              style={{ width: '100%' }}
            >
              <Select.Option value="enabled">启用</Select.Option>
              <Select.Option value="disabled">禁用</Select.Option>
              <Select.Option value="local">本地</Select.Option>
              <Select.Option value="reply-only">仅回复</Select.Option>
            </Select>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>优先级</label>
            <Input
              value={bridgeForm.priority}
              onChange={e => setBridgeForm(f => ({ ...f, priority: e.target.value }))}
              placeholder="如: 32768"
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>注释</label>
            <Input
              value={bridgeForm.comment}
              onChange={e => setBridgeForm(f => ({ ...f, comment: e.target.value }))}
              placeholder="可选注释"
            />
          </div>
        </div>
      </Modal>

      {/* 编辑桥接口 Modal */}
      <Modal
        title="编辑桥接口"
        open={bridgeEditModalVisible}
        onCancel={() => setBridgeEditModalVisible(false)}
        onOk={handleEditBridge}
        okText="保存"
        cancelText="取消"
        confirmLoading={bridgeLoading2}
        width={460}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>名称</label>
            <Input
              value={bridgeForm.name}
              onChange={e => setBridgeForm(f => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>协议模式</label>
            <Select
              value={bridgeForm['protocol-mode']}
              onChange={v => setBridgeForm(f => ({ ...f, 'protocol-mode': v }))}
              style={{ width: '100%' }}
            >
              <Select.Option value="none">无</Select.Option>
              <Select.Option value="stp">STP</Select.Option>
              <Select.Option value="rstp">RSTP</Select.Option>
              <Select.Option value="mstp">MSTP</Select.Option>
            </Select>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>VLAN过滤</label>
            <Select
              value={bridgeForm['vlan-filtering']}
              onChange={v => setBridgeForm(f => ({ ...f, 'vlan-filtering': v }))}
              style={{ width: '100%' }}
            >
              <Select.Option value="no">禁用</Select.Option>
              <Select.Option value="yes">启用</Select.Option>
            </Select>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>ARP</label>
            <Select
              value={bridgeForm.arp}
              onChange={v => setBridgeForm(f => ({ ...f, arp: v }))}
              style={{ width: '100%' }}
            >
              <Select.Option value="enabled">启用</Select.Option>
              <Select.Option value="disabled">禁用</Select.Option>
              <Select.Option value="local">本地</Select.Option>
              <Select.Option value="reply-only">仅回复</Select.Option>
            </Select>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>优先级</label>
            <Input
              value={bridgeForm.priority}
              onChange={e => setBridgeForm(f => ({ ...f, priority: e.target.value }))}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>注释</label>
            <Input
              value={bridgeForm.comment}
              onChange={e => setBridgeForm(f => ({ ...f, comment: e.target.value }))}
            />
          </div>
        </div>
      </Modal>

      {/* 添加桥接端口 Modal */}
      <Modal
        title="添加桥接端口"
        open={portAddModalVisible}
        onCancel={() => setPortAddModalVisible(false)}
        onOk={handleAddBridgePort}
        okText="添加"
        cancelText="取消"
        confirmLoading={portLoading2}
        width={460}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>接口</label>
            <Select
              value={portForm.interface || undefined}
              onChange={v => setPortForm(f => ({ ...f, interface: v }))}
              style={{ width: '100%' }}
              placeholder="选择接口"
              showSearch
              filterOption={(input, option) => (option?.children as unknown as string)?.toLowerCase().includes(input.toLowerCase())}
            >
              {interfaces
                .filter(iface => {
                  const bridgeNames = new Set((bridges as Bridge[]).map(b => b.name));
                  const portedInterfaces = new Set((bridgePorts as BridgePort[]).map(p => p.interface));
                  return !bridgeNames.has(iface.name) && !portedInterfaces.has(iface.name);
                })
                .map(iface => (
                  <Select.Option key={iface.name} value={iface.name}>
                    {iface.name}
                  </Select.Option>
                ))
              }
            </Select>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>桥接口</label>
            <Select
              value={portForm.bridge}
              onChange={v => setPortForm(f => ({ ...f, bridge: v }))}
              style={{ width: '100%' }}
              placeholder="选择桥接口"
            >
              {(bridges as Bridge[]).map((b: Bridge) => (
                <Select.Option key={b.name} value={b.name}>{b.name}</Select.Option>
              ))}
            </Select>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>PVID</label>
            <Input
              value={portForm['pvid']}
              onChange={e => setPortForm(f => ({ ...f, 'pvid': e.target.value }))}
              placeholder="如: 1"
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>路径开销</label>
            <Input
              value={portForm['path-cost']}
              onChange={e => setPortForm(f => ({ ...f, 'path-cost': e.target.value }))}
              placeholder="可选"
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>优先级</label>
            <Input
              value={portForm.priority}
              onChange={e => setPortForm(f => ({ ...f, priority: e.target.value }))}
              placeholder="可选"
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>边缘端口</label>
            <Select
              value={portForm.edge}
              onChange={v => setPortForm(f => ({ ...f, edge: v }))}
              style={{ width: '100%' }}
            >
              <Select.Option value="no">否</Select.Option>
              <Select.Option value="yes">是</Select.Option>
            </Select>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>注释</label>
            <Input
              value={portForm.comment}
              onChange={e => setPortForm(f => ({ ...f, comment: e.target.value }))}
              placeholder="可选注释"
            />
          </div>
        </div>
      </Modal>

      {/* 编辑桥接端口 Modal */}
      <Modal
        title="编辑桥接端口"
        open={portEditModalVisible}
        onCancel={() => setPortEditModalVisible(false)}
        onOk={handleEditBridgePort}
        okText="保存"
        cancelText="取消"
        confirmLoading={portLoading2}
        width={460}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>接口</label>
            <Input value={portForm.interface} disabled />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>桥接口</label>
            <Select
              value={portForm.bridge}
              onChange={v => setPortForm(f => ({ ...f, bridge: v }))}
              style={{ width: '100%' }}
            >
              {(bridges as Bridge[]).map((b: Bridge) => (
                <Select.Option key={b.name} value={b.name}>{b.name}</Select.Option>
              ))}
            </Select>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>PVID</label>
            <Input
              value={portForm['pvid']}
              onChange={e => setPortForm(f => ({ ...f, 'pvid': e.target.value }))}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>路径开销</label>
            <Input
              value={portForm['path-cost']}
              onChange={e => setPortForm(f => ({ ...f, 'path-cost': e.target.value }))}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>优先级</label>
            <Input
              value={portForm.priority}
              onChange={e => setPortForm(f => ({ ...f, priority: e.target.value }))}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>边缘端口</label>
            <Select
              value={portForm.edge}
              onChange={v => setPortForm(f => ({ ...f, edge: v }))}
              style={{ width: '100%' }}
            >
              <Select.Option value="no">否</Select.Option>
              <Select.Option value="yes">是</Select.Option>
            </Select>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>注释</label>
            <Input
              value={portForm.comment}
              onChange={e => setPortForm(f => ({ ...f, comment: e.target.value }))}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};
