#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
瞬联调试工具 - 更新服务程序
用于处理程序更新请求和推送更新程序
端口: 32999
"""

import os
import re
import json
import logging
import hashlib
import shutil
import secrets
import time
from datetime import datetime
from typing import Optional
from collections import defaultdict

from fastapi import FastAPI, HTTPException, UploadFile, File, Query, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse, HTMLResponse, RedirectResponse
from pydantic import BaseModel

# ==================== 日志配置 ====================

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger("update-server")

# ==================== 路径配置 ====================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
RELEASES_DIR = os.path.join(DATA_DIR, 'releases')
VERSION_FILE = os.path.join(DATA_DIR, 'version.json')
CHANGELOG_FILE = os.path.join(DATA_DIR, 'changelog.md')
STATS_FILE = os.path.join(DATA_DIR, 'stats.json')

# 确保目录存在
os.makedirs(RELEASES_DIR, exist_ok=True)

# ==================== 更新服务端口 ====================

UPDATE_SERVER_PORT = 32999

# ==================== 认证配置 ====================

ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "!HuYao1314"
SESSION_TIMEOUT = 86400  # 24小时
auth_tokens: dict[str, float] = {}
auth_tokens_lock = __import__('threading').Lock()

def generate_auth_token() -> str:
    """生成认证令牌"""
    return secrets.token_urlsafe(48)

def set_auth_token(token: str):
    """存储认证令牌及过期时间"""
    with auth_tokens_lock:
        auth_tokens[token] = time.time() + SESSION_TIMEOUT
        clean_expired_tokens()

def verify_auth_token(token: str) -> bool:
    """验证令牌是否有效"""
    with auth_tokens_lock:
        clean_expired_tokens()
        return token in auth_tokens

def revoke_auth_token(token: str):
    """撤销令牌"""
    with auth_tokens_lock:
        auth_tokens.pop(token, None)

def clean_expired_tokens():
    """清理过期令牌"""
    now = time.time()
    expired = [t for t, exp in auth_tokens.items() if now >= exp]
    for t in expired:
        del auth_tokens[t]

def get_auth_token_from_request(request: Request) -> Optional[str]:
    """从请求中提取认证令牌（优先Cookie，其次Authorization Header）"""
    token = request.cookies.get("auth_token")
    if token:
        return token
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:]
    return None

async def require_admin_auth(request: Request):
    """依赖注入：验证管理员认证"""
    token = get_auth_token_from_request(request)
    if not token or not verify_auth_token(token):
        raise HTTPException(status_code=401, detail="未授权访问，请先登录")
    return True

# ==================== FastAPI 应用 ====================

app = FastAPI(
    title="瞬联调试工具 - 更新服务",
    description="处理程序更新请求和推送更新程序",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==================== 数据模型 ====================

class VersionInfo(BaseModel):
    version: str
    changelog: str = ""
    download_url: str = ""
    release_date: str = ""
    file_hash: str = ""


class PublishRequest(BaseModel):
    version: str
    changelog: str = ""
    release_date: str = ""


class LoginRequest(BaseModel):
    username: str
    password: str


# ==================== 工具函数 ====================

def compute_file_hash(filepath: str) -> str:
    """计算文件的 SHA256 哈希值"""
    sha256 = hashlib.sha256()
    with open(filepath, 'rb') as f:
        for chunk in iter(lambda: f.read(8192), b''):
            sha256.update(chunk)
    return sha256.hexdigest()


def load_version_info() -> dict:
    """加载当前版本信息"""
    if os.path.exists(VERSION_FILE):
        try:
            with open(VERSION_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"读取版本信息失败: {e}")
    return {
        "version": "1.0.0",
        "changelog": "",
        "download_url": "",
        "release_date": "",
        "file_hash": ""
    }


def save_version_info(info: dict):
    """保存版本信息"""
    with open(VERSION_FILE, 'w', encoding='utf-8') as f:
        json.dump(info, f, ensure_ascii=False, indent=2)


def version_tuple(v: str) -> tuple:
    """将版本号字符串转为元组用于比较"""
    parts = v.replace('v', '').split('.')
    return tuple(int(p) for p in parts)


def get_release_filename(version: str) -> Optional[str]:
    """获取指定版本的发布文件名"""
    if not os.path.exists(RELEASES_DIR):
        return None
    for fname in os.listdir(RELEASES_DIR):
        if version.replace('v', '') in fname:
            return fname
    return None


# ==================== 下载统计 ====================

def load_stats() -> dict:
    """加载下载统计数据"""
    if os.path.exists(STATS_FILE):
        try:
            with open(STATS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"读取统计数据失败: {e}")
    return {"total_downloads": 0, "files": {}, "daily": {}, "check_count": 0}


def save_stats(stats: dict):
    """保存统计数据"""
    with open(STATS_FILE, 'w', encoding='utf-8') as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)


def record_download(filename: str, client_ip: str):
    """记录一次下载"""
    stats = load_stats()
    stats["total_downloads"] = stats.get("total_downloads", 0) + 1

    today = datetime.now().strftime("%Y-%m-%d")
    stats["daily"][today] = stats.get("daily", {}).get(today, 0) + 1

    if filename not in stats.get("files", {}):
        stats["files"][filename] = {"count": 0, "downloads": []}

    stats["files"][filename]["count"] = stats["files"][filename].get("count", 0) + 1
    stats["files"][filename].setdefault("downloads", []).append({
        "ip": client_ip,
        "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    })

    save_stats(stats)


def record_check():
    """记录一次更新检查"""
    stats = load_stats()
    stats["check_count"] = stats.get("check_count", 0) + 1
    today = datetime.now().strftime("%Y-%m-%d")
    if "daily_checks" not in stats:
        stats["daily_checks"] = {}
    stats["daily_checks"][today] = stats["daily_checks"].get(today, 0) + 1
    save_stats(stats)


# ==================== 客户端接口 ====================

@app.get("/version.json")
async def get_version_info(request: Request):
    """
    客户端检查更新接口
    返回最新版本信息，供客户端判断是否需要更新
    """
    record_check()

    info = load_version_info()

    # 构建下载 URL（使用请求的 host）
    host = request.headers.get("host", f"yaohu.dynv6.net:{UPDATE_SERVER_PORT}")
    scheme = "https" if request.url.scheme == "https" else "http"

    download_url = info.get("download_url", "")
    if not download_url and info.get("version"):
        filename = get_release_filename(info["version"])
        if filename:
            download_url = f"{scheme}://{host}/download/{filename}"

    return {
        "version": info.get("version", "1.0.0"),
        "changelog": info.get("changelog", ""),
        "download_url": download_url,
        "release_date": info.get("release_date", ""),
        "file_hash": info.get("file_hash", ""),
    }


@app.get("/download/{filename}")
async def download_release(filename: str, request: Request):
    """下载更新文件"""
    filepath = os.path.join(RELEASES_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="文件不存在")

    client_ip = request.client.host if request.client else "unknown"
    record_download(filename, client_ip)

    logger.info(f"下载更新文件: {filename} (IP: {client_ip})")
    return FileResponse(
        filepath,
        filename=filename,
        media_type='application/octet-stream'
    )


@app.get("/check")
async def check_update(client_version: str = Query(..., description="客户端当前版本号")):
    """
    客户端检查更新（带版本比较）
    返回是否有更新及更新详情
    """
    record_check()

    info = load_version_info()
    latest_version = info.get("version", "1.0.0")

    try:
        has_update = version_tuple(latest_version) > version_tuple(client_version)
    except (ValueError, IndexError):
        has_update = False

    return {
        "has_update": has_update,
        "current_version": client_version,
        "latest_version": latest_version,
        "changelog": info.get("changelog", ""),
        "download_url": info.get("download_url", ""),
        "file_hash": info.get("file_hash", ""),
    }


# ==================== 认证接口 ====================

@app.post("/admin/login")
async def admin_login(req: LoginRequest):
    """管理员登录"""
    if req.username != ADMIN_USERNAME or req.password != ADMIN_PASSWORD:
        logger.warning(f"登录失败: 用户名={req.username}")
        raise HTTPException(status_code=401, detail="账号或密码错误")

    token = generate_auth_token()
    set_auth_token(token)
    logger.info(f"管理员登录成功")

    response = JSONResponse({"status": "success", "message": "登录成功"})
    response.set_cookie(
        key="auth_token",
        value=token,
        max_age=SESSION_TIMEOUT,
        httponly=True,
        samesite="lax",
        secure=False,
        path="/"
    )
    return response


@app.post("/admin/logout")
async def admin_logout(request: Request):
    """管理员登出"""
    token = get_auth_token_from_request(request)
    if token:
        revoke_auth_token(token)
    response = JSONResponse({"status": "success", "message": "已登出"})
    response.delete_cookie("auth_token", path="/")
    return response


@app.get("/admin/check-auth")
async def check_auth(request: Request):
    """检查当前认证状态"""
    token = get_auth_token_from_request(request)
    if token and verify_auth_token(token):
        return {"status": "success", "authenticated": True}
    return {"status": "success", "authenticated": False}


# ==================== 管理接口 ====================

@app.post("/admin/publish")
async def publish_version(req: PublishRequest, request: Request, _auth: bool = Depends(require_admin_auth)):
    """
    发布新版本
    需要先通过 /admin/upload 上传文件，再调用此接口发布
    """
    # 检查是否有对应的发布文件
    filename = get_release_filename(req.version)
    if not filename:
        logger.warning(f"发布版本 {req.version} 时未找到对应文件")

    # 构建下载 URL
    host = request.headers.get("host", f"yaohu.dynv6.net:{UPDATE_SERVER_PORT}")
    scheme = "https" if request.url.scheme == "https" else "http"
    download_url = f"{scheme}://{host}/download/{filename}" if filename else ""

    # 计算文件哈希
    file_hash = ""
    if filename:
        filepath = os.path.join(RELEASES_DIR, filename)
        file_hash = compute_file_hash(filepath)

    release_date = req.release_date or datetime.now().strftime("%Y-%m-%d")

    info = {
        "version": req.version.replace('v', ''),
        "changelog": req.changelog,
        "download_url": download_url,
        "release_date": release_date,
        "file_hash": file_hash,
    }

    save_version_info(info)

    # 同时更新 changelog 文件
    with open(CHANGELOG_FILE, 'w', encoding='utf-8') as f:
        f.write(f"## v{req.version.replace('v', '')} ({release_date})\n\n")
        f.write(req.changelog)

    logger.info(f"发布新版本: v{req.version}")
    return {"status": "success", "message": f"版本 v{req.version} 已发布", "info": info}


@app.post("/admin/upload")
async def upload_release(file: UploadFile = File(...), _auth: bool = Depends(require_admin_auth)):
    """上传更新文件"""
    if not file.filename:
        raise HTTPException(status_code=400, detail="文件名不能为空")

    # 保存到 releases 目录
    filepath = os.path.join(RELEASES_DIR, file.filename)

    # 如果同名文件已存在，先备份
    if os.path.exists(filepath):
        backup_dir = os.path.join(RELEASES_DIR, 'backup')
        os.makedirs(backup_dir, exist_ok=True)
        backup_path = os.path.join(backup_dir, f"{file.filename}.{datetime.now().strftime('%Y%m%d%H%M%S')}")
        shutil.move(filepath, backup_path)
        logger.info(f"备份已有文件: {file.filename} -> {backup_path}")

    # 写入新文件
    try:
        with open(filepath, 'wb') as f:
            content = await file.read()
            f.write(content)
    except Exception as e:
        logger.error(f"上传文件失败: {e}")
        raise HTTPException(status_code=500, detail=f"文件保存失败: {e}")

    file_hash = compute_file_hash(filepath)
    file_size = os.path.getsize(filepath)

    logger.info(f"上传更新文件: {file.filename} (大小: {file_size} 字节, SHA256: {file_hash})")

    return {
        "status": "success",
        "message": f"文件 {file.filename} 上传成功",
        "filename": file.filename,
        "size": file_size,
        "hash": file_hash,
    }


@app.get("/admin/versions")
async def list_versions(_auth: bool = Depends(require_admin_auth)):
    """列出所有已上传的版本文件"""
    files = []
    if os.path.exists(RELEASES_DIR):
        for fname in os.listdir(RELEASES_DIR):
            fpath = os.path.join(RELEASES_DIR, fname)
            if os.path.isfile(fpath):
                files.append({
                    "filename": fname,
                    "size": os.path.getsize(fpath),
                    "hash": compute_file_hash(fpath),
                    "modified": datetime.fromtimestamp(os.path.getmtime(fpath)).strftime("%Y-%m-%d %H:%M:%S"),
                })

    info = load_version_info()

    return {
        "current_version": info.get("version", ""),
        "files": sorted(files, key=lambda x: x["modified"], reverse=True),
    }


@app.delete("/admin/versions/{filename}")
async def delete_release(filename: str, _auth: bool = Depends(require_admin_auth)):
    """删除指定版本文件"""
    filepath = os.path.join(RELEASES_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="文件不存在")

    os.remove(filepath)
    logger.info(f"删除版本文件: {filename}")
    return {"status": "success", "message": f"文件 {filename} 已删除"}


@app.get("/admin/status")
async def server_status(_auth: bool = Depends(require_admin_auth)):
    """服务状态"""
    info = load_version_info()
    stats = load_stats()
    return {
        "status": "running",
        "port": UPDATE_SERVER_PORT,
        "current_version": info.get("version", "1.0.0"),
        "releases_count": len([f for f in os.listdir(RELEASES_DIR) if os.path.isfile(os.path.join(RELEASES_DIR, f))]) if os.path.exists(RELEASES_DIR) else 0,
        "total_downloads": stats.get("total_downloads", 0),
        "check_count": stats.get("check_count", 0),
        "uptime": datetime.now().isoformat(),
    }


@app.get("/admin/stats")
async def get_stats(_auth: bool = Depends(require_admin_auth)):
    """获取下载统计数据"""
    stats = load_stats()
    info = load_version_info()

    # 补充文件信息
    file_details = []
    for fname, fdata in stats.get("files", {}).items():
        fpath = os.path.join(RELEASES_DIR, fname)
        file_details.append({
            "filename": fname,
            "download_count": fdata.get("count", 0),
            "file_exists": os.path.exists(fpath),
            "file_size": os.path.getsize(fpath) if os.path.exists(fpath) else 0,
            "recent_downloads": fdata.get("downloads", [])[-20:],
        })

    # 按下载量排序
    file_details.sort(key=lambda x: x["download_count"], reverse=True)

    # 每日统计（最近30天）
    daily = stats.get("daily", {})
    daily_checks = stats.get("daily_checks", {})
    sorted_days = sorted(daily.keys(), reverse=True)[:30]

    daily_stats = []
    for day in sorted_days:
        daily_stats.append({
            "date": day,
            "downloads": daily.get(day, 0),
            "checks": daily_checks.get(day, 0),
        })

    return {
        "current_version": info.get("version", "1.0.0"),
        "total_downloads": stats.get("total_downloads", 0),
        "check_count": stats.get("check_count", 0),
        "file_details": file_details,
        "daily_stats": daily_stats,
    }


@app.delete("/admin/stats")
async def reset_stats(_auth: bool = Depends(require_admin_auth)):
    """重置统计数据"""
    save_stats({"total_downloads": 0, "files": {}, "daily": {}, "check_count": 0, "daily_checks": {}})
    logger.info("统计数据已重置")
    return {"status": "success", "message": "统计数据已重置"}


# ==================== 管理前端页面 ====================

@app.get("/", response_class=HTMLResponse)
async def admin_page(request: Request):
    """管理前端页面（需认证）"""
    token = get_auth_token_from_request(request)
    if token and verify_auth_token(token):
        return HTMLResponse(content=ADMIN_HTML)
    return HTMLResponse(content=LOGIN_HTML)


LOGIN_HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>瞬联调试工具 - 登录</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #0f0f0f;
  color: #fff;
  min-height: 100vh;
  display: flex; align-items: center; justify-content: center;
}
.login-card {
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 12px;
  padding: 40px;
  width: 380px;
  max-width: 90vw;
}
.login-card h1 {
  font-size: 20px; font-weight: 700; text-align: center; margin-bottom: 8px;
}
.login-card h1 span { color: #ff6b35; }
.login-card .subtitle {
  text-align: center; color: #aaa; font-size: 13px; margin-bottom: 30px;
}
.form-group { margin-bottom: 20px; }
.form-group label {
  display: block; font-size: 13px; color: #aaa; margin-bottom: 8px;
}
.form-group input {
  width: 100%; padding: 12px; background: #252525;
  border: 1px solid #333; border-radius: 8px; color: #fff;
  font-size: 14px; outline: none; transition: border-color 0.2s;
}
.form-group input:focus { border-color: #ff6b35; }
.btn-login {
  width: 100%; padding: 12px; background: #ff6b35; color: #fff;
  border: none; border-radius: 8px; font-size: 15px; font-weight: 600;
  cursor: pointer; transition: background 0.2s; margin-top: 8px;
}
.btn-login:hover { background: #ff8555; }
.btn-login:disabled { opacity: 0.5; cursor: not-allowed; }
.error-msg {
  color: #f44336; font-size: 13px; text-align: center; margin-top: 12px;
  min-height: 20px;
}
</style>
</head>
<body>
<div class="login-card">
  <h1><span>瞬联</span>调试工具</h1>
  <p class="subtitle">更新服务管理</p>
  <form id="login-form" onsubmit="handleLogin(event)">
    <div class="form-group">
      <label>账号</label>
      <input type="text" id="username" placeholder="请输入管理员账号" autocomplete="username" required>
    </div>
    <div class="form-group">
      <label>密码</label>
      <input type="password" id="password" placeholder="请输入管理员密码" autocomplete="current-password" required>
    </div>
    <div class="error-msg" id="error-msg"></div>
    <button type="submit" class="btn-login" id="login-btn">登 录</button>
  </form>
</div>
<script>
async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const errorEl = document.getElementById('error-msg');
  const btn = document.getElementById('login-btn');

  btn.disabled = true;
  btn.textContent = '登录中...';
  errorEl.textContent = '';

  try {
    const res = await fetch('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      credentials: 'include'
    });
    if (res.ok) {
      window.location.href = '/';
    } else {
      const data = await res.json();
      errorEl.textContent = data.detail || '账号或密码错误';
    }
  } catch (err) {
    errorEl.textContent = '网络错误，请重试';
  }
  btn.disabled = false;
  btn.textContent = '登 录';
}
</script>
</body>
</html>"""


