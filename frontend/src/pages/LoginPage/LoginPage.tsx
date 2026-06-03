import React, { useState, useEffect, useCallback } from 'react';
import { useAppState } from '../../contexts/AppContext';
import api from '../../services/api';
import { UpdateModal } from '../../components/organisms/UpdateModal/UpdateModal';
import type { DeviceInfo } from '../../types/api';
import styles from './LoginPage.module.css';

export const LoginPage: React.FC = () => {
  const { setRouter, setLoggedIn } = useAppState();
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

  useEffect(() => {
    if (rememberPassword) {
      const savedPwd = localStorage.getItem('savedPassword');
      if (savedPwd) setPassword(savedPwd);
    }
  }, [rememberPassword]);

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
        body: JSON.stringify({ ip, username, password }),
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
      if ((device['Identity'] || device.identity) && (device['Identity'] || device.identity) !== 'Unknown') {
        setUsername('admin');
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleLogin();
  };

  const filteredDevices = devices.filter(d => {
    if (!search) return true;
    const s = search.toLowerCase();
    const identity = (d['Identity'] || d.identity || '').toString().toLowerCase();
    const dip = (d['IPv4-Address'] || d.ipv4_address || d.ip || '').toString().toLowerCase();
    const mac = (d['MAC-Address'] || d.mac_address || '').toString().toLowerCase();
    return identity.includes(s) || dip.includes(s) || mac.includes(s);
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
        <div className={styles.discoveryHeader}>
          <h2 className={styles.discoveryTitle}>设备发现</h2>
          <span className={styles.deviceCount}>{devices.length} 台设备</span>
        </div>

        <div className={styles.searchBox}>
          <input
            className={styles.searchInput}
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索设备 (IP / 名称 / MAC)..."
          />
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
    </>
  );
};
