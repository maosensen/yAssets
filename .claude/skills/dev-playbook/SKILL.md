---
name: dev-playbook
description: Working playbook for the yAssets repo, distilled from building Phases 1-4 with the user (core library loop → organization → viewers/dedupe → release engineering). Covers the collaboration contract with the user, milestone process and definition-of-done, proven architecture meta-patterns, and evidence-first debugging methodology, plus a symptom→cause→fix gotcha index (gotchas.md) and the release/signing runbook (release.md). Load at the START of any substantive work in this repo — features, bug fixes, refactors, UI polish, or releases.
---

# yAssets 开发手册（dev-playbook）

从 Phase 1（零业务 → 建库/导入/浏览闭环）一路做到 Phase 4（键盘体系/发布流水线/自更新）沉淀下来的工作方式。**AGENTS.md 管「项目约定」（技术栈、红线、代码规范），本 skill 管「怎么干活」（流程、方法论、踩坑索引）。两份都要遵守，冲突以 AGENTS.md 为准。**

配套文件（按需读）：

- [gotchas.md](gotchas.md) — 踩坑索引：症状 → 根因 → 处置。**调试任何诡异问题前先扫对应小节**——本项目一半的「bug」根因都在里面出现过。
- [release.md](release.md) — 发版 runbook + 签名密钥铁律。碰版本号 / tag / updater 之前必读。

## 1. 协作契约（与用户的既定工作方式）

- **对话一律中文**；UI 文案一律英文且只进 `src/lib/text.ts` 的 `T` 常量（组件零裸字符串）。
- **用户自己跑着 `pnpm tauri dev`（端口 1420）**——绝不启动第二个 tauri dev / vite。两个原因：端口冲突；single-instance 插件会让第二个实例瞬间退出。src-tauri 改动会触发用户侧自动重编译，改完 Rust 提示用户「等 app 自动重启」即可。需要浏览器侧验证 CSS/组件产物时用 preview browser（`.claude/launch.json` 的 `vite` 配置，端口 1430）。
- **绝不触碰用户真实素材库 `~/Documents/DESIGN`**。测试一律 tempfile（Rust）/ 临时目录；若为测试临时改了用户配置（如 settings.json 的库指针），**用完必须恢复原值**。
- **阶段推进由用户驱动**：用户说「next / 测试完成 / 测试没有问题」才进下一个里程碑；用户报的 bug 永远插队优先。发版、push 到远程等对外动作等用户明确指示；本地 commit 是每个里程碑收尾的常规动作，不必再问。
- **用户常用 Eagle 截图提需求**：先把截图翻译成一份可执行的差异清单（布局 / 尺寸 / 图标 / 交互逐条），再动手，做完逐条对照。
- 汇报风格：结论先行；bug 分析先给根因和证据、再给修复；方案给一个带理由的推荐，而不是罗列选项让用户挑。

## 2. 工程流程

### 大阶段怎么开局

1. 进 plan mode 产出**里程碑计划**，每个里程碑的定义 = 结束时可运行、可演示、`pnpm check` 全绿。
2. **风险尖刺先行（M0 模式）**：把「不点亮就不知道架构是否成立」级别的风险（新 RC 库的 API 面、跨层协议、性能假设）压成一天内的最小验证，每项配好兜底方案，全部点亮后才在其上盖楼。本项目靠这个避免了大返工（specta typed events / `yasset://` 协议 / 万级虚拟滚动都是先尖刺后建设）。
3. TaskCreate 建里程碑粒度的任务（不是一行代码一个），开工 in_progress、验收 completed。

### 一个改动什么时候算「完成」

四件事缺一不可：

1. 代码本身；
2. **同一个 commit 里的测试**——纯逻辑（布局 / 解析 / 聚类 / SQL 谓词 / 规则翻译）必须有单测：Rust 用 tempfile + 内存库，前端 vitest；
3. `pnpm check` 全绿（typecheck + biome + vitest + bindings 漂移 + rustfmt + clippy），这是唯一门禁，也是 CI 的门禁；
4. **实际环境验证**——编译通过不等于生效：
   - UI/样式改动 → preview browser 看产物（例：Windows 透明度修复是在 1430 端口查编译出的 CSS 里确实存在 `.platform-windows` 规则与 `windows\:bg-sidebar` 类来确认的）；
   - 双端功能（updater、协议）→ 两侧都验：客户端代码 + `curl` 服务端产物（latest.json）；
   - 平台相关改动 → 至少在 macOS WebKit 目标上手测（见 AGENTS.md 的 WebView portability）。

