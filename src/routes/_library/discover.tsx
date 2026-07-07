import { createFileRoute } from "@tanstack/react-router";
import { DiscoverPage } from "@/components/discover/discover-page";

export const Route = createFileRoute("/_library/discover")({
	component: DiscoverPage,
});
