# 踩坑索引（症状 → 根因 → 处置）

每条都是本项目实际踩过并修复的。按「你会先看到什么」组织；调试前先扫对应小节。

## Tauri / 权限 / 窗口

| 症状 | 根因 | 处置 |
|---|---|---|
| window/plugin API 调用不报错但没效果（如 setTheme 后亮色主题一团糟） | capability 缺对应权限，Tauri 静默拒绝 | 查/补 `capabilities/default.json`：`core:window:allow-set-theme` / `allow-start-dragging` / `allow-toggle-maximize`、`updater:default`、`process:allow-restart` |
| 拖滚动条时整个窗口跟着移动 | 长按拖动手势没排除滚动条命中 | `use-window-drag.ts` 已内置两道防线：指针坐标超出 clientWidth/Height 视为经典滚动条；手势期间收到 scroll 事件即否决。新增 chrome 区域复用该 hook，别自写 |
| WebView2（Windows）上 HTML5 drag 完全不触发 | 窗口 `dragDropEnabled` 默认 true，原生层吞掉 HTML5 DnD | 内部拖拽（卡片→文件夹）一律 pointer 方案（drag-store + use-card-drag）；外部文件导入用原生 `onDragDropEvent`（经 `tauri-events.ts`） |
| Windows 侧栏透明过头、文字看不清 | mica/acrylic 的透过率远高于 macOS vibrancy，同一半透明 token 两平台观感完全不同 | `windowEffects.effects` 混填 `["sidebar","mica","acrylic","blur"]`（各平台忽略不认识的值，一份配置服双端）；main.tsx 按 UA 挂 `.platform-windows` + index.css `@custom-variant windows` + 关键面板 `windows:bg-sidebar` 不透明兜底 |

## macOS 分发

| 症状 | 根因 | 处置 |
|---|---|---|
| 安装后提示「已损坏，无法打开」 | 未公证 + quarantine 属性（Gatekeeper） | `xattr -cr /Applications/yAssets.app`（README 已记载）；应用内更新下载不带 quarantine，不受影响 |
| 双击启动「闪退」 | 大概率不是 crash：single-instance 插件——dev 实例与 release 版同 identifier（`com.maosensen.yassets`），后启动者直接退出 | 先查 `~/Library/Logs/DiagnosticReports` 有无记录；没有 → 关掉 `pnpm tauri dev` 再启动。dev 与正式版互斥属预期 |
| （潜在）不同大小写文件名撞车 | APFS 大小写不敏感 | 文件 id 只用 `[0-9a-z]` 字母表（`library::new_id`），别引入混合大小写 id |

## Rust / crates

- **rusqlite `Connection` 是 `Send + !Sync`** → 单写连接 Mutex + 手写读池，全部经 `Library::read`/`write`（blocking 线程），锁绝不跨 await。
- **`image` crate 的 WebPEncoder 只有 lossless**（体积 3–5 倍）→ lossy 编码用 `webp` crate。
- **EXIF 方向要在记录宽高之前转正**，否则竖拍照片的 masonry 布局全错。
- **`AppError::Internal` 是 unit variant**：细节走 `logger`，payload 里没有位置放 detail。
- clippy 高频修法：手写除零保护 → `checked_div`；`&Vec<T>`/`&mut Vec<T>` 参数 → `&[T]`/`&mut [usize]`；索引 for 循环 → `enumerate`。
- specta 红线：三件套 `=` 锁版本、一起升；**64 位整数不能过 IPC**（字节数/时间戳 → f64，宽高 u32，评分 u8）。

## 前端

- **unplugin-icons `compiler:"jsx"`** 需要显式安装 `@svgr/core` + `@svgr/plugin-jsx`（devDeps），否则 vitest 环境直接炸。
- **shadcn 底座是 Base UI 不是 Radix**：触发器用 `render={...}` 不是 `asChild`；菜单项用 `onClick`（`onSelect` 能过类型检查但永远不触发）；`*MenuLabel` 必须在 `*MenuGroup` 里否则运行时抛错。
- **biome `noStaticElementInteractions` 挡窗口手势 div** → 逐处 `biome-ignore` 并写明理由（window chrome 手势合法地落在 div 上），不放宽全局规则。
- **视频封面零 ffmpeg 管线**：`<video crossOrigin="anonymous">` → canvas 截帧；遇 SecurityError（画布污染）退 blob URL 重试；失败进会话级 skip-set 防无限重试。
- **React 合成 onWheel 无法 preventDefault**（passive）→ 画布缩放的 wheel 监听必须原生 `addEventListener(..., { passive: false })`。
- 全局键盘处理必须同时跳过输入框**和** `[role="dialog"]` 祖先，否则对话框里打字会触发网格快捷键。

## CI / 发布 / 更新

- **Actions 报 "Wrong password for that key"** → secret 存的是轮换前的旧密钥文件。定位法：本地 `pnpm tauri signer sign --private-key-path ~/.tauri/yassets.key --password "<密码>" <任意文件>`——本地能过 = secret 过期，更新 `TAURI_SIGNING_PRIVATE_KEY` 后重跑。
- **GitHub secrets 不接受空值** → 签名密钥必须带密码生成。`tauri signer generate` 的 `-w` 短旗标不可用，用长旗标：`--write-keys ~/.tauri/yassets.key --password "<密码>" --force`；**换钥后 `tauri.conf.json` 的 `plugins.updater.pubkey` 必须同步更新**。
- **更新通知的先有鸡先有蛋**：自动检查功能随版本 N 首发，则只有「从 N 升 N+1」才能看到 toast；N−1 用户只能走 Preferences ▸ Check for Updates 手动升。发布任何「通知类」功能时主动向用户解释这一点，省一轮「为什么没反应」。
- **updater 全链路清单**（漏任何一项就静默不工作）：`plugins.updater.pubkey + endpoints`（tauri.conf.json）→ `bundle.createUpdaterArtifacts: true` → capabilities `updater:default` + `process:allow-restart` → lib.rs 注册 updater + process 插件 → 前端只经 `lib/updater.ts`。
- `releases/latest/download/latest.json` 只解析**已发布**的 release——draft 阶段 404 属预期。

## IPC / 导入管线

- 改导入管线共享函数签名（如 `process_file` 加参数）→ 用 codegraph_impact 全仓扫调用点（上次波及 10 处，含 `commands/trash.rs` 的恢复路径），受影响测试语义同 commit 更新。
- `keep_duplicates = true` 只关**库级**查重；批内 `seen_hashes` 永远生效（同一批拖两份一样的文件仍只进一份）。
- 嵌套文件夹导入：`DiscoveredFile.folder_components` 相对「拖入目录的父级」计算（所以拖入的目录名本身是链条第一层）；`build_folder_map` 用 BTreeSet 保证父先于子创建，`ensure_folder` 按 `name COLLATE NOCASE + parent_id` 复用——重复导入收敛到同一棵树。
