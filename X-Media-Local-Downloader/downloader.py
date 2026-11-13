"""Local X media downloader; Python standard library only."""
import argparse
import json
import os
import re
import tempfile
import threading
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# 保存目录：填写完整路径，如 r"D:\X媒体"；留空则保存到此脚本所在文件夹的“下载文件”。
# 路径前的 r 必须保留，这样 Windows 路径中的反斜杠不会被误处理。
SAVE_DIRECTORY = r"D:\BDY_Download\X"

HOSTS = {'pbs.twimg.com', 'video.twimg.com'}
WRITE_LOCK = threading.Lock()


def allowed_url(url):
    try:
        u = urllib.parse.urlsplit(url)
        return (u.scheme == 'https' and u.hostname in HOSTS and u.username is None
                and u.password is None and u.port in (None, 443))
    except (TypeError, ValueError):
        return False


def validate_filename(name):
    if not isinstance(name, str) or not name or len(name) > 200 or name in ('.', '..'):
        raise ValueError('无效文件名')
    if re.search(r'[<>:"/\\|?*\x00-\x1f]', name) or name.endswith(('.', ' ')):
        raise ValueError('文件名包含非法字符')
    if re.match(r'^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)', name, re.I):
        raise ValueError('文件名是 Windows 保留名称')
    return name


def save_stream(root, filename, chunks, expected_size=None):
    filename = validate_filename(filename)
    root.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix='.xdownload-', suffix='.part', dir=root)
    temp = Path(temp_name)
    try:
        size = 0
        with os.fdopen(fd, 'wb') as output:
            for chunk in chunks:
                output.write(chunk)
                size += len(chunk)
        if size == 0 or (expected_size is not None and size != expected_size):
            raise ValueError(f'文件为空或长度不符: 实际 {size}，预期 {expected_size}')
        # Reservation with exclusive creation protects existing files and concurrent requests.
        name = Path(filename)
        with WRITE_LOCK:
            for index in range(100000):
                target = root / (filename if index == 0 else f'{name.stem} ({index}){name.suffix}')
                try:
                    with target.open('xb'):
                        pass
                    break
                except FileExistsError:
                    continue
            else:
                raise OSError('同名文件过多')
            try:
                os.replace(temp, target)
            except BaseException:
                target.unlink(missing_ok=True)
                raise
        return target
    finally:
        temp.unlink(missing_ok=True)


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not allowed_url(newurl):
            raise ValueError('拒绝跳转到非 X 媒体地址')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


OPENER = urllib.request.build_opener(SafeRedirect())


def download(url, filename, root):
    if not allowed_url(url):
        raise ValueError('只允许 HTTPS 的 pbs.twimg.com 或 video.twimg.com 媒体地址')
    validate_filename(filename)
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Accept': '*/*'})
    with OPENER.open(req, timeout=120) as response:
        content_type = response.headers.get_content_type().lower()
        if content_type in ('text/html', 'application/json'):
            raise ValueError(f'服务器返回非媒体内容: {content_type}')
        length = response.headers.get('Content-Length')
        expected = int(length) if length and length.isdigit() else None
        return save_stream(root, filename, iter(lambda: response.read(1024 * 256), b''), expected)


def make_handler(root):
    class Handler(BaseHTTPRequestHandler):
        def respond(self, code, data):
            body = json.dumps(data, ensure_ascii=False).encode('utf-8')
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                print('浏览器已断开；本地处理结果:', data, flush=True)

        def do_POST(self):
            # This is not authentication. Reject browser forms, cross-site origins
            # and DNS-rebinding hosts; privileged local programs can still call it.
            origin = self.headers.get('Origin', '')
            host = self.headers.get('Host', '').lower()
            host_valid = host == '127.0.0.1' or host.startswith('127.0.0.1:') and host[10:].isdigit()
            if (not host_valid or origin not in ('', 'https://x.com', 'https://twitter.com')
                    or self.headers.get('X-TMD-Request') != '1'
                    or self.headers.get_content_type() != 'application/json'):
                return self.respond(403, {'ok': False, 'error': '拒绝不受支持的请求'})
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 16384:
                    raise ValueError('请求长度不正确')
                data = json.loads(self.rfile.read(length).decode('utf-8'))
                if self.path == '/ping':
                    return self.respond(200, {'ok': True, 'directory': str(root)})
                if self.path == '/failure':
                    filename = str(data.get('filename', '未知文件')).replace('\n', ' ').replace('\r', ' ')
                    error = str(data.get('error', '')).replace('\n', ' ').replace('\r', ' ')
                    print('失败文件:', filename, '| 原因:', error, flush=True)
                    return self.respond(200, {'ok': True})
                if self.path != '/download':
                    return self.respond(404, {'ok': False, 'error': '未知接口'})
                print('正在下载:', data.get('filename'), flush=True)
                saved = download(data.get('url'), data.get('filename'), root)
                print('已保存:', saved, flush=True)
                return self.respond(200, {'ok': True, 'filename': saved.name, 'size': saved.stat().st_size})
            except (ValueError, TypeError, KeyError, json.JSONDecodeError) as e:
                print('请求失败:', str(e), flush=True)
                return self.respond(400, {'ok': False, 'error': str(e)})
            except Exception as e:
                print('下载失败:', str(e), flush=True)
                return self.respond(502, {'ok': False, 'error': str(e)})

        def log_message(self, format, *args):
            pass
    return Handler


def main():
    parser = argparse.ArgumentParser(description='本机 X 媒体下载服务')
    parser.add_argument('--directory', default=SAVE_DIRECTORY or str(ROOT / '下载文件'), help='保存目录；优先于脚本中的 SAVE_DIRECTORY')
    parser.add_argument('--port', type=int, default=18765)
    args = parser.parse_args()
    root = Path(args.directory).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1', args.port), make_handler(root))
    print('\nX 本地下载器已启动。请勿关闭此窗口。', flush=True)
    print('保存目录:', root, flush=True)
    print('按 Ctrl+C 停止。\n', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n已停止。')
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
