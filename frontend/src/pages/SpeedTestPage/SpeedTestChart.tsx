import React, { useRef, useEffect, useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  Title,
  Tooltip,
  Legend,
  Filler,
  Chart,
  ChartConfiguration,
} from 'chart.js';
import styles from './SpeedTestChart.module.css';

ChartJS.register(
  LineController,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

// iperf3 每秒输出行正则
// 匹配单向: [  5]   0.00-1.01   sec  27.5 MBytes   229 Mbits/sec  ...
// 匹配双向: [  5][TX-C]   0.00-1.01   sec  1.43 GBytes  12.1 Gbits/sec
const INTERVAL_LINE_RE = /^\[\s*(\d+)\s*\](?:\[(TX|RX)-[CS]\])?\s+([\d.]+)-([\d.]+)\s+sec\s+([\d.]+)\s+([KMGT]?Bytes)\s+([\d.]+)\s+([KMGT]?bits\/sec)/;

interface ParsedPoint {
  streamId: number;
  time: number;
  mbps: number;
  role?: 'TX' | 'RX';  // TX=发送, RX=接收（双向模式才有）
}

interface SpeedTestChartProps {
  lines: string[];
  reverse: boolean;
  running: boolean;
  isServer?: boolean;
}

// 将带单位的带宽值转为 Mbps
function toMbps(value: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u.startsWith('g')) return value * 1000;
  if (u.startsWith('m')) return value;
  if (u.startsWith('k')) return value / 1000;
  return value / 1e6;
}

// 解析 iperf3 输出行，提取每秒带宽数据点
function parseLines(lines: string[]): ParsedPoint[] {
  const points: ParsedPoint[] = [];
  for (const line of lines) {
    const m = INTERVAL_LINE_RE.exec(line);
    if (!m) continue;
    const streamId = parseInt(m[1], 10);
    const role = m[2] as 'TX' | 'RX' | undefined;  // 双向模式才有
    const start = parseFloat(m[3]);
    const end = parseFloat(m[4]);
    const interval = end - start;
    // 只取每秒间隔的数据点（排除汇总行）
    if (interval > 1.5) continue;
    const value = parseFloat(m[7]);
    const unit = m[8];
    points.push({ streamId, time: end, mbps: toMbps(value, unit), role });
  }
  return points;
}

