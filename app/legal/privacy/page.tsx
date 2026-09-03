import type { Metadata } from "next";
import LegalShell from "../legal-shell";

export const metadata: Metadata = {
  title: "Privacy Policy — Rockwell Metals",
  description: "What data Rockwell Metals collects and how it is handled.",
};

export default function Page() {
  return (
    <LegalShell
      index="L3 / Privacy"
      title="Privacy policy"
      sub="What we collect, why, and what happens to it."
      draft
    >
      <h2>What the platform stores today</h2>
      <p>
        Your name, email address, phone number, account type, verification status and risk rating;
        your orders and their full status history; your vault holdings and their serial numbers; your
        shipments and delivery addresses; your support conversations; and an append-only audit record
        of every action taken on your account by you or by staff.
      </p>

      <h2>Credentials</h2>
      <p>
        Passwords are stored only as a scrypt digest with a per-account salt. Sessions are held in a
        signed, HTTP-only cookie that your browser cannot read or modify.
      </p>

      <h2>What has not been settled yet</h2>
      <p>
        Data retention periods, third-party processors, international transfer basis, your rights of
        access and erasure, and the lawful basis for each category of processing all need to be
        determined and documented with counsel before this page can be considered complete. Do not
        treat this summary as a compliant privacy notice.
      </p>
    </LegalShell>
  );
}
