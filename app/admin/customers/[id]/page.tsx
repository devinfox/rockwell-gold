import type { Metadata } from "next";
import { AdminCustomerDossierClient } from "../../desk-clients";

export const metadata: Metadata = {
  title: "Customer dossier — Rockwell Ops",
  description: "Full customer timeline, KYC record, linked rails, trade history and staff notes.",
};

export default async function Page({ params }: PageProps<"/admin/customers/[id]">) {
  const { id } = await params;
  return <AdminCustomerDossierClient userId={id} />;
}
