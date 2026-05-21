import React, { useState } from 'react';
import { Modal, Button, message as antMessage, Spin } from 'antd';
import { ExclamationCircleOutlined, PoweroffOutlined } from '@ant-design/icons';
import { useAppState } from '../../contexts/AppContext';
import styles from './RebootPage.module.css';

export const RebootPage: React.FC = () => {
  const { router } = useAppState();
  const [rebootLoading, setRebootLoading] = useState(false);
  const [rebootModalVisible, setRebootModalVisible] = useState(false);

  const handleReboot = async () => {
    setRebootLoading(true);
    try {
      const resp = await fetch('/api/system/reboot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip: router?.ipAddress || '',
        }),
      });
      const data = await resp.json();
      if (data.status === 'success') {
        antMessage.success('设备重启命令已发送，设备将在几分钟后重新上线');
      } else {
        antMessage.error(data.message || '重启失败');
      }
    } catch (err) {
      antMessage.error('发送重启命令失败');
    } finally {
      setRebootLoading(false);
      setRebootModalVisible(false);
    }
  };

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>系统重启</h2>
      <div className={styles.card}>
        <div className={styles.iconWrapper}>
          <PoweroffOutlined className={styles.icon} />
        </div>
        <p className={styles.description}>
          重启设备将导致网络连接短暂中断。设备重启后，所有服务将自动恢复。
        </p>
        <p className={styles.warning}>
          当前设备：<strong>{router?.name}</strong> ({router?.ipAddress})
        </p>
        <Button
          type="primary"
          danger
          size="large"
          icon={<PoweroffOutlined />}
          loading={rebootLoading}
          onClick={() => setRebootModalVisible(true)}
        >
          重启设备
        </Button>
      </div>

      <Modal
        title={
          <span>
            <ExclamationCircleOutlined style={{ color: '#ff4d4f', marginRight: 8 }} />
            确认重启
          </span>
        }
        open={rebootModalVisible}
        onOk={handleReboot}
        onCancel={() => setRebootModalVisible(false)}
        okText="确认重启"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        cancelButtonProps={{ style: { display: 'inline-block' } }}
        footer={[
          <Button key="cancel" onClick={() => setRebootModalVisible(false)}>
            取消
          </Button>,
          <Button key="confirm" type="primary" danger onClick={handleReboot} loading={rebootLoading}>
            确认重启
          </Button>,
        ]}
      >
        <p>您确定要重启设备 <strong>{router?.name}</strong> 吗？</p>
        <p style={{ color: '#ff4d4f', marginTop: 12 }}>
          此操作将导致设备短暂离线，重启完成后将自动恢复连接。
        </p>
      </Modal>
    </div>
  );
};
