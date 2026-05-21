import React, { useState } from 'react';
import { useAppState } from '../../contexts/AppContext';
import { Button } from '../../components/atoms/Button/Button';
import styles from './SystemPage.module.css';

export const SystemPage: React.FC = () => {
  const { router } = useAppState();
  const [deviceName, setDeviceName] = useState(router?.name || '');
  const [saving, setSaving] = useState(false);

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
    </div>
  );
};
