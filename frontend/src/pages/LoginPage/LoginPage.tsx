import React, { useState, useEffect, useCallback } from 'react';
import { useAppState } from '../../contexts/AppContext';
import { SunOutlined, MoonOutlined, SearchOutlined, SkinOutlined, CopyOutlined } from '@ant-design/icons';
import { Modal, message as antMessage } from 'antd';
import api from '../../services/api';
import { UpdateModal } from '../../components/organisms/UpdateModal/UpdateModal';
import type { DeviceInfo } from '../../types/api';
import styles from './LoginPage.module.css';

export const LoginPage: React.FC = () => {
  const { setRouter, setLoggedIn, theme, setTheme, debugModeEnabled, setDebugModeEnabled, compatModeEnabled, setCompatModeEnabled } = useAppState();

  // 简单加密/解密：使用固定密钥进行Base64+XOR混淆，防止明文暴露
  const _ENC_KEY = 'SLSC2025';
  const _encrypt = (text: string): string => {
    try {
      const encoded = encodeURIComponent(text);
      const xored = encoded.split('').map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ _ENC_KEY.charCodeAt(i % _ENC_KEY.length))).join('');
      return btoa(xored);
    } catch { return ''; }
  };
  const _decrypt = (cipher: string): string => {
    try {
      const xored = atob(cipher);
      const decoded = xored.split('').map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ _ENC_KEY.charCodeAt(i % _ENC_KEY.length))).join('');
      return decodeURIComponent(decoded);
    } catch { return ''; }
  };

  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [search, setSearch] = useState('');
  const [ip, setIp] = useState(() => localStorage.getItem('savedIp') || '');
  const [username, setUsername] = useState(() => localStorage.getItem('savedUsername') || 'admin');
  const [password, setPassword] = useState('');
  const [rememberPassword, setRememberPassword] = useState(() => localStorage.getItem('rememberPwd') === 'true');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [updateVisible, setUpdateVisible] = useState(false);
  const [updateInfo, setUpdateInfo] = useState({ currentVersion: '', latestVersion: '', changelog: '', downloadUrl: '' });
  const [appVersion, setAppVersion] = useState('');
  const [themeDropdownVisible, setThemeDropdownVisible] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState('');
  const [selectedMac, setSelectedMac] = useState('');
  const [debugModalVisible, setDebugModalVisible] = useState(false);
  const [diagnosisModalVisible, setDiagnosisModalVisible] = useState(false);
  const [diagnosisContent, setDiagnosisContent] = useState('');
  const [ipConflict, setIpConflict] = useState(false);
  const [conflictDetails, setConflictDetails] = useState<string[]>([]);
  const [sortColumn, setSortColumn] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // 排序函数
  const sortDevices = (devices: DeviceInfo[], column: string, order: 'asc' | 'desc'): DeviceInfo[] => {
    if (!column) return devices;
    
    return [...devices].sort((a, b) => {
      let aValue: string | number = '';
      let bValue: string | number = '';
      
      switch (column) {
        case 'status':
          aValue = a['Identity'] || a.identity || '';
          bValue = b['Identity'] || b.identity || '';
          break;
        case 'name':
          aValue = a['Identity'] || a.identity || '';
          bValue = b['Identity'] || b.identity || '';
          break;
        case 'ip':
          aValue = a['IPv4-Address'] || a.ipv4_address || a.ip || '';
          bValue = b['IPv4-Address'] || b.ipv4_address || b.ip || '';
          break;
        case 'mac':
          aValue = a['MAC-Address'] || a.mac_address || '';
          bValue = b['MAC-Address'] || b.mac_address || '';
          break;
        case 'version':
          aValue = (a['Version'] || '').toString().replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '');
          bValue = (b['Version'] || '').toString().replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '');
          break;
        case 'interface':
          aValue = a['Interface name'] || a.interface_name || '';
          bValue = b['Interface name'] || b.interface_name || '';
          break;
        case 'uptime':
          aValue = a['Uptime'] || '';
          bValue = b['Uptime'] || '';
          break;
        default:
          return 0;
      }
      
      // 如果是数字，则转换为数字比较
      if (!isNaN(Number(aValue)) && !isNaN(Number(bValue))) {
        const numA = Number(aValue);
        const numB = Number(bValue);
        return order === 'asc' ? numA - numB : numB - numA;
      }
      
      // 字符串比较
      const strA = String(aValue).toLowerCase();
      const strB = String(bValue).toLowerCase();
      
      if (order === 'asc') {
        return strA.localeCompare(strB);
      } else {
        return strB.localeCompare(strA);
      }
    });
  };

  // 处理列排序
  const handleSort = (column: string) => {
    if (sortColumn === column) {
      // 如果当前列已经是升序，则切换为降序；如果是降序，则取消排序
      if (sortOrder === 'asc') {
        setSortOrder('desc');
      } else {
        setSortColumn('');
        setSortOrder('asc');
      }
    } else {
      // 点击新列，按升序排列
      setSortColumn(column);
      setSortOrder('asc');
    }
  };

  // 复制文本到剪贴板
  const copyToClipboard = async (text: string, label: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        antMessage.success(`${label} 已复制到剪贴板`);
        return;
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        antMessage.success(`${label} 已复制到剪贴板`);
      }
    } catch (e) {
      antMessage.error('复制失败');
    }
  };

  const handleCopyIp = (ip: string) => {
    if (ip && ip !== '-') copyToClipboard(ip, 'IP地址');
  };

  const handleCopyMac = (mac: string) => {
    if (mac && mac !== '-') copyToClipboard(mac, 'MAC地址');
  };

  // 阻止事件冒泡，避免触发行点击
  const stopPropagation = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  // 调试模式 / 兼容模式 状态已上提到 AppContext，登录/退出设备不会丢失，仅刷新浏览器或重开浏览器时清除
  const [contextMenu, setContextMenu] = useState<{ visible: boolean; x: number; y: number; device: DeviceInfo | null }>({ visible: false, x: 0, y: 0, device: null });
  const contextMenuRef = React.useRef<HTMLDivElement>(null);
  const themeDropdownRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (rememberPassword) {
      const savedPwd = localStorage.getItem('savedPassword');
      if (savedPwd) setPassword(_decrypt(savedPwd));
    }
  }, [rememberPassword]);

  // 点击外部关闭主题下拉和右键菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (themeDropdownRef.current && !themeDropdownRef.current.contains(e.target as Node)) {
        setThemeDropdownVisible(false);
      }
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(prev => prev.visible ? { ...prev, visible: false } : prev);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Alt+Shift+Z 打开调试弹窗
  useEffect(() => {
    const handleDebugKey = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && (e.key === 'Z' || e.key === 'z')) {
        e.preventDefault();
        setDebugModalVisible(true);
      }
    };
    document.addEventListener('keydown', handleDebugKey);
    return () => document.removeEventListener('keydown', handleDebugKey);
  }, []);

  const fetchDevices = useCallback(async () => {
    try {
      const data = await api.getDevices();
      setDevices(data);
    } catch (e) {
      console.error('获取设备列表失败:', e);
    }
  }, []);

  useEffect(() => {
    fetchDevices();
    const interval = setInterval(fetchDevices, 5000);
    return () => clearInterval(interval);
  }, [fetchDevices]);

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const res = await fetch('/api/app-version');
        const data = await res.json();
        setAppVersion(data.version || '');
      } catch (_) {}
    };
    fetchVersion();
  }, []);

  useEffect(() => {
    const checkUpdate = async () => {
      try {
        const res = await fetch('/api/check-update');
        const data = await res.json();
        if (data.has_update) {
          setUpdateInfo({
            currentVersion: data.current_version || '',
            latestVersion: data.latest_version || '',
            changelog: data.changelog || '',
            downloadUrl: data.download_url || '',
          });
          setUpdateVisible(true);
        }
      } catch (_) {}
    };
    checkUpdate();
    const updateInterval = setInterval(checkUpdate, 60000);
    return () => clearInterval(updateInterval);
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const data = await api.refreshDevices();
      setDevices(data);
    } catch (e) {
      console.error('刷新失败:', e);
    } finally {
      setRefreshing(false);
    }
  };

  const handleLogin = async () => {
    if (!ip) {
      setError('请输入设备IP地址');
      return;
    }
    if (!username) {
      setError('请输入用户名');
      return;
    }

    if (rememberPassword) {
      localStorage.setItem('rememberPwd', 'true');
      localStorage.setItem('savedIp', ip);
      localStorage.setItem('savedUsername', username);
      localStorage.setItem('savedPassword', _encrypt(password));
    } else {
      localStorage.removeItem('rememberPwd');
      localStorage.removeItem('savedIp');
      localStorage.removeItem('savedUsername');
      localStorage.removeItem('savedPassword');
    }

    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip, username, password, platform: selectedPlatform, compat_mode: compatModeEnabled }),
      });
      const result = await response.json();

      if (result.status === 'success') {
        setRouter({
          name: result.identity || '设备',
          ipAddress: result.ip,
          status: 'online',
          model: result.board_name || '---',
          osVersion: result.routeros_version || '---',
          username: result.username,
          password: password,
          platform: selectedPlatform,
        });
        setLoggedIn(true);
      } else {
        // 重置诊断弹窗状态
        setDiagnosisModalVisible(false);
        setDiagnosisContent('');
        setIpConflict(false);
        setConflictDetails([]);

        // 兼容 FastAPI HTTPException 的 detail 字段
        const rawMsg = result.message || result.detail || '登录失败';
        let errorMsg = rawMsg;
        const msg = rawMsg.toLowerCase();
        if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('超时')) {
          errorMsg = '连接超时，请检查设备IP地址是否正确';
        } else if (msg.includes('refused') || msg.includes('connection refused') || msg.includes('连接被拒绝')) {
          errorMsg = '连接被拒绝，请检查设备服务是否开启';
        } else if (msg.includes('no route') || msg.includes('unreachable') || msg.includes('不可达')) {
          errorMsg = '设备不可达，请检查网络连接';
        } else if (msg.includes('password') || msg.includes('auth') || msg.includes('credential') || msg.includes('用户名或密码')) {
          errorMsg = '用户名或密码错误';
        }
        
        // 有诊断信息时弹出Modal
        if (result.diagnosis && result.diagnosis.message) {
          setDiagnosisContent(result.diagnosis.message);
          if (result.diagnosis.ip_conflict) {
            setIpConflict(true);
            setConflictDetails(result.diagnosis.conflict_details || []);
          } else {
            setIpConflict(false);
            setConflictDetails([]);
          }
          setDiagnosisModalVisible(true);
          setError(errorMsg);
        } else {
          setError(errorMsg);
        }
      }
    } catch (e: any) {
      setError(e.message || '连接服务器失败，请确保后端服务已启动');
    } finally {
      setLoading(false);
    }
  };

  const selectDevice = (device: DeviceInfo) => {
    const deviceIp = device['IPv4-Address'] || device.ipv4_address || device.ip || '';
    if (deviceIp) {
      setIp(deviceIp);
      setSelectedPlatform((device['Platform'] || '').toString());
      setSelectedMac((device['MAC-Address'] || device.mac_address || '').toString());
      if ((device['Identity'] || device.identity) && (device['Identity'] || device.identity) !== 'Unknown') {
        setUsername('admin');
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleLogin();
  };

  // 启用调试模式（状态保存在 AppContext，登录/退出设备不丢失，刷新浏览器清除）
  const handleEnableDebugMode = () => {
    setDebugModeEnabled(true);
  };

  // 启用/关闭兼容模式（状态保存在 AppContext，登录/退出设备不丢失，刷新浏览器清除）
  const handleToggleCompatMode = () => {
    setCompatModeEnabled(!compatModeEnabled);
  };

  // 右键菜单处理
  const handleContextMenu = (e: React.MouseEvent, device: DeviceInfo) => {
    console.log('[DEBUG] 右键触发, debugModeEnabled:', debugModeEnabled);
    if (!debugModeEnabled) return;
    e.preventDefault();
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, device });
    console.log('[DEBUG] 右键菜单已显示');
  };

  // 使用英文工具
  const handleEnglishTool = async () => {
    const device = contextMenu.device;
    setContextMenu({ visible: false, x: 0, y: 0, device: null });
    if (!device) return;

    const mac = (device['MAC-Address'] || device.mac_address || '').toString();
    console.log('[DEBUG] 调用后端, MAC:', mac);
    if (!mac) return;

    try {
      const res = await fetch('/api/debug-trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mac }),
      });
      const data = await res.json();
      console.log('[DEBUG] 后端响应:', data);
    } catch (e: any) {
      console.error('[DEBUG] 请求失败:', e);
    }
  };

  const filteredDevices = devices.filter(d => {
    const platform = (d['Platform'] || '').toString();
    const isSlsc = platform.toUpperCase().includes('SLSC');
    // 兼容模式启用时，同时显示 MikroTik 平台设备；否则仅显示 SLSC 平台设备
    if (!isSlsc && !compatModeEnabled) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    const identity = (d['Identity'] || d.identity || '').toString().toLowerCase();
    const dip = (d['IPv4-Address'] || d.ipv4_address || d.ip || '').toString().toLowerCase();
    const macAddr = (d['MAC-Address'] || d.mac_address || '').toString().toLowerCase();
    return identity.includes(s) || dip.includes(s) || macAddr.includes(s);
  });

  // 应用排序
  const sortedDevices = sortColumn ? sortDevices(filteredDevices, sortColumn, sortOrder) : filteredDevices;

  return (
    <>
    <div className={styles.container}>
      <div className={styles.leftPanel}>
        <div className={styles.brand}>
          <h1>瞬联调试工具{appVersion && <span className={styles.versionText}>v{appVersion}</span>}</h1>
          <p>网络设备管理平台</p>
        </div>

        <div className={styles.loginForm}>
          <h2 className={styles.formTitle}>设备登录</h2>

          <div className={styles.formGroup}>
            <label>设备 IP</label>
            <input
              type="text"
              value={ip}
              onChange={e => setIp(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="192.168.1.1"
            />
          </div>

          <div className={styles.formGroup}>
            <label>用户名</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="admin"
            />
          </div>

          <div className={styles.formGroup}>
            <label>密码</label>
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="请输入密码"
            />
          </div>

          <div className={styles.checkboxRow}>
            <div className={styles.checkboxItem}>
              <input
                type="checkbox"
                id="showPwd"
                checked={showPassword}
                onChange={e => setShowPassword(e.target.checked)}
              />
              <label htmlFor="showPwd">显示密码</label>
            </div>
            <div className={styles.checkboxItem}>
              <input
                type="checkbox"
                id="rememberPwd"
                checked={rememberPassword}
                onChange={e => setRememberPassword(e.target.checked)}
              />
              <label htmlFor="rememberPwd">记住密码</label>
            </div>
          </div>

          {error && <div className={styles.errorMsg}>{error}</div>}

          <div className={styles.actions}>
            <button className={styles.refreshBtn} onClick={handleRefresh} disabled={refreshing}>
              {refreshing ? '搜索中...' : '搜索设备'}
            </button>
            <button className={styles.loginBtn} onClick={handleLogin} disabled={loading}>
              {loading ? '连接中...' : '登录'}
            </button>
          </div>
        </div>
      </div>

      <div className={styles.rightPanel}>
        <div className={styles.topBar}>
          <div className={styles.searchWrapper}>
            <SearchOutlined className={styles.searchIcon} />
            <input
              className={styles.searchInput}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索设备 (IP / 名称 / MAC)..."
            />
          </div>
          <div className={styles.themeDropdown} ref={themeDropdownRef}>
            <div className={styles.themeBtnWrapper}>
              <button
                className={styles.themeIconBtn}
                onClick={() => setThemeDropdownVisible(!themeDropdownVisible)}
                title="切换模式"
              >
                <SkinOutlined />
              </button>
              <span className={styles.themeBtnLabel}>主题</span>
            </div>
            {themeDropdownVisible && (
              <div className={styles.themeDropdownMenu}>
                <div
                  className={`${styles.themeDropdownItem} ${theme === 'light' ? styles.themeDropdownItemActive : ''}`}
                  onClick={() => { setTheme('light'); setThemeDropdownVisible(false); }}
                >
                  <SunOutlined />
                  <span>浅色模式</span>
                </div>
                <div
                  className={`${styles.themeDropdownItem} ${theme === 'dark' ? styles.themeDropdownItemActive : ''}`}
                  onClick={() => { setTheme('dark'); setThemeDropdownVisible(false); }}
                >
                  <MoonOutlined />
                  <span>深色模式</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className={styles.discoveryHeader}>
          <h2 className={styles.discoveryTitle}>设备发现</h2>
          <span className={styles.deviceCount}>{filteredDevices.length} 台设备</span>
        </div>

        <div className={styles.deviceList}>
          {filteredDevices.length === 0 ? (
            <div className={styles.emptyState}>
              <p>未发现设备</p>
              <small>点击"搜索设备"开始扫描</small>
            </div>
          ) : (
            <table className={styles.deviceTable}>
              <thead>
                <tr>
                  <th className={sortColumn === 'name' ? styles.thActive : ''} onClick={() => handleSort('name')}>
                    名称{sortColumn === 'name' && <span className={styles.sortIndicator}>{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                  </th>
                  <th className={sortColumn === 'ip' ? styles.thActive : ''} onClick={() => handleSort('ip')}>
                    IP 地址{sortColumn === 'ip' && <span className={styles.sortIndicator}>{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                  </th>
                  <th className={sortColumn === 'mac' ? styles.thActive : ''} onClick={() => handleSort('mac')}>
                    MAC 地址{sortColumn === 'mac' && <span className={styles.sortIndicator}>{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                  </th>
                  <th className={sortColumn === 'version' ? styles.thActive : ''} onClick={() => handleSort('version')}>
                    版本{sortColumn === 'version' && <span className={styles.sortIndicator}>{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                  </th>
                  <th className={sortColumn === 'interface' ? styles.thActive : ''} onClick={() => handleSort('interface')}>
                    发现接口{sortColumn === 'interface' && <span className={styles.sortIndicator}>{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                  </th>
                  <th className={sortColumn === 'uptime' ? styles.thActive : ''} onClick={() => handleSort('uptime')}>
                    运行时间{sortColumn === 'uptime' && <span className={styles.sortIndicator}>{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedDevices.map((d, i) => {
                  const dip = d['IPv4-Address'] || d.ipv4_address || d.ip || '';
                  return (
                    <tr
                      key={d['MAC-Address'] || d.mac_address || i}
                      className={ip === dip ? styles.selected : ''}
                      onClick={() => selectDevice(d)}
                      onDoubleClick={() => { selectDevice(d); handleLogin(); }}
                      onContextMenu={(e) => handleContextMenu(e, d)}
                    >
                      <td>
                        <span className={styles.deviceName}>{d['Identity'] || d.identity || '-'}</span>
                      </td>
                      <td>
                        <span
                          className={styles.copyableText}
                          onClick={(e) => { stopPropagation(e); handleCopyIp(dip || '-'); }}
                          title="点击复制IP地址"
                        >
                          {dip || '-'}
                        </span>
                      </td>
                      <td>
                        <span
                          className={styles.copyableText}
                          onClick={(e) => { stopPropagation(e); handleCopyMac(d['MAC-Address'] || d.mac_address || '-'); }}
                          title="点击复制MAC地址"
                        >
                          {d['MAC-Address'] || d.mac_address || '-'}
                        </span>
                      </td>
                      <td>{(d['Version'] || '').toString().replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '') || '-'}</td>
                      <td>{d['Interface name'] || d.interface_name || '--'}</td>
                      <td>{d['Uptime'] || '--'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
      <UpdateModal
        visible={updateVisible}
        currentVersion={updateInfo.currentVersion}
        latestVersion={updateInfo.latestVersion}
        changelog={updateInfo.changelog}
        downloadUrl={updateInfo.downloadUrl}
        onClose={() => setUpdateVisible(false)}
      />
      {/* Alt+Shift+Z 高级选项弹窗 */}
      {debugModalVisible && (
        <div className={styles.debugOverlay} onClick={() => setDebugModalVisible(false)}>
          <div className={styles.debugModal} onClick={e => e.stopPropagation()}>
            <div className={styles.debugHeader}>
              <h2 className={styles.debugTitle}>高级选项</h2>
              <button className={styles.debugCloseBtn} onClick={() => setDebugModalVisible(false)}>✕</button>
            </div>
            <div className={styles.debugBody}>
              {/* 英文调试工具 */}
              <div className={styles.debugOptionRow}>
                <div className={styles.debugOptionInfo}>
                  <div className={styles.debugOptionTitle}>英文调试工具</div>
                  <div className={styles.debugDesc}>
                    启用后，可在设备列表中右键单击设备调用英文调试工具。
                    <br />
                    该功能仅对当前会话有效，关闭或刷新页面后自动失效。
                  </div>
                  {debugModeEnabled && (
                    <div className={styles.debugActiveBadge}>● 当前会话已启用</div>
                  )}
                </div>
                <button
                  className={`${styles.debugBtnPrimary} ${styles.debugBtnCompact}`}
                  onClick={handleEnableDebugMode}
                >
                  {debugModeEnabled ? '重新启用' : '启用'}
                </button>
              </div>

              {/* 兼容模式 */}
              <div className={styles.debugOptionRow}>
                <div className={styles.debugOptionInfo}>
                  <div className={styles.debugOptionTitle}>兼容模式</div>
                  <div className={styles.debugDesc}>
                    启用后，可搜索其它品牌设备。
                    <br />
                    该功能仅对当前会话有效，关闭或刷新页面后自动失效。
                  </div>
                  {compatModeEnabled && (
                    <div className={styles.debugActiveBadge}>● 当前会话已启用</div>
                  )}
                </div>
                <button
                  className={`${styles.debugBtnPrimary} ${styles.debugBtnCompact}`}
                  onClick={handleToggleCompatMode}
                >
                  {compatModeEnabled ? '关闭' : '启用'}
                </button>
              </div>
            </div>
            <div className={styles.debugFooter}>
              <button className={styles.debugBtnSecondary} onClick={() => setDebugModalVisible(false)}>关闭</button>
            </div>
          </div>
        </div>
      )}
      {/* 右键菜单 - 仅调试模式激活时显示 */}
      {contextMenu.visible && (
        <div ref={contextMenuRef} className={styles.contextMenu} style={{ left: contextMenu.x, top: contextMenu.y }}>
          <div className={styles.contextMenuItem} onClick={handleEnglishTool}>
            使用英文工具
          </div>
        </div>
      )}
      {/* 网络诊断弹窗 */}
      <Modal
        title={
          <span>
            网络诊断
            {ipConflict && (
              <span style={{ color: '#ff4d4f', marginLeft: 8 }}>
                ⚠️ IP地址冲突
              </span>
            )}
          </span>
        }
        open={diagnosisModalVisible}
        onOk={() => setDiagnosisModalVisible(false)}
        onCancel={() => setDiagnosisModalVisible(false)}
        okText="关闭"
        width={500}
      >
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.8', fontSize: '14px' }}>
          {diagnosisContent}
        </div>
        {ipConflict && conflictDetails.length > 0 && (
          <div style={{ marginTop: 16, padding: 12, background: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 4 }}>
            <div style={{ color: '#ff4d4f', fontWeight: 'bold', marginBottom: 8 }}>
              冲突详情：
            </div>
            <div style={{ color: '#595959' }}>
              该IP对应多个MAC地址：
            </div>
            <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
              {conflictDetails.map((mac, index) => (
                <li key={index} style={{ fontFamily: 'monospace', color: '#cf1322' }}>
                  {mac}
                </li>
              ))}
            </ul>
            <div style={{ color: '#8c8c8c', fontSize: '12px' }}>
              可能原因：网络中存在IP地址配置冲突，请检查设备网络设置
            </div>
          </div>
        )}
      </Modal>
    </>
  );
};