### 提交纪律

- 一个里程碑 / 一个独立修复 = 一个 commit；`type(scope): summary` 格式，正文英文。
- commit 前核对 `git config user.email`（github.com → `maosensen` / `yjkbako.lyre@gmail.com`，local 配置，规则见全局 CLAUDE.md）。
- `bindings.ts`、`routeTree.gen.ts` 是生成物：永不手改，再生后随功能一起提交。

## 3. 架构决策模式（做新功能时套用）

这些是本项目反复验证有效的**元模式**——新功能动手前先问自己套哪个：

- **边界先行**：先问「这活儿归哪层」。文件系统、重计算 → Rust command；前端永不接触绝对路径（素材按 id 走 `yasset://`）。凡是想在前端 fetch 本地文件 / 拼路径，都是走错层了。
- **单一网关模块**：每个插件 / 外部 API 只允许一个封装文件——`media.ts`（URL 构造）、`updater.ts`、`dialogs.ts`、`opener.ts`、`tauri-events.ts`、`icons.ts`（图标唯一导入点）、`text.ts`（文案唯一来源）。**加新插件的第一步是建网关文件**，别让 `@tauri-apps/plugin-*` 散进组件——这是能快速排查权限/行为问题的根基。
- **纯函数核心 + 薄 IO 壳**：算法（masonry、dHash、Range 解析、folder-tree、union-find 聚类、smart-folder 规则→SQL）写成无 IO 纯函数，壳只做读写。可测性全部来自这一刀。
- **注册表集中分发**：ext/mime→viewer（`viewer-registry.ts`，顺序敏感：video/pdf 判定必须排在 has_thumb→image 规则之前）、query key 工厂、mutation 乐观更新模板。加一种格式 = 扩一个 set + 一个 case，分发逻辑永远只有一处。
- **schema 追加式演进**：`PRAGMA user_version` + migrations 只追加不修改（当前 v5）。优先加可空列；需要回填历史数据的（dhash、缩略图）配开库时的后台 backfill，单条失败只记日志不致命。
- **列表载荷洁癖**：不为单个消费者加宽热列表（AssetSummary 不含 mime → 让 ViewerAsset.mime 可选，而不是给全量列表加列）。
- **决策留痕**：有意推迟的事（例：50k 以内不做 keyset 分页）把「为什么 + 何时重启」写进 AGENTS.md 的 Deferred by choice，不留裸 TODO。

## 4. 调试方法论（实战验证）

1. **先取证，再动手**——症状会撒谎，两个真实案例：
   - 「应用闪退」→ 先查 `~/Library/Logs/DiagnosticReports` 没有 crash 记录 → 根本不是崩溃，是 single-instance 插件在 dev 实例活着时让 release 实例主动退出。
   - 「重启没有更新提示」→ 先 `curl` latest.json 证明服务端完好 → 真相是旧版本里根本没有自动检查这段代码（功能随新版本才发布）。
   - 修复动作必须与证据匹配；按模式匹配去重启 / 重装 / 改 CSS 都是浪费。
2. **分层定位口诀**：
   - Tauri 的 window/plugin API「无声不生效」→ 第一反应查 `capabilities/default.json`（亮色主题烂掉 = 缺 `core:window:allow-set-theme`，不是 CSS 问题）。
   - 样式异常 → 查产物 CSS 与平台 class 是否真的生成 / 挂上（preview browser）。
   - CI 失败 → 先在本地复现同一条命令再猜（签名报错 = 本地跑一次 `pnpm tauri signer sign` 就分辨出 secret 里是旧密钥）。
3. **改共享函数签名先扫全部调用点**：用 codegraph_callers / codegraph_impact（一次 `process_file` 签名变更波及 10 处，含 `commands/trash.rs`），受影响测试的语义断言（如枚举 Skipped→Duplicate）同一个 commit 更新。
4. **修根因不糊症状**：权限 / 协议 / 时序问题不要用 CSS hack 或延时掩盖。

## 5. 命令速查

```bash
pnpm check          # 全量门禁（提交前必绿）
pnpm rust:test      # 只跑 Rust 测试
pnpm check:bindings # bindings 漂移检查（specta 再生 + git diff）
pnpm test           # 只跑前端 vitest
```

发版流程见 [release.md](release.md)；诡异问题先查 [gotchas.md](gotchas.md)。
