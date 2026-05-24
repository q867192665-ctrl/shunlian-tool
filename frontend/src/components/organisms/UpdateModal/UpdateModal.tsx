import React from 'react';
import styles from './UpdateModal.module.css';

interface UpdateModalProps {
  visible: boolean;
  currentVersion: string;
  latestVersion: string;
  changelog: string;
  downloadUrl: string;
  onClose: () => void;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  visible,
  currentVersion,
  latestVersion,
  changelog,
  downloadUrl,
  onClose,
}) => {
  if (!visible) return null;

  const handleDownload = () => {
    if (downloadUrl) {
      window.open(downloadUrl, '_blank');
    }
    onClose();
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>发现新版本</h2>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div className={styles.body}>
          <div className={styles.versionInfo}>
            <span className={`${styles.versionTag} ${styles.currentVersion}`}>v{currentVersion}</span>
            <span className={styles.arrow}>→</span>
            <span className={`${styles.versionTag} ${styles.latestVersion}`}>v{latestVersion}</span>
          </div>
          {changelog && (
            <div className={styles.changelog}>{changelog}</div>
          )}
        </div>
        <div className={styles.footer}>
          <button className={styles.btnSecondary} onClick={onClose}>稍后再说</button>
          {downloadUrl && (
            <button className={styles.btnPrimary} onClick={handleDownload}>立即更新</button>
          )}
        </div>
      </div>
    </div>
  );
};
