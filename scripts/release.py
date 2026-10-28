"""
用 GitHub API 建 / 更新一条 Release，正文自动从 CHANGELOG.md 里对应版本的段落取。

用法（token 要有 classic PAT 的 repo 权限）：

    GH_TOKEN=ghp_xxx python scripts/release.py v1.1
    GH_TOKEN=ghp_xxx python scripts/release.py v1.1 --dry-run    # 只看正文，不发请求
    GH_TOKEN=ghp_xxx python scripts/release.py v1.1 --name "PsyMatch v1.1"

已在同一个 tag 上发过 Release 的话走 PATCH 更新，不会重复建。
tag 本身要先 push 上去（`git push origin main --tags`），否则 API 会 422。
"""
import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def repo_slug() -> tuple[str, str]:
    """从 origin 的 URL 里解析 owner/repo，https 和 ssh 两种写法都认。"""
    url = subprocess.check_output(
        ["git", "remote", "get-url", "origin"], cwd=ROOT, text=True
    ).strip()
    m = re.search(r"github\.com[:/]([^/]+)/([^/.]+?)(?:\.git)?$", url)
    if not m:
        sys.exit(f"无法从 origin 解析 owner/repo：{url}")
    return m.group(1), m.group(2)


def changelog_section(tag: str) -> str | None:
    """取 `## v1.1 — ...` 到下一个 `## v` 之间的正文。"""
    text = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    m = re.search(rf"^## {re.escape(tag)}\b.*$", text, re.M)
    if not m:
        return None
    rest = text[m.end():]
    nxt = re.search(r"^## v", rest, re.M)
    body = rest[: nxt.start()] if nxt else rest
    return re.sub(r"\n-{3,}\s*$", "", body).strip()


def api(method: str, path: str, token: str, payload: dict | None = None):
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "psymatch-release",
            **({"Content-Type": "application/json"} if payload is not None else {}),
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read() or "{}")
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            return exc.code, json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return exc.code, {"raw": raw.decode("utf-8", "replace")}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("tag", help="例如 v1.1")
    parser.add_argument("--name", help="Release 标题，默认 PsyMatch <tag>")
    parser.add_argument("--target", default="main", help="目标分支，默认 main")
    parser.add_argument("--dry-run", action="store_true", help="只打印正文，不发请求")
    args = parser.parse_args()

    body = changelog_section(args.tag)
    if not body:
        sys.exit(f"CHANGELOG.md 里找不到 `## {args.tag}` 开头的段落")
    name = args.name or f"PsyMatch {args.tag}"

    if args.dry_run:
        print(f"@{args.tag}  {name}\n{'=' * 50}\n{body}")
        return

    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if not token:
        sys.exit("缺少 GH_TOKEN 环境变量（需要 repo 权限）")

    owner, repo = repo_slug()
    print(f"仓库: {owner}/{repo}")

    status, existing = api("GET", f"/repos/{owner}/{repo}/releases/tags/{args.tag}", token)
    payload = {
        "tag_name": args.tag,
        "target_commitish": args.target,
        "name": name,
        "body": body,
        "draft": False,
        "prerelease": False,
    }

    if status == 200:
        print(f"已有 Release（id {existing.get('id')}），走更新")
        status, data = api(
            "PATCH", f"/repos/{owner}/{repo}/releases/{existing['id']}", token, payload
        )
    elif status == 404:
        status, data = api("POST", f"/repos/{owner}/{repo}/releases", token, payload)
    else:
        sys.exit(f"查询失败 HTTP {status}: {existing}")

    if status not in (200, 201):
        sys.exit(f"写入失败 HTTP {status}: {data.get('message') or data}")

    print(f"完成 HTTP {status}")
    print(f"  页面: {data.get('html_url')}")
    print(f"  tag : {data.get('tag_name')}  name: {data.get('name')}")
    print(f"  正文 {len(data.get('body') or '')} 字符")


if __name__ == "__main__":
    main()
