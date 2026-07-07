# 踩坑索引（症状 → 根因 → 处置）

每条都是本项目实际踩过并修复的。按「你会先看到什么」组织；调试前先扫对应小节。

## Tauri / 权限 / 窗口

| 症状 | 根因 | 处置 |
|---|---|---|
| window/plugin API 调用不报错但没效果（如 setTheme 后亮色主题一团糟） | capability 缺对应权限，Tauri 静默拒绝 | 查/补 `capabilities/default.json`：`core:window:allow-set-theme` / `allow-start-dragging` / `allow-toggle-maximize`、`updater:default`、`process:allow-restart` |
| 拖滚动条时整个窗口跟着移动 | 长按拖动手势没排除滚动条命中 | `use-window-drag.ts` 已内置两道防线：指针坐标超出 clientWidth/Height 视为经典滚动条；手势期间收到 scroll 事件即否决。新增 chrome 区域复用该 hook，别自写 |
| WebView2（Windows）上 HTML5 drag 完全不触发 | 窗口 `dragDropEnabled` 默认 true，原生层吞掉 HTML5 DnD | 内部拖拽（卡片→文件夹）一律 pointer 方案（drag-store + use-card-drag）；外部文件导入用原生 `onDragDropEvent`（经 `tauri-events.ts`） |
| Windows 侧栏透明过头、文字看不清 | mica/acrylic 的透过率远高于 macOS vibrancy，同一半透明 token 两平台观感完全不同 | `windowEffects.effects` 混填 `["sidebar","mica","acrylic","blur"]`（各平台忽略不认识的值，一份配置服双端）；main.tsx 按 UA 挂 `.platform-windows` + index.css `@custom-variant windows` + 关键面板 `windows:bg-sidebar` 不透明兜底 |
| 设了自定义原生菜单后 macOS 上 Cmd+C/V/X/A 全失效 | `app.set_menu` 一旦设了自定义 app 菜单，就把系统默认的 Edit 菜单（含剪切/复制/粘贴/全选）**整个替换掉**了 | 菜单里**必须**手动补一个 `Edit` 子菜单（`SubmenuBuilder::new(h,"Edit").undo().redo().cut().copy().paste().select_all()`）；顺带补 Window（minimize/maximize/close_window）。原生菜单仅 macOS（`#[cfg(target_os="macos")]`），Windows/Linux 会在窗口内长出菜单栏和自定义标题栏打架，那边用侧栏菜单承载同样动作 |
| 原生菜单点 Preferences/About 没反应（欢迎页） | macOS 菜单栏**全局常驻**（欢迎页也在），但对话框当时挂在侧栏组件里、欢迎页没侧栏 → 菜单只 set 了 store flag 没人渲染；开库后 flag 残留还会误弹 | 菜单驱动的全局对话框放到根级 `AppDialogs`（在 i18n 重挂边界**内**，始终挂载、切语言也重译），用 UI store flag 驱动。菜单→前端走 `app.emit("menu://<id>")` + `listen`；订阅 hook 挂在重挂边界**外**（RootComponent），异步 `listen` 的 cleanup 要用 `cancelled` 标志防竞态 |

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
- **`psd` crate 对畸形/截断文件会 panic（slice 越界），不是返回 Err**。缩略图 `generate()` 在导入的 rayon worker 上直接跑，一个 panic 会 unwind 掉**整批导入**（违背「单文件失败不污染批次」）。`decode_psd` 用 `std::panic::catch_unwind` 把 `Psd::from_bytes` + `.rgba()` 包起来 → 坏 PSD 退化成单文件错误。任何「解码用户文件」的第三方 crate 都要先确认它 panic 还是返回 Err。
- **新增缩略图格式要区分「服务端可解码」vs「需 WebView」**：纯 Rust 能 headless 解的（tiff/ico/psd/sketch）走导入管线 `is_thumbable_ext`；WebView 才能解的（video/pdf/heic）不进 `is_thumbable_ext`，改由 `list_cover_candidates` + 前端 `use-cover-worker` 客户端截帧。存量文件回填：服务端格式靠 `backfill_missing_thumbnails`（每次开库跑一次），客户端格式靠 worker 扫 `has_thumb=0`。
- **zip 容器格式**（sketch/ora/kra）内嵌预览 PNG：`zip` crate 用 `default-features=false, features=["deflate"]` 保持纯 Rust（别拉 bzip2/lzma/zstd 的 C 依赖）；按格式试候选路径（sketch=`previews/preview.png`, ora=`Thumbnails/thumbnail.png`, kra=`mergedimage.png`）。
- **「遍历磁盘文件 vs DB rel_path」必须归一化路径分隔符**：DB 里 rel_path 是 `asset_rel_path` 写死的正斜杠（`assets/ab/id.png`），但 `entry.strip_prefix(root).to_string_lossy()` 在 **Windows 出反斜杠**，集合比对永不命中 → **每个素材都被判成孤儿**。`find_orphans` 里 `rel.replace(std::path::MAIN_SEPARATOR, "/")` 后再比。⚠️ 更大的教训：**把一个 log-only 的检查改成「可删除」时是数据丢失倍增器**——`spawn_orphan_sweep` 一直有这个分隔符 bug 但只打日志无害；M10 让它能删了才变成「Windows 上清孤儿=删整库」。这类重构要专门 re-review。
- **keyset 分页**：`sort_sql` 早就带了 `{col} {dir}, id {dir}` tiebreak；游标谓词要**手写展开**（`(col cmp ? OR (col = ? AND id cmp ?))`）**不能用 `(col,id)` 行值元组**——因为 Name 排序要 `COLLATE NOCASE`，元组比较注入不了 collation，会导致翻页重叠/跳过。方向随 `dir`（Desc=`<`/Asc=`>`）。UpdatedAt 排序要把 `updated_at` 加进 `AssetSummary`/`SUMMARY_COLS`，游标值才能从已加载行取到。总数 `total` 每页都返回，计数器才不受已加载页数影响。
- **`notify-debouncer-full` 的 `Drop` 只置 stop 标志、不 join 线程**（阻塞 join 在消费型 `stop()` 里，从不被调用）→ 库切换/关闭后一个已成熟的 debounced 批次仍可能触发回调，把文件导入到**已切走/已关闭的库**（绕过 `cancel_all_imports`）。防御：watcher 回调 spawn 前用 `Arc::ptr_eq(state.current_library(), 捕获的 library)` 校验仍是当前库，不是就 no-op。watcher 句柄以 `Box<dyn Any + Send>` 存 AppState（RAII，换/清即 drop）。
- **watched-folder 路径校验先 canonicalize**：`Path::starts_with` 按 component 字面比较，不解析 `..`/symlink，所以 `.../foo/../Lib` 能绕过「不许监视库内」的检查 → reconcile 走库自身 assets/thumbs → 导入死循环。`std::fs::canonicalize` 两边后再做包含判断，并存归一化后的路径。
- **删孤儿的 TOCTOU**：`has_active_imports()` 只在进 `run_blocking` 前查一次；watcher 事件可能之后才 spawn 导入，把刚复制进 `assets/`、DB 行还没提交的文件当孤儿删掉。除了这个 guard，删除时**跳过 mtime 在 60s 宽限窗内的文件**。

