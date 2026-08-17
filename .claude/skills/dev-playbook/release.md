# 发版 Runbook

## 签名密钥铁律（最先读）

- 私钥：`~/.tauri/yassets.key`（公钥 `.pub` 同目录）。**在仓库之外，永不入库、永不出现在 commit / 日志 / 任何仓库文件里**；带密码保护。
- **密码值同样绝不写进任何仓库文件**——它只存在于 GitHub secret 和用户自己的记录里。
- GitHub secrets（repo Settings ▸ Secrets and variables ▸ Actions）：
  - `TAURI_SIGNING_PRIVATE_KEY` = 密钥**文件全文**
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = 密码
- **macOS 签名/公证（2026-08 起）**：`APPLE_CERTIFICATE`（Developer ID Application .p12 的 base64）、`APPLE_CERTIFICATE_PASSWORD`（.p12 导出密码）、`APPLE_SIGNING_IDENTITY`（`Developer ID Application: YANG JIAKAI (D567A6PTG2)`）、`APPLE_ID`（**Apple ID 邮箱** `yjkbako.lyre@gmail.com`——0.1.29 首跑实测：误填成 Team ID 会在公证阶段报 `401 Invalid credentials`，而签名阶段照常通过，别被"证书没问题"误导）、`APPLE_PASSWORD`（**应用专用密码**，非登录密码，appleid 可吊销重发）、`APPLE_TEAM_ID`（`D567A6PTG2`）。公证凭据错误的修复姿势：改 secret 后 `gh run rerun <id> --failed` 只重跑 macOS job，draft 与其他平台产物原地保留，无需重打 tag。证书 .p12 与私钥在用户离线备份里，同样永不入库。Developer ID Application 证书同时最多 2 张、私钥丢失只能作废重发。
- **Apple 签名与 minisign 是两套独立信任链**：Gatekeeper 看 Apple 签名，updater 的 `latest.json` 看 minisign（`pubkey`）。两个都必须在，谁也不替代谁。
- **丢失密钥或密码 = 已发行版本永久收不到更新**（只能让用户手动重装）。不要轮换密钥，除非用户明确要求且知晓后果；轮换 = 重新生成 + 更新 conf 的 `plugins.updater.pubkey` + 更新两个 secrets，旧版本用户从此断链。

## 流程（以 0.1.1 实际发版为准）

1. **bump 版本**：`src-tauri/tauri.conf.json` 的 `version`（发布版本以它为准）、`package.json`、`src-tauri/Cargo.toml`（+ `Cargo.lock` 里的 `yassets`）四处同步一致。
1b. **更新 `CHANGELOG.md`**：把 `## [Unreleased]` 的条目挪到 `## [X.Y.Z] - YYYY-MM-DD` 新小节（Unreleased 清空留给下一轮），并在文件底部加一行 `[X.Y.Z]: …releases/tag/vX.Y.Z` 链接。这一小节会被 `release.yml` 的 `create-release` 原样当作 GitHub Release 的 body（外部 changelog dashboard 读的就是它）；漏填则回退到 GitHub 自动生成的 notes，别让 body 空着。
1c. **更新应用内 What's New**：在 `src/lib/changelog/{en,zh,ja}.ts` 各加一条本版本的 release（三份结构一致）：`version`/`date` + 必填 headline `title`（可选一句 `summary`）+ 精选 `changes`（每条带 `kind` 与描述 `text`，通常再配短行标题 `title`——类型上可选；`text` 别再以标题开头，避免与行标题重复）。
2. 功能 / 修复 commit 齐全，`pnpm check` 全绿。
3. push main 后打 tag：`git tag vX.Y.Z && git push origin vX.Y.Z`（tag 触发 `.github/workflows/release.yml`）。
4. **盯 CI**：`gh run watch <run-id>`——四平台矩阵（macOS aarch64/x64、Windows、Linux）→ 产出 **draft** Release。失败先在本地复现同一条命令（见 gotchas.md 的 CI 小节）再改。macOS 两个 job 各含一次公证等待（Apple 侧排队，通常 2–15 分钟），比其他平台明显慢属预期，别当卡死。
5. **验 draft 资产**：`gh release view vX.Y.Z --json assets,draft`，应有 **17 个**（0.1.1 实测值）。`.sig` 只跟签名产物走，别数错：
   - macOS ×2 架构：`dmg`（**无 sig**）+ `app.tar.gz` + `app.tar.gz.sig` = 每架构 3，共 6
   - Windows：`msi` + `msi.sig` + `setup.exe`(nsis) + `setup.exe.sig` = 4
   - Linux：`deb` + `deb.sig` + `rpm` + `rpm.sig` + `AppImage` + `AppImage.sig` = 6（deb/rpm **也有** sig）
   - `latest.json` = 1 → 合计 6 + 4 + 6 + 1 = 17。
6. 发布：`gh release edit vX.Y.Z --draft=false`。
7. **服务端验证**（draft 阶段此 URL 404 属预期，发布后才通）：

   ```bash
   curl -sL https://github.com/maosensen/yAssets/releases/latest/download/latest.json
   ```

   确认 `version` 正确、platforms 含 darwin-aarch64 / darwin-x86_64 / windows-x86_64 等、每个平台都有 signature。
8. **提醒用户升级路径**：装了带自动检查版本（≥0.1.1）的机器启动约 5 秒后弹 toast（Install & Restart）；更老的版本走 Preferences ▸ Updates 手动检查。

## 已知分发问题（提前告知用户）

- macOS **≤ v0.1.28 的老包**未公证：首次手动安装 dmg 会报「已损坏」→ `xattr -cr /Applications/yAssets.app`；应用内更新不受影响。之后的版本已签名 + 公证，安装后可用 `spctl -a -vvv -t install /Applications/yAssets.app` 验证（应见 `source=Notarized Developer ID`）。
- dev 实例（`pnpm tauri dev`）开着时启动正式版会立即退出（single-instance 同 identifier）——先关 dev。
- 验证更新流程注意先有鸡先有蛋：toast 只在「从带该功能的版本升级」时出现（详见 gotchas.md）。
