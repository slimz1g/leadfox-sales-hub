"use client";
// app/priorities/page.tsx
// The real "Priorités" tab — fetches live data from /api/priorities (which pulls from
// HubSpot, the Google Sheet, and Fireflies) instead of the hardcoded mockup arrays.

import { useEffect, useState } from "react";

const COLORS = {
  bg: "#F3F4F8",
  card: "#FFFFFF",
  border: "#E5E7EB",
  navy: "#101828",
  navySoft: "#475467",
  orange: "#F26B21",
  red: "#B42318",
  redSoft: "#FEF0EF",
  indigo: "#4338CA",
};

type Priorities = {
  generatedAt: string;
  p1_closing: any[];
  p1b_entonnoir_no_followup: { total: number; items: any[] };
  p2_inbound_fresh: any[];
  p3_no_show: any[];
  p4_stale_planned_meetings: any[];
  p5_nettoyage: any[];
  overdue_tasks: { total: number; items: any[] };
  p6_outbound_general: any[];
};

export default function PrioritesPage() {
  const [data, setData] = useState<Priorities | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/priorities")
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setData(json);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div style={{ padding: 40, color: COLORS.navySoft }}>Chargement des priorités…</div>;
  }

  if (error) {
    return (
      <div style={{ padding: 40, color: COLORS.red }}>
        Erreur en chargeant les données : {error}
        <br />
        <span style={{ fontSize: 13, color: COLORS.navySoft }}>
          Vérifie que HUBSPOT_PRIVATE_APP_TOKEN, GOOGLE_SERVICE_ACCOUNT_KEY, FIREFLIES_API_KEY,
          HUBSPOT_PORTAL_ID et HUBSPOT_OWNER_ID sont bien configurés dans .env.local
        </span>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div style={{ background: COLORS.bg, minHeight: "100vh", fontFamily: "Inter, sans-serif", padding: "28px 24px" }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: COLORS.navy }}>🎯 L'ordre du jour</h1>
      <p style={{ color: COLORS.navySoft, fontSize: 14 }}>Le plus urgent en haut, le nettoyage en bas</p>
      <p style={{ fontSize: 11, color: COLORS.navySoft }}>
        Mis à jour : {new Date(data.generatedAt).toLocaleString("fr-CA")}
      </p>

      <Section title="🔥 Sur le point de signer" count={data.p1_closing.length}>
        {data.p1_closing.map((d, i) => (
          <Card key={i}>
            <strong>{d.name}</strong> — {d.percent}% · {d.amount}
            <div style={{ fontSize: 13, color: COLORS.navySoft }}>{d.note}</div>
            {d.hubspotUrl && (
              <a href={d.hubspotUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                Ouvrir dans HubSpot
              </a>
            )}
          </Card>
        ))}
      </Section>

      <Section
        title="🕸️ Entonnoir de ventes — aucun suivi programmé"
        count={data.p1b_entonnoir_no_followup.total}
      >
        {data.p1b_entonnoir_no_followup.items.map((d, i) => (
          <Row key={i} name={d.name} meta={`${d.days} jours sans contact`} url={d.hubspotUrl} tone={COLORS.indigo} />
        ))}
        {data.p1b_entonnoir_no_followup.total > data.p1b_entonnoir_no_followup.items.length && (
          <div style={{ fontSize: 12, fontStyle: "italic", color: COLORS.navySoft }}>
            + {data.p1b_entonnoir_no_followup.total - data.p1b_entonnoir_no_followup.items.length} autres
          </div>
        )}
      </Section>

      <Section title="📥 Leads inbound sans contact 48h+" count={data.p2_inbound_fresh.length}>
        {data.p2_inbound_fresh.map((d, i) => (
          <Row key={i} name={d.name} meta={`${d.days ?? "?"} jours`} url={d.hubspotUrl} tone={COLORS.orange} />
        ))}
      </Section>

      <Section title="📵 No Show sans contact 48h+" count={data.p3_no_show.length}>
        {data.p3_no_show.length === 0 ? (
          <Empty text="Rien à signaler." />
        ) : (
          data.p3_no_show.map((d, i) => <Row key={i} name={d.name} meta="" url={d.hubspotUrl} tone={COLORS.orange} />)
        )}
      </Section>

      <Section title="🗓️ RV planifié à mettre à jour" count={data.p4_stale_planned_meetings.length}>
        {data.p4_stale_planned_meetings.length === 0 ? (
          <Empty text="Rien à signaler." />
        ) : (
          data.p4_stale_planned_meetings.map((d, i) => (
            <Row key={i} name={d.name} meta={`Rencontre prévue le ${d.meetingDate}`} url={d.hubspotUrl} tone={COLORS.red} />
          ))
        )}
      </Section>

      <Section title="🧹 Nettoyage" count={data.p5_nettoyage.length}>
        {data.p5_nettoyage.map((d, i) => (
          <Row key={i} name={d.name} meta={d.overdueRecall ? "Rappel dépassé (60j)" : `${d.days} jours`} url={d.hubspotUrl} tone={COLORS.navySoft} />
        ))}
        <Card>
          ⏰ {data.overdue_tasks.total} tâches HubSpot en retard
          {data.overdue_tasks.items.slice(0, 3).map((t, i) => (
            <div key={i} style={{ fontSize: 12, color: COLORS.navySoft }}>
              {t.properties.hs_task_subject} · {t.properties.hs_task_priority}
            </div>
          ))}
        </Card>
      </Section>

      <Section title="📤 Outbound — cadence normale" count={data.p6_outbound_general.length}>
        {data.p6_outbound_general.map((d, i) => (
          <Row key={i} name={d.name} meta={`${d.days ?? "?"} jours`} url={d.hubspotUrl} tone={COLORS.navySoft} />
        ))}
      </Section>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 24 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, color: COLORS.navy }}>
        {title} ({count})
      </h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>{children}</div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 12 }}>
      {children}
    </div>
  );
}

function Row({ name, meta, url, tone }: { name: string; meta: string; url: string | null; tone: string }) {
  return (
    <div
      style={{
        background: COLORS.card,
        border: `1px solid ${COLORS.border}`,
        borderLeft: `3px solid ${tone}`,
        borderRadius: 8,
        padding: "10px 12px",
        display: "flex",
        justifyContent: "space-between",
        fontSize: 13,
      }}
    >
      <span>
        <strong>{name}</strong> {meta && `— ${meta}`}
      </span>
      {url && (
        <a href={url} target="_blank" rel="noreferrer" style={{ color: COLORS.navySoft, fontSize: 12 }}>
          HubSpot
        </a>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ fontSize: 13, fontStyle: "italic", color: COLORS.navySoft }}>✅ {text}</div>;
}
