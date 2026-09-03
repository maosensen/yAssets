# Release card — yAssets

<!-- 由 release skill 生成于 2026-07-28;发版流程见 user 级 release skill,本卡只记录项目特异性事实。
     更详细的签名密钥铁律与分发注意事项见 .claude/skills/dev-playbook/release.md(与本卡互补,冲突时以实测为准)。 -->

## 版本文件(bump 时全部同步)

- `package.json`
- `src-tauri/tauri.conf.json`   <!-- 发布版本以它为准 -->
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`(`yassets` 条目;dev 进程跑着时会自动同步)

bump 后 `grep -rn "<旧版本号>"` 确认四处无残留(排除 lockfile 第三方依赖)。

## 门禁

- `pnpm check`(typecheck + biome + vitest + bindings 漂移 + rustfmt + clippy)
  - `bindings.ts` 是生成物:变更属正常,重新生成随功能 commit,不手改
- smoke:—(门禁已含双端测试)

## CHANGELOG

- `CHANGELOG.md`,Keep a Changelog,英文;新小节会被 `release.yml` 的 create-release 原样用作 Release body(漏填会回退到自动生成 notes,别让 body 空着)
- 应用内 What's New:`src/lib/changelog/{en,zh,ja}.ts` 三份同构(release 带 title/summary,change 带 kind/title/text;`text` 不要以行标题开头)

## 发布渠道

- 渠道:A(tag `v*` 触发 `.github/workflows/release.yml`,四平台矩阵 macOS aarch64/x64 + Windows + Linux → **draft** Release)
- 等待 CI:用 release skill 的 `scripts/watch_run.sh <run-id>` 轮询到 completed,不要只信 `gh run watch`
- 产物期望数:**17**(2026-07-28 以 v0.1.25 实测)——macOS 2 架构 ×(dmg 无 sig + app.tar.gz + .sig)= 6;Windows msi/.sig + setup.exe/.sig = 4;Linux deb/rpm/AppImage 各带 .sig = 6;latest.json = 1
- 发布:资产数达标后 `gh release edit vX.Y.Z --draft=false`
- 发布后验证:`curl -sL https://github.com/maosensen/yAssets/releases/latest/download/latest.json` → version 正确、darwin-aarch64 / darwin-x86_64 / windows-x86_64 等平台齐、每平台有 signature(draft 阶段 404 属预期)

## 功能台账

- `.roadmap/features.yaml` 存在 → 发版门禁含台账核对(置 done / completedAt / shippedIn)
- 一条 feature = 可独立宣布的**应用能力**;仓库基建/文档变更不建 feature 条目

## 本项目特有注意事项

- 签名私钥在 `~/.tauri/yassets.key`(带密码),**密钥与密码永不入库**;丢失任一 = 已发行版本永久收不到更新。CI 从 `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` secrets 读取
- macOS 签名 + 公证自 **v0.1.29** 起在 CI 内完成(`APPLE_*` secrets,详见 dev-playbook/release.md),下载包直接过 Gatekeeper。**≤ v0.1.28 的旧包**仍会报「已损坏」→ `xattr -cr /Applications/yAssets.app`
- dev 实例(`pnpm tauri dev`)开着时启动正式版会立即退出(single-instance 同 identifier)
