import type { ChangelogRelease } from "./index";

export const zh: ChangelogRelease[] = [
	{
		version: "0.1.25",
		date: "2026-07-23",
		title: "Windows 上收藏的链接又能打开了",
		summary: "修复 Windows 专属问题:双击收藏的链接弹出空白窗口。",
		changes: [
			{
				kind: "fixed",
				title: "Windows 链接窗口空白",
				text: "在 Windows 上双击书签会弹出空白窗口——现在能正常加载页面,与 macOS 一致。",
			},
		],
	},
	{
		version: "0.1.24",
		date: "2026-07-22",
		title: "文件夹,随你定制",
		summary:
			"给文件夹换颜色和图标,拖动即可排序或移入其他文件夹,还能为抓不到封面的链接手动设封面。",
		changes: [
			{
				kind: "new",
				title: "文件夹换色与图标",
				text: "右键侧栏文件夹 ▸ 颜色与图标…,给图标上色并从精选图标里挑一个——一个弹层搞定,各带「默认」项可清除还原。",
			},
			{
				kind: "new",
				title: "拖动排序与移入",
				text: "拖动侧栏文件夹,放到行与行之间即可同级排序,放到某个文件夹上即可移入其中——落点会有细线或高亮提示。",
			},
			{
				kind: "new",
				title: "为链接设置封面",
				text: "对没有自动封面的书签,右键链接 ▸ 设置封面…(或 inspector 预览上的按钮),粘贴图片(⌘V)或上传一张,预览后保存。",
			},
			{
				kind: "improved",
				title: "评分星星更清晰",
				text: "点亮的星星改为实心暖金色,不再用主题色,悬停时还会预览到指针所在的星级。",
			},
		],
	},
	{
		version: "0.1.23",
		date: "2026-07-21",
		title: "图标更整齐,滚动不跳位",
		summary: "侧栏和工具栏图标视觉统一,从素材返回列表时也会停在原来的位置。",
		changes: [
			{
				kind: "improved",
				title: "统一、均匀的图标",
				text: "侧栏和工具栏的图标现在用同一种线条粗细,不再有的重有的轻。当前选中的侧栏项图标会变实心,标示你所在的位置。",
			},
			{
				kind: "fixed",
				title: "列表保留浏览位置",
				text: "打开某个素材再返回,列表不再跳回顶部——会停在你之前滚动到的位置,并按视图分别记忆。",
			},
		],
	},
	{
		version: "0.1.22",
		date: "2026-07-21",
		title: "用 ⌘C 把文件复制出去",
		summary:
			"选中素材按 ⌘C,即可粘贴到访达、浏览器或聊天框——⌘V 粘贴入库的镜像。",
		changes: [
			{
				kind: "new",
				title: "复制到其它应用",
				text: "选中一个或多个素材按 ⌘C 放进剪贴板,再粘贴到访达、Chrome,或 Claude、ChatGPT 这类聊天框——文件会以真实文件名落下。在此之前,应用内复制在别处粘贴不出任何东西。",
			},
		],
	},
	{
		version: "0.1.21",
		date: "2026-07-17",
		title: "把文件拖到任何地方",
		summary:
			"直接把素材从 yAssets 拖进访达、浏览器或聊天框——采集来的视频也会立刻生成封面。",
		changes: [
			{
				kind: "new",
				title: "拖动导出到其它应用",
				text: "把一个或多个素材拖出窗口,放进访达、Chrome,或 Claude、ChatGPT 这类聊天框——文件会以真实文件名落下。拖到侧栏文件夹或回收站仍在同一个手势里照常工作。",
			},
			{
				kind: "fixed",
				title: "采集视频封面即时生成",
				text: "通过 yClip 采集的视频,不再要等下次启动才有缩略图和时长——封面在采集到达时立即生成。",
			},
		],
	},
	{
		version: "0.1.20",
		date: "2026-07-17",
		title: "更安静的启动",
		summary: "监视文件夹不再每次启动都弹出「重复文件」对话框。",
		changes: [
			{
				kind: "fixed",
				title: "启动不再弹重复对话框",
				text: "监视文件夹里已入库的文件此前每次启动都会被当成重复项弹窗。现在自动导入(监视文件夹)会静默跳过已导入的文件——「重复文件」对话框只在你自己发起导入时才出现。",
			},
		],
	},
	{
		version: "0.1.19",
		date: "2026-07-17",
		title: "从浏览器采集视频",
		summary:
			"yClip 现在也能存视频了——直链片段像图片一样入库,流媒体平台视频(X、TikTok、YouTube)由内置下载器搞定。",
		changes: [
			{
				kind: "new",
				title: "视频采集",
				text: "右键或 ⌥+右键点视频,或在 yClip 里粘贴链接。流媒体平台视频由内置的 yt-dlp 下载——在偏好设置 ▸ Collect 里开启一次即可(校验和验证,约 35 MB)。",
			},
			{
				kind: "fixed",
				title: "下载器安装更可靠",
				text: "安装视频下载器不再无声卡死,下载失败也会给出明确原因。",
			},
		],
	},
	{
		version: "0.1.18",
		date: "2026-07-16",
		title: "从浏览器直接采集",
		summary:
			"全新的 yClip Chrome 扩展,把任意网页上的图片、链接和页面一键存进素材库。",
		changes: [
			{
				kind: "new",
				title: "Collect API + yClip",
				text: "在偏好设置 ▸ Collect 中开启本地采集 API(默认关闭、token 保护),配对一次 yClip 扩展后,右键(或 ⌥+右键)即可保存网页内容,并自动记录来源页面。防盗链图片(如 pixiv)会在浏览器会话内抓取。",
			},
		],
	},
	{
		version: "0.1.17",
		date: "2026-07-09",
		title: "焕然一新的更新日志",
		summary: "你现在看到的这个页面,换上了新排版。",
		changes: [
			{
				kind: "improved",
				title: "发布说明排版",
				text: "每个版本以版本徽章、大标题与摘要开场,时间线串联,条目按类别分组并配有小标题。",
			},
		],
	},
	{
		version: "0.1.16",
		date: "2026-07-09",
		title: "把网页收进素材库",
		summary:
			"用 ⌘V 粘贴任意链接，yAssets 会把它变成一份正式素材——封面、标题俱全，还有内置浏览器随时回访页面。",
		changes: [
			{
				kind: "new",
				title: "粘贴网址",
				text: "复制链接后按 ⌘V 即可存为书签,自动抓取页面封面与标题。双击在应用内浏览器实时打开网页;直链图片或视频则作为文件入库。",
			},
		],
	},
	{
		version: "0.1.15",
		date: "2026-07-08",
		title: "Openverse 有声音了",
		summary:
			"发现页不再只有图片：知识共享音频加入目录，SVG 插画也能正常显示了。",
		changes: [
			{
				kind: "new",
				title: "音频模式",
				text: "Openverse 新增音频模式——浏览知识共享的音乐、音效、播客与有声书,带时长徽标。",
			},
			{
				kind: "fixed",
				title: "插画缩略图",
				text: "Openverse 插画(SVG 作品)可以正常显示了,不再是一片裂图。",
			},
		],
	},
	{
		version: "0.1.14",
		date: "2026-07-07",
		title: "更清爽的发现页",
		summary:
			"发现页工具栏重新编排，并集中修复了菜单、Openverse 与图标导入的一批问题。",
		changes: [
			{
				kind: "improved",
				title: "两层工具栏",
				text: "发现页改为两层工具栏:上层选来源,下层是搜索与各来源专属的筛选条件。",
			},
			{
				kind: "fixed",
				title: "右键菜单与排序",
				text: "右键菜单的操作恢复正常,排序菜单不再导致崩溃。",
			},
			{
				kind: "fixed",
				title: "Openverse 与图标显示",
				text: "Openverse 可以正常加载了;导入的图标在深浅主题下都清晰可见。",
			},
		],
	},
	{
		version: "0.1.13",
		date: "2026-07-07",
		title: "二十万图标任你挑",
		summary: "Iconify 加入发现页——20 万+ 开源图标，以可改色的 SVG 入库。",
		changes: [
			{
				kind: "new",
				title: "发现页：Iconify",
				text: "发现页新增 Iconify——搜索 20 万+ 开源图标,免密钥,一键作为 SVG 加入素材库。",
			},
		],
	},
	{
		version: "0.1.12",
		date: "2026-07-07",
		title: "再添两个来源",
		summary: "Openverse 与 Pexels 加入发现页，每次导入都会记下作者与许可。",
		changes: [
			{
				kind: "new",
				title: "Openverse 与 Pexels",
				text: "发现页在 Wallhaven、Pixabay 之外新增 Openverse（知识共享，无需密钥）和 Pexels（免费密钥）。",
			},
			{
				kind: "improved",
				title: "导入记录署名",
				text: "导入的图片会记录署名信息——作者与许可协议——以满足需要署名的来源。",
			},
		],
	},
	{
		version: "0.1.11",
		date: "2026-07-07",
		title: "更新日志上线",
		summary: "就是你现在看到的这个页面，外加焕然一新的偏好设置。",
		changes: [
			{
				kind: "new",
				title: "应用内更新日志",
				text: "更新日志——可从菜单栏打开的应用内更新日志，查看每个版本的更新要点。",
			},
			{
				kind: "improved",
				title: "偏好设置焕新",
				text: "偏好设置界面焕新：带标题的分区栏、卡片式分组，以及主题与语言的分段控件。",
			},
		],
	},
	{
		version: "0.1.10",
		date: "2026-07-07",
		title: "Pixabay 加入发现页",
		summary: "第二个图片来源，工具栏一键切换。",
		changes: [
			{
				kind: "new",
				title: "发现页：Pixabay",
				text: "发现页在 Wallhaven 之外新增了 Pixabay——在工具栏即可切换来源。",
			},
		],
	},
	{
		version: "0.1.9",
		date: "2026-07-07",
		title: "「发现」登场",
		summary: "不离开应用就能浏览第三方图源——首发 Wallhaven。",
		changes: [
			{
				kind: "new",
				title: "发现视图",
				text: "全新发现视图：浏览 Wallhaven 壁纸并一键加入素材库，同时自动记录来源。",
			},
		],
	},
	{
		version: "0.1.8",
		date: "2026-07-07",
		title: "说你的语言",
		summary: "界面本地化，并成为一名合格的 macOS 公民。",
		changes: [
			{
				kind: "new",
				title: "中文与日文界面",
				text: "新增简体中文与日文界面，并可在偏好设置中实时切换语言。",
			},
			{
				kind: "new",
				title: "macOS 菜单栏与关于",
				text: "原生 macOS 菜单栏，以及全新的“关于”窗口。",
			},
		],
	},
	{
		version: "0.1.7",
		date: "2026-07-06",
		title: "幻灯片精修",
		summary: "一次专注于无障碍的打磨。",
		changes: [
			{
				kind: "improved",
				title: "无障碍幻灯片",
				text: "幻灯片播放升级为完整的无障碍弹窗，焦点处理更规范。",
			},
		],
	},
	{
		version: "0.1.6",
		date: "2026-07-06",
		title: "为大库而生",
		summary: "大规模下依旧顺滑，导入全自动，还有一套素材库体检工具。",
		changes: [
			{
				kind: "improved",
				title: "无限滚动",
				text: "大型素材库借助无限滚动，加载更加顺滑。",
			},
			{
				kind: "new",
				title: "监视文件夹",
				text: "监视文件夹会自动导入新增文件。",
			},
			{
				kind: "new",
				title: "维护工具",
				text: "维护工具：压缩数据库、清理孤立文件、校验完整性。",
			},
		],
	},
	{
		version: "0.1.5",
		date: "2026-07-06",
		title: "更多格式，更多视角",
		summary: "设计文件缩略图，外加全屏幻灯片与并排对比。",
		changes: [
			{
				kind: "new",
				title: "更多缩略图",
				text: "支持 PDF、HEIC、TIFF、PSD 与 Sketch 文件缩略图。",
			},
			{
				kind: "new",
				title: "幻灯片与对比",
				text: "全屏幻灯片播放，以及并排对比。",
			},
		],
	},
	{
		version: "0.1.4",
		date: "2026-07-05",
		title: "排序、搜索、评分",
		summary: "什么都找得到：工具栏排序、带筛选的全文搜索、批量评分。",
		changes: [
			{
				kind: "new",
				title: "排序、搜索与评分",
				text: "工具栏排序、带筛选的全文搜索，以及批量评分。",
			},
		],
	},
	{
		version: "0.1.3",
		date: "2026-07-05",
		title: "更好用的文件夹选择器",
		summary: "整理更快，视频封面更清晰。",
		changes: [
			{
				kind: "new",
				title: "Eagle 风格选择器",
				text: "Eagle 风格的文件夹选择器。",
			},
			{
				kind: "improved",
				title: "视频封面",
				text: "更清晰的视频封面帧。",
			},
		],
	},
	{
		version: "0.1.2",
		date: "2026-07-05",
		title: "浏览体验小升级",
		summary: "网格、预览与信息面板，处处见细节。",
		changes: [
			{
				kind: "new",
				title: "子文件夹、类型标签与 HTML 预览",
				text: "子文件夹栏、文件类型标签、HTML 预览，以及文件夹信息面板。",
			},
		],
	},
	{
		version: "0.1.1",
		date: "2026-07-04",
		title: "结构不丢",
		summary: "导入文件夹保留原有层级，新版本会主动打招呼。",
		changes: [
			{
				kind: "new",
				title: "嵌套结构导入",
				text: "导入文件夹时保留原有结构。",
			},
			{
				kind: "new",
				title: "更新提醒",
				text: "自动更新提醒。",
			},
		],
	},
	{
		version: "0.1.0",
		date: "2026-07-04",
		title: "yAssets，你好",
		summary: "本地优先媒体素材库的第一个版本——你的素材，始终归你。",
		changes: [
			{
				kind: "new",
				title: "本地优先的素材库",
				text: "首个版本——本地优先的媒体素材库：导入、整理、打标签、预览、去重，并支持自我更新。",
			},
		],
	},
];
