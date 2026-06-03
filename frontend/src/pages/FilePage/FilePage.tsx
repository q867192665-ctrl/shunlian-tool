import React, { useState, useEffect, useMemo } from 'react';
import { useAppState } from '../../contexts/AppContext';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { message, Upload, Modal } from 'antd';
import { UploadOutlined, FolderOutlined, FileOutlined, DownloadOutlined, DeleteOutlined, CaretRightOutlined, CaretDownOutlined } from '@ant-design/icons';
import styles from './FilePage.module.css';

interface FileInfo {
  name: string;
  full_path?: string;
  folder_path?: string;
  size: number;
  date: string;
  type?: string;
  is_folder?: boolean;
  is_disk?: boolean;
}

interface TreeNode {
  key: string;
  name: string;
  full_path: string;
  type: string;
  is_folder: boolean;
  is_disk: boolean;
  size: number;
  date: string;
  children?: TreeNode[];
  depth: number;
}

export const FilePage: React.FC = () => {
  const { router } = useAppState();
  const { files, filesLoading, downloading, setDownloading, sendWsMessage, setFiles } = useWebSocket();
  const [uploading, setUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    console.log('[FilePage] router:', router?.ipAddress);
    if (!router?.ipAddress) return;
    loadFiles();
  }, [router?.ipAddress]);

  useEffect(() => {
    if (files.length > 0) {
      const allFolderKeys = new Set<string>();
      for (const file of files) {
        const isFolder = file.is_folder === true || file.type === 'directory';
        const isDisk = file.is_disk === true || file.type === 'disk';
        if (isFolder || isDisk) {
          allFolderKeys.add(file.full_path || file.name);
        }
      }
      setExpandedKeys(allFolderKeys);
    }
  }, [files]);

  const loadFiles = () => {
    console.log('[FilePage] 加载文件列表:', router?.ipAddress);
    if (!router?.ipAddress) return;
    sendWsMessage({
      action: 'get_file_list',
      ip: router.ipAddress,
      username: router.username || '',
      password: router.password || '',
    });
  };

  const handleUpload = async (file: File) => {
    if (!router?.ipAddress) return;
    setUploading(true);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('ip', router.ipAddress);
    formData.append('username', router.username || '');
    formData.append('password', router.password || '');

    try {
      const response = await fetch('/api/files/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (data.status === 'success') {
        message.success('文件上传成功');
        setTimeout(() => loadFiles(), 800);
      } else {
        message.error(data.message || '上传失败');
      }
    } catch (error) {
      message.error('上传失败');
    } finally {
      setUploading(false);
    }
    return false;
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const getFileTypeLabel = (type?: string): string => {
    if (!type) return '文件';
    const typeMap: Record<string, string> = {
      'file': '文件',
      'directory': '文件夹',
      'disk': '磁盘',
      'script': '脚本',
      'certificate': '证书',
      'dhcp-option-set': 'DHCP选项',
      'backup': '备份',
      'before-reset': '重置前配置',
      'hotspot': '热点',
      'l2tp-secret': 'L2TP密钥',
      'ppp-secret': 'PPP密钥',
      'pptp-secret': 'PPTP密钥',
      'user': '用户',
    };
    return typeMap[type] || type;
  };

  const toggleFileSelection = (key: string) => {
    setSelectedFiles(prev => 
      prev.includes(key) 
        ? prev.filter(f => f !== key)
        : [...prev, key]
    );
  };

  const handleDownloadSelected = () => {
    if (selectedFiles.length === 0) {
      message.warning('请先选择要下载的文件');
      return;
    }
    selectedFiles.forEach(filePath => {
      setDownloading(filePath);
      sendWsMessage({
        action: 'download_file',
        ip: router?.ipAddress || '',
        username: router?.username || '',
        password: router?.password || '',
        file_name: filePath,
      });
    });
  };

  const handleDeleteSelected = () => {
    if (selectedFiles.length === 0) {
      message.warning('请先选择要删除的文件');
      return;
    }
    const filesToDelete = [...selectedFiles];
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除选中的 ${filesToDelete.length} 个文件吗？此操作不可撤销。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        setFiles(prev => prev.filter(f => !filesToDelete.includes((f.full_path || f.name))));
        setSelectedFiles([]);
        filesToDelete.forEach(filePath => {
          sendWsMessage({
            action: 'delete_file',
            ip: router?.ipAddress || '',
            username: router?.username || '',
            password: router?.password || '',
            file_name: filePath,
          });
        });
        setTimeout(() => loadFiles(), 800);
      },
    });
  };

  const isFolder = (file: FileInfo): boolean => {
    return file.is_folder === true || file.type === 'directory';
  };

  const isDisk = (file: FileInfo): boolean => {
    return file.is_disk === true || file.type === 'disk';
  };

  const isSelected = (key: string): boolean => {
    return selectedFiles.includes(key);
  };

  const toggleExpand = (key: string) => {
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const treeData = useMemo((): TreeNode[] => {
    const rootMap = new Map<string, TreeNode>();
    const folderMap = new Map<string, TreeNode>();

    const sortedFiles = [...files].sort((a, b) => {
      const aIsDisk = isDisk(a) ? 0 : 1;
      const bIsDisk = isDisk(b) ? 0 : 1;
      if (aIsDisk !== bIsDisk) return aIsDisk - bIsDisk;
      const aIsFolder = isFolder(a) ? 0 : 1;
      const bIsFolder = isFolder(b) ? 0 : 1;
      if (aIsFolder !== bIsFolder) return aIsFolder - bIsFolder;
      return (a.full_path || a.name).localeCompare(b.full_path || b.name);
    });

    for (const file of sortedFiles) {
      const fullPath = file.full_path || file.name;
      const node: TreeNode = {
        key: fullPath,
        name: file.name,
        full_path: fullPath,
        type: file.type || 'file',
        is_folder: isFolder(file),
        is_disk: isDisk(file),
        size: file.size,
        date: file.date,
        children: [],
        depth: 0,
      };

      if (isDisk(file)) {
        rootMap.set(fullPath, node);
        folderMap.set(fullPath, node);
      } else if (isFolder(file)) {
        const parts = fullPath.split('/');
        if (parts.length === 1) {
          rootMap.set(fullPath, node);
          folderMap.set(fullPath, node);
        } else {
          const parentPath = parts.slice(0, -1).join('/');
          const parent = folderMap.get(parentPath);
          if (parent) {
            node.depth = parent.depth + 1;
            parent.children!.push(node);
          } else {
            rootMap.set(fullPath, node);
          }
          folderMap.set(fullPath, node);
        }
      } else {
        const parts = fullPath.split('/');
        if (parts.length === 1) {
          rootMap.set(fullPath, node);
        } else {
          const parentPath = parts.slice(0, -1).join('/');
          const parent = folderMap.get(parentPath);
          if (parent) {
            node.depth = parent.depth + 1;
            parent.children!.push(node);
          } else {
            rootMap.set(fullPath, node);
          }
        }
      }
    }

    return Array.from(rootMap.values());
  }, [files]);

  const renderTree = (nodes: TreeNode[]): React.ReactNode => {
    return nodes.map((node) => {
      const isExpanded = expandedKeys.has(node.key);
      const hasChildren = node.children && node.children.length > 0;
      const indent = node.depth * 24;

      return (
        <React.Fragment key={node.key}>
          <tr 
            className={`${isSelected(node.key) ? styles.selectedRow : ''}`}
            onClick={() => toggleFileSelection(node.key)}
          >
            <td className={styles.checkboxCell}>
              <input 
                type="checkbox" 
                checked={isSelected(node.key)}
                onChange={() => toggleFileSelection(node.key)}
                onClick={(e) => e.stopPropagation()}
              />
            </td>
            <td className={styles.fileName} style={{ paddingLeft: `${indent + 8}px` }}>
              {hasChildren ? (
                <span 
                  className={styles.expandIcon} 
                  onClick={(e) => { e.stopPropagation(); toggleExpand(node.key); }}
                >
                  {isExpanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
                </span>
              ) : (
                <span className={styles.expandPlaceholder} />
              )}
              {isDisk({ type: node.type, is_disk: node.is_disk }) ? (
                <FolderOutlined style={{ marginRight: '6px', color: '#52c41a' }} />
              ) : isFolder({ type: node.type, is_folder: node.is_folder }) ? (
                <FolderOutlined style={{ marginRight: '6px', color: '#faad14' }} />
              ) : (
                <FileOutlined style={{ marginRight: '6px', color: '#1890ff' }} />
              )}
              {node.name}
            </td>
            <td className={styles.fileType}>{getFileTypeLabel(node.type)}</td>
            <td className={styles.fileSize}>{formatFileSize(node.size)}</td>
            <td className={styles.fileDate}>{node.date}</td>
          </tr>
          {hasChildren && isExpanded && renderTree(node.children!)}
        </React.Fragment>
      );
    });
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>文件管理</h2>
        <div className={styles.controls}>
          <button className={styles.actionBtn} onClick={handleDownloadSelected} disabled={selectedFiles.length === 0}>
            <DownloadOutlined /> 下载 ({selectedFiles.length})
          </button>
          <Upload
            accept="*/*"
            showUploadList={false}
            beforeUpload={handleUpload}
            disabled={uploading}
          >
            <button className={styles.actionBtn} disabled={uploading}>
              <UploadOutlined /> 上传
            </button>
          </Upload>
          <button className={styles.actionBtn} onClick={handleDeleteSelected} disabled={selectedFiles.length === 0}>
            <DeleteOutlined /> 删除 ({selectedFiles.length})
          </button>
        </div>
      </div>
      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th style={{ width: '40px' }}>选择</th>
              <th>文件名</th>
              <th style={{ width: '100px' }}>类型</th>
              <th style={{ width: '120px' }}>大小</th>
              <th style={{ width: '180px' }}>修改时间</th>
            </tr>
          </thead>
          <tbody>
            {treeData.length > 0 ? renderTree(treeData) : (
              <>
                {filesLoading && (
                  <tr>
                    <td colSpan={5} className={styles.loadingState}>正在加载文件列表...</td>
                  </tr>
                )}
                {!filesLoading && (
                  <tr>
                    <td colSpan={5} className={styles.emptyState}>暂无文件</td>
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
