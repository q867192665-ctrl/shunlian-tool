import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Progress, Badge, message as antMessage } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  GlobalOutlined,
  HddOutlined,
} from '@ant-design/icons';
import { useAppState } from '../../contexts/AppContext';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { useTrafficMonitor } from '../../hooks/useTrafficMonitor';
import { TrafficIndicator } from '../../components/atoms/TrafficIndicator/TrafficIndicator';
import { InterfaceTypeIcon } from '../../components/atoms/InterfaceTypeIcon/InterfaceTypeIcon';
import styles from './DashboardPage.module.css';

interface StatCardProps {
  title: string;
  value: string;
  unit?: string;
  status?: 'good' | 'warning' | 'critical';
  icon: React.ReactNode;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, unit, status = 'good', icon }) => {
  return (
    <div className={`${styles.statCard} ${styles[status]}`}>
      <div className={styles.statIconContainer}>{icon}</div>
      <div className={styles.statContent}>
        <h3 className={styles.statTitle}>{title}</h3>
        <div className={styles.statValue}>
          {value}
          {unit && <span className={styles.statUnit}>{unit}</span>}
        </div>
      </div>
    </div>
  );
};

interface ProgressStatCardProps {
  title: string;
  percentage: number;
  details: string;
  icon: React.ReactNode;
}

const ProgressStatCard: React.FC<ProgressStatCardProps> = ({ title, percentage, details, icon }) => {
  const getStrokeColor = (percent: number): string => {
    if (percent < 60) return '#10b981';
    if (percent < 80) return '#f59e0b';
    return '#ef4444';
  };

  return (
    <div className={styles.statCard}>
      <div className={styles.progressContainer}>
        <Progress
          type="circle"
          percent={Math.round(percentage)}
          strokeColor={getStrokeColor(percentage)}
          trailColor="var(--color-bg-tertiary)"
          strokeWidth={8}
          size={100}
          format={(percent) => (
            <div className={styles.progressText}>
              <div className={styles.progressPercent}>{percent}%</div>
              <div className={styles.progressIconInner}>{icon}</div>
            </div>
          )}
        />
      </div>
      <div className={styles.progressInfo}>
        <h3 className={styles.statTitle}>{title}</h3>
        <div className={styles.progressDetails}>{details}</div>
      </div>
    </div>
  );
};

interface InterfaceItemProps {
  name: string;
  type: string;
  status: 'up' | 'down';
  rx: string;
  tx: string;
  rxRate: number;
  txRate: number;
  ipAddress?: string;
  macAddress?: string;
}

const InterfaceItem: React.FC<InterfaceItemProps> = ({ name, type, status, rx, tx, rxRate, txRate, ipAddress, macAddress }) => {
  const isActive = status === 'up';

  const handleCopyMac = async () => {
    if (!macAddress) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(macAddress);
        antMessage.success('MAC地址 已复制到剪贴板');
        return;
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = macAddress;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        antMessage.success('MAC地址 已复制到剪贴板');
      }
    } catch (err) {
      console.error('复制失败:', err);
    }
  };

  return (
    <div className={styles.interfaceItem}>
      <div className={styles.interfaceStatus}>
        <div className={styles.interfaceInfo}>
          <div className={styles.interfaceNameRow}>
            <Badge status={isActive ? 'success' : 'default'} />
            <InterfaceTypeIcon type={type} size={20} className={styles.interfaceTypeIcon} />
            <span className={styles.interfaceName}>{name}</span>
          </div>
          <div className={styles.interfaceMeta}>
            {macAddress && (
              <span
                className={styles.interfaceMac}
                onClick={handleCopyMac}
                title="点击复制MAC地址"
              >
                {macAddress}
              </span>
            )}
            {ipAddress && (
              <span className={styles.interfaceIp}>{ipAddress}</span>
            )}
          </div>
        </div>
      </div>
      <div className={styles.interfaceStats}>
        <span className={isActive ? styles.interfaceRx : styles.interfaceInactive}>
          <TrafficIndicator direction="rx" rate={rxRate} active={isActive} />
          <span className={styles.trafficRate}>↓ {rx}</span>
        </span>
        <span className={isActive ? styles.interfaceTx : styles.interfaceInactive}>
          <TrafficIndicator direction="tx" rate={txRate} active={isActive} />
          <span className={styles.trafficRate}>↑ {tx}</span>
        </span>
      </div>
    </div>
  );
};

