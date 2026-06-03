import React, { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react';
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

interface TerminalProviderProps {
  children: React.ReactNode;
  router: RouterInfo | null;
  deviceOffline: boolean;
}

export const TerminalProvider: React.FC<TerminalProviderProps> = ({ children, router, deviceOffline }) => {
  const wsRef = useRef<WebSocket | null>(null);
  const bufferRef = useRef<string>('');
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const replayCallbackRef = useRef<((data: string) => void) | null>(null);
  const routerRef = useRef<RouterInfo | null>(router);

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

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
    setIsConnecting(false);
    bufferRef.current = '';
  }, []);

  const connectTerminal = useCallback((r: RouterInfo) => {
    if (!r?.ipAddress || !r?.username || !r?.password) {
      return;
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      return;
    }

    setIsConnecting(true);
    bufferRef.current = '';

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const isDev = window.location.port === '5173';
    const wsUrl = isDev ? `${wsProtocol}//${window.location.host}/ws` : `${wsProtocol}//${window.location.hostname}:32996`;
    const ws = new WebSocket(wsUrl);

    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      bufferRef.current = '\r\n正在连接设备...\r\n';
      replayCallbackRef.current?.(bufferRef.current);
      ws.send(JSON.stringify({
        ip: r.ipAddress,
        username: r.username,
        password: r.password,
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
              const successMsg = `\r\n登录成功！已连接到设备 ${r.ipAddress}\r\n\r\n`;
              bufferRef.current += successMsg;
              replayCallbackRef.current?.(successMsg);
            } else if (data.status === 'output') {
              bufferRef.current += data.data;
              replayCallbackRef.current?.(data.data);
            } else if (data.status === 'error') {
              setIsConnected(false);
              setIsConnecting(false);
              const errorMsg = `\r\n登录失败: ${data.message}\r\n`;
              bufferRef.current += errorMsg;
              replayCallbackRef.current?.(errorMsg);
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
    };

    wsRef.current = ws;
  }, []);

  // 设备断线时自动断开终端
  useEffect(() => {
    if (deviceOffline) {
      disconnectTerminal();
    }
  }, [deviceOffline]);

  // 设备重连成功后自动重新连接终端
  const deviceOfflineRef = useRef(deviceOffline);
  useEffect(() => {
    deviceOfflineRef.current = deviceOffline;
  }, [deviceOffline]);

  useEffect(() => {
    if (!deviceOffline && routerRef.current?.ipAddress && !wsRef.current) {
      const timer = setTimeout(() => {
        if (!deviceOfflineRef.current && routerRef.current && !wsRef.current) {
          connectTerminal(routerRef.current);
        }
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [deviceOffline]);

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
