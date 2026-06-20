import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button, message as antMessage, Switch } from 'antd';
import {
  PlayCircleOutlined,
  StopOutlined,
  ThunderboltOutlined,
  ClearOutlined,
} from '@ant-design/icons';
import { useAppState } from '../../contexts/AppContext';
import styles from './SpeedTestPage.module.css';

type Mode = 'server' | 'client';
type Protocol = 'TCP' | 'UDP';

interface SpeedTestResult {
  mode: string;
  protocol: string;
  duration: number;
  sent_bps: number;
  received_bps: number;
  sent_bps_human: string;
  received_bps_human: string;
  sent_transfer_human: string;
  received_transfer_human: string;
  retransmits: number;
  jitter_ms: number;
  lost_percent: number;
  packets: number;
  lost_packets: number;
  error: string;
}

export const SpeedTestPage: React.FC = () => {
  const { router } = useAppState();

  // 配置参数
  const [mode, setMode] = useState<Mode>('client');
  const [protocol, setProtocol] = useState<Protocol>('TCP');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(5201);
  const [customPort, setCustomPort] = useState('');
  const [duration, setDuration] = useState(10);
  const [threads, setThreads] = useState(1);
  const [bandwidth, setBandwidth] = useState('10M');
  const [customBandwidth, setCustomBandwidth] = useState('');
  const [reverse, setReverse] = useState(false);

  // 运行状态
  const [available, setAvailable] = useState<boolean | null>(null);
  const [running, setRunning] = useState(false);
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [result, setResult] = useState<SpeedTestResult | null>(null);
  const [testStatus, setTestStatus] = useState<'idle' | 'running' | 'completed'>('idle');

  const outputRef = useRef<HTMLDivElement>(null);
  const lastVersionRef = useRef(-1);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 检查 iperf3 可用性
  useEffect(() => {
    fetch('/api/speedtest/availability')
      .then(res => res.json())
      .then(data => setAvailable(data.available))
      .catch(() => setAvailable(false));
  }, []);

  // 自动滚动输出区
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [outputLines]);

  // 轮询输出
  const startPolling = useCallback(() => {
    if (pollTimerRef.current) return;
    lastVersionRef.current = -1;
    setOutputLines([]);

    pollTimerRef.current = setInterval(async () => {
      try {
        // 获取全部输出
        const outputRes = await fetch('/api/speedtest/output');
        const outputData = await outputRes.json();

        // 版本变化说明新测试开始，清除旧结果
        if (outputData.version !== undefined && outputData.version !== lastVersionRef.current) {
          if (lastVersionRef.current !== -1) {
            setResult(null);
            setTestStatus('running');
          }
          lastVersionRef.current = outputData.version;
        }

        // 整体替换输出
        if (outputData.lines) {
          setOutputLines(outputData.lines);
        }

        // 获取状态
        const statusRes = await fetch('/api/speedtest/status');
        const statusData = await statusRes.json();

        // 更新结果（服务端模式下进程仍在运行但测试已完成时也可获取结果）
        if (statusData.result && (statusData.result.sent_bps > 0 || statusData.result.received_bps > 0 || statusData.result.error)) {
          setResult(statusData.result);
          if (testStatus !== 'completed') {
            setTestStatus('completed');
          }
        }

        if (!statusData.running) {
          setRunning(false);
          if (statusData.result) {
            setResult(statusData.result);
          }
          if (testStatus !== 'completed') {
            setTestStatus('completed');
          }
          stopPolling();
        }
      } catch {
        // 忽略轮询错误
      }
    }, 500);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  // 启动测速
  const handleStart = async () => {
    if (mode === 'client' && !host.trim()) {
      antMessage.warning('请输入目标服务器地址');
      return;
    }

    const actualPort = port === -1 ? parseInt(customPort) || 5201 : port;
    if (actualPort < 1 || actualPort > 65535) {
      antMessage.warning('端口号范围 1-65535');
      return;
    }

    setResult(null);
    setOutputLines([]);
    lastVersionRef.current = -1;
    setRunning(true);
    setTestStatus('running');

    try {
      let res: Response;
      if (mode === 'server') {
        res = await fetch('/api/speedtest/start-server', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ port: actualPort, one_off: false }),
        });
      } else {
        const actualBandwidth = bandwidth === 'custom' ? customBandwidth : bandwidth;
        res = await fetch('/api/speedtest/start-client', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: host.trim(),
            port: actualPort,
            protocol,
            duration,
            threads,
            bandwidth: protocol === 'UDP' ? actualBandwidth : '',
            reverse,
          }),
        });
      }

      const data = await res.json();
      if (data.status === 'error') {
        antMessage.error(data.message);
        setRunning(false);
        setTestStatus('idle');
        return;
      }

      startPolling();
    } catch (err) {
      antMessage.error('启动测速失败');
      setRunning(false);
      setTestStatus('idle');
    }
  };

  // 停止测速
  const handleStop = async () => {
    try {
      await fetch('/api/speedtest/stop', { method: 'POST' });
      setRunning(false);
      setTestStatus('idle');
      stopPolling();
    } catch {
      antMessage.error('停止测速失败');
    }
  };

  // 清空输出
  const handleClear = () => {
    setOutputLines([]);
    setResult(null);
    setTestStatus('idle');
  };

  const isClient = mode === 'client';

  // 按钮选项组件
  const BtnOption = ({
    active,
    onClick,
    disabled,
    children,
  }: {
    active: boolean;
    onClick: () => void;
    disabled?: boolean;
    children: React.ReactNode;
  }) => (
    <button
      className={`${styles.btnOption} ${active ? styles.btnOptionActive : ''} ${disabled ? styles.btnOptionDisabled : ''}`}
      onClick={disabled ? undefined : onClick}
    >
      {children}
    </button>
  );

  if (available === false) {
    return (
      <div className={styles.container}>
        <h2 className={styles.title}>带宽测速</h2>
        <div className={styles.unavailable}>
          <ThunderboltOutlined className={styles.unavailableIcon} />
          <p className={styles.unavailableText}>
            iperf3 工具未找到，请确保 backend/iperf3/ 目录下存在 iperf3 可执行文件
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>带宽测速</h2>

      {/* 配置区 */}
      <div className={styles.configSection}>
        <div className={styles.configTitle}>测速参数配置</div>
        <div className={styles.configGrid}>
          {/* 运行模式 */}
          <div className={styles.configItem}>
            <span className={styles.configLabel}>运行模式</span>
            <div className={styles.btnGroup}>
              <BtnOption active={mode === 'server'} onClick={() => setMode('server')}>
                服务端
              </BtnOption>
              <BtnOption active={mode === 'client'} onClick={() => setMode('client')}>
                客户端
              </BtnOption>
            </div>
          </div>

          {/* 协议 - 仅客户端 */}
          <div className={styles.configItem}>
            <span className={styles.configLabel}>协议</span>
            <div className={styles.btnGroup}>
              <BtnOption active={protocol === 'TCP'} onClick={() => setProtocol('TCP')} disabled={!isClient}>
                TCP
              </BtnOption>
              <BtnOption active={protocol === 'UDP'} onClick={() => setProtocol('UDP')} disabled={!isClient}>
                UDP
              </BtnOption>
            </div>
          </div>

          {/* 目标地址 - 仅客户端 */}
          {isClient && (
            <div className={styles.configItem}>
              <span className={styles.configLabel}>目标服务器地址</span>
              <input
                className={styles.customInput}
                style={{ width: '100%' }}
                value={host}
                onChange={e => setHost(e.target.value)}
                placeholder="例如：192.168.1.1"
                disabled={running}
              />
            </div>
          )}

          {/* 端口 */}
          <div className={styles.configItem}>
            <span className={styles.configLabel}>端口</span>
            <div className={styles.btnGroup}>
              <BtnOption active={port === 5201} onClick={() => setPort(5201)}>5201</BtnOption>
              <BtnOption active={port === 5202} onClick={() => setPort(5202)}>5202</BtnOption>
              <BtnOption active={port === -1} onClick={() => setPort(-1)}>自定义</BtnOption>
              {port === -1 && (
                <input
                  className={styles.customInput}
                  value={customPort}
                  onChange={e => setCustomPort(e.target.value)}
                  placeholder="端口号"
                  disabled={running}
                />
              )}
            </div>
          </div>

          {/* 测速时长 - 仅客户端 */}
          {isClient && (
            <div className={styles.configItem}>
              <span className={styles.configLabel}>测速时长</span>
              <div className={styles.btnGroup}>
                {[10, 20, 30, 60].map(d => (
                  <BtnOption key={d} active={duration === d} onClick={() => setDuration(d)} disabled={running}>
                    {d}s
                  </BtnOption>
                ))}
              </div>
            </div>
          )}

          {/* 并发线程 - 仅客户端 */}
          {isClient && (
            <div className={styles.configItem}>
              <span className={styles.configLabel}>并发线程</span>
              <div className={styles.btnGroup}>
                {[1, 2, 4, 8].map(t => (
                  <BtnOption key={t} active={threads === t} onClick={() => setThreads(t)} disabled={running}>
                    {t}
                  </BtnOption>
                ))}
              </div>
            </div>
          )}

          {/* UDP 带宽 - 仅 UDP 客户端 */}
          {isClient && protocol === 'UDP' && (
            <div className={styles.configItem}>
              <span className={styles.configLabel}>UDP 带宽</span>
              <div className={styles.btnGroup}>
                {['10M', '50M', '100M', 'custom'].map(b => (
                  <BtnOption key={b} active={bandwidth === b} onClick={() => setBandwidth(b)} disabled={running}>
                    {b === 'custom' ? '自定义' : b}
                  </BtnOption>
                ))}
                {bandwidth === 'custom' && (
                  <input
                    className={styles.customInput}
                    value={customBandwidth}
                    onChange={e => setCustomBandwidth(e.target.value)}
                    placeholder="如 200M"
                    disabled={running}
                  />
                )}
              </div>
            </div>
          )}

          {/* 反向测速 - 仅客户端 */}
          {isClient && (
            <div className={styles.configItem}>
              <span className={styles.configLabel}>反向测速（服务端发送）</span>
              <div className={styles.switchRow}>
                <Switch checked={reverse} onChange={setReverse} disabled={running} size="small" />
                <span className={styles.switchLabel}>{reverse ? '开启' : '关闭'}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 操作栏 */}
      <div className={styles.actionBar}>
        {!running ? (
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={handleStart}
            size="large"
          >
            开始测速
          </Button>
        ) : (
          <Button
            danger
            icon={<StopOutlined />}
            onClick={handleStop}
            size="large"
          >
            停止测速
          </Button>
        )}
        <Button icon={<ClearOutlined />} onClick={handleClear} disabled={running}>
          清空
        </Button>
        <div className={styles.statusBadge}>
          <span
            className={`${styles.statusDot} ${
              testStatus === 'running'
                ? styles.statusDotRunning
                : testStatus === 'completed'
                ? styles.statusDotCompleted
                : styles.statusDotIdle
            }`}
          />
          <span>
            {testStatus === 'idle' && '空闲'}
            {testStatus === 'running' && `测速中 (${mode === 'server' ? '服务端' : '客户端'}模式)`}
            {testStatus === 'completed' && '测速完成'}
          </span>
        </div>
      </div>

      {/* 实时输出区 */}
      <div className={styles.outputSection}>
        <div className={styles.outputHeader}>
          <span className={styles.outputTitle}>实时输出</span>
        </div>
        <div className={styles.outputBody} ref={outputRef}>
          {outputLines.length === 0 ? (
            <div className={styles.outputEmpty}>
              {running ? '等待 iperf3 输出...' : '点击"开始测速"运行 iperf3'}
            </div>
          ) : (
            outputLines.map((line, i) => (
              <div key={i} className={styles.outputLine}>{line}</div>
            ))
          )}
        </div>
      </div>

      {/* 汇总区 */}
      {result && (result.sent_bps > 0 || result.received_bps > 0 || result.error) && (
        <div className={styles.summarySection}>
          <div className={styles.summaryTitle}>
            测速结果汇总
            {running && result.mode === 'server' && (
              <span className={styles.summaryRunningHint}>（服务端运行中）</span>
            )}
          </div>
          {result.error ? (
            <div className={styles.summaryError}>{result.error}</div>
          ) : (
            <div className={styles.summaryGrid}>
              <div className={styles.summaryCard}>
                <div className={styles.summaryValue}>{result.sent_bps_human || '-'}</div>
                <div className={styles.summaryLabel}>发送速率</div>
              </div>
              <div className={styles.summaryCard}>
                <div className={styles.summaryValue}>{result.received_bps_human || '-'}</div>
                <div className={styles.summaryLabel}>接收速率</div>
              </div>
              <div className={styles.summaryCard}>
                <div className={styles.summaryValue}>{result.sent_transfer_human || '-'}</div>
                <div className={styles.summaryLabel}>发送数据量</div>
              </div>
              <div className={styles.summaryCard}>
                <div className={styles.summaryValue}>{result.received_transfer_human || '-'}</div>
                <div className={styles.summaryLabel}>接收数据量</div>
              </div>
              {result.protocol === 'TCP' && (
                <div className={styles.summaryCard}>
                  <div className={styles.summaryValue}>{result.retransmits}</div>
                  <div className={styles.summaryLabel}>重传次数</div>
                </div>
              )}
              {result.protocol === 'UDP' && (
                <>
                  <div className={styles.summaryCard}>
                    <div className={styles.summaryValue}>{result.jitter_ms.toFixed(2)} ms</div>
                    <div className={styles.summaryLabel}>抖动</div>
                  </div>
                  <div className={styles.summaryCard}>
                    <div className={styles.summaryValue}>{result.lost_percent.toFixed(2)}%</div>
                    <div className={styles.summaryLabel}>丢包率</div>
                  </div>
                  <div className={styles.summaryCard}>
                    <div className={styles.summaryValue}>{result.lost_packets} / {result.packets}</div>
                    <div className={styles.summaryLabel}>丢包 / 总包数</div>
                  </div>
                </>
              )}
              <div className={styles.summaryCard}>
                <div className={styles.summaryValue}>{result.duration}s</div>
                <div className={styles.summaryLabel}>测速时长</div>
              </div>
              <div className={styles.summaryCard}>
                <div className={styles.summaryValue}>{result.protocol}</div>
                <div className={styles.summaryLabel}>协议</div>
              </div>
              <div className={styles.summaryCard}>
                <div className={styles.summaryValue}>{result.mode === 'server' ? '服务端' : '客户端'}</div>
                <div className={styles.summaryLabel}>运行模式</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
