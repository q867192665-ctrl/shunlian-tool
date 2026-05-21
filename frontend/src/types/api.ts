export interface DeviceInfo {
  'MAC-Address'?: string;
  'Identity'?: string;
  'Platform'?: string;
  'Version'?: string;
  'Uptime'?: string;
  'Interface name'?: string;
  'IPv4-Address'?: string;
  mac_address?: string;
  identity?: string;
  ipv4_address?: string;
  ip?: string;
  interface_name?: string;
  last_seen?: number;
}

export interface ConnectRequest {
  ip: string;
  username: string;
  password: string;
}

export interface ConnectResponse {
  status: string;
  message: string;
  session_id?: string;
}

export interface SystemInfo {
  'cpu-load'?: string;
  'cpu-count'?: string;
  'free-memory'?: string;
  'total-memory'?: string;
  'free-hdd-space'?: string;
  'total-hdd-space'?: string;
  'uptime'?: string;
  'version'?: string;
  'architecture-name'?: string;
  'board-name'?: string;
  'identity'?: string;
  platform?: string;
}

export interface SystemResources {
  cpu: { load: number; count: number };
  memory: { used: number; total: number; percentage: number };
  disk: { used: number; total: number; percentage: number };
  uptime: string;
  timestamp: string;
}

export interface InterfaceInfo {
  name: string;
  type: string;
  status: 'up' | 'down';
  mtu: string;
  'mac-address'?: string;
  'running'?: string;
  disabled?: string;
  comment?: string;
  'rx-bytes'?: string;
  'tx-bytes'?: string;
  'rx-bits-per-second'?: string;
  'tx-bits-per-second'?: string;
  slave?: string;
  '.id'?: string;
}

export interface InterfaceTraffic {
  [iface: string]: {
    tx_bps: number;
    rx_bps: number;
  };
}

export interface IpAddress {
  interface: string;
  address: string;
  network: string;
  disabled?: string;
  comment?: string;
  '.id'?: string;
}

export interface RouteInfo {
  'dst-address': string;
  gateway: string;
  distance: string;
  'routing-table'?: string;
  'active'?: string;
  '.id'?: string;
}

export interface ArpEntry {
  address: string;
  'mac-address': string;
  interface: string;
  '.id'?: string;
}

export interface FirewallRule {
  '.id': string;
  chain: string;
  action: string;
  comment?: string;
  'src-address'?: string;
  'dst-address'?: string;
  protocol?: string;
  'disabled'?: string;
}

export interface FirewallFilterRule {
  id: string;
  chain: string;
  action: string;
  protocol?: string;
  srcAddress?: string;
  dstAddress?: string;
  srcPort?: string;
  dstPort?: string;
  inInterface?: string;
  outInterface?: string;
  bytes?: number;
  packets?: number;
  disabled: boolean;
  invalid: boolean;
  dynamic: boolean;
  comment?: string;
}

export interface FirewallNatRule {
  id: string;
  chain: string;
  action: string;
  protocol?: string;
  srcAddress?: string;
  dstAddress?: string;
  srcPort?: string;
  dstPort?: string;
  toAddresses?: string;
  toPorts?: string;
  inInterface?: string;
  outInterface?: string;
  bytes?: number;
  packets?: number;
  disabled: boolean;
  invalid: boolean;
  dynamic: boolean;
  comment?: string;
}

export interface FirewallMangleRule {
  id: string;
  chain: string;
  action: string;
  protocol?: string;
  srcAddress?: string;
  dstAddress?: string;
  newRoutingMark?: string;
  newPacketMark?: string;
  passthroughEnabled: boolean;
  bytes?: number;
  packets?: number;
  disabled: boolean;
  invalid: boolean;
  dynamic: boolean;
  comment?: string;
}

export interface FirewallAddressList {
  id: string;
  list: string;
  address: string;
  creationTime?: string;
  timeout?: string;
  dynamic: boolean;
  disabled: boolean;
  comment?: string;
}

export interface WirelessInterface {
  name: string;
  mode: string;
  band: string;
  frequency?: string;
  ssid?: string;
  'security-profile'?: string;
  disabled?: string;
  '.id'?: string;
}

export interface WirelessClient {
  interface: string;
  'mac-address': string;
  signal?: string;
  'tx-rate'?: string;
  'rx-rate'?: string;
  uptime?: string;
}

export interface SecurityProfile {
  name: string;
  mode?: string;
  'authentication-types'?: string;
  'unicast-ciphers'?: string;
  'group-ciphers'?: string;
  '.id'?: string;
}

export interface LogEntry {
  time: string;
  topics: string;
  message: string;
}

export interface WsMessage {
  type: string;
  status: string;
  interfaces?: InterfaceInfo[];
  wireless_interfaces?: WirelessInterface[];
  clients?: WirelessClient[];
  security_profiles?: SecurityProfile[];
  traffic?: InterfaceTraffic;
  logs?: LogEntry[];
  message?: string;
}

export interface NetworkInterface {
  id: string;
  name: string;
  type: string;
  status: 'up' | 'down';
  rxRate: number;
  txRate: number;
  rxBytes: number;
  txBytes: number;
  comment?: string;
  ipAddress?: string;
  bridge?: string;
  isBridge?: boolean;
  bridgePorts?: string[];
  disabled?: boolean;
  mtu?: string;
  'mac-address'?: string;
  running?: string;
}

export interface UpdateInterfaceRequest {
  name?: string;
  comment?: string;
  disabled?: boolean;
}

export interface Route {
  id: string;
  dstAddress: string;
  gateway: string;
  gatewayStatus: 'reachable' | 'unreachable';
  distance: number;
  scope: number;
  targetScope: number;
  interface?: string;
  dynamic: boolean;
  active: boolean;
  static: boolean;
  comment?: string;
}

export interface ArpEntry {
  id: string;
  address: string;
  macAddress: string;
  interface: string;
  status: 'reachable' | 'stale' | 'delay' | 'probe' | 'failed';
  dynamic: boolean;
  published: boolean;
  invalid: boolean;
  dhcp: boolean;
  complete: boolean;
  disabled: boolean;
  comment?: string;
}
