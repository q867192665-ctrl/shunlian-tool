import React, { useState, useEffect } from 'react';
import { Menu, Badge, Modal, Input, message as antMessage } from 'antd';
import {
  DashboardOutlined,
  LinkOutlined,
  WifiOutlined,
  GlobalOutlined,
  SafetyOutlined,
  ShareAltOutlined,
  FileTextOutlined,
  FolderOutlined,
  SettingOutlined,
  ClusterOutlined,
  LogoutOutlined,
  EditOutlined,
  CodeOutlined,
  ThunderboltOutlined,
  ReloadOutlined,
  UndoOutlined,
  ToolOutlined,
  ArrowDownOutlined,
} from '@ant-design/icons';
import type { RouterInfo } from '../../../types/router';
import styles from './Sidebar.module.css';

const MENU_ITEMS = [
  { key: 'dashboard', icon: <DashboardOutlined />, label: '仪表盘' },
  { key: 'bridge', icon: <LinkOutlined />, label: '桥接口' },
  { key: 'wireless', icon: <WifiOutlined />, label: '无线' },
  { key: 'network', icon: <GlobalOutlined />, label: '网络' },
  { key: 'firewall', icon: <SafetyOutlined />, label: '防火墙' },
  { key: 'routing', icon: <ShareAltOutlined />, label: '路由' },
  { key: 'logs', icon: <FileTextOutlined />, label: 'Logs' },
  { key: 'files', icon: <FolderOutlined />, label: '文件' },
  { key: 'terminal', icon: <CodeOutlined />, label: '终端' },
  {
    key: 'tools', icon: <ToolOutlined />, label: '工具',
    children: [
      { key: 'speedtest', icon: <ThunderboltOutlined />, label: '带宽测速' },
    ],
  },
  {
    key: 'system', icon: <SettingOutlined />, label: '系统',
    children: [
      { key: 'reboot', icon: <ReloadOutlined />, label: '重启' },
      { key: 'factory-reset', icon: <UndoOutlined />, label: '恢复出厂' },
      { key: 'system-downgrade', icon: <ArrowDownOutlined />, label: '系统降级' },
    ],
  },
];

export interface SidebarProps {
  router: RouterInfo;
  activeNav: string;
  onNavigate: (nav: string) => void;
  onLogout: () => void;
  onRouterNameChange?: (name: string) => void;
  onSetNetworkTargetTab?: (tab: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ router, activeNav, onNavigate, onLogout, onRouterNameChange, onSetNetworkTargetTab }) => {
  const [openKeys, setOpenKeys] = useState<string[]>(() => {
    if (activeNav === 'speedtest') return ['tools'];
    if (activeNav === 'reboot' || activeNav === 'factory-reset' || activeNav === 'system-downgrade') return ['system'];
    return [];
  });
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editName, setEditName] = useState('');
  const [editLoading, setEditLoading] = useState(false);

  useEffect(() => {
    if (activeNav === 'speedtest' && !openKeys.includes('tools')) {
      setOpenKeys(prev => [...prev, 'tools']);
    }
    if ((activeNav === 'reboot' || activeNav === 'factory-reset' || activeNav === 'system-downgrade') && !openKeys.includes('system')) {
      setOpenKeys(prev => [...prev, 'system']);
    }
  }, [activeNav]);

  const selectedKeys = [activeNav];

  const handleMenuClick = ({ key }: { key: string }) => {
    onNavigate(key);
  };

  const handleSubMenuChange = (keys: string[]) => {
    setOpenKeys(keys);
  };

  const handleNameDoubleClick = () => {
    setEditName(router.name);
    setEditModalVisible(true);
  };

  const handleIpDoubleClick = () => {
    if (onSetNetworkTargetTab) {
      onSetNetworkTargetTab('addresses');
    }
    onNavigate('network');
  };

  const handleEditOk = async () => {
    if (!editName.trim()) {
      antMessage.warning('设备名称不能为空');
      return;
    }

    setEditLoading(true);
    try {
      const resp = await fetch('/api/device/identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip: router.ipAddress,
          identity: editName.trim(),
        }),
      });
      const data = await resp.json();
      if (data.status === 'success') {
        antMessage.success('设备名称已更新');
        setEditModalVisible(false);
        if (onRouterNameChange) {
          onRouterNameChange(editName.trim());
        }
      } else {
        antMessage.error(data.message || '修改失败');
      }
    } catch (err) {
      antMessage.error('修改设备名称失败');
    } finally {
      setEditLoading(false);
    }
  };

  const handleEditCancel = () => {
    setEditModalVisible(false);
    setEditName('');
  };

  return (
    <aside className={styles.sidebar} role="navigation" aria-label="Main navigation">
      <div className={styles.logo}>
        <span className={styles.logoText}>瞬联数创调试工具</span>
      </div>

      <div className={styles.routerSection}>
        <h2 className={styles.sectionTitle}>
          <ClusterOutlined className={styles.sectionIcon} />
          已连接设备
        </h2>
        <div className={styles.routerInfo}>
          <table className={styles.routerTable}>
            <tbody>
              <tr>
                <td className={styles.routerLabel}>设备名称</td>
                <td className={styles.routerValue}>
                  <span
                    className={styles.editableText}
                    onDoubleClick={handleNameDoubleClick}
                    title="双击修改设备名称"
                  >
                    {router.name}
                  </span>
                  <button
                    className={styles.editButton}
                    onClick={handleNameDoubleClick}
                    title="修改设备名称"
                  >
                    <EditOutlined />
                  </button>
                </td>
              </tr>
              <tr>
                <td className={styles.routerLabel}>IP</td>
                <td
                  className={`${styles.routerValue} ${styles.clickable}`}
                  onDoubleClick={handleIpDoubleClick}
                  title="双击跳转到IP地址"
                >
                  {router.ipAddress}
                </td>
              </tr>
              <tr>
                <td className={styles.routerLabel}>状态</td>
                <td className={styles.routerValue}>
                  <Badge
                    status={router.status === 'online' ? 'success' : 'default'}
                    text={router.status === 'online' ? '在线' : '离线'}
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <nav className={styles.navigation}>
        <Menu
          mode="inline"
          selectedKeys={selectedKeys}
          openKeys={openKeys}
          onOpenChange={handleSubMenuChange}
          onClick={handleMenuClick}
          items={MENU_ITEMS}
          className={styles.menu}
          style={{
            background: 'transparent',
            border: 'none',
          }}
        />
      </nav>

      <div className={styles.footer}>
        <button className={styles.logoutBtn} onClick={onLogout}>
          <LogoutOutlined />
          <span>断开连接</span>
        </button>
      </div>

      <Modal
        title="修改设备名称"
        open={editModalVisible}
        onOk={handleEditOk}
        onCancel={handleEditCancel}
        confirmLoading={editLoading}
        okText="确定"
        cancelText="取消"
      >
        <Input
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          placeholder="请输入设备名称"
          onPressEnter={handleEditOk}
        />
      </Modal>
    </aside>
  );
};