## 前端

- **unplugin-icons `compiler:"jsx"`** 需要显式安装 `@svgr/core` + `@svgr/plugin-jsx`（devDeps），否则 vitest 环境直接炸。
- **shadcn 底座是 Base UI 不是 Radix**：触发器用 `render={...}` 不是 `asChild`；菜单项用 `onClick`（`onSelect` 能过类型检查但永远不触发）；`*MenuLabel` 必须在 `*MenuGroup` 里否则运行时抛错。
- **biome `noStaticElementInteractions` 挡窗口手势 div** → 逐处 `biome-ignore` 并写明理由（window chrome 手势合法地落在 div 上），不放宽全局规则。
- **视频封面零 ffmpeg 管线**：`<video crossOrigin="anonymous">` → canvas 截帧；遇 SecurityError（画布污染）退 blob URL 重试；失败进会话级 skip-set 防无限重试。同一套客户端截帧管线现泛化到 PDF（pdf.js 渲第 1 页）和 HEIC（`<img>` 解码，仅 WebKit/macOS 能解，Chromium WebView 回落占位）：`lib/cover-capture.ts` 按 ext 分发，`use-cover-worker.ts` 统一 drain。
- **pdf.js（pdfjs-dist v6）在 CSP + Tauri 下的坑**：① 顶层 `import * as pdfjsLib` 在模块加载时就引用 `DOMMatrix`，jsdom 测试环境没有该全局 → 直接炸；且 ~1MB 进启动包。**改用动态 `import("pdfjs-dist")` 懒加载**（首次截 PDF 才加载），顺带修了测试。② v6 API 变了：`getDocument` 参数类型里**没有** `isEvalSupported`（删掉，pdf.js 自己会在无 unsafe-eval 的 CSP 下探测并禁用 eval 快路径）；`PDFDocumentProxy` **没有** `destroy()`（用 `loadingTask.destroy()`）；`page.render` 用 `{ canvas, viewport, background: "#ffffff" }`（不是 `canvasContext`；`background` 填白，否则黑字画到透明 canvas 转 JPEG 后是黑底黑字）。③ Worker 走 Vite `import PdfWorkerUrl from "...pdf.worker.min.mjs?url"`（同源 module worker，CSP `script-src 'self'` 覆盖 worker-src）；PDF 字节主线程 `fetch` 后以 `{data}` 传入，worker 不碰网络。
- **给 tiff/heic/psd/sketch 生成缩略图后 `has_thumb=1` → `viewerKindFor` 会返回 `"image"`**，预览会走图片查看器。但这些原图 Chromium WebView 解不了 → `viewer-registry.canDecodeNativeImage()` 白名单（png/jpg/jpeg/gif/webp/bmp/svg/ico）之外的，预览只显示 512 缩略图、**不去 fetch 无法解码的原图**（`preview.tsx ImageBody` 按 ext 门控 original-load，兼省下大文件白下载）。
- **React 合成 onWheel 无法 preventDefault**（passive）→ 画布缩放的 wheel 监听必须原生 `addEventListener(..., { passive: false })`。
- 全局键盘处理必须同时跳过输入框**和** `[role="dialog"]` 祖先，否则对话框里打字会触发网格快捷键。
- **infinite query（keyset 分页）的乐观更新必须遍历 `InfiniteData.pages`**，不是单个 `{items,total}` 数组——旧的乐观 helper（trash/restore/rename）在缓存值变成 `InfiniteData` 的瞬间会静默 no-op 或崩。改造 query 和改造这些 helper 必须**同一提交**。展平的 `items` 要 `useMemo`（`data.pages.flatMap` 每次渲染都是新数组 → 网格 layout memo 每次重算，性能回退）。计数器语义分叉：`total` 是全量匹配数，但预览「Next 禁用」要用**已加载数** `items.length`（否则最后一张已加载项处按钮可点却 no-op）。
- **全库 `list_asset_ids` 支撑分页后的全选**：Cmd+A 不能只选已加载页；加一个只返回 id、无分页的后端命令，前端 Cmd+A 拉全量 id 再 selectMany（similar 视图是单次 capped 查询，选已加载即可）。
- **手写 focus trap 必须把「容器自身」当边界**：自定义全屏 modal（幻灯片）用 `tabIndex=-1` 的容器承接初始焦点，但容器**不在** `querySelectorAll('button,...')` 的可聚焦列表里。若 trap 只判 `active===first/last || !root.contains(active)`，那么焦点停在容器上时 `root.contains(容器)` 为 true 且既非 first 也非 last → 两个分支都不进 → 浏览器默认 **Shift+Tab 把焦点送到 DOM 里排在容器前面的控件**（本例是盖在 `z-95` 遮罩下面的 preview topbar 按钮），焦点逃出 modal。修法：`const atBoundary = active === root || !root.contains(active)`，Tab/Shift+Tab 命中边界就 `preventDefault` 并 wrap 到 first/last。对抗式 review 抓到的真回归。
- **i18n 可切换而零改动 43 个引用**：文案放 `i18n/en.ts`（不加 `as const`，这样 `Messages = typeof en` 的叶子是 `string`/函数签名，别的 locale 才能满足契约；加了 `as const` 会把每个字面量钉死成精确字符串，第二语言无法赋值）。`T` 做成**浅 Proxy**（只拦顶层 `T.<group>`，返回 `locales[active][group]` 的真对象，嵌套访问/迭代不受影响、引用稳定），调用形态 `T.a.b(...)` 不变，`text.ts` 退化成 re-export barrel。`counted()` 换 `Intl.PluralRules`：只决定单复数形，`s` 后缀逻辑不变，对现有所有调用（含 `0`/多词名词）输出与旧实现逐字一致。CJK 无复数：`zh.ts`/`ja.ts` 不用 `counted`，直接「数字+量词」内联。
- **运行时切语言 = 靠 `key` 重挂子树，但边界要收窄**：`T` 是渲染期解析的 Proxy，普通 re-render 会被 `React.memo` 挡住（provider re-render 也不会重渲染作为 prop 传入的 `{children}`——元素引用不变会 bailout）。所以切 locale 用 `<Fragment key={locale}>` 强制**重挂**子树让所有组件重读 `T`。**但重挂边界必须只包 routed content（`<Outlet/>`），不能包 `<Toaster/>`**：Sonner 的 Toaster 把可见 toast 存在自己的 `useState`、mount 时**不**从模块级 `ToastState` 回灌，重挂 = 清空所有在显 toast——尤其那条 `duration:Infinity` 的「有更新可安装」toast（每次启动只 fire 一次，是应用内唯一升级入口）会消失且到下次启动才回来。同理，切换时**在 Outlet 子树内的对话框本地 `useState`（如 Preferences 的 open）会被重挂重置 → 对话框消失**；把这种「切换时还需存活」的开关挪到 zustand store（store 在子树外，重挂不丢），对话框就能保持打开并重渲染成新语言。两处都是对抗式 review 抓到的真回归。启动时机：locale store 在模块 import 时 `applyLocale(getState().locale)`（含 persist 水合 + 系统语言探测），保证首帧前 active locale 已就位；**别在模块顶层捕获 `T.x` 到 const/数组**（如 `SECTIONS`/`SORT_KEYS`），否则冻结在加载时语言——改成渲染期读或 thunk。

