import React, { useState, useEffect } from 'react';
import { useAppState } from '../../contexts/AppContext';
import styles from './SecurityProfilePage.module.css';

interface SecurityProfile {
  name: string;
  mode?: string;
  'authentication-types'?: string;
  'unicast-ciphers'?: string;
  'group-ciphers'?: string;
}

export const SecurityProfilePage: React.FC = () => {
  const { router } = useAppState();
  const [profiles, setProfiles] = useState<SecurityProfile[]>([]);

  const fetchProfiles = async () => {
    try {
      const resp = await fetch('/api/device/security-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: router?.ipAddress || '' }),
      });
      const data = await resp.json();
      if (data.status === 'success' && data.security_profiles) {
        setProfiles(data.security_profiles);
      }
    } catch (e) {
      console.error('获取加密配置失败:', e);
    }
  };

  useEffect(() => {
    fetchProfiles();
    const interval = setInterval(fetchProfiles, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>无线加密配置</h2>
      <table className={styles.table}>
        <thead>
          <tr><th>名称</th><th>模式</th><th>认证类型</th><th>单播加密</th><th>组播加密</th></tr>
        </thead>
        <tbody>
          {profiles.map((p, i) => (
            <tr key={p.name || i}>
              <td>{p.name}</td>
              <td>{p.mode || '--'}</td>
              <td>{p['authentication-types'] || '--'}</td>
              <td>{p['unicast-ciphers'] || '--'}</td>
              <td>{p['group-ciphers'] || '--'}</td>
            </tr>
          ))}
          {profiles.length === 0 && (
            <tr><td colSpan={5} style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-secondary)' }}>加载中...</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
