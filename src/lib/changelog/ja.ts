import type { ChangelogRelease } from "./index";

export const ja: ChangelogRelease[] = [
	{
		version: "0.1.10",
		date: "2026-07-07",
		changes: [
			{
				kind: "new",
				text: "「見つける」に Wallhaven に加えて Pixabay が仲間入り。ツールバーからソースを切り替えられます。",
			},
		],
	},
	{
		version: "0.1.9",
		date: "2026-07-07",
		changes: [
			{
				kind: "new",
				text: "新しい「見つける」画面が登場。Wallhaven を閲覧して、壁紙をそのままライブラリに追加できます。取得元も記録されます。",
			},
		],
	},
	{
		version: "0.1.8",
		date: "2026-07-07",
		changes: [
			{
				kind: "new",
				text: "インターフェースが簡体字中国語と日本語に対応。環境設定からその場で言語を切り替えられます。",
			},
			{
				kind: "new",
				text: "ネイティブの macOS メニューバーと「yAssets について」ウィンドウを追加しました。",
			},
		],
	},
	{
		version: "0.1.7",
		date: "2026-07-06",
		changes: [
			{
				kind: "improved",
				text: "スライドショーがフォーカス管理に対応した、アクセシブルなモーダルになりました。",
			},
		],
	},
	{
		version: "0.1.6",
		date: "2026-07-06",
		changes: [
			{
				kind: "improved",
				text: "無限スクロールで大きなライブラリも軽快に読み込めます。",
			},
			{
				kind: "new",
				text: "監視フォルダが新しいファイルを自動で取り込みます。",
			},
			{
				kind: "new",
				text: "メンテナンス機能を追加。データベースの最適化、不要データの整理、整合性チェックが行えます。",
			},
		],
	},
	{
		version: "0.1.5",
		date: "2026-07-06",
		changes: [
			{
				kind: "new",
				text: "PDF・HEIC・TIFF・PSD・Sketch ファイルのサムネイルに対応しました。",
			},
			{
				kind: "new",
				text: "全画面スライドショーと、2 枚並べての比較表示が可能になりました。",
			},
		],
	},
	{
		version: "0.1.4",
		date: "2026-07-05",
		changes: [
			{
				kind: "new",
				text: "ツールバーでの並べ替え、フィルター付き全文検索、まとめて評価に対応しました。",
			},
		],
	},
	{
		version: "0.1.3",
		date: "2026-07-05",
		changes: [
			{ kind: "new", text: "Eagle 風のフォルダ選択画面を追加しました。" },
			{ kind: "improved", text: "動画のカバー画像がより鮮明になりました。" },
		],
	},
	{
		version: "0.1.2",
		date: "2026-07-05",
		changes: [
			{
				kind: "new",
				text: "サブフォルダバー、ファイル種別チップ、HTML プレビュー、フォルダ情報パネルを追加しました。",
			},
		],
	},
	{
		version: "0.1.1",
		date: "2026-07-04",
		changes: [
			{
				kind: "new",
				text: "フォルダ構造を保ったままインポートできるようになりました。",
			},
			{ kind: "new", text: "自動アップデート通知に対応しました。" },
		],
	},
	{
		version: "0.1.0",
		date: "2026-07-04",
		changes: [
			{
				kind: "new",
				text: "初回リリース。ローカルファーストのメディアライブラリとして、インポート・整理・タグ付け・プレビュー・重複除去・自動アップデートに対応します。",
			},
		],
	},
];
