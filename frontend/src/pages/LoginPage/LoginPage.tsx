import React, { useState, useEffect, useCallback } from 'react';
import { useAppState } from '../../contexts/AppContext';
import { SunOutlined, MoonOutlined, SearchOutlined, SkinOutlined } from '@ant-design/icons';
import api from '../../services/api';
import { UpdateModal } from '../../components/organisms/UpdateModal/UpdateModal';
import type { DeviceInfo } from '../../types/api';
import styles from './LoginPage.module.css';

export const LoginPage: React.FC = () => {
  const { setRouter, setLoggedIn, theme, setTheme } = useAppState();
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
  // 调试模式仅当次会话有效：使用 sessionStorage，网页重开（关闭标签页/刷新）后自动失效
  const [debugModeEnabled, setDebugModeEnabled] = useState(() => sessionStorage.getItem('debugModeEnabled') === 'true');
  const [contextMenu, setContextMenu] = useState<{ visible: boolean; x: number; y: number; device: DeviceInfo | null }>({ visible: false, x: 0, y: 0, device: null });
  const contextMenuRef = React.useRef<HTMLDivElement>(null);
  const themeDropdownRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (rememberPassword) {
      const savedPwd = localStorage.getItem('savedPassword');
      if (savedPwd) setPassword(savedPwd);
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
      localStorage.setItem('savedPassword', password);
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
        body: JSON.stringify({ ip, username, password, platform: selectedPlatform }),
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
        let errorMsg = result.message || '登录失败';
        const msg = (result.message || '').toLowerCase();
        if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('超时')) {
          errorMsg = '连接超时，请检查设备IP地址是否正确';
        } else if (msg.includes('refused') || msg.includes('connection refused') || msg.includes('连接被拒绝')) {
          errorMsg = '连接被拒绝，请检查设备服务是否开启';
        } else if (msg.includes('no route') || msg.includes('unreachable') || msg.includes('不可达')) {
          errorMsg = '设备不可达，请检查网络连接';
        } else if (msg.includes('password') || msg.includes('auth') || msg.includes('credential') || msg.includes('用户名或密码')) {
          errorMsg = '用户名或密码错误';
        }
        setError(errorMsg);
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

  // 启用调试模式（仅当次会话有效，sessionStorage 在标签页关闭/刷新后自动清除）
  const handleEnableDebugMode = () => {
    sessionStorage.setItem('debugModeEnabled', 'true');
    setDebugModeEnabled(true);
    setDebugModalVisible(false);
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
    if (!platform.toUpperCase().includes('SLSC')) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    const identity = (d['Identity'] || d.identity || '').toString().toLowerCase();
    const dip = (d['IPv4-Address'] || d.ipv4_address || d.ip || '').toString().toLowerCase();
    const macAddr = (d['MAC-Address'] || d.mac_address || '').toString().toLowerCase();
    return identity.includes(s) || dip.includes(s) || macAddr.includes(s);
  });

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
                  <th>状态</th>
                  <th>名称</th>
                  <th>IP 地址</th>
                  <th>MAC 地址</th>
                  <th>版本</th>
                  <th>发现接口</th>
                  <th>运行时间</th>
                </tr>
              </thead>
              <tbody>
                {filteredDevices.map((d, i) => {
                  const dip = d['IPv4-Address'] || d.ipv4_address || d.ip || '';
                  return (
                    <tr
                      key={d['MAC-Address'] || d.mac_address || i}
                      className={ip === dip ? styles.selected : ''}
                      onClick={() => selectDevice(d)}
                      onDoubleClick={() => { selectDevice(d); handleLogin(); }}
                      onContextMenu={(e) => handleContextMenu(e, d)}
                    >
                      <td><span className={styles.statusDot} /></td>
                      <td className={styles.deviceName}>{d['Identity'] || d.identity || '-'}</td>
                      <td className={styles.deviceIp}>{dip || '-'}</td>
                      <td className={styles.deviceMac}>{d['MAC-Address'] || d.mac_address || '-'}</td>
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
      {/* Alt+Shift+Z 调试模式激活弹窗 */}
      {debugModalVisible && (
        <div className={styles.debugOverlay} onClick={() => setDebugModalVisible(false)}>
          <div className={styles.debugModal} onClick={e => e.stopPropagation()}>
            <div className={styles.debugHeader}>
              <h2 className={styles.debugTitle}>调试选项</h2>
              <button className={styles.debugCloseBtn} onClick={() => setDebugModalVisible(false)}>✕</button>
            </div>
            <div className={styles.debugBody}>
              <div className={styles.debugDesc}>
                启用后，可在设备列表中右键单击设备调用英文调试工具。
                <br />
                该功能仅对当前会话有效，关闭或刷新页面后自动失效。
              </div>
              {debugModeEnabled && (
                <div className={styles.debugActiveBadge}>● 当前会话已启用</div>
              )}
            </div>
            <div className={styles.debugFooter}>
              <button className={styles.debugBtnSecondary} onClick={() => setDebugModalVisible(false)}>取消</button>
              <button className={styles.debugBtnPrimary} onClick={handleEnableDebugMode}>
                {debugModeEnabled ? '重新启用' : '启用英文调试工具'}
              </button>
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
    </>
  );
};
