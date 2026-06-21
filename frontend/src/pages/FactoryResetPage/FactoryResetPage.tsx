import React, { useState } from 'react';
import { Modal, Button, message as antMessage } from 'antd';
import { ExclamationCircleOutlined, UndoOutlined } from '@ant-design/icons';
import { useAppState } from '../../contexts/AppContext';
import styles from './FactoryResetPage.module.css';

export const FactoryResetPage: React.FC = () => {
  const { router } = useAppState();
  const [resetLoading, setResetLoading] = useState(false);
  const [resetModalVisible, setResetModalVisible] = useState(false);

  const handleFactoryReset = async () => {
    setResetLoading(true);
    try {
      const resp = await fetch('/api/system/factory-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip: router?.ipAddress || '',
        }),
      });
      const data = await resp.json();
      if (data.status === 'success') {
        antMessage.success('恢复出厂命令已发送，设备将自动重启');
      } else {
        antMessage.error(data.message || '恢复出厂失败');
      }
    } catch (err) {
      antMessage.error('发送恢复出厂命令失败');
    } finally {
      setResetLoading(false);
      setResetModalVisible(false);
    }
  };

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>恢复出厂设置</h2>
      <div className={styles.card}>
        <div className={styles.iconWrapper}>
          <UndoOutlined className={styles.icon} />
        </div>
        <p className={styles.description}>
          恢复出厂设置将清除设备上的所有配置，恢复到出厂默认状态，设备将自动重启。
        </p>
        <p className={styles.warning}>
          当前设备：<strong>{router?.name}</strong> ({router?.ipAddress})<br />
          此操作不可撤销，请谨慎操作！
        </p>
        <Button
          type="primary"
          danger
          size="large"
          icon={<UndoOutlined />}
          loading={resetLoading}
          onClick={() => setResetModalVisible(true)}
        >
          恢复出厂设置
        </Button>
      </div>

      <Modal
        title={
          <span>
            <ExclamationCircleOutlined style={{ color: '#ff4d4f', marginRight: 8 }} />
            确认恢复出厂设置
          </span>
        }
        open={resetModalVisible}
        onCancel={() => setResetModalVisible(false)}
        footer={[
          <Button key="cancel" onClick={() => setResetModalVisible(false)}>
            取消
          </Button>,
          <Button key="confirm" type="primary" danger onClick={handleFactoryReset} loading={resetLoading}>
            确认恢复出厂
          </Button>,
        ]}
      >
        <p>您确定要将设备 <strong>{router?.name}</strong> 恢复出厂设置吗？</p>
        <p style={{ color: '#ff4d4f', marginTop: 12 }}>
          此操作将清除设备上的所有配置并恢复到出厂状态，设备将自动重启。此操作不可撤销！
        </p>
      </Modal>
    </div>
  );
};
