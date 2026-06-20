const API_BASE = window.location.origin;

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }
  return response.json();
}

export const api = {
  getDevices: () => request<any[]>('/api/devices'),
  refreshDevices: () => request<any[]>('/api/refresh', { method: 'POST' }),
  connect: (ip: string, username: string, password: string, platform?: string) =>
    request<any>('/api/connect', {
      method: 'POST',
      body: JSON.stringify({ ip, username, password, platform: platform || '' }),
    }),
  disconnect: (ip: string) => request<any>('/api/logout', {
    method: 'POST',
    body: JSON.stringify({ ip }),
  }),
  getSystemInfo: () => request<any>('/api/system/info'),
  getDeviceInfo: (ip: string) => request<any>(`/api/device-info?ip=${encodeURIComponent(ip)}`),
  getInterfaces: (ip: string) => request<{status: string; interfaces: any[]}>(`/api/interfaces?ip=${encodeURIComponent(ip)}`),
  exportConfig: () => request<string>('/api/router/export'),

  getNetworkInterfaces: (ip: string) => request<{status: string; interfaces: any[]}>(`/api/interfaces?ip=${encodeURIComponent(ip)}`),
  getIpAddresses: (ip: string) => request<any[]>('/api/device/ip-addresses', {
    method: 'POST',
    body: JSON.stringify({ ip }),
  }),
  getRoutes: (ip: string) => request<any[]>('/api/device/routes', {
    method: 'POST',
    body: JSON.stringify({ ip }),
  }),
  getArpTable: (ip: string) => request<any[]>('/api/device/arp', {
    method: 'POST',
    body: JSON.stringify({ ip }),
  }),
  updateInterface: (ip: string, id: string, updates: any) => request<any>(`/api/interface-toggle?ip=${encodeURIComponent(ip)}&id=${encodeURIComponent(id)}`, {
    method: 'GET',
  }),

  getFirewallFilterRules: (ip: string) => request<any[]>('/api/device/firewall/filter', {
    method: 'POST',
    body: JSON.stringify({ ip }),
  }),

  getFirewallNatRules: (ip: string) => request<any[]>('/api/device/firewall/nat', {
    method: 'POST',
    body: JSON.stringify({ ip }),
  }),

  getFirewallMangleRules: (ip: string) => request<any[]>('/api/device/firewall/mangle', {
    method: 'POST',
    body: JSON.stringify({ ip }),
  }),

  getFirewallAddressLists: (ip: string) => request<any[]>('/api/device/firewall/address-list', {
    method: 'POST',
    body: JSON.stringify({ ip }),
  }),
};

export default api;
