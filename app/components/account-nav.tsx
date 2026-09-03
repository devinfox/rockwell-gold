"use client";

// Sub-nav chips shared by every signed-in customer surface.

const LINKS = [
  { href: "/vault", label: "Vault" },
  { href: "/vault/sell-back", label: "Sell-back" },
  { href: "/vault/delivery", label: "Delivery" },
  { href: "/vault/vaultplan", label: "VaultPlan" },
  { href: "/vault/rewards", label: "Rewards" },
  { href: "/orders", label: "Orders" },
  { href: "/tax-center", label: "Tax center" },
  { href: "/support", label: "Support" },
];

export default function AccountNav({ current }: { current: string }) {
  return (
    <div className="rm-chips" style={{ marginBottom: 26 }} role="navigation" aria-label="Account">
      {LINKS.map((l) => (
        <a key={l.href} className={`chip${current === l.href ? " chip--on" : ""}`} href={l.href}>
          {l.label}
        </a>
      ))}
    </div>
  );
}
