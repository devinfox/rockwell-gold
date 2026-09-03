import type { Metadata } from "next";
import DropRoomClient from "./drop-room-client";

export const metadata: Metadata = {
  title: "Auction room — Rockwell Metals",
  description: "Live bid ladder, countdown, and instant bid placement with anti-snipe extensions.",
};

export default async function Page({ params }: PageProps<"/drops/[id]">) {
  const { id } = await params;
  return <DropRoomClient dropId={id} />;
}
