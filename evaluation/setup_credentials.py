#!/usr/bin/env python3
"""交互填写本机 token，输入不回显，不写入 Git 跟踪文件。"""
import getpass
import json
from pathlib import Path


def main():
    folder = Path(__file__).resolve().parent / ".local"
    folder.mkdir(exist_ok=True, mode=0o700)
    folder.chmod(0o700)
    target = folder / "credentials.json"
    data = json.loads(target.read_text()) if target.exists() else {}
    for key, label in [("AGGREGATE_API_KEY", "聚合 API"), ("DASHSCOPE_API_KEY", "百炼")]:
        value = getpass.getpass(label + " token（直接回车保留已有值）：").strip()
        if value:
            data[key] = value
    # Set restrictive permissions before writing any secret bytes.
    import os
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        os.chmod(target, 0o600)
        json.dump(data, handle)
    print("凭证已保存到本机 evaluation/.local/credentials.json。")


if __name__ == "__main__":
    main()
