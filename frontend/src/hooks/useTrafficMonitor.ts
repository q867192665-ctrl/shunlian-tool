import { useMemo } from 'react';
import { useWebSocket } from '../contexts/WebSocketContext';
import type { RouterInfo } from '../types/router';
import type { InterfaceTraffic } from '../types/api';

interface InterfaceApiData {
  name: string;
  type: string;
  mac_address?: string;
  running: boolean;
  disabled: boolean;
  rx_rate: number;
  tx_rate: number;
  rx_byte: number;
  tx_byte: number;
  slave: boolean;
}

interface UseTrafficMonitorResult {
  interfaces: InterfaceApiData[];
  trafficData: InterfaceTraffic;
  loading: boolean;
  error: string | null;
}

export function useTrafficMonitor(_router: RouterInfo | null): UseTrafficMonitorResult {
  const { interfaces, trafficData, loading, error } = useWebSocket();

  const mergedInterfaces = useMemo(() => {
    return interfaces.map(iface => ({
      ...iface,
      rx_rate: trafficData[iface.name]?.rx_bps ?? iface.rx_rate ?? 0,
      tx_rate: trafficData[iface.name]?.tx_bps ?? iface.tx_rate ?? 0,
    }));
  }, [interfaces, trafficData]);

  return { interfaces: mergedInterfaces, trafficData, loading, error };
}
