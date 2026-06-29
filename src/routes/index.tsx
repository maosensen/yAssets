import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { invoke } from "@/lib/tauri";

export const Route = createFileRoute("/")({
	component: Home,
});

function Home() {
	const [name, setName] = useState("Tauri");
	const { theme, setTheme } = useTheme();

	// The canonical pattern: an IPC command wrapped in react-query.
	// `greet` is the default Rust command in src-tauri/src/lib.rs.
	const { data, isFetching, refetch } = useQuery({
		queryKey: ["greet", name],
		queryFn: () => invoke<string>("greet", { name }),
		enabled: false, // fire on demand via the button below
	});

	return (
		<main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 p-8">
			<h1 className="text-2xl font-semibold">Tauri + React</h1>

			<div className="flex w-full gap-2">
				<Input
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="Your name"
				/>
				<Button onClick={() => refetch()} disabled={isFetching}>
					{isFetching ? "..." : "Greet"}
				</Button>
			</div>

			{data && <p className="text-muted-foreground">{data}</p>}

			<Button
				variant="outline"
				size="sm"
				onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
			>
				Toggle theme ({theme})
			</Button>
		</main>
	);
}