ADMIN_HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>瞬联调试工具 - 更新服务管理</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
:root {
  --bg-primary: #0f0f0f;
  --bg-secondary: #1a1a1a;
  --bg-tertiary: #252525;
  --border: #333;
  --text-primary: #fff;
  --text-secondary: #aaa;
  --accent: #ff6b35;
  --accent-hover: #ff8555;
  --success: #4caf50;
  --danger: #f44336;
  --warning: #ff9800;
}
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  min-height: 100vh;
}
.container { max-width: 1200px; margin: 0 auto; padding: 20px; }

/* Header */
.header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 20px 0; border-bottom: 1px solid var(--border); margin-bottom: 30px;
}
.header h1 { font-size: 22px; font-weight: 700; }
.header h1 span { color: var(--accent); }
.status-badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 12px; border-radius: 20px; font-size: 12px;
  background: rgba(76,175,80,0.15); color: var(--success); border: 1px solid var(--success);
}
.status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--success); }

/* Stats Cards */
.stats-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px; margin-bottom: 30px;
}
.stat-card {
  background: var(--bg-secondary); border: 1px solid var(--border);
  border-radius: 10px; padding: 20px;
}
.stat-card .label { font-size: 12px; color: var(--text-secondary); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
.stat-card .value { font-size: 28px; font-weight: 700; }
.stat-card .value.accent { color: var(--accent); }

/* Sections */
.section {
  background: var(--bg-secondary); border: 1px solid var(--border);
  border-radius: 10px; margin-bottom: 20px; overflow: hidden;
}
.section-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-bottom: 1px solid var(--border);
}
.section-header h2 { font-size: 16px; font-weight: 600; }
.section-body { padding: 20px; }

