"""
用 GitHub API 建 / 更新一条 Release，正文自动从 git 历史里生成。

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


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def repo_slug() -> tuple[str, str]:
    """从 origin 的 URL 里解析 owner/repo，https 和 ssh 两种写法都认。"""
    url = git("remote", "get-url", "origin")
    m = re.search(r"github\.com[:/]([^/]+)/([^/.]+?)(?:\.git)?$", url)
    if not m:
        sys.exit(f"无法从 origin 解析 owner/repo：{url}")
    return m.group(1), m.group(2)


def last_tag(tag: str) -> str | None:
    """上一个 tag（版本序，不是时间序）。没有就返回 None。"""
    try:
        tags = git("tag", "--sort=-v:refname").splitlines()
    except subprocess.CalledProcessError:
        return None
    # 当前 tag 自己可能已经打在 HEAD 上，要跳过它去找更早的那个
    older = [t for t in tags if t != tag]
    return older[0] if older else None


def commit_log(tag: str) -> str | None:
    """从上一个 tag 到 HEAD 的提交，按前缀分组排成 Release 正文。

    仓库不再维护 CHANGELOG.md —— 49 条 commit 本身就是更好的记录。
    约定式提交前缀（feat/fix/refactor/docs/chore/test）直接当分类标题用。
    """
    base = last_tag(tag)
    span = f"{base}..HEAD" if base else "HEAD"
    try:
        raw = subprocess.check_output(
            ["git", "log", "--pretty=format:%s%n%b%n---", span], cwd=ROOT, text=True
        )
    except subprocess.CalledProcessError as exc:
        sys.exit(f"git log 失败：{exc}")

    groups: dict[str, list[str]] = {}
    for block in raw.split("\n---"):
        lines = [ln.rstrip() for ln in block.strip().splitlines() if ln.strip()]
        if not lines:
            continue
        subject = lines[0]
        m = re.match(r"^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$", subject)
        if m:
            kind, scope, text = m.group(1), m.group(2), m.group(3)
        else:
            kind, scope, text = "其他", None, subject
        label = {
            "feat": "新功能", "fix": "修复", "refactor": "重构",
            "perf": "性能", "docs": "文档", "test": "测试", "chore": "杂项",
        }.get(kind, "其他")
        item = f"- **{scope}**：{text}" if scope else f"- {text}"
        groups.setdefault(label, []).append(item)

    if not groups:
        return None

    order = ["新功能", "修复", "重构", "性能", "测试", "文档", "杂项", "其他"]
    parts = []
    for label in order:
        items = groups.get(label)
        if items:
            parts.append(f"### {label}\n" + "\n".join(items))
    header = f"对比 {base}...{tag}" if base else f"首个版本 {tag}"
    return f"{header}\n\n" + "\n\n".join(parts)


def readme_version() -> str | None:
    """README 顶部那行「当前版本：vX.Y」。

    连漏了两次（v1.0→v1.1、v1.1→v1.2），所以发版前在这里卡一道：
    对不上就不让发，免得 tag 里的 README 还写着上一个版本。
    """
    text = (ROOT / "README.md").read_text(encoding="utf-8")
    m = re.search(r"当前版本：\**\s*(v[\d.]+)", text)
    return m.group(1) if m else None


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
    parser.add_argument("--force", action="store_true", help="跳过 README 版本号一致性检查")
    parser.add_argument("--dry-run", action="store_true", help="只打印正文，不发请求")
    args = parser.parse_args()

    declared = readme_version()
    if declared != args.tag:
        message = f"README.md 顶部写的是 {declared or '(没找到「当前版本：vX.Y」)'}，和要发的 {args.tag} 对不上"
        if args.force:
            print(f"[警告] {message}（--force，继续）")
        else:
            sys.exit(f"{message}\n先把 README 顶部改成 {args.tag}，或加 --force 跳过检查。")

    body = commit_log(args.tag)
    if not body:
        sys.exit(f"{args.tag} 之前没有任何提交，生成不出 Release 正文")
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