const formatBitsPerSec = (bps: number): string => {
  if (bps === 0) return '0 bps';
  if (bps < 1000) return `${bps.toFixed(0)} bps`;
  if (bps < 1_000_000) return `${(bps / 1000).toFixed(1)} Kbps`;
  if (bps < 1_000_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  return `${(bps / 1_000_000_000).toFixed(2)} Gbps`;
};

interface DeviceInfoData {
  cpu_load: string;
  cpu_load_num: number;
  uptime: string;
  memory_used: string;
  memory_total: string;
  memory_percentage: number;
  hdd_used: string;
  hdd_total: string;
  hdd_percentage: number;
  board?: string;
  cpu_count?: string;
}

export const DashboardPage: React.FC = () => {
  const { router } = useAppState();
  const { deviceOffline, interfaces: wsInterfaces, loading: wsLoading } = useWebSocket();
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfoData | null>(null);
  const [deviceInfoLoading, setDeviceInfoLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { interfaces, loading: trafficLoading, error: trafficError } = useTrafficMonitor(router);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [showActiveInterfaces, setShowActiveInterfaces] = useState(() => {
    const stored = localStorage.getItem('dashboard.showActiveInterfaces');
    return stored !== null ? JSON.parse(stored) : true;
  });
  const [showInactiveInterfaces, setShowInactiveInterfaces] = useState(() => {
    const stored = localStorage.getItem('dashboard.showInactiveInterfaces');
    return stored !== null ? JSON.parse(stored) : false;
  });

  useEffect(() => {
    localStorage.setItem('dashboard.showActiveInterfaces', JSON.stringify(showActiveInterfaces));
  }, [showActiveInterfaces]);

  useEffect(() => {
    localStorage.setItem('dashboard.showInactiveInterfaces', JSON.stringify(showInactiveInterfaces));
  }, [showInactiveInterfaces]);

  const fetchDeviceInfo = useCallback(async () => {
    if (!router?.ipAddress || deviceOffline) return;
    try {
      const resp = await fetch(`/api/device-info?ip=${encodeURIComponent(router.ipAddress)}&force_refresh=true`);
      const data = await resp.json();
      if (data.status === 'success' && data.info) {
        setDeviceInfo(data.info);
        setDeviceInfoLoading(false);
      }
    } catch (e) {
      console.error('Failed to fetch device info:', e);
      setDeviceInfoLoading(false);
    }
  }, [router?.ipAddress, deviceOffline]);

  useEffect(() => {
    if (!router?.ipAddress) return;

    fetchDeviceInfo();

    intervalRef.current = setInterval(fetchDeviceInfo, 3000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [router?.ipAddress, fetchDeviceInfo]);

  useEffect(() => {
    if (trafficError) {
      setError(trafficError);
    }
  }, [trafficError]);

  const hasAnyData = deviceInfo || wsInterfaces.length > 0;
  const isFullyLoading = deviceInfoLoading && wsLoading && !hasAnyData;

  if (isFullyLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>加载仪表盘数据中...</div>
      </div>
    );
  }

  if (error && !deviceInfo && wsInterfaces.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>
          错误: {error}
        </div>
      </div>
    );
  }

  const cpuLoad = deviceInfo?.cpu_load_num || 0;
  const memoryPercentage = deviceInfo?.memory_percentage || 0;
  const hddPercentage = deviceInfo?.hdd_percentage || 0;

  const activeInterfaces = interfaces.filter((i) => !i.disabled && i.running);
  const inactiveInterfaces = interfaces.filter((i) => i.disabled || !i.running);

  const totalTrafficBps = interfaces.reduce((sum, iface) => sum + iface.rx_rate + iface.tx_rate, 0);
  const totalTrafficMbps = totalTrafficBps / 1_000_000;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>仪表盘</h1>
          <p className={styles.subtitle}>路由器实时统计与监控</p>
        </div>
      </div>

      <div className={styles.statsGrid}>
        <ProgressStatCard
          title="CPU使用率"
          percentage={cpuLoad}
          details={
            deviceInfo
              ? (deviceInfo.cpu_count && deviceInfo.cpu_count !== '--'
                ? `${deviceInfo.cpu_count} 核${parseInt(deviceInfo.cpu_count) > 1 ? '心' : ''}`
                : `${cpuLoad}% 利用率`)
              : '加载中...'
          }
          icon={<DashboardOutlined />}
        />
        <ProgressStatCard
          title="内存"
          percentage={memoryPercentage}
          details={deviceInfo ? `${deviceInfo.memory_used} / ${deviceInfo.memory_total}` : '加载中...'}
          icon={<DatabaseOutlined />}
        />
        {deviceInfo && hddPercentage > 0 && (
          <ProgressStatCard
            title="磁盘"
            percentage={hddPercentage}
            details={`${deviceInfo.hdd_used} / ${deviceInfo.hdd_total}`}
            icon={<HddOutlined />}
          />
        )}
        <StatCard
          title="流量"
          value={totalTrafficMbps.toFixed(1)}
          unit="Mbps"
          status={totalTrafficMbps > 100 ? 'warning' : 'good'}
          icon={<GlobalOutlined />}
        />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>网络接口</h2>
          <div className={styles.interfaceTags}>
            <button
              className={`${styles.interfaceTag} ${styles.tagActive} ${!showActiveInterfaces ? styles.tagHidden : ''}`}
              onClick={() => setShowActiveInterfaces(!showActiveInterfaces)}
              title="点击切换活动接口显示"
            >
              <CheckCircleOutlined />
              <span>活动: {activeInterfaces.length}</span>
            </button>
            <button
              className={`${styles.interfaceTag} ${styles.tagInactive} ${!showInactiveInterfaces ? styles.tagHidden : ''}`}
              onClick={() => setShowInactiveInterfaces(!showInactiveInterfaces)}
              title="点击切换非活动接口显示"
            >
              <CloseCircleOutlined />
              <span>非活动: {inactiveInterfaces.length}</span>
            </button>
          </div>
        </div>
        <div className={styles.interfacesList}>
          {interfaces.length === 0 && wsLoading ? (
            <div className={styles.loading}>加载网络接口数据中...</div>
          ) : interfaces.length === 0 ? (
            <div className={styles.loading}>暂无网络接口数据</div>
          ) : (
            interfaces
              .filter((iface) => {
                const isActive = !iface.disabled && iface.running;
                if (isActive) return showActiveInterfaces;
                return showInactiveInterfaces;
              })
              .map((iface) => (
              <InterfaceItem
                key={iface.name}
                name={iface.name}
                type={iface.type}
                status={!iface.disabled && iface.running ? 'up' : 'down'}
                rx={formatBitsPerSec(iface.rx_rate)}
                tx={formatBitsPerSec(iface.tx_rate)}
                rxRate={iface.rx_rate}
                txRate={iface.tx_rate}
                macAddress={iface.mac_address}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
};
