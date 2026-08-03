/**
 * Audio preview — a waveform transport over the yasset:// protocol.
 *
 * Playback is a plain `<audio>` element (WebKit/WebView2 decode mp3/m4a/aac/
 * wav/flac/aiff natively and Range support makes seeking instant), so nothing
 * here re-implements a decoder. On top of it: a canvas waveform you can click
 * to seek, transport controls (play, volume, speed, loop), and the file's
 * acoustic numbers. The waveform + numbers come from one Web Audio decode of
 * the whole file — skipped past `MAX_DECODE_BYTES`, where the wait would cost
 * more than the picture is worth; the player itself still works.
 *
 * Opening an audio asset starts it playing, matching the video viewer.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { IconMusic, IconPause, IconPlay, IconReload } from "@/components/icons";
import {
	channelLayout,
	computeWaveformPeaks,
	estimateBitrateKbps,
	formatClock,
	formatDbfs,
	peakAmplitude,
	rmsAmplitude,
	toDbfs,
} from "@/lib/audio-analysis";
import { logger } from "@/lib/logger";
import { fileUrl } from "@/lib/media";
import { T } from "@/lib/text";
import { cn } from "@/lib/utils";

/** Decoding a whole file costs time + memory; past this we skip the waveform. */
const MAX_DECODE_BYTES = 80 * 1024 * 1024;
/** Waveform resolution — bars are ~2px + 1px gap on a typical window. */
const WAVEFORM_BUCKETS = 480;
const SPEEDS = [0.5, 1, 1.5, 2] as const;

type Analysis = {
	peaks: Float32Array;
	durationSec: number;
	sampleRate: number;
	channels: number;
	peakDb: number;
	rmsDb: number;
};

