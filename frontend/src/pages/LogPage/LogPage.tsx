import React, { useState, useEffect, useRef } from 'react';
import { useAppState } from '../../contexts/AppContext';
import { useWebSocket } from '../../contexts/WebSocketContext';
import styles from './LogPage.module.css';

interface LogEntry {
  time: string;
  topics: string;
  message: string;
}

const getLogTopicClass = (topics: string): string => {
  if (!topics) return styles.topicDefault;
  const t = topics.toLowerCase();
  if (t.includes('error') || t.includes('critical')) return styles.topicError;
  if (t.includes('warning') || t.includes('warn')) return styles.topicWarning;
  if (t.includes('info')) return styles.topicInfo;
  if (t.includes('debug')) return styles.topicDebug;
  return styles.topicDefault;
};

const getLogRowClass = (topics: string): string => {
  if (!topics) return '';
  const t = topics.toLowerCase();
  if (t.includes('error') || t.includes('critical')) return styles.rowError;
  if (t.includes('warning') || t.includes('warn')) return styles.rowWarning;
  return '';
};

export const LogPage: React.FC = () => {
  const { router } = useAppState();
  const { logs, logsLoading, startLogsPolling, stopLogsPolling } = useWebSocket();
  const [autoScroll, setAutoScroll] = useState(true);
  const tableBodyRef = useRef<HTMLTableSectionElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!router?.ipAddress) {
      console.log('[LogPage] router.ipAddress 为空，跳过');
      return;
    }
    console.log('[LogPage] 启动日志轮询');
    startLogsPolling();
  }, [router?.ipAddress, startLogsPolling, stopLogsPolling]);

  useEffect(() => {
    if (autoScroll && tableBodyRef.current && logs.length > 0) {
      tableBodyRef.current.lastElementChild?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 50;
    setAutoScroll(isAtBottom);
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>系统日志</h2>
        <div className={styles.controls}>
          <label className={styles.autoScrollLabel}>
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            <span>自动滚动</span>
          </label>
          <span className={styles.logCount}>共 {logs.length} 条日志</span>
        </div>
      </div>
      <div className={styles.tableContainer} ref={containerRef} onScroll={handleScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th style={{ width: '60px' }}>序号</th>
              <th style={{ width: '180px' }}>时间</th>
              <th style={{ width: '120px' }}>主题</th>
              <th>消息</th>
            </tr>
          </thead>
          <tbody ref={tableBodyRef}>
            {logs.map((l, i) => (
              <tr key={l.time + i} className={getLogRowClass(l.topics)}>
                <td className={styles.index}>{i + 1}</td>
                <td className={styles.mono}>{l.time}</td>
                <td><span className={getLogTopicClass(l.topics)}>{l.topics}</span></td>
                <td>{l.message}</td>
              </tr>
            ))}
            {logs.length === 0 && logsLoading && (
              <tr><td colSpan={4} style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-secondary)' }}>正在加载日志...</td></tr>
            )}
            {logs.length === 0 && !logsLoading && (
              <tr><td colSpan={4} style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-secondary)' }}>暂无日志</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