## CI / 发布 / 更新

- **Actions 报 "Wrong password for that key"** → secret 存的是轮换前的旧密钥文件。定位法：本地 `pnpm tauri signer sign --private-key-path ~/.tauri/yassets.key --password "<密码>" <任意文件>`——本地能过 = secret 过期，更新 `TAURI_SIGNING_PRIVATE_KEY` 后重跑。
- **GitHub secrets 不接受空值** → 签名密钥必须带密码生成。`tauri signer generate` 的 `-w` 短旗标不可用，用长旗标：`--write-keys ~/.tauri/yassets.key --password "<密码>" --force`；**换钥后 `tauri.conf.json` 的 `plugins.updater.pubkey` 必须同步更新**。
- **更新通知的先有鸡先有蛋**：自动检查功能随版本 N 首发，则只有「从 N 升 N+1」才能看到 toast；N−1 用户只能走 Preferences ▸ Check for Updates 手动升。发布任何「通知类」功能时主动向用户解释这一点，省一轮「为什么没反应」。
- **updater 全链路清单**（漏任何一项就静默不工作）：`plugins.updater.pubkey + endpoints`（tauri.conf.json）→ `bundle.createUpdaterArtifacts: true` → capabilities `updater:default` + `process:allow-restart` → lib.rs 注册 updater + process 插件 → 前端只经 `lib/updater.ts`。
- `releases/latest/download/latest.json` 只解析**已发布**的 release——draft 阶段 404 属预期。
- **发版产物少了一半平台(release.yml)**：症状 = release 只有 ~10 个资产(缺 windows msi/setup + mac-x64 dmg/app),但每个 matrix job 都 `success`,job 日志里明明 `Uploading ...` 了。根因 = 旧 workflow 让**每个 matrix job 各自** `tauri-action` 带 `tagName + releaseDraft:true` 去建 draft → GitHub 允许**同一 tag 多个 draft**,四个 job 竞态各建各的,资产散落 + latest.json 只含各自平台。0.1.0–0.1.3 侥幸没触发,FTS 改动让编译耗时变化后触发。**排查**:`gh api repos/OWNER/REPO/releases --jq '.[]|select(.tag_name=="vX")|{id,draft,assets:(.assets|length)}'` 会看到同 tag 两个 release。**修复**(已落地):拆成 `create-release` 单 job 建一个 draft 输出 `release_id` → matrix job 用 `releaseId:` 上传到同一个 release(不再各自建),tauri-action 会把各平台合并进同一 latest.json。发版后务必核对资产数=17 且 latest.json 平台数=11,别只看 CI 绿。

