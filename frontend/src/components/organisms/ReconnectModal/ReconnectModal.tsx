import React, { useState, useEffect, useRef } from 'react';
import {
  DisconnectOutlined,
  LogoutOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import { useAppState } from '../../../contexts/AppContext';
import styles from './ReconnectModal.module.css';

interface ReconnectModalProps {
  visible: boolean;
  reason: string;
  onReturnToLogin: () => void;
  onReconnectSuccess?: () => void;
}

type ReconnectStatus = 'connecting' | 'success' | 'failed' | 'timeout';

export const ReconnectModal: React.FC<ReconnectModalProps> = ({
  visible,
  reason,
  onReturnToLogin,
  onReconnectSuccess,
}) => {
  const { router } = useAppState();
  const [status, setStatus] = useState<ReconnectStatus>('connecting');
  const [countdown, setCountdown] = useState(15);
  const [attemptCount, setAttemptCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const attemptReconnect = async (): Promise<boolean> => {
    if (!router?.ipAddress || !router.username || !router.password) {
      return false;
    }

    try {
      const response = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip: router.ipAddress,
          username: router.username,
          password: router.password,
          platform: router.platform || '',
        }),
      });

      const data = await response.json();
      return data.status === 'success';
    } catch (error) {
      console.error('[ReconnectModal] 重连失败:', error);
      return false;
    }
  };

  useEffect(() => {
    if (!visible) {
      setStatus('connecting');
      setCountdown(15);
      setAttemptCount(0);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      return;
    }

    setStatus('connecting');
    setCountdown(15);
    setAttemptCount(0);

    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (countdownRef.current) {
            clearInterval(countdownRef.current);
            countdownRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    timerRef.current = setInterval(async () => {
      setAttemptCount((prev) => prev + 1);
      const success = await attemptReconnect();

      if (success) {
        setStatus('success');
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        if (countdownRef.current) {
          clearInterval(countdownRef.current);
          countdownRef.current = null;
        }
        setTimeout(() => {
          onReconnectSuccess?.();
        }, 1500);
      }
    }, 3000);

    const timeoutId = setTimeout(() => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      setStatus('timeout');
    }, 15000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      clearTimeout(timeoutId);
    };
  }, [visible, router?.ipAddress, router?.username, router?.password, onReconnectSuccess]);

  useEffect(() => {
    if (countdown === 0 && status === 'connecting') {
      setStatus('timeout');
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [countdown, status]);

  if (!visible) return null;

  const renderIcon = () => {
    switch (status) {
      case 'connecting':
        return (
          <div className={styles.iconWrapper}>
            <SyncOutlined spin className={styles.reconnectIcon} />
          </div>
        );
      case 'success':
        return (
          <div className={`${styles.iconWrapper} ${styles.successWrapper}`}>
            <CheckCircleOutlined className={styles.successIcon} />
          </div>
        );
      case 'timeout':
      case 'failed':
        return (
          <div className={styles.iconWrapper}>
            <CloseCircleOutlined className={styles.failIcon} />
          </div>
        );
      default:
        return (
          <div className={styles.iconWrapper}>
            <DisconnectOutlined className={styles.icon} />
          </div>
        );
    }
  };

  const renderTitle = () => {
    switch (status) {
      case 'connecting':
        return '正在尝试重新连接...';
      case 'success':
        return '重连成功';
      case 'timeout':
        return '重连超时';
      case 'failed':
        return '重连失败';
      default:
        return '设备连接已断开';
    }
  };

  const renderContent = () => {
    const shouldHideReason = reason === 'WebSocket 连接已断开';
    switch (status) {
      case 'connecting':
        return (
          <>
            {!shouldHideReason && <p className={styles.reason}>{reason}</p>}
            <div className={styles.progressContainer}>
              <div className={styles.progressBar}>
                <div
                  className={styles.progressFill}
                  style={{ width: `${(countdown / 15) * 100}%` }}
                />
              </div>
              <div className={styles.progressInfo}>
                <span className={styles.countdownText}>
                  剩余时间: <strong>{countdown}</strong> 秒
                </span>
                <span className={styles.attemptText}>
                  尝试次数: <strong>{attemptCount}</strong>
                </span>
              </div>
            </div>
            <p className={styles.hint}>
              系统正在自动尝试重新连接设备...
            </p>
          </>
        );
      case 'success':
        return (
          <>
            {!shouldHideReason && <p className={styles.reason}>{reason}</p>}
            <p className={styles.hint}>
              已成功重新连接到设备，正在恢复...
            </p>
          </>
        );
      case 'timeout':
      case 'failed':
        return (
          <>
            {!shouldHideReason && <p className={styles.reason}>{reason}</p>}
            <p className={styles.hint}>
              无法重新连接到设备，请检查网络后返回登录页面重新连接。
            </p>
            <button className={styles.logoutButton} onClick={onReturnToLogin}>
              <LogoutOutlined />
              返回登录页面
            </button>
          </>
        );
      default:
        return (
          <>
            {!shouldHideReason && <p className={styles.reason}>{reason}</p>}
            <p className={styles.hint}>
              与设备的连接已丢失。
              <br />
              请返回登录页面重新连接设备。
            </p>
            <button className={styles.logoutButton} onClick={onReturnToLogin}>
              <LogoutOutlined />
              返回登录页面
            </button>
          </>
        );
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        {renderIcon()}
        <h2 className={styles.title}>{renderTitle()}</h2>
        {renderContent()}
      </div>
    </div>
  );
};
