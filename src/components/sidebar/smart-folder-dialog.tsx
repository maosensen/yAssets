/**
 * Smart folder rule editor — name, match mode (all/any), and a list of
 * condition rows. Each row is a field selector plus a field-specific value
 * control; the condition union mirrors `SmartCondition` in the bindings.
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { IconClose, IconPlus } from "@/components/icons";
import { HUE_SWATCHES, NEUTRAL_HUE } from "@/components/layout/color-filter";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { SmartCondition, SmartFolder } from "@/lib/bindings";
import {
	useCreateSmartFolder,
	useUpdateSmartFolder,
} from "@/lib/queries/smart-folders";
import { tagsQueryOptions } from "@/lib/queries/tags";
import { T } from "@/lib/text";
import { cn } from "@/lib/utils";

export type SmartFolderDialogState = SmartFolder | "new" | null;

type FieldKind = SmartCondition["field"];

const FIELD_ORDER: FieldKind[] = [
	"ext",
	"name_contains",
	"rating_at_least",
	"hue",
	"has_tag",
	"added_within_days",
];

function defaultCondition(field: FieldKind): SmartCondition {
	switch (field) {
		case "ext":
			return { field, values: [] };
		case "name_contains":
			return { field, value: "" };
		case "rating_at_least":
			return { field, min: 3 };
		case "hue":
			return { field, value: 0 };
		case "has_tag":
			return { field, tag_id: "" };
		case "added_within_days":
			return { field, days: 30 };
	}
}

export function SmartFolderDialog({
	state,
	onClose,
}: {
	state: SmartFolderDialogState;
	onClose: () => void;
}) {
	const editing = state !== null && state !== "new" ? state : null;
	const [name, setName] = useState("");
	const [matchAny, setMatchAny] = useState(false);
	const [conditions, setConditions] = useState<SmartCondition[]>([]);
	const createMutation = useCreateSmartFolder();
	const updateMutation = useUpdateSmartFolder();
	const busy = createMutation.isPending || updateMutation.isPending;

	useEffect(() => {
		setName(editing?.name ?? "");
		setMatchAny(editing?.rules.match_any ?? false);
		setConditions(editing?.rules.conditions ?? []);
	}, [editing]);

	const submit = () => {
		const trimmed = name.trim();
		if (!trimmed || busy) return;
		const rules = { match_any: matchAny, conditions };
		const done = { onSuccess: onClose };
		if (editing) {
			updateMutation.mutate({ id: editing.id, name: trimmed, rules }, done);
		} else {
			createMutation.mutate({ name: trimmed, rules }, done);
		}
	};

	const patchCondition = (index: number, next: SmartCondition) =>
		setConditions((current) =>
			current.map((cond, i) => (i === index ? next : cond)),
		);
	const removeCondition = (index: number) =>
		setConditions((current) => current.filter((_, i) => i !== index));

	return (
		<Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>
						{editing ? T.smartFolders.editTitle : T.smartFolders.create}
					</DialogTitle>
				</DialogHeader>

				<div className="flex flex-col gap-4">
					<div className="flex flex-col gap-1.5">
						<span className="text-muted-foreground text-xs">
							{T.smartFolders.nameLabel}
						</span>
						<Input
							autoFocus
							value={name}
							placeholder={T.smartFolders.namePlaceholder}
							onChange={(event) => setName(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") submit();
							}}
						/>
					</div>

					<div className="flex items-center gap-4">
						<span className="text-muted-foreground text-xs">
							{T.smartFolders.matchLabel}
						</span>
						<label className="flex cursor-pointer items-center gap-1.5 text-sm">
							<input
								type="radio"
								name="smart-match"
								className="accent-primary"
								checked={!matchAny}
								onChange={() => setMatchAny(false)}
							/>
							{T.smartFolders.matchAll}
						</label>
						<label className="flex cursor-pointer items-center gap-1.5 text-sm">
							<input
								type="radio"
								name="smart-match"
								className="accent-primary"
								checked={matchAny}
								onChange={() => setMatchAny(true)}
							/>
							{T.smartFolders.matchAny}
						</label>
					</div>

					<div className="flex flex-col gap-2">
						<span className="text-muted-foreground text-xs">
							{T.smartFolders.conditionsLabel}
						</span>
						{conditions.length === 0 && (
							<p className="text-muted-foreground text-xs">
								{T.smartFolders.emptyConditions}
							</p>
						)}
						{conditions.map((condition, index) => (
							<ConditionRow
								// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional edits with no stable identity
								key={index}
								condition={condition}
								onChange={(next) => patchCondition(index, next)}
								onRemove={() => removeCondition(index)}
							/>
						))}
						<Button
							variant="outline"
							size="sm"
							className="h-8 w-full border-dashed text-muted-foreground text-xs"
							onClick={() =>
								setConditions((current) => [
									...current,
									defaultCondition("ext"),
								])
							}
						>
							<IconPlus className="size-3.5" />
							{T.smartFolders.addCondition}
						</Button>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={onClose} disabled={busy}>
						{T.common.cancel}
					</Button>
					<Button onClick={submit} disabled={!name.trim() || busy}>
						{editing ? T.smartFolders.saveAction : T.smartFolders.createAction}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function ConditionRow({
	condition,
	onChange,
	onRemove,
}: {
	condition: SmartCondition;
	onChange: (next: SmartCondition) => void;
	onRemove: () => void;
}) {
	return (
		<div className="flex items-center gap-2">
			<select
				className="h-8 shrink-0 rounded-md border border-input bg-transparent px-2 text-sm"
				value={condition.field}
				onChange={(event) =>
					onChange(defaultCondition(event.target.value as FieldKind))
				}
			>
				{FIELD_ORDER.map((field) => (
					<option key={field} value={field}>
						{T.smartFolders.fields[field]}
					</option>
				))}
			</select>
			<div className="min-w-0 flex-1">
				<ConditionValue condition={condition} onChange={onChange} />
			</div>
			<Button
				variant="ghost"
				size="icon"
				className="size-6 shrink-0 text-muted-foreground"
				aria-label={T.smartFolders.removeCondition}
				onClick={onRemove}
			>
				<IconClose className="size-3.5" />
			</Button>
		</div>
	);
}

function ConditionValue({
	condition,
	onChange,
}: {
	condition: SmartCondition;
	onChange: (next: SmartCondition) => void;
}) {
	const { data: tags } = useQuery(tagsQueryOptions());

	switch (condition.field) {
		case "ext":
			return (
				<Input
					className="h-8"
					placeholder={T.smartFolders.extPlaceholder}
					value={condition.values.join(", ")}
					onChange={(event) =>
						onChange({
							field: "ext",
							values: event.target.value
								.split(/[,\s]+/)
								.map((v) => v.trim())
								.filter(Boolean),
						})
					}
				/>
			);
		case "name_contains":
			return (
				<Input
					className="h-8"
					placeholder={T.smartFolders.keywordPlaceholder}
					value={condition.value}
					onChange={(event) =>
						onChange({ field: "name_contains", value: event.target.value })
					}
				/>
			);
		case "rating_at_least":
			return (
				<select
					className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
					value={condition.min}
					onChange={(event) =>
						onChange({
							field: "rating_at_least",
							min: Number(event.target.value),
						})
					}
				>
					{[1, 2, 3, 4, 5].map((n) => (
						<option key={n} value={n}>
							{"★".repeat(n)}
						</option>
					))}
				</select>
			);
		case "hue":
			return (
				<div className="flex flex-wrap items-center gap-1">
					{HUE_SWATCHES.map(({ hue, color }) => (
						<button
							key={hue}
							type="button"
							aria-label={`${T.colorFilter.label} ${hue}`}
							className={cn(
								"size-5 rounded-full border border-foreground/10",
								condition.value === hue && "ring-2 ring-primary",
							)}
							style={{ backgroundColor: color }}
							onClick={() => onChange({ field: "hue", value: hue })}
						/>
					))}
					<button
						type="button"
						aria-label={T.colorFilter.neutral}
						className={cn(
							"size-5 rounded-full border border-foreground/10",
							condition.value === NEUTRAL_HUE && "ring-2 ring-primary",
						)}
						style={{
							background: "conic-gradient(#111,#555,#999,#ccc,#fff,#999,#111)",
						}}
						onClick={() => onChange({ field: "hue", value: NEUTRAL_HUE })}
					/>
				</div>
			);
		case "has_tag":
			return (
				<select
					className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
					value={condition.tag_id}
					onChange={(event) =>
						onChange({ field: "has_tag", tag_id: event.target.value })
					}
				>
					<option value="" disabled>
						{tags && tags.length > 0
							? T.sidebar.tagsTitle
							: T.smartFolders.noTagsAvailable}
					</option>
					{(tags ?? []).map((tag) => (
						<option key={tag.id} value={tag.id}>
							{tag.name}
						</option>
					))}
				</select>
			);
		case "added_within_days":
			return (
				<div className="flex items-center gap-2">
					<Input
						className="h-8 w-24"
						type="number"
						min={1}
						value={condition.days}
						onChange={(event) =>
							onChange({
								field: "added_within_days",
								days: Math.max(1, Number(event.target.value) || 1),
							})
						}
					/>
					<span className="text-muted-foreground text-xs">
						{T.smartFolders.daysSuffix}
					</span>
				</div>
			);
	}
}
