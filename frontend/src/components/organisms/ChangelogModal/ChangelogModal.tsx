import React, { useState, useEffect } from 'react';
import styles from './ChangelogModal.module.css';

interface ChangelogModalProps {
  visible: boolean;
  onClose: () => void;
}

export const ChangelogModal: React.FC<ChangelogModalProps> = ({ visible, onClose }) => {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible) {
      setLoading(true);
      fetch('/api/changelog')
        .then(res => res.json())
        .then(data => {
          setContent(data.content || '暂无更新日志');
          setLoading(false);
        })
        .catch(() => {
          setContent('读取更新日志失败');
          setLoading(false);
        });
    }
  }, [visible]);

  if (!visible) return null;

  const renderMarkdown = (text: string) => {
    const lines = text.split('\n');
    const elements: React.ReactNode[] = [];
    let inList = false;
    let listItems: React.ReactNode[] = [];

    const flushList = () => {
      if (listItems.length > 0) {
        elements.push(
          <ul key={`list-${elements.length}`} className={styles.list}>
            {listItems}
          </ul>
        );
        listItems = [];
        inList = false;
      }
    };

    lines.forEach((line, index) => {
      const trimmed = line.trim();

      if (trimmed.startsWith('# ')) {
        flushList();
        elements.push(
          <h1 key={index} className={styles.h1}>{trimmed.substring(2)}</h1>
        );
      } else if (trimmed.startsWith('## ')) {
        flushList();
        elements.push(
          <h2 key={index} className={styles.h2}>{trimmed.substring(3)}</h2>
        );
      } else if (trimmed.startsWith('### ')) {
        flushList();
        elements.push(
          <h3 key={index} className={styles.h3}>{trimmed.substring(4)}</h3>
        );
      } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        inList = true;
        listItems.push(<li key={index}>{trimmed.substring(2)}</li>);
      } else if (trimmed === '') {
        flushList();
      } else {
        flushList();
        elements.push(
          <p key={index} className={styles.paragraph}>{trimmed}</p>
        );
      }
    });

    flushList();
    return elements;
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>更新日志</h2>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div className={styles.body}>
          {loading ? (
            <div className={styles.loading}>加载中...</div>
          ) : (
            <div className={styles.content}>
              {renderMarkdown(content)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
