import React, { createContext, useContext, useRef, useState, useCallback } from 'react';
import { message as antMessage } from 'antd';
import type { RouterInfo } from '../types/router';

interface TerminalState {
  isConnected: boolean;
  isConnecting: boolean;
  buffer: string;
  connectTerminal: (router: RouterInfo) => void;
  disconnectTerminal: () => void;
  sendInput: (data: string) => void;
  getBuffer: () => string;
  onReplayBuffer: (callback: (data: string) => void) => void;
}

const TerminalContext = createContext<TerminalState>({
  isConnected: false,
  isConnecting: false,
  buffer: '',
  connectTerminal: () => {},
  disconnectTerminal: () => {},
  sendInput: () => {},
  getBuffer: () => '',
  onReplayBuffer: () => {},
});

export const TerminalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const wsRef = useRef<WebSocket | null>(null);
  const bufferRef = useRef<string>('');
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const replayCallbackRef = useRef<((data: string) => void) | null>(null);

  const sendInput = useCallback((data: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        action: 'terminal_input',
        data: data
      }));
    }
  }, []);

  const disconnectTerminal = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
    bufferRef.current = '';
  }, []);

  const connectTerminal = useCallback((router: RouterInfo) => {
    if (!router?.ipAddress || !router?.username || !router?.password) {
      antMessage.error('请先登录设备');
      return;
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      antMessage.info('终端已连接');
      return;
    }

    setIsConnecting(true);
    bufferRef.current = '';

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // 开发环境（Vite 5173）使用代理路径，生产环境直接连接 32996 端口
    const isDev = window.location.port === '5173';
    const wsUrl = isDev ? `${wsProtocol}//${window.location.host}/ws` : `${wsProtocol}//${window.location.hostname}:32996`;
    const ws = new WebSocket(wsUrl);

    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      ws.send(JSON.stringify({
        ip: router.ipAddress,
        username: router.username,
        password: router.password,
        action: 'terminal_connect'
      }));
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'terminal') {
            if (data.status === 'connected') {
              setIsConnected(true);
              setIsConnecting(false);
            } else if (data.status === 'output') {
              bufferRef.current += data.data;
              replayCallbackRef.current?.(data.data);
            } else if (data.status === 'error') {
              setIsConnected(false);
              setIsConnecting(false);
              bufferRef.current += `\r\nError: ${data.message}\r\n`;
              replayCallbackRef.current?.(`\r\nError: ${data.message}\r\n`);
            }
          }
        } catch {
          replayCallbackRef.current?.(event.data);
        }
      } else if (event.data instanceof ArrayBuffer) {
        const decoder = new TextDecoder();
        const text = decoder.decode(event.data);
        bufferRef.current += text;
        replayCallbackRef.current?.(text);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      setIsConnecting(false);
    };

    ws.onerror = () => {
      setIsConnected(false);
      setIsConnecting(false);
      antMessage.error('终端连接失败');
    };

    wsRef.current = ws;
  }, []);

  const getBuffer = useCallback(() => {
    return bufferRef.current;
  }, []);

  const onReplayBuffer = useCallback((callback: (data: string) => void) => {
    replayCallbackRef.current = callback;
    if (bufferRef.current) {
      callback(bufferRef.current);
    }
  }, []);

  return (
    <TerminalContext.Provider value={{
      isConnected,
      isConnecting,
      buffer: bufferRef.current,
      connectTerminal,
      disconnectTerminal,
      sendInput,
      getBuffer,
      onReplayBuffer,
    }}>
      {children}
    </TerminalContext.Provider>
  );
};

export const useTerminal = () => useContext(TerminalContext);
