"use client";
// components/Header.tsx
// Shared top navigation for the whole Sales Hub. Built pages use real links;
// not-yet-built modules show as muted, non-clickable placeholders so the full
// vision of the platform is always visible.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LOGO_SRC } from "@/lib/logo";

const COLORS = {
  card: "#FFFFFF",
  border: "#E5E7EB",
  navy: "#101828",
  navySoft: "#475467",
  orange: "#F26B21",
  soon: "#98A2B3",
};

const NAV_ITEMS = [
  { href: "/", label: "🏠 Accueil", built: true },
  { href: "/priorities", label: "🎯 Priorités", built: true },
  { href: "/outbound", label: "📤 Outbound", built: false },
  { href: "/rendez-vous", label: "📅 Rendez-vous", built: false },
  { href: "/recaps", label: "✉️ Récaps", built: false },
  { href: "/ressources", label: "🎓 Ressources", built: false },
  { href: "/coach", label: "🤖 Coach", built: false },
];

export default function Header() {
  const pathname = usePathname();

  return (
    <div
      style={{
        background: COLORS.card,
        borderBottom: `1px solid ${COLORS.border}`,
        boxShadow: "0 1px 3px rgba(16,24,40,0.04)",
        padding: "0 24px",
        display: "flex",
        alignItems: "center",
        gap: 20,
        height: 64,
        flexWrap: "wrap",
      }}
    >
      <img src={LOGO_SRC} alt="LeadFox" style={{ height: 40 }} />

      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href;

        if (!item.built) {
          return (
            <span
              key={item.href}
              title="Bientôt disponible"
              style={{
                fontSize: 13,
                fontWeight: 700,
                padding: "20px 3px",
                color: COLORS.soon,
                borderBottom: "2px solid transparent",
                cursor: "not-allowed",
                whiteSpace: "nowrap",
              }}
            >
              {item.label}
            </span>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            style={{
              fontSize: 13.5,
              fontWeight: 700,
              padding: "20px 4px",
              color: isActive ? COLORS.navy : COLORS.navySoft,
              borderBottom: isActive ? `2px solid ${COLORS.orange}` : "2px solid transparent",
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
