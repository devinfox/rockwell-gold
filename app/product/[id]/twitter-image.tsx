// X / Twitter uses the same product card as Open Graph.
//
// Route segment config is declared here, never re-exported: Next cannot read
// a re-exported config field and fails the production build.
export { default, size, contentType } from "./opengraph-image";

export const dynamic = "force-dynamic";
