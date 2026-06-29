import React, { useState, useEffect } from 'react';
import { ClockCircleOutlined } from '@ant-design/icons';
import styles from './Header.module.css';

const PAGE_TITLES: Record<string, string> = {
  dashboard: '仪表盘',
  bridge: '桥接口',
  'wireless-interfaces': '无线',
  wireless: '无线',
  network: '网络',
  firewall: '防火墙',
  routing: '路由',
  logs: '日志',
  files: '文件',
  terminal: '终端',
  tools: '工具',
  speedtest: '带宽测速',
  system: '系统',
  reboot: '重启',
  'factory-reset': '恢复出厂',
  'system-downgrade': '系统降级',
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
