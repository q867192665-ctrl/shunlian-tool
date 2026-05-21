import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Button, message as antMessage } from 'antd';
import { ClearOutlined, FontSizeOutlined, DisconnectOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { useAppState } from '../../contexts/AppContext';
import { useTerminal } from '../../contexts/TerminalContext';
import styles from './TerminalPage.module.css';

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';

export const TerminalPage: React.FC = () => {
  const { router } = useAppState();
  const { isConnected, isConnecting, connectTerminal, disconnectTerminal, sendInput, onReplayBuffer } = useTerminal();
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [fontSize, setFontSize] = useState(14);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: fontSize,
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', 'Courier New', monospace",
      theme: {
        background: '#0d0d0d',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        selectionBackground: '#264f78',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#e5e5e5',
      },
      allowProposedApi: true,
      scrollback: 10000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);

    try {
      term.loadAddon(new WebglAddon());
    } catch {
      console.log('WebGL renderer not available, falling back to canvas');
    }

    term.open(terminalRef.current);
    fitAddon.fit();
    xtermRef.current = term;

    onReplayBuffer((data) => {
      term.write(data);
    });

    term.onData((data) => {
      sendInput(data);
    });

    term.onResize(() => {
      fitAddon.fit();
    });

    const handleResize = () => {
      fitAddon.fit();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
      xtermRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.fontSize = fontSize;
      fitAddonRef.current?.fit();
    }
  }, [fontSize]);

  const handleClear = () => {
    xtermRef.current?.clear();
  };

  const handleDisconnect = () => {
    disconnectTerminal();
    xtermRef.current?.clear();
  };

  const handleConnect = () => {
    if (!router) {
      antMessage.error('请先登录设备');
      return;
    }
    xtermRef.current?.clear();
    connectTerminal({
      ipAddress: router.ipAddress,
      username: router.username,
      password: router.password,
      name: router.name,
      status: router.status,
      model: router.model,
      osVersion: router.osVersion,
    });
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.headerTitle}>Terminal</span>
          <span className={styles.deviceInfo}>{router?.name || router?.ipAddress || '未连接'}</span>
          {isConnected && <span className={styles.connectedBadge}>● 已连接</span>}
        </div>
        <div className={styles.headerRight}>
          <span className={styles.fontSizeLabel}>
            <FontSizeOutlined />
          </span>
          <input
            type="range"
            min="10"
            max="20"
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            className={styles.fontSizeSlider}
          />
          <Button
            icon={<ClearOutlined />}
            size="small"
            onClick={handleClear}
            className={styles.clearButton}
          >
            清屏
          </Button>
          {!isConnected ? (
            <Button
              type="primary"
              size="small"
              icon={<PlayCircleOutlined />}
              onClick={handleConnect}
              loading={isConnecting}
              disabled={!router?.ipAddress}
            >
              连接
            </Button>
          ) : (
            <Button
              danger
              size="small"
              icon={<DisconnectOutlined />}
              onClick={handleDisconnect}
            >
              断开
            </Button>
          )}
        </div>
      </div>

      <div className={styles.terminalContainer}>
        <div ref={terminalRef} className={styles.terminal} />
      </div>
    </div>
  );
};
