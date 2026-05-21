import React, { useState, useEffect } from 'react';
import { useAppState } from '../../contexts/AppContext';
import styles from './InterfacePage.module.css';

interface BackendInterface {
  name: string;
  type: string;
  mac_address: string;
  mtu: string;
  running: boolean;
  disabled: boolean;
  comment: string;
  tx_byte: number;
  rx_byte: number;
  slave: boolean;
}

export const InterfacePage: React.FC = () => {
  const { router } = useAppState();
  const [interfaces, setInterfaces] = useState<BackendInterface[]>([]);

  const fetchInterfaces = async () => {
    try {
      const resp = await fetch(`/api/interfaces?ip=${encodeURIComponent(router?.ipAddress || '')}`);
      const data = await resp.json();
      if (data.status === 'success' && data.interfaces) {
        setInterfaces(data.interfaces);
      }
    } catch (e) {
      console.error('获取接口列表失败:', e);
    }
  };

  useEffect(() => {
    fetchInterfaces();
    const interval = setInterval(fetchInterfaces, 3000);
    return () => clearInterval(interval);
  }, []);

  const formatBytes = (b: number) => {
    if (!b || b === 0) return '0 B';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
    return `${(b / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const isActive = (iface: BackendInterface) => {
    return iface.running && !iface.disabled;
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>接口管理</h2>
      </div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>名称</th>
            <th>类型</th>
            <th>状态</th>
            <th>MAC 地址</th>
            <th>MTU</th>
            <th>接收</th>
            <th>发送</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          {interfaces.map((iface) => {
            const active = isActive(iface);
            return (
              <tr key={iface.name}>
                <td className={styles.mono}>{iface.name}</td>
                <td>{iface.type}</td>
                <td className={active ? styles.statusUp : styles.statusDown}>
                  {iface.disabled ? '已禁用' : iface.running ? '运行中' : '已断开'}
                </td>
                <td className={styles.mono}>{iface.mac_address || '--'}</td>
                <td>{iface.mtu}</td>
                <td className={styles.mono}>{formatBytes(iface.rx_byte)}</td>
                <td className={styles.mono}>{formatBytes(iface.tx_byte)}</td>
                <td>{iface.comment || '--'}</td>
              </tr>
            );
          })}
          {interfaces.length === 0 && (
            <tr><td colSpan={8} style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-secondary)' }}>正在加载接口列表...</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
