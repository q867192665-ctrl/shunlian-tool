import React, { useState, useEffect } from 'react';
import { useAppState } from '../../contexts/AppContext';
import type { RouteInfo } from '../../types/api';
import styles from './RoutePage.module.css';

export const RoutePage: React.FC = () => {
  const { router } = useAppState();
  const [routes, setRoutes] = useState<RouteInfo[]>([]);

  useEffect(() => {
    if (!router?.ipAddress) return;
    const fetchRoutes = async () => {
      try {
        const resp = await fetch('/api/device/routes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ip: router?.ipAddress || '', username: '', password: '' }),
        });
        if (resp.ok) setRoutes(await resp.json());
      } catch (e) { console.error(e); }
    };
    fetchRoutes();
    const interval = setInterval(fetchRoutes, 5000);
    return () => clearInterval(interval);
  }, [router?.ipAddress]);

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>路由表</h2>
      <table className={styles.table}>
        <thead><tr><th>目标网络</th><th>网关</th><th>距离</th><th>路由表</th><th>活跃</th></tr></thead>
        <tbody>
          {routes.map((r, i) => (
            <tr key={r['.id'] || i}>
              <td className={styles.mono}>{r['dst-address']}</td>
              <td className={styles.mono}>{r.gateway}</td>
              <td>{r.distance}</td>
              <td>{r['routing-table'] || 'main'}</td>
              <td>{r.active === 'true' ? '是' : '否'}</td>
            </tr>
          ))}
          {routes.length === 0 && (
            <tr><td colSpan={5} style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-secondary)' }}>加载中...</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
