#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TLS 自签名证书生成工具
在打包或首次启动时自动生成自签名证书
"""

import os
import sys
import logging

logger = logging.getLogger(__name__)


def generate_self_signed_cert(cert_dir: str) -> bool:
    """
    生成自签名 TLS 证书
    
    Args:
        cert_dir: 证书输出目录
        
    Returns:
        bool: 是否成功
    """
    cert_path = os.path.join(cert_dir, 'server-cert.pem')
    key_path = os.path.join(cert_dir, 'server-key.pem')
    
    # 如果证书已存在，跳过生成
    if os.path.exists(cert_path) and os.path.exists(key_path):
        logger.info(f"TLS 证书已存在，跳过生成: {cert_path}")
        return True
    
    os.makedirs(cert_dir, exist_ok=True)
    
    try:
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        import datetime
        import ipaddress
        
        # 生成私钥
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        
        # 生成证书
        subject = issuer = x509.Name([
            x509.NameAttribute(NameOID.COMMON_NAME, "ShunLianTool"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "ShunLian"),
        ])
        
        now = datetime.datetime.now(datetime.timezone.utc)
        cert = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(issuer)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now)
            .not_valid_after(now + datetime.timedelta(days=3650))
            .add_extension(
                x509.SubjectAlternativeName([
                    x509.DNSName("localhost"),
                    x509.DNSName("127.0.0.1"),
                    x509.IPAddress(
                        ipaddress.IPv4Address("127.0.0.1")
                    ),
                ]),
                critical=False,
            )
            .sign(key, hashes.SHA256())
        )
        
        # 写入私钥
        with open(key_path, 'wb') as f:
            f.write(key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.TraditionalOpenSSL,
                encryption_algorithm=serialization.NoEncryption(),
            ))
        
        # 写入证书
        with open(cert_path, 'wb') as f:
            f.write(cert.public_bytes(serialization.Encoding.PEM))
        
        logger.info(f"TLS 证书已生成: {cert_path}")
        return True
        
    except ImportError:
        logger.warning("cryptography 库未安装，尝试使用 OpenSSL 命令行生成证书")
        return _generate_with_openssl(cert_path, key_path)
    except Exception as e:
        logger.error(f"生成 TLS 证书失败: {e}")
        return _generate_with_openssl(cert_path, key_path)


def _generate_with_openssl(cert_path: str, key_path: str) -> bool:
    """使用 OpenSSL 命令行生成证书（备用方案）"""
    import subprocess
    try:
        cmd = [
            'openssl', 'req', '-x509', '-newkey', 'rsa:2048',
            '-keyout', key_path, '-out', cert_path,
            '-days', '3650', '-nodes',
            '-subj', '/CN=ShunLianTool/O=ShunLian',
            '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0:
            logger.info(f"TLS 证书已生成(OpenSSL): {cert_path}")
            return True
        else:
            logger.error(f"OpenSSL 生成证书失败: {result.stderr}")
            return False
    except FileNotFoundError:
        logger.error("OpenSSL 命令不可用，无法生成证书")
        return False
    except Exception as e:
        logger.error(f"OpenSSL 生成证书异常: {e}")
        return False


def ensure_cert_exists(base_dir: str = None) -> bool:
    """
    确保证书文件存在，不存在则自动生成
    
    Args:
        base_dir: 程序根目录，默认自动检测
        
    Returns:
        bool: 证书是否可用
    """
    if base_dir is None:
        if getattr(sys, 'frozen', False):
            base_dir = os.path.dirname(sys.executable)
        else:
            base_dir = os.path.dirname(os.path.abspath(__file__))
    
    cert_dir = os.path.join(base_dir, 'certs')
    return generate_self_signed_cert(cert_dir)


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
    base_dir = os.path.dirname(os.path.abspath(__file__))
    if ensure_cert_exists(base_dir):
        print("证书生成成功")
    else:
        print("证书生成失败")
        sys.exit(1)
