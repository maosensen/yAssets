import type { ChangelogRelease } from "./index";

export const zh: ChangelogRelease[] = [
	{
		version: "0.1.11",
		date: "2026-07-07",
		changes: [
			{
				kind: "new",
				text: "更新日志——可从菜单栏打开的应用内更新日志，查看每个版本的更新要点。",
			},
			{
				kind: "improved",
				text: "偏好设置界面焕新：带标题的分区栏、卡片式分组，以及主题与语言的分段控件。",
			},
		],
	},
	{
		version: "0.1.10",
		date: "2026-07-07",
		changes: [
			{
				kind: "new",
				text: "发现页在 Wallhaven 之外新增了 Pixabay——在工具栏即可切换来源。",
			},
		],
	},
	{
		version: "0.1.9",
		date: "2026-07-07",
		changes: [
			{
				kind: "new",
				text: "全新发现视图：浏览 Wallhaven 壁纸并一键加入素材库，同时自动记录来源。",
			},
		],
	},
	{
		version: "0.1.8",
		date: "2026-07-07",
		changes: [
			{
				kind: "new",
				text: "新增简体中文与日文界面，并可在偏好设置中实时切换语言。",
			},
			{
				kind: "new",
				text: "原生 macOS 菜单栏，以及全新的“关于”窗口。",
			},
		],
	},
	{
		version: "0.1.7",
		date: "2026-07-06",
		changes: [
			{
				kind: "improved",
				text: "幻灯片播放升级为完整的无障碍弹窗，焦点处理更规范。",
			},
		],
	},
	{
		version: "0.1.6",
		date: "2026-07-06",
		changes: [
			{
				kind: "improved",
				text: "大型素材库借助无限滚动，加载更加顺滑。",
			},
			{
				kind: "new",
				text: "监视文件夹会自动导入新增文件。",
			},
			{
				kind: "new",
				text: "维护工具：压缩数据库、清理孤立文件、校验完整性。",
			},
		],
	},
	{
		version: "0.1.5",
		date: "2026-07-06",
		changes: [
			{
				kind: "new",
				text: "支持 PDF、HEIC、TIFF、PSD 与 Sketch 文件缩略图。",
			},
			{
				kind: "new",
				text: "全屏幻灯片播放，以及并排对比。",
			},
		],
	},
	{
		version: "0.1.4",
		date: "2026-07-05",
		changes: [
			{
				kind: "new",
				text: "工具栏排序、带筛选的全文搜索，以及批量评分。",
			},
		],
	},
	{
		version: "0.1.3",
		date: "2026-07-05",
		changes: [
			{ kind: "new", text: "Eagle 风格的文件夹选择器。" },
			{ kind: "improved", text: "更清晰的视频封面帧。" },
		],
	},
	{
		version: "0.1.2",
		date: "2026-07-05",
		changes: [
			{
				kind: "new",
				text: "子文件夹栏、文件类型标签、HTML 预览，以及文件夹信息面板。",
			},
		],
	},
	{
		version: "0.1.1",
		date: "2026-07-04",
		changes: [
			{
				kind: "new",
				text: "导入文件夹时保留原有结构。",
			},
			{ kind: "new", text: "自动更新提醒。" },
		],
	},
	{
		version: "0.1.0",
		date: "2026-07-04",
		changes: [
			{
				kind: "new",
				text: "首个版本——本地优先的媒体素材库：导入、整理、打标签、预览、去重，并支持自我更新。",
			},
		],
	},
];