export const SpeedTestChart: React.FC<SpeedTestChartProps> = ({
  lines,
  reverse,
  running,
  isServer = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const lastPointsLenRef = useRef(0);

  // 解析数据点
  const points = useMemo(() => parseLines(lines), [lines]);

  // 自动检测是否为双向测速（有 role 标签或多个 stream ID）
  const isBidir = useMemo(() => {
    if (points.length === 0) return false;
    // 优先通过 role 标签判断（双向模式特有）
    const hasRole = points.some(p => p.role);
    if (hasRole) return true;
    // 兜底：stream ID >= 2
    const streamIds = [...new Set(points.map(p => p.streamId))];
    return streamIds.length >= 2;
  }, [points]);

  // 自动检测服务端反向模式：iperf3 输出含 "sender" 标识表示服务端在发送
  // 仅在服务端模式下检测，客户端反向模式输出也含 sender 汇总行但不应触发
  const isServerSending = useMemo(() => {
    if (!isServer || !reverse) return false;
    return lines.some(line => /\bsender\b/.test(line) && /\bsec\b/.test(line));
  }, [lines, reverse, isServer]);

  // 构建图表数据
  const chartData = useMemo(() => {
    if (points.length === 0) {
      return { labels: [], upload: [], download: [], bidir: false };
    }

    if (isBidir) {
      // 双向模式：通过 role 标签区分发送(TX)/接收(RX)
      const uploadMap = new Map<number, number>();
      const downloadMap = new Map<number, number>();
      for (const p of points) {
        if (p.role === 'TX') {
          uploadMap.set(p.time, p.mbps);
        } else if (p.role === 'RX') {
          downloadMap.set(p.time, p.mbps);
        } else {
          // 无 role 标签时兜底用 streamId 区分
          const streamIds = [...new Set(points.map(pp => pp.streamId))].sort((a, b) => a - b);
          if (p.streamId === streamIds[0]) uploadMap.set(p.time, p.mbps);
          else if (p.streamId === streamIds[streamIds.length - 1]) downloadMap.set(p.time, p.mbps);
        }
      }
      const allTimes = [...new Set([...uploadMap.keys(), ...downloadMap.keys()])].sort((a, b) => a - b);
      return {
        labels: allTimes.map(t => t.toFixed(1) + 's'),
        upload: allTimes.map(t => uploadMap.get(t) ?? null),
        download: allTimes.map(t => downloadMap.get(t) ?? null),
        bidir: true,
      };
    }

    // 单向模式
    const sorted = [...points].sort((a, b) => a.time - b.time);
    const labels = sorted.map(p => p.time.toFixed(1) + 's');
    const vals = sorted.map(p => p.mbps);
    // 服务端反向模式：检测到 sender，显示为发送
    if (isServerSending) {
      return { labels, upload: vals, download: [], bidir: false };
    }
    if (reverse) {
      return { labels, upload: [], download: vals, bidir: false };
    }
    return { labels, upload: vals, download: [], bidir: false };
  }, [points, isBidir, reverse, isServerSending]);

  // 初始化图表（仅一次）
  useEffect(() => {
    if (!canvasRef.current) return;

    // 安全清理：如果已有图表实例（HMR 或 StrictMode 重复挂载），先销毁
    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    const config: ChartConfiguration = {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: '发送 (Mbps)',
            data: [],
            borderColor: '#58a6ff',
            backgroundColor: 'rgba(88, 166, 255, 0.15)',
            borderWidth: 2.5,
            pointRadius: 2.5,
            pointHoverRadius: 5,
            pointBackgroundColor: '#58a6ff',
            pointBorderColor: 'rgba(13, 17, 23, 1)',
            pointBorderWidth: 1.5,
            tension: 0.4,
            fill: true,
            cubicInterpolationMode: 'monotone',
            spanGaps: true,
            hidden: false,
          },
          {
            label: '接收 (Mbps)',
            data: [],
            borderColor: '#3fb950',
            backgroundColor: 'rgba(63, 185, 80, 0.15)',
            borderWidth: 2.5,
            pointRadius: 2.5,
            pointHoverRadius: 5,
            pointBackgroundColor: '#3fb950',
            pointBorderColor: 'rgba(13, 17, 23, 1)',
            pointBorderWidth: 1.5,
            tension: 0.4,
            fill: true,
            cubicInterpolationMode: 'monotone',
            spanGaps: true,
            hidden: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 400,
          easing: 'easeOutQuart',
        },
        interaction: {
          intersect: false,
          mode: 'index',
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              color: '#8b949e',
              font: { size: 12 },
              usePointStyle: true,
              pointStyle: 'circle',
              padding: 16,
            },
          },
          tooltip: {
            backgroundColor: 'rgba(13, 17, 23, 0.95)',
            titleColor: '#e6edf3',
            bodyColor: '#e6edf3',
            borderColor: '#30363d',
            borderWidth: 1,
            padding: 10,
            displayColors: true,
            usePointStyle: true,
            callbacks: {
              label: (ctx: any) => {
                const val = ctx.parsed.y;
                if (val === null || val === undefined) return '';
                return `${ctx.dataset.label}: ${val.toFixed(2)} Mbps`;
              },
            },
          },
        },
        scales: {
          x: {
            title: {
              display: true,
              text: '时间 (秒)',
              color: '#8b949e',
              font: { size: 11 },
            },
            ticks: {
              color: '#8b949e',
              font: { size: 10 },
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 12,
            },
            grid: {
              color: 'rgba(48, 54, 61, 0.5)',
            },
          },
          y: {
            title: {
              display: true,
              text: '带宽 (Mbps)',
              color: '#8b949e',
              font: { size: 11 },
            },
            ticks: {
              color: '#8b949e',
              font: { size: 10 },
              callback: (val: any) => val + ' Mbps',
            },
            grid: {
              color: 'rgba(48, 54, 61, 0.5)',
            },
            beginAtZero: true,
          },
        },
      },
    };

    chartRef.current = new Chart(canvasRef.current, config);

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, []);

  // 更新图表数据（数据变化时）
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // 更新标签
    chart.data.labels = chartData.labels;

    // 更新发送数据集
    chart.data.datasets[0].data = chartData.upload;
    chart.data.datasets[0].hidden = chartData.upload.length === 0;

    // 更新接收数据集
    chart.data.datasets[1].data = chartData.download;
    chart.data.datasets[1].hidden = chartData.download.length === 0;

    // 只在有新数据点时触发动画更新
    const hasNewData = chartData.labels.length !== lastPointsLenRef.current;
    lastPointsLenRef.current = chartData.labels.length;

    chart.update(hasNewData ? undefined : 'none');
  }, [chartData]);

  return (
    <div className={styles.chartSection}>
      <div className={styles.chartWrapper}>
        <div className={styles.canvasContainer}>
          <canvas ref={canvasRef} />
        </div>
      </div>
    </div>
  );
};

export default SpeedTestChart;
