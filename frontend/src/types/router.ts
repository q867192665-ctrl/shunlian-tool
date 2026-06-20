export interface RouterInfo {
  name: string;
  ipAddress: string;
  status: 'online' | 'offline' | 'connecting';
  model: string;
  osVersion: string;
  username: string;
  password: string;
  platform?: string;
}