/* Form */
.form-group { margin-bottom: 16px; }
.form-group label { display: block; font-size: 13px; color: var(--text-secondary); margin-bottom: 6px; }
.form-group input, .form-group textarea, .form-group select {
  width: 100%; padding: 10px 12px; background: var(--bg-tertiary);
  border: 1px solid var(--border); border-radius: 6px; color: var(--text-primary);
  font-size: 14px; outline: none; transition: border-color 0.2s;
}
.form-group input:focus, .form-group textarea:focus {
  border-color: var(--accent);
}
.form-group textarea { resize: vertical; min-height: 80px; font-family: monospace; }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

/* Buttons */
.btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 10px 20px; border: none; border-radius: 6px;
  font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s;
}
.btn-primary { background: var(--accent); color: #fff; }
.btn-primary:hover { background: var(--accent-hover); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-danger { background: transparent; color: var(--danger); border: 1px solid var(--danger); }
.btn-danger:hover { background: rgba(244,67,54,0.1); }
.btn-sm { padding: 6px 12px; font-size: 12px; }
.btn-ghost { background: transparent; color: var(--text-secondary); border: 1px solid var(--border); }
.btn-ghost:hover { background: var(--bg-tertiary); color: var(--text-primary); }

/* Table */
.table-wrapper { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid var(--border); font-size: 13px; }
th { color: var(--text-secondary); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
tr:hover td { background: var(--bg-tertiary); }
.hash-cell { font-family: monospace; font-size: 11px; color: var(--text-secondary); max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.size-cell { white-space: nowrap; }

/* Upload area */
.upload-area {
  border: 2px dashed var(--border); border-radius: 10px; padding: 40px;
  text-align: center; cursor: pointer; transition: all 0.2s;
}
.upload-area:hover, .upload-area.dragover { border-color: var(--accent); background: rgba(255,107,53,0.05); }
.upload-area .icon { font-size: 40px; margin-bottom: 10px; }
.upload-area .text { color: var(--text-secondary); font-size: 14px; }
.upload-area .hint { color: var(--text-secondary); font-size: 12px; margin-top: 6px; }
.upload-progress { margin-top: 12px; }
.progress-bar { height: 4px; background: var(--bg-tertiary); border-radius: 2px; overflow: hidden; }
.progress-fill { height: 100%; background: var(--accent); border-radius: 2px; transition: width 0.3s; }

/* Toast */
.toast-container { position: fixed; top: 20px; right: 20px; z-index: 10000; display: flex; flex-direction: column; gap: 8px; }
.toast {
  padding: 12px 20px; border-radius: 8px; font-size: 13px; font-weight: 500;
  animation: slideIn 0.3s ease; min-width: 250px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
}
.toast.success { background: rgba(76,175,80,0.9); color: #fff; }
.toast.error { background: rgba(244,67,54,0.9); color: #fff; }
.toast.info { background: rgba(255,107,53,0.9); color: #fff; }
@keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

/* Daily chart */
.chart-container { display: flex; align-items: flex-end; gap: 4px; height: 120px; padding-top: 10px; }
.chart-bar-group { display: flex; flex-direction: column; align-items: center; flex: 1; min-width: 0; }
.chart-bar { width: 100%; max-width: 30px; border-radius: 3px 3px 0 0; transition: height 0.3s; position: relative; }
.chart-bar.downloads { background: var(--accent); }
.chart-bar.checks { background: #4a90d9; }
.chart-label { font-size: 10px; color: var(--text-secondary); margin-top: 4px; white-space: nowrap; }
.chart-legend { display: flex; gap: 16px; margin-top: 10px; justify-content: center; }
.chart-legend-item { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); }
.chart-legend-dot { width: 10px; height: 10px; border-radius: 2px; }

/* Empty state */
.empty-state { text-align: center; padding: 40px; color: var(--text-secondary); }
.empty-state .icon { font-size: 40px; margin-bottom: 10px; opacity: 0.3; }

/* Tabs */
.tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); }
.tab {
  padding: 12px 20px; font-size: 14px; cursor: pointer;
  color: var(--text-secondary); border-bottom: 2px solid transparent; transition: all 0.2s;
}
.tab:hover { color: var(--text-primary); }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }

.tab-content { display: none; }
.tab-content.active { display: block; }

/* Modal */
.modal-overlay {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center;
  z-index: 9999; animation: fadeIn 0.2s;
}
.modal {
  background: var(--bg-secondary); border: 1px solid var(--border);
  border-radius: 10px; max-width: 500px; width: 90%; padding: 24px;
}
.modal h3 { margin-bottom: 16px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

/* Responsive */
@media (max-width: 768px) {
  .form-row { grid-template-columns: 1fr; }
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
</head>
<body>
<div class="container">
  <!-- Header -->
  <div class="header">
    <h1><span>瞬联</span> 更新服务管理</h1>
    <div style="display:flex;align-items:center;gap:12px">
      <div class="status-badge"><div class="status-dot"></div>运行中</div>
      <button class="btn btn-ghost btn-sm" onclick="handleLogout()">退出登录</button>
    </div>
  </div>

  <!-- Stats Cards -->
  <div class="stats-grid">
    <div class="stat-card">
      <div class="label">当前版本</div>
      <div class="value accent" id="stat-version">-</div>
    </div>
    <div class="stat-card">
      <div class="label">总下载次数</div>
      <div class="value" id="stat-downloads">0</div>
    </div>
    <div class="stat-card">
      <div class="label">更新检查次数</div>
      <div class="value" id="stat-checks">0</div>
    </div>
    <div class="stat-card">
      <div class="label">发布文件数</div>
      <div class="value" id="stat-files">0</div>
    </div>
  </div>

  <!-- Tabs -->
  <div class="section">
    <div class="tabs">
      <div class="tab active" data-tab="upload">上传发布</div>
      <div class="tab" data-tab="files">文件管理</div>
      <div class="tab" data-tab="stats">下载统计</div>
    </div>

    <!-- Upload Tab -->
    <div class="tab-content active" id="tab-upload">
      <div class="section-body">
        <div class="upload-area" id="upload-area">
          <div class="icon">📦</div>
          <div class="text">拖拽文件到此处或点击选择文件</div>
          <div class="hint">支持 .exe .zip .tar.gz 等格式</div>
          <input type="file" id="file-input" style="display:none">
        </div>
        <div class="upload-progress" id="upload-progress" style="display:none">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span id="upload-filename" style="font-size:13px"></span>
            <span id="upload-percent" style="font-size:13px;color:var(--text-secondary)"></span>
          </div>
          <div class="progress-bar"><div class="progress-fill" id="progress-fill"></div></div>
        </div>

        <div style="margin-top:24px">
          <h3 style="font-size:15px;margin-bottom:16px">发布新版本</h3>
          <div class="form-row">
            <div class="form-group">
              <label>版本号</label>
              <input type="text" id="publish-version" placeholder="例如: 1.0.5">
            </div>
            <div class="form-group">
              <label>发布日期</label>
              <input type="date" id="publish-date">
            </div>
          </div>
          <div class="form-group">
            <label>更新日志</label>
            <textarea id="publish-changelog" placeholder="请输入更新内容..."></textarea>
          </div>
          <button class="btn btn-primary" id="btn-publish" disabled>发布版本</button>
        </div>
      </div>
    </div>

    <!-- Files Tab -->
    <div class="tab-content" id="tab-files">
      <div class="section-body">
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>文件名</th>
                <th>大小</th>
                <th>SHA256</th>
                <th>修改时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody id="files-table"></tbody>
          </table>
        </div>
        <div class="empty-state" id="files-empty" style="display:none">
          <div class="icon">📂</div>
          <div>暂无发布文件</div>
        </div>
      </div>
    </div>

    <!-- Stats Tab -->
    <div class="tab-content" id="tab-stats">
      <div class="section-body">
        <h3 style="font-size:15px;margin-bottom:16px">每日趋势（最近30天）</h3>
        <div class="chart-container" id="daily-chart"></div>
        <div class="chart-legend">
          <div class="chart-legend-item"><div class="chart-legend-dot" style="background:var(--accent)"></div>下载量</div>
          <div class="chart-legend-item"><div class="chart-legend-dot" style="background:#4a90d9"></div>检查量</div>
        </div>

        <h3 style="font-size:15px;margin:24px 0 16px">文件下载详情</h3>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>文件名</th>
                <th>下载次数</th>
                <th>文件大小</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody id="stats-table"></tbody>
          </table>
        </div>
        <div class="empty-state" id="stats-empty" style="display:none">
          <div class="icon">📊</div>
          <div>暂无下载数据</div>
        </div>

        <div style="margin-top:20px;text-align:right">
          <button class="btn btn-danger btn-sm" id="btn-reset-stats">重置统计</button>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- Toast Container -->
<div class="toast-container" id="toast-container"></div>

<!-- Confirm Modal -->
<div class="modal-overlay" id="confirm-modal" style="display:none">
  <div class="modal">
    <h3 id="confirm-title">确认操作</h3>
    <p id="confirm-message" style="color:var(--text-secondary);font-size:14px"></p>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="confirm-cancel">取消</button>
      <button class="btn btn-danger" id="confirm-ok">确认</button>
    </div>
  </div>
</div>

<script>
// ==================== 工具函数 ====================
function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, 3000);
}

let confirmCallback = null;
function showConfirm(title, message, callback) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  document.getElementById('confirm-modal').style.display = 'flex';
  confirmCallback = callback;
}
document.getElementById('confirm-cancel').onclick = () => { document.getElementById('confirm-modal').style.display = 'none'; confirmCallback = null; };
document.getElementById('confirm-ok').onclick = () => { document.getElementById('confirm-modal').style.display = 'none'; if (confirmCallback) confirmCallback(); confirmCallback = null; };

// ==================== Tab 切换 ====================
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'files') loadFiles();
    if (tab.dataset.tab === 'stats') loadStats();
  });
});

