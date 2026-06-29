import React, { useState } from 'react';
import { Modal, Button, message as antMessage } from 'antd';
import { ExclamationCircleOutlined, ArrowDownOutlined } from '@ant-design/icons';
import { useAppState } from '../../contexts/AppContext';
import styles from './SystemDowngradePage.module.css';

export const SystemDowngradePage: React.FC = () => {
  const { router } = useAppState();
  const [downgradeLoading, setDowngradeLoading] = useState(false);
  const [downgradeModalVisible, setDowngradeModalVisible] = useState(false);

  const handleDowngrade = async () => {
    setDowngradeLoading(true);
    try {
      const resp = await fetch('/api/system/downgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip: router?.ipAddress || '',
        }),
      });
      const data = await resp.json();
      if (data.status === 'success') {
        antMessage.success('系统降级命令已发送，设备将自动重启');
      } else {
        antMessage.error(data.message || '系统降级失败');
      }
    } catch (err) {
      antMessage.error('发送系统降级命令失败');
    } finally {
      setDowngradeLoading(false);
      setDowngradeModalVisible(false);
    }
  };

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>系统降级</h2>
      <div className={styles.card}>
        <div className={styles.iconWrapper}>
          <ArrowDownOutlined className={styles.icon} />
        </div>
        <p className={styles.description}>
          系统降级将把设备回退到已上传的旧版本固件。请确保已将目标版本的 .npk 文件上传至设备。
        </p>
        <p className={styles.warning}>
          当前设备：<strong>{router?.name}</strong> ({router?.ipAddress})<br />
          执行后设备将自动重启并降级，此操作不可撤销，请谨慎操作！
        </p>
        <Button
          type="primary"
          danger
          size="large"
          icon={<ArrowDownOutlined />}
          loading={downgradeLoading}
          onClick={() => setDowngradeModalVisible(true)}
        >
          执行系统降级
        </Button>
      </div>

      <Modal
        title={
          <span>
            <ExclamationCircleOutlined style={{ color: '#ff4d4f', marginRight: 8 }} />
            确认系统降级
          </span>
        }
        open={downgradeModalVisible}
        onCancel={() => setDowngradeModalVisible(false)}
        footer={[
          <Button key="cancel" onClick={() => setDowngradeModalVisible(false)}>
            取消
          </Button>,
          <Button key="confirm" type="primary" danger onClick={handleDowngrade} loading={downgradeLoading}>
            确认降级
          </Button>,
        ]}
      >
        <p>您确定要对设备 <strong>{router?.name}</strong> 执行系统降级吗？</p>
        <p style={{ color: '#ff4d4f', marginTop: 12 }}>
          执行后设备将自动重启并降级到已上传的旧版本。请确保已上传正确架构和版本的 .npk 文件，否则可能导致设备无法启动。此操作不可撤销！
        </p>
      </Modal>
    </div>
  );
};
