import React, { useState, useEffect } from 'react';
import { useAppState } from '../../contexts/AppContext';
import styles from './WirelessClientPage.module.css';

interface WirelessClient {
  interface: string;
  'mac-address': string;
  signal?: string;
  'tx-rate'?: string;
  'rx-rate'?: string;
  uptime?: string;
}

export const WirelessClientPage: React.FC = () => {
  const { router } = useAppState();
  const [clients, setClients] = useState<WirelessClient[]>([]);

  const fetchClients = async () => {
    try {
      const resp = await fetch('/api/device/wireless-clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: router?.ipAddress || '' }),
      });
      const data = await resp.json();
      if (data.status === 'success' && data.clients) {
        setClients(data.clients);
      }
    } catch (e) {
      console.error('获取终端列表失败:', e);
    }
  };

  useEffect(() => {
    fetchClients();
    const interval = setInterval(fetchClients, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>终端列表</h2>
      <table className={styles.table}>
        <thead>
          <tr><th>接口</th><th>MAC 地址</th><th>信号</th><th>发送速率</th><th>接收速率</th><th>在线时长</th></tr>
        </thead>
        <tbody>
          {clients.map((c, i) => (
            <tr key={`${c['mac-address']}-${i}`}>
              <td>{c.interface}</td>
              <td style={{ fontFamily: 'var(--font-family-mono)' }}>{c['mac-address']}</td>
              <td>{c.signal || '--'}</td>
              <td>{c['tx-rate'] || '--'}</td>
              <td>{c['rx-rate'] || '--'}</td>
              <td>{c.uptime || '--'}</td>
            </tr>
          ))}
          {clients.length === 0 && (
            <tr><td colSpan={6} style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-secondary)' }}>暂无连接的终端</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
