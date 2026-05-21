import type { WsMessage } from '../types/api';

type MessageHandler = (data: WsMessage) => void;

class WsService {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsUrl: string = '';

  connect(ip: string, username: string, password: string) {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = window.location.hostname;
    this.wsUrl = `${protocol}://${host}:32996`;

    this.ws = new WebSocket(this.wsUrl);

    this.ws.onopen = () => {
      this.ws?.send(JSON.stringify({
        type: 'auth',
        ip,
        username,
        password,
      }));
    };

    this.ws.onmessage = (event) => {
      try {
        const data: WsMessage = JSON.parse(event.data);
        const handlers = this.handlers.get(data.type);
        if (handlers) {
          handlers.forEach(h => h(data));
        }
        const allHandlers = this.handlers.get('*');
        if (allHandlers) {
          allHandlers.forEach(h => h(data));
        }
      } catch (e) {
        console.error('WebSocket message parse error:', e);
      }
    };

    this.ws.onclose = () => {
      this.startReconnect(ip, username, password);
    };

    this.ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  }

  private startReconnect(ip: string, username: string, password: string) {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(ip, username, password);
    }, 3000);
  }

  on(type: string, handler: MessageHandler) {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.handlers.clear();
    this.ws?.close();
    this.ws = null;
  }

  isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export const wsService = new WsService();
export default wsService;