// ==================== 数据加载 ====================
async function loadStatus() {
  try {
    const res = await fetch('/admin/status');
    const data = await res.json();
    document.getElementById('stat-version').textContent = 'v' + data.current_version;
    document.getElementById('stat-downloads').textContent = data.total_downloads;
    document.getElementById('stat-checks').textContent = data.check_count;
    document.getElementById('stat-files').textContent = data.releases_count;
  } catch (e) { console.error(e); }
}

async function loadFiles() {
  try {
    const res = await fetch('/admin/versions');
    const data = await res.json();
    const tbody = document.getElementById('files-table');
    const empty = document.getElementById('files-empty');
    if (!data.files || data.files.length === 0) {
      tbody.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';
    tbody.innerHTML = data.files.map(f => `
      <tr>
        <td>${f.filename}</td>
        <td class="size-cell">${formatSize(f.size)}</td>
        <td class="hash-cell" title="${f.hash}">${f.hash}</td>
        <td>${f.modified}</td>
        <td><button class="btn btn-danger btn-sm" onclick="deleteFile('${f.filename}')">删除</button></td>
      </tr>
    `).join('');
  } catch (e) { console.error(e); }
}

async function loadStats() {
  try {
    const res = await fetch('/admin/stats');
    const data = await res.json();
    document.getElementById('stat-downloads').textContent = data.total_downloads;
    document.getElementById('stat-checks').textContent = data.check_count;

    // 文件下载详情
    const tbody = document.getElementById('stats-table');
    const empty = document.getElementById('stats-empty');
    if (!data.file_details || data.file_details.length === 0) {
      tbody.innerHTML = '';
      empty.style.display = 'block';
    } else {
      empty.style.display = 'none';
      tbody.innerHTML = data.file_details.map(f => `
        <tr>
          <td>${f.filename}</td>
          <td style="font-weight:600;color:var(--accent)">${f.download_count}</td>
          <td class="size-cell">${formatSize(f.file_size)}</td>
          <td>${f.file_exists ? '<span style="color:var(--success)">正常</span>' : '<span style="color:var(--danger)">已删除</span>'}</td>
        </tr>
      `).join('');
    }

    // 每日趋势图
    const chart = document.getElementById('daily-chart');
    if (!data.daily_stats || data.daily_stats.length === 0) {
      chart.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:40px;font-size:13px">暂无数据</div>';
      return;
    }

    const maxVal = Math.max(...data.daily_stats.map(d => Math.max(d.downloads, d.checks)), 1);
    chart.innerHTML = data.daily_stats.reverse().map(d => {
      const dlH = Math.max((d.downloads / maxVal) * 100, 2);
      const ckH = Math.max((d.checks / maxVal) * 100, 2);
      const date = d.date.slice(5);
      return `
        <div class="chart-bar-group">
          <div style="display:flex;gap:2px;align-items:flex-end;height:100px">
            <div class="chart-bar downloads" style="height:${dlH}%" title="下载: ${d.downloads}"></div>
            <div class="chart-bar checks" style="height:${ckH}%" title="检查: ${d.checks}"></div>
          </div>
          <div class="chart-label">${date}</div>
        </div>
      `;
    }).join('');
  } catch (e) { console.error(e); }
}

// ==================== 文件上传 ====================
let uploadedFilename = '';
const uploadArea = document.getElementById('upload-area');
const fileInput = document.getElementById('file-input');

uploadArea.addEventListener('click', () => fileInput.click());
uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('dragover'); });
uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
uploadArea.addEventListener('drop', (e) => {
  e.preventDefault(); uploadArea.classList.remove('dragover');
  if (e.dataTransfer.files.length > 0) uploadFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => { if (fileInput.files.length > 0) uploadFile(fileInput.files[0]); });

async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);

  document.getElementById('upload-progress').style.display = 'block';
  document.getElementById('upload-filename').textContent = file.name;
  document.getElementById('upload-percent').textContent = '0%';
  document.getElementById('progress-fill').style.width = '0%';

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/admin/upload');

  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      const pct = Math.round((e.loaded / e.total) * 100);
      document.getElementById('upload-percent').textContent = pct + '%';
      document.getElementById('progress-fill').style.width = pct + '%';
    }
  };

  xhr.onload = () => {
    document.getElementById('upload-progress').style.display = 'none';
    if (xhr.status === 401) {
      window.location.href = '/';
      return;
    }
    if (xhr.status === 200) {
      const data = JSON.parse(xhr.responseText);
      uploadedFilename = data.filename;
      showToast('文件上传成功: ' + data.filename, 'success');
      document.getElementById('btn-publish').disabled = false;
      // 自动填充版本号
      const versionInput = document.getElementById('publish-version');
      if (!versionInput.value) {
        const match = data.filename.match(/(\\d+\\.\\d+\\.\\d+)/);
        if (match) versionInput.value = match[1];
      }
      loadStatus();
    } else {
      showToast('上传失败: ' + xhr.statusText, 'error');
    }
  };

  xhr.onerror = () => { document.getElementById('upload-progress').style.display = 'none'; showToast('上传失败', 'error'); };
  xhr.send(formData);
}

