import React, { useState } from 'react';
import { useAppState } from '../../contexts/AppContext';
import { Button } from '../../components/atoms/Button/Button';
import { Modal, message as antMessage } from 'antd';
import styles from './SystemPage.module.css';

export const SystemPage: React.FC = () => {
  const { router } = useAppState();
  const [deviceName, setDeviceName] = useState(router?.name || '');
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleSave = async () => {
    if (!deviceName) return;
    setSaving(true);
    try {
      await fetch('/api/device/identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip: router?.ipAddress || '',
          username: '',
          password: '',
          identity: deviceName,
        }),
      });
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const handleFactoryReset = () => {
    Modal.confirm({
      title: '恢复出厂设置',
      content: '此操作将清除设备上的所有配置并恢复到出厂状态，设备将自动重启。确定要继续吗？',
      okText: '确定恢复',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        setResetting(true);
        try {
          const resp = await fetch('/api/system/factory-reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip: router?.ipAddress || '' }),
          });
          const data = await resp.json();
          if (data.status === 'success') {
            antMessage.success('恢复出厂命令已发送，设备将重启');
          } else {
            antMessage.error(data.message || '恢复出厂失败');
          }
        } catch (e) {
          antMessage.error('恢复出厂请求失败');
        } finally {
          setResetting(false);
        }
      },
    });
  };

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>系统设置</h2>
      <div className={styles.formGroup}>
        <label>设备名称 (Identity)</label>
        <div style={{ display: 'flex', gap: 'var(--space-md)', alignItems: 'center' }}>
          <input
            type="text"
            value={deviceName}
            onChange={e => setDeviceName(e.target.value)}
            maxLength={32}
          />
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>

      <div className={styles.divider} />

      <div className={styles.dangerZone}>
        <h3 className={styles.dangerTitle}>危险操作</h3>
        <div className={styles.dangerItem}>
          <div>
            <div className={styles.dangerLabel}>恢复出厂设置</div>
            <div className={styles.dangerDesc}>清除设备所有配置并恢复到出厂状态，设备将自动重启</div>
          </div>
          <Button variant="danger" onClick={handleFactoryReset} disabled={resetting}>
            {resetting ? '执行中...' : '恢复出厂'}
          </Button>
        </div>
      </div>
    </div>
  );
};
