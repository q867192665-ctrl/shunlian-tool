import React, { useState, useEffect } from 'react';
import { ClockCircleOutlined } from '@ant-design/icons';
import styles from './Header.module.css';

const PAGE_TITLES: Record<string, string> = {
  dashboard: '仪表盘',
  bridge: '桥接口',
  'wireless-interfaces': 'Wireless',
  wireless: 'Wireless',
  network: '网络',
  firewall: '防火墙',
  routing: '路由',
  logs: 'Logs',
  'device-name': '设备信息',
};

export interface HeaderProps {
  currentPage: string;
}

export const Header: React.FC<HeaderProps> = ({ currentPage }) => {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const title = PAGE_TITLES[currentPage] || currentPage;

  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <h1 className={styles.pageTitle}>{title}</h1>
      </div>
      <div className={styles.right}>
        <div className={styles.timeDisplay}>
          <ClockCircleOutlined className={styles.timeIcon} />
          <span className={styles.timeText}>
            {currentTime.toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: false,
            })}
          </span>
        </div>
      </div>
    </header>
  );
};