// ==================== 发布版本 ====================
document.getElementById('btn-publish').addEventListener('click', async () => {
  const version = document.getElementById('publish-version').value.trim();
  const changelog = document.getElementById('publish-changelog').value.trim();
  const releaseDate = document.getElementById('publish-date').value;

  if (!version) { showToast('请输入版本号', 'error'); return; }

  try {
    const res = await fetch('/admin/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, changelog, release_date: releaseDate }),
    });
    const data = await res.json();
    if (data.status === 'success') {
      showToast('版本 v' + version + ' 发布成功', 'success');
      document.getElementById('publish-version').value = '';
      document.getElementById('publish-changelog').value = '';
      document.getElementById('publish-date').value = '';
      document.getElementById('btn-publish').disabled = true;
      uploadedFilename = '';
      loadStatus();
    } else {
      showToast('发布失败: ' + (data.message || '未知错误'), 'error');
    }
  } catch (e) { showToast('发布失败', 'error'); }
});

// ==================== 删除文件 ====================
async function deleteFile(filename) {
  showConfirm('删除文件', '确定要删除 ' + filename + ' 吗？此操作不可恢复。', async () => {
    try {
      const res = await fetch('/admin/versions/' + encodeURIComponent(filename), { method: 'DELETE' });
      const data = await res.json();
      if (data.status === 'success') { showToast('文件已删除', 'success'); loadFiles(); loadStatus(); }
      else showToast('删除失败', 'error');
    } catch (e) { showToast('删除失败', 'error'); }
  });
}