## IPC / 导入管线

- 改导入管线共享函数签名（如 `process_file` 加参数）→ 用 codegraph_impact 全仓扫调用点（上次波及 10 处，含 `commands/trash.rs` 的恢复路径），受影响测试语义同 commit 更新。
- `keep_duplicates = true` 只关**库级**查重；批内 `seen_hashes` 永远生效（同一批拖两份一样的文件仍只进一份）。
- 嵌套文件夹导入：`DiscoveredFile.folder_components` 相对「拖入目录的父级」计算（所以拖入的目录名本身是链条第一层）；`build_folder_map` 用 BTreeSet 保证父先于子创建，`ensure_folder` 按 `name COLLATE NOCASE + parent_id` 复用——重复导入收敛到同一棵树。

## 网络 / 三方源 (Discover)

- **网络全留在 Rust**（reqwest,rustls 无 OpenSSL）,webview 只 hotlink 缩略图。API 调用/原图下载走 Tauri command,`connect-src` 不用放开;只有缩略图 `<img>` 需要在 CSP `img-src` 加该 provider 的 CDN host(如 `https://th.wallhaven.cc`)。API key 存前端 store 传入 command,永不进日志。
- **下载防 SSRF 不能只查初始 URL 的 scheme**:reqwest 默认 `Policy::limited(10)` 会跟 302,`https://` 初始 URL 能被重定向到 `http://169.254.169.254`(云 metadata)/`http://localhost`/内网。修法三连:client 建成 `.redirect(Policy::none())` + `.https_only(true)`;download() 里 `Url::parse` 后校验 scheme==https **且** host 不是 loopback/private/link-local/unspecified(`host_is_blocked`,含 IPv6 去括号);`.send()` 后非 2xx 一律当失败(no-redirect 下 3xx 就是失败)。对抗式 review 抓到的 HIGH。
- **下载体积上限必须在流式读取时判**:`resp.bytes().await` 会把整个 body 先灌进内存,`Content-Length` 缺失/伪造时 100MiB 上限形同虚设(OOM)。改用 `while let Some(chunk)=resp.chunk().await?` 累加,超限即 abort(保留 content-length 预检做快速拒绝)。
- **下临时文件别用 `?` 提前返回**:`std::fs::write(&tmp,..)?` 失败会跳过后面的 `remove_file` → 泄漏(可能是空/半包)临时文件到 `std::env::temp_dir()`。用 `match` 写,无论成败都走一次 `remove_file`。`tempfile` crate 只在 dev-deps,生产用裸 `std::fs`。
- **infinite query 展平要按 id 去重**:三方源分页会重叠(wallhaven `sorting=random` 每次请求重新洗牌、`date_added` 随新上传漂移),`pages.flatMap` 不去重会出现重复 React key + 重复卡片 + 多选串味。展平时用 `Set<id>` 去重。搜索 query key 要**带 apiKey 值**(react-query key 仅内存),否则改了无效 key 不会 refetch,卡在错误态。
- **schema 列名别信注释**:v5 迁移注释写「source URL」,实际列名是 `url`(不是 `source`)。写 INSERT 前 grep `migrations.rs` 确认真实列名——Rust 测试当场会以「table has no column named X」炸出来。
- **reqwest 错误会带上完整 URL → 把 API key 泄进日志和 IPC**:非 2xx 时 `.error_for_status()?`(以及 send 失败)会把请求 URL 挂到 `reqwest::Error` 上,而三方源把 key 放在 query(`?key=…`/`apikey=…`)。`err.to_string()` 会原样打印 ` for url (https://…?key=SECRET)`,于是既进 `log::warn!`(落盘日志、常被贴进 bug 报告)又进 `AppError::Network(detail)`(跨 IPC 到前端、devtools 可见)。**在 `From<reqwest::Error> for AppError` 里先 `let err = err.without_url();`** 一处根治(covers 所有 provider + 下载),保留 status/timeout 等有用信息。对抗式 review 抓到的 HIGH——无效 key / 触发限频(400/429)就必现。

## 工具 / 多智能体 review

- **后台 review Workflow 会在共享工作树里跑 `git stash`/`checkout`**（为了 diff 历史提交），把你**未提交**的改动在中途 revert 掉——我亲眼看到一个新文件在两条命令间闪现消失。**规矩：spawn 后台 review workflow 之前先把在做的活 commit**，让工作树干净；review 只读已提交代码，也更准。对抗式 review 每个阶段都抓到过真 bug（B 组 zip-bomb/PSD panic、E 组 Next 按钮、D+E-2 的 Windows 删库/watcher 竞态）——值得每个 milestone 批次跑一次，但务必先 commit。
