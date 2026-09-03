import type { Metadata } from "next";
import { TicketThreadClient } from "../../support-clients";

export const metadata: Metadata = {
  title: "Support ticket — Rockwell Metals",
  description: "Real-time thread with support specialists, synced with the staff desk.",
};

export default async function Page({ params }: PageProps<"/support/tickets/[id]">) {
  const { id } = await params;
  return <TicketThreadClient ticketId={id} />;
}