// ==================== 重置统计 ====================
document.getElementById('btn-reset-stats').addEventListener('click', () => {
  showConfirm('重置统计', '确定要重置所有统计数据吗？此操作不可恢复。', async () => {
    try {
      const res = await fetch('/admin/stats', { method: 'DELETE' });
      const data = await res.json();
      if (data.status === 'success') { showToast('统计数据已重置', 'success'); loadStats(); loadStatus(); }
      else showToast('重置失败', 'error');
    } catch (e) { showToast('重置失败', 'error'); }
  });
});

// ==================== 认证处理 ====================
async function handleLogout() {
  try {
    await fetch('/admin/logout', { method: 'POST', credentials: 'include' });
  } catch (e) {}
  window.location.href = '/';
}

async function checkAuth() {
  try {
    const res = await fetch('/admin/check-auth', { credentials: 'include' });
    const data = await res.json();
    if (!data.authenticated) {
      window.location.href = '/';
      return false;
    }
    return true;
  } catch (e) {
    window.location.href = '/';
    return false;
  }
}

// 全局 fetch 拦截：自动处理 401
const originalFetch = window.fetch;
window.fetch = function(...args) {
  return originalFetch.apply(this, args).then(res => {
    if (res.status === 401) {
      window.location.href = '/';
    }
    return res;
  });
};

// ==================== 初始化 ====================
checkAuth().then(authenticated => {
  if (!authenticated) return;
  document.getElementById('publish-date').value = new Date().toISOString().split('T')[0];
  loadStatus();
});
</script>
</body>
</html>"""


# ==================== 启动入口 ====================

if __name__ == "__main__":
    import uvicorn

    logger.info(f"更新服务启动 - 端口: {UPDATE_SERVER_PORT}")
    logger.info(f"数据目录: {DATA_DIR}")
    logger.info(f"发布文件目录: {RELEASES_DIR}")

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=UPDATE_SERVER_PORT,
        log_level="info"
    )