export function AudioViewer({
	assetId,
	name,
	ext,
	size,
}: {
	assetId: string;
	name: string;
	ext: string;
	/** Container size in bytes; drives the decode guard + bitrate estimate. */
	size: number | null;
}) {
	const audioRef = useRef<HTMLAudioElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [analysis, setAnalysis] = useState<Analysis | null>(null);
	const [playing, setPlaying] = useState(false);
	const [current, setCurrent] = useState(0);
	const [duration, setDuration] = useState(0);
	const [volume, setVolume] = useState(1);
	const [speed, setSpeed] = useState<number>(1);
	const [loop, setLoop] = useState(false);

	// Autoplay on open — same rationale as the video viewer (the click that got
	// us here is the user activation the engines' policies want).
	useEffect(() => {
		audioRef.current?.play().catch(() => {
			/* policy refused — stay paused, controls are right there */
		});
	}, []);

	// One decode drives both the waveform and the acoustic readout.
	useEffect(() => {
		if (size !== null && size > MAX_DECODE_BYTES) return;
		let cancelled = false;
		const context = new AudioContext();
		void (async () => {
			try {
				const response = await fetch(fileUrl(assetId));
				const bytes = await response.arrayBuffer();
				const buffer = await context.decodeAudioData(bytes);
				if (cancelled) return;
				const channels = Array.from(
					{ length: buffer.numberOfChannels },
					(_, i) => buffer.getChannelData(i),
				);
				setAnalysis({
					peaks: computeWaveformPeaks(
						channels[0] ?? new Float32Array(),
						WAVEFORM_BUCKETS,
					),
					durationSec: buffer.duration,
					sampleRate: buffer.sampleRate,
					channels: buffer.numberOfChannels,
					peakDb: toDbfs(peakAmplitude(channels)),
					rmsDb: toDbfs(rmsAmplitude(channels)),
				});
			} catch (error) {
				if (!cancelled)
					logger.warn({ assetId, error }, "audio analysis failed");
			} finally {
				void context.close();
			}
		})();
		return () => {
			cancelled = true;
			void context.close();
		};
	}, [assetId, size]);

	const progress = duration > 0 ? current / duration : 0;

	// Canvas draw: colors read fresh from the theme tokens on every paint, so a
	// light/dark switch just needs a redraw (see the MutationObserver below).
	const draw = useCallback(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const parent = canvas.parentElement;
		const cssWidth = parent?.clientWidth ?? canvas.clientWidth;
		const cssHeight = canvas.clientHeight;
		if (cssWidth === 0 || cssHeight === 0) return;

		const dpr = window.devicePixelRatio || 1;
		canvas.width = Math.round(cssWidth * dpr);
		canvas.height = Math.round(cssHeight * dpr);
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.scale(dpr, dpr);
		ctx.clearRect(0, 0, cssWidth, cssHeight);

		const styles = getComputedStyle(canvas);
		const played = usableColor(
			ctx,
			styles.getPropertyValue("--primary").trim(),
			"#3b82f6",
		);
		const rest = usableColor(
			ctx,
			styles.getPropertyValue("--muted-foreground").trim(),
			"#71717a",
		);

		const peaks = analysis?.peaks;
		const mid = cssHeight / 2;
		if (!peaks || peaks.length === 0) {
			// No waveform (still decoding, or too large): a flat baseline.
			ctx.fillStyle = rest;
			ctx.globalAlpha = 0.4;
			ctx.fillRect(0, mid - 0.5, cssWidth, 1);
			ctx.globalAlpha = 1;
			return;
		}

		const barWidth = cssWidth / peaks.length;
		const playedUntil = cssWidth * progress;
		for (let i = 0; i < peaks.length; i++) {
			const magnitude = peaks[i] as number;
			// Keep quiet passages visible instead of vanishing to a hairline.
			const height = Math.max(1.5, magnitude * (cssHeight - 4));
			const x = i * barWidth;
			ctx.fillStyle = x + barWidth <= playedUntil ? played : rest;
			ctx.globalAlpha = x + barWidth <= playedUntil ? 1 : 0.45;
			ctx.fillRect(x, mid - height / 2, Math.max(1, barWidth - 1), height);
		}
		ctx.globalAlpha = 1;
	}, [analysis, progress]);

	useEffect(() => {
		draw();
	}, [draw]);

	// Redraw on resize and on a theme flip (tokens change under us).
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const resize = new ResizeObserver(() => draw());
		if (canvas.parentElement) resize.observe(canvas.parentElement);
		const theme = new MutationObserver(() => draw());
		theme.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class"],
		});
		return () => {
			resize.disconnect();
			theme.disconnect();
		};
	}, [draw]);

	// Smooth playhead while playing (timeupdate alone is ~4 Hz and visibly steppy).
	useEffect(() => {
		if (!playing) return;
		let frame = 0;
		const tick = () => {
			const audio = audioRef.current;
			if (audio) setCurrent(audio.currentTime);
			frame = window.requestAnimationFrame(tick);
		};
		frame = window.requestAnimationFrame(tick);
		return () => window.cancelAnimationFrame(frame);
	}, [playing]);

	const seekToRatio = (ratio: number) => {
		const audio = audioRef.current;
		if (!audio || !Number.isFinite(audio.duration)) return;
		const clamped = Math.min(1, Math.max(0, ratio));
		audio.currentTime = clamped * audio.duration;
		setCurrent(audio.currentTime);
	};

	const onWaveformPointer = (event: React.PointerEvent<HTMLDivElement>) => {
		const rect = event.currentTarget.getBoundingClientRect();
		if (rect.width === 0) return;
		seekToRatio((event.clientX - rect.left) / rect.width);
	};

	const togglePlay = () => {
		const audio = audioRef.current;
		if (!audio) return;
		if (audio.paused) {
			audio.play().catch(() => {
				/* ignore — controls stay usable */
			});
		} else {
			audio.pause();
		}
	};

	const cycleSpeed = () => {
		const next = SPEEDS[(SPEEDS.indexOf(speed as 1) + 1) % SPEEDS.length] ?? 1;
		setSpeed(next);
		if (audioRef.current) audioRef.current.playbackRate = next;
	};

	const bitrate = estimateBitrateKbps(size, analysis?.durationSec ?? duration);

	return (
		<div className="flex h-full flex-col items-center justify-center gap-6 p-8">
			{/* Identity */}
			<div className="flex flex-col items-center gap-3">
				<div className="flex size-16 items-center justify-center rounded-lg border border-border/70 bg-muted/40 text-muted-foreground/70">
					<IconMusic className="size-8" />
				</div>
				<span className="max-w-lg truncate font-medium text-sm">{name}</span>
			</div>

			{/* Waveform (click to seek) */}
			<div
				className="h-28 w-full max-w-3xl cursor-pointer rounded-md bg-muted/30 px-2 py-2"
				onPointerDown={onWaveformPointer}
			>
				<canvas ref={canvasRef} className="h-full w-full" />
			</div>

			{/* Transport */}
			<div className="flex w-full max-w-3xl flex-wrap items-center justify-center gap-4">
				<button
					type="button"
					aria-label={playing ? T.audio.pause : T.audio.play}
					className="flex size-9 items-center justify-center rounded-full border text-foreground hover:bg-muted"
					onClick={togglePlay}
				>
					{playing ? (
						<IconPause className="size-5" />
					) : (
						<IconPlay className="size-5" />
					)}
				</button>

				<span className="font-mono text-muted-foreground text-xs tabular-nums">
					{formatClock(current)} / {formatClock(duration)}
				</span>

				<label className="flex items-center gap-2 text-muted-foreground text-xs">
					{T.audio.volume}
					<input
						type="range"
						min={0}
						max={1}
						step={0.01}
						value={volume}
						className="w-24 accent-primary"
						onChange={(event) => {
							const next = Number(event.target.value);
							setVolume(next);
							if (audioRef.current) audioRef.current.volume = next;
						}}
					/>
				</label>

				<button
					type="button"
					className="rounded-md border px-2 py-1 font-medium text-xs tabular-nums hover:bg-muted"
					aria-label={T.audio.speed}
					onClick={cycleSpeed}
				>
					{speed}×
				</button>

				<button
					type="button"
					aria-label={T.audio.loop}
					aria-pressed={loop}
					className={cn(
						"flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-muted",
						loop && "border-primary text-primary",
					)}
					onClick={() => {
						const next = !loop;
						setLoop(next);
						if (audioRef.current) audioRef.current.loop = next;
					}}
				>
					<IconReload className="size-3.5" />
					{T.audio.loop}
				</button>
			</div>

			{/* Acoustic readout */}
			<dl className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs">
				<Stat label={T.audio.format} value={ext.toUpperCase() || "—"} />
				{analysis && (
					<>
						<Stat
							label={T.audio.sampleRate}
							value={`${(analysis.sampleRate / 1000).toFixed(1)} kHz`}
						/>
						<Stat
							label={T.audio.channels}
							value={channelLayout(analysis.channels)}
						/>
						<Stat label={T.audio.peak} value={formatDbfs(analysis.peakDb)} />
						<Stat label={T.audio.loudness} value={formatDbfs(analysis.rmsDb)} />
					</>
				)}
				{bitrate !== null && (
					<Stat label={T.audio.bitrate} value={`${bitrate} kbps`} />
				)}
			</dl>

			{/* biome-ignore lint/a11y/useMediaCaption: arbitrary user audio files have no caption tracks */}
			<audio
				ref={audioRef}
				autoPlay
				preload="metadata"
				src={fileUrl(assetId)}
				className="hidden"
				onPlay={() => setPlaying(true)}
				onPause={() => setPlaying(false)}
				onEnded={() => setPlaying(false)}
				onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
				onLoadedMetadata={(event) => {
					const el = event.currentTarget;
					if (Number.isFinite(el.duration)) setDuration(el.duration);
				}}
			/>
		</div>
	);
}

/**
 * Theme tokens are `oklch(...)`; a canvas silently IGNORES a color string its
 * engine can't parse, which would leave the waveform drawn in the default black
 * (invisible on the dark theme). Probe the assignment and fall back to a plain
 * hex when it doesn't take.
 */
function usableColor(
	ctx: CanvasRenderingContext2D,
	candidate: string,
	fallback: string,
): string {
	if (!candidate) return fallback;
	const sentinel = "#010203";
	ctx.fillStyle = sentinel;
	ctx.fillStyle = candidate;
	return ctx.fillStyle === sentinel ? fallback : candidate;
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-baseline gap-1.5">
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="font-medium tabular-nums">{value}</dd>
		</div>
	);
}
