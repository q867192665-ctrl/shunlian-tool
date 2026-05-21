import React from 'react';
import {
  ApartmentOutlined,
  WifiOutlined,
  NodeIndexOutlined,
  LinkOutlined,
  GlobalOutlined,
  MinusOutlined,
} from '@ant-design/icons';

export interface InterfaceTypeIconProps {
  type: string;
  size?: number;
  className?: string;
}

export const InterfaceTypeIcon: React.FC<InterfaceTypeIconProps> = ({
  type,
  size = 16,
  className
}) => {
  const normalizedType = type.toLowerCase();

  const getIcon = () => {
    if (normalizedType.includes('ether')) {
      return <ApartmentOutlined style={{ fontSize: size }} className={className} />;
    }
    if (normalizedType.includes('wlan') || normalizedType.includes('wireless')) {
      return <WifiOutlined style={{ fontSize: size }} className={className} />;
    }
    if (normalizedType.includes('bridge')) {
      return <NodeIndexOutlined style={{ fontSize: size }} className={className} />;
    }
    if (normalizedType.includes('vlan')) {
      return <LinkOutlined style={{ fontSize: size }} className={className} />;
    }
    if (normalizedType.includes('pppoe')) {
      return <GlobalOutlined style={{ fontSize: size }} className={className} />;
    }
    return <MinusOutlined style={{ fontSize: size }} className={className} />;
  };

  return getIcon();
};
