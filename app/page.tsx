"use client";
// app/page.tsx
// The real "Accueil" home page — replaces home_page_mockup.html.
//
// Design choice: every section here is either (a) real, computed from the
// existing /api/priorities response (no backend changes needed), or
// (b) clearly marked "Bientôt" because the data source doesn't exist yet
// (monthly goal tracking, call activity log, closed-deal history, streaks,
// notes storage, etc.). Nothing on this page is fabricated demo data —
// a sales rep needs to be able to trust every number shown here.

import { useEffect, useState } from "react";
import Header from "@/components/Header";
import { SALES_REPS } from "@/lib/team";

const COLORS = {
  bg: "#F3F4F8",
  card: "#FFFFFF",
  border: "#E5E7EB",
  navy: "#101828",
  navySoft: "#475467",
  orange: "#F26B21",
  orangeSoft: "#FFF1E8",
  green: "#12805C",
  greenSoft: "#E6F6EF",
  amber: "#B45309",
  amberSoft: "#FEF3E2",
  red: "#B42318",
  redSoft: "#FEF0EF",
  blue: "#1849A9",
  blueSoft: "#EFF4FF",
  indigo: "#4338CA",
  disabled: "#98A2B3",
};

const HUBSPOT_PORTAL_ID = "2530556";
const GOOGLE_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1-TicSgs0Ds6-_6DOZ1m-7Bm2LVCM5eqNcFoe4-lJZBI";
const FIREFLIES_URL = "https://app.fireflies.ai";

const FONT_IMPORT =
  "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');";

type PrioritiesResponse = {
  generatedAt: string;
  sheetTabUsed?: string;
  salesReps?: { id: string; name: string }[];
  activeRep?: { id: string; name: string } | null;
  p1_closing: any[];
  p1b_entonnoir_no_followup: { total: number; items: any[] };
  p2_inbound_fresh: any[];
  p3_no_show: any[];
  p4_stale_planned_meetings: any[];
  p5_nettoyage: any[];
  overdue_tasks: any[];
  upcoming_tasks: any[];
  p6_outbound_general: any[];
  monthly_goal: {
    monthLabel: string;
    tabUsed: string;
    dealCountTarget: number;
    dollarTarget: number;
    dealCountActual: number;
    dollarActual: number;
  } | null;
};

function fmtDate(d: Date) {
  return d
    .toLocaleDateString("fr-CA", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    })
    .toUpperCase();
}

function SectionTitle({
  children,
  seeAllHref,
}: {
  children: React.ReactNode;
  seeAllHref?: string;
}) {
  return (
    <div
      style={{
        fontSize: 15,
        fontWeight: 700,
        color: COLORS.navy,
        marginBottom: 14,
        paddingBottom: 10,
        borderBottom: `1px solid ${COLORS.border}`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
      }}
    >
      <span>{children}</span>
      {seeAllHref && (
        <a
          href={seeAllHref}
          style={{
            fontSize: 12.5,
            color: COLORS.orange,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Voir tout →
        </a>
      )}
    </div>
  );
}

function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        background: COLORS.card,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 12,
        boxShadow: "0 1px 2px rgba(16,24,40,0.04)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card style={{ padding: 18 }}>
      <div style={{ fontSize: 12.5, color: COLORS.navySoft, fontWeight: 600, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: COLORS.navy }}>{value}</div>
    </Card>
  );
}

function ActionRow({
  name,
  meta,
  url,
  tone,
}: {
  name: string;
  meta: string;
  url: string | null;
  tone: "red" | "amber" | "indigo" | "blue";
}) {
  const toneColor = { red: COLORS.red, amber: COLORS.amber, indigo: COLORS.indigo, blue: COLORS.blue }[tone];
  return (
    <div
      style={{
        background: COLORS.card,
        border: `1px solid ${COLORS.border}`,
        borderLeft: `3px solid ${toneColor}`,
        borderRadius: 9,
        padding: "12px 14px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontSize: 13.5,
        boxShadow: "0 1px 2px rgba(16,24,40,0.04)",
        marginBottom: 8,
      }}
    >
      <span>
        <strong style={{ color: COLORS.navy }}>{name}</strong>
        <span style={{ color: COLORS.navySoft }}> — {meta}</span>
      </span>
      {url && (
        <a href={url} target="_blank" rel="noreferrer" style={{ color: COLORS.navySoft, fontSize: 12, textDecoration: "none" }}>
          HubSpot ↗
        </a>
      )}
    </div>
  );
}

function ComingSoon({ note }: { note: string }) {
  return (
    <Card style={{ padding: 16, marginBottom: 32, opacity: 0.7 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.disabled, marginBottom: 4 }}>
        🔜 BIENTÔT
      </div>
      <div style={{ fontSize: 13, color: COLORS.navySoft, fontStyle: "italic" }}>{note}</div>
    </Card>
  );
}

export default function HomePage() {
  const [repId, setRepId] = useState<string>("396827993"); // Slim by default, same as /priorities
  const [teamView, setTeamView] = useState(false);
  const [data, setData] = useState<PrioritiesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<
    { name: string; closing: number; overdue: number }[] | null
  >(null);

  useEffect(() => {
    document.title = "Sales Hub Homepage | Leadfox";
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const query = teamView ? "team" : repId;
    fetch(`/api/priorities?repId=${query}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setData(json);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [repId, teamView]);

  // Leaderboard: reuses the same /api/priorities endpoint per rep, run in
  // parallel. No new backend route needed — every number here is real.
  useEffect(() => {
    Promise.all(
      SALES_REPS.map((rep) =>
        fetch(`/api/priorities?repId=${rep.id}`)
          .then((r) => r.json())
          .then((json) => ({
            name: rep.name,
            closing: json.p1_closing?.length ?? 0,
            overdue: json.overdue_tasks?.length ?? 0,
          }))
          .catch(() => ({ name: rep.name, closing: 0, overdue: 0 }))
      )
    ).then((rows) => setLeaderboard(rows.sort((a, b) => b.closing - a.closing)));
  }, []);

  const firstName = teamView
    ? "l'équipe"
    : SALES_REPS.find((r) => r.id === repId)?.firstName ?? "";

  // "Deal en jeu" — since deal amount isn't currently returned by
  // /api/priorities, we surface the closing-stage deal with the most recent
  // contact instead of a dollar figure (honest substitute, not a guess).
  const topClosingDeal =
    data?.p1_closing && data.p1_closing.length > 0
      ? [...data.p1_closing].sort((a, b) => (a.days ?? 999) - (b.days ?? 999))[0]
      : null;

  // Deals à risque: closing-stage deals flagged overdueRecall by the API.
  const atRiskDeals = data?.p1_closing?.filter((d) => d.overdueRecall) ?? [];

  // Priorités du jour: top overdue tasks + at-risk closing deals, capped.
  const todayPriorities = [
    ...(data?.overdue_tasks ?? []).slice(0, 3).map((t) => ({
      name: t.dealName || t.subject,
      meta: t.subject,
      url: null as string | null,
      tone: "amber" as const,
    })),
    ...atRiskDeals.slice(0, 2).map((d) => ({
      name: d.name,
      meta: `${d.days ?? "?"} jours sans contact — ${d.stageLabel}`,
      url: d.hubspotUrl as string | null,
      tone: "red" as const,
    })),
  ].slice(0, 5);

  // Funnel + pipeline split computed from the real section counts the API
  // already returns — labeled with the actual section names, not forced
  // into the mockup's 4-category shape which doesn't map 1:1 to this data.
  const funnelSections = data
    ? [
        { label: "Négo en cours (P1)", count: data.p1_closing.length, color: COLORS.red },
        { label: "Entonnoir sans suivi (P1b)", count: data.p1b_entonnoir_no_followup.total, color: COLORS.amber },
        { label: "Inbound frais / no-show (P2-P3)", count: data.p2_inbound_fresh.length + data.p3_no_show.length, color: COLORS.blue },
        { label: "RV planifiés en attente (P4)", count: data.p4_stale_planned_meetings.length, color: COLORS.indigo },
        { label: "Nettoyage (P5)", count: data.p5_nettoyage.length, color: COLORS.disabled },
        { label: "Outbound actif (P6)", count: data.p6_outbound_general.length, color: COLORS.orange },
      ]
    : [];
  const funnelMax = Math.max(1, ...funnelSections.map((s) => s.count));

  const entonnoirTotal = (data?.p1_closing.length ?? 0) + (data?.p1b_entonnoir_no_followup.total ?? 0);
  const inboundTotal = (data?.p2_inbound_fresh.length ?? 0) + (data?.p3_no_show.length ?? 0) + (data?.p4_stale_planned_meetings.length ?? 0);
  const outboundTotal = data?.p6_outbound_general.length ?? 0;
  const pipelineGrandTotal = Math.max(1, entonnoirTotal + inboundTotal + outboundTotal);

  return (
    <div style={{ minHeight: "100vh", background: COLORS.bg, fontFamily: "'Inter', sans-serif" }}>
      <style>{FONT_IMPORT}</style>
      <Header />

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px 60px" }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: COLORS.orange, letterSpacing: 0.4 }}>
          {fmtDate(new Date())}
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: COLORS.navy, margin: "6px 0 24px" }}>
          👋 Bonjour, {firstName}
        </h1>

        <div style={{ display: "flex", gap: 8, marginBottom: 28, flexWrap: "wrap" }}>
          {SALES_REPS.map((rep) => (
            <button
              key={rep.id}
              onClick={() => {
                setTeamView(false);
                setRepId(rep.id);
              }}
              style={{
                borderRadius: 8,
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 600,
                border: `1px solid ${!teamView && repId === rep.id ? COLORS.orange : COLORS.border}`,
                background: !teamView && repId === rep.id ? COLORS.orange : COLORS.card,
                color: !teamView && repId === rep.id ? "#fff" : COLORS.navySoft,
                cursor: "pointer",
              }}
            >
              👤 {rep.name}
            </button>
          ))}
          <button
            onClick={() => setTeamView(true)}
            style={{
              borderRadius: 8,
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 600,
              border: `1px solid ${teamView ? COLORS.orange : COLORS.border}`,
              background: teamView ? COLORS.orange : COLORS.card,
              color: teamView ? "#fff" : COLORS.navySoft,
              cursor: "pointer",
            }}
          >
            👥 Toute l'équipe
          </button>
        </div>

        {error && (
          <Card style={{ padding: 16, marginBottom: 24, borderLeft: `3px solid ${COLORS.red}` }}>
            <div style={{ color: COLORS.red, fontSize: 13.5 }}>Erreur : {error}</div>
          </Card>
        )}
        {loading && <div style={{ color: COLORS.navySoft, fontSize: 13.5, marginBottom: 24 }}>Chargement…</div>}

        {/* Metric cards — all real, from /api/priorities */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 32 }}>
          <MetricCard label="🔥 Deals chauds" value={data?.p1_closing.length ?? "—"} />
          <MetricCard label="📋 Tâches en retard" value={data?.overdue_tasks.length ?? "—"} />
          <MetricCard label="📅 Tâches à venir" value={data?.upcoming_tasks.length ?? "—"} />
          <MetricCard label="🧹 À nettoyer" value={data?.p5_nettoyage.length ?? "—"} />
        </div>

        <SectionTitle>🎯 Objectif du mois{data?.monthly_goal ? ` — ${data.monthly_goal.monthLabel}` : ""}</SectionTitle>
        {data?.monthly_goal ? (
          <Card style={{ padding: 18, marginBottom: 32 }}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, marginBottom: 8 }}>
                <span style={{ color: COLORS.navySoft }}>
                  {data.monthly_goal.dealCountActual} deals fermés sur un objectif de {data.monthly_goal.dealCountTarget}
                </span>
                <span style={{ fontWeight: 700, color: COLORS.green }}>
                  {data.monthly_goal.dealCountTarget > 0
                    ? Math.round((data.monthly_goal.dealCountActual / data.monthly_goal.dealCountTarget) * 100)
                    : 0}
                  %
                </span>
              </div>
              <div style={{ background: "#F1F2F5", borderRadius: 8, height: 12, overflow: "hidden" }}>
                <div
                  style={{
                    width: `${Math.min(100, data.monthly_goal.dealCountTarget > 0 ? (data.monthly_goal.dealCountActual / data.monthly_goal.dealCountTarget) * 100 : 0)}%`,
                    height: "100%",
                    background: COLORS.green,
                    borderRadius: 8,
                  }}
                />
              </div>
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, marginBottom: 8 }}>
                <span style={{ color: COLORS.navySoft }}>
                  {data.monthly_goal.dollarActual.toLocaleString("fr-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 })} sur un objectif de{" "}
                  {data.monthly_goal.dollarTarget.toLocaleString("fr-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 })}
                </span>
                <span style={{ fontWeight: 700, color: COLORS.orange }}>
                  {data.monthly_goal.dollarTarget > 0
                    ? Math.round((data.monthly_goal.dollarActual / data.monthly_goal.dollarTarget) * 100)
                    : 0}
                  %
                </span>
              </div>
              <div style={{ background: "#F1F2F5", borderRadius: 8, height: 12, overflow: "hidden" }}>
                <div
                  style={{
                    width: `${Math.min(100, data.monthly_goal.dollarTarget > 0 ? (data.monthly_goal.dollarActual / data.monthly_goal.dollarTarget) * 100 : 0)}%`,
                    height: "100%",
                    background: COLORS.orange,
                    borderRadius: 8,
                  }}
                />
              </div>
            </div>
          </Card>
        ) : (
          <ComingSoon note="Le mois en cours n'a pas été trouvé dans l'onglet Objectif marketing/vente du Sheet — vérifie que la colonne du mois existe, ou que le nom de l'onglet n'a pas changé (nommage par trimestre)." />
        )}

        <SectionTitle>🧠 Rétro du mois dernier</SectionTitle>
        <ComingSoon note="Pas encore de résumé automatique du mois précédent — à construire une fois qu'on a l'historique des deals fermés." />

        <SectionTitle>Tes outils</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 32 }}>
          <Card style={{ padding: 20 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🎯</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.navy }}>Priorités</div>
            <div style={{ fontSize: 13, color: COLORS.navySoft, marginTop: 4, lineHeight: 1.4 }}>
              Qui appeler, qui closer, qui nettoyer — calculé automatiquement chaque jour.
            </div>
            <span
              style={{
                display: "inline-block",
                fontSize: 11,
                fontWeight: 700,
                color: COLORS.green,
                background: COLORS.greenSoft,
                padding: "3px 9px",
                borderRadius: 999,
                marginTop: 8,
              }}
            >
              ✅ Actif
            </span>
          </Card>
          {["📤 Outbound", "📅 Rendez-vous"].map((label) => (
            <Card key={label} style={{ padding: 20, opacity: 0.6 }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>{label.split(" ")[0]}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.navy }}>{label.split(" ").slice(1).join(" ")}</div>
              <span
                style={{
                  display: "inline-block",
                  fontSize: 11,
                  fontWeight: 700,
                  color: COLORS.amber,
                  background: COLORS.amberSoft,
                  padding: "3px 9px",
                  borderRadius: 999,
                  marginTop: 8,
                }}
              >
                🔜 Bientôt
              </span>
            </Card>
          ))}
        </div>

        <SectionTitle seeAllHref="/priorities">🎯 Priorités du jour</SectionTitle>
        <div style={{ marginBottom: 32 }}>
          {todayPriorities.length === 0 && !loading ? (
            <div style={{ fontSize: 13, fontStyle: "italic", color: COLORS.navySoft }}>Rien d'urgent pour l'instant 🎉</div>
          ) : (
            todayPriorities.map((p, i) => <ActionRow key={i} {...p} />)
          )}
        </div>

        <SectionTitle>⚠️ Deals à risque</SectionTitle>
        <div style={{ marginBottom: 32 }}>
          {atRiskDeals.length === 0 && !loading ? (
            <div style={{ fontSize: 13, fontStyle: "italic", color: COLORS.navySoft }}>Aucun deal chaud à risque en ce moment.</div>
          ) : (
            atRiskDeals.slice(0, 5).map((d) => (
              <ActionRow
                key={d.dealId}
                name={d.name}
                meta={`${d.stageLabel} — rappel dépassé (${d.days ?? "?"} jours sans contact)`}
                url={d.hubspotUrl}
                tone="amber"
              />
            ))
          )}
        </div>

        <SectionTitle>📦 Nouveaux leads assignés aujourd'hui</SectionTitle>
        <ComingSoon note="Nécessite un filtre par date de création — pas encore ajouté à /api/priorities." />

        <SectionTitle>⏱️ Temps de réponse moyen</SectionTitle>
        <ComingSoon note="Pas encore de calcul du délai de première réponse sur les leads inbound." />

        <SectionTitle seeAllHref="/priorities">⏰ Rappels à venir bientôt</SectionTitle>
        <div style={{ marginBottom: 32 }}>
          {(data?.upcoming_tasks ?? []).length === 0 && !loading ? (
            <div style={{ fontSize: 13, fontStyle: "italic", color: COLORS.navySoft }}>Aucun rappel à venir.</div>
          ) : (
            (data?.upcoming_tasks ?? []).slice(0, 5).map((t) => (
              <ActionRow key={t.id} name={t.dealName || t.subject} meta={t.subject} url={null} tone="blue" />
            ))
          )}
        </div>

        <SectionTitle>🥇 Deal le plus actif en négociation</SectionTitle>
        <Card style={{ padding: 18, marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {topClosingDeal ? (
            <>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.navy }}>{topClosingDeal.name}</div>
                <div style={{ fontSize: 12.5, color: COLORS.navySoft, marginTop: 2 }}>{topClosingDeal.stageLabel}</div>
              </div>
              <a href={topClosingDeal.hubspotUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: COLORS.orange, fontWeight: 700, textDecoration: "none" }}>
                Ouvrir ↗
              </a>
            </>
          ) : (
            <div style={{ fontSize: 13, fontStyle: "italic", color: COLORS.navySoft }}>Aucun deal en négociation active.</div>
          )}
        </Card>

        <SectionTitle>🎙️ Derniers insights Fireflies</SectionTitle>
        <ComingSoon note="Les insights Fireflies existent par deal (page Priorités) mais ne sont pas encore agrégés ici." />

        <SectionTitle>📊 Santé de l'entonnoir de ventes</SectionTitle>
        <Card style={{ padding: 18, marginBottom: 32 }}>
          {funnelSections.map((s) => (
            <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ width: 200, fontSize: 12.5, color: COLORS.navySoft, flexShrink: 0 }}>{s.label}</span>
              <div style={{ flex: 1, background: "#F1F2F5", borderRadius: 6, height: 20, overflow: "hidden" }}>
                <div style={{ width: `${(s.count / funnelMax) * 100}%`, height: "100%", background: s.color, borderRadius: 6 }} />
              </div>
              <span style={{ width: 34, textAlign: "right", fontSize: 12.5, fontWeight: 700, color: COLORS.navy }}>{s.count}</span>
            </div>
          ))}
        </Card>

        <SectionTitle>📊 Répartition par pipeline</SectionTitle>
        <Card style={{ padding: 18, marginBottom: 32 }}>
          <div style={{ display: "flex", height: 22, borderRadius: 6, overflow: "hidden", marginBottom: 10 }}>
            <div style={{ width: `${(entonnoirTotal / pipelineGrandTotal) * 100}%`, background: COLORS.indigo }} />
            <div style={{ width: `${(inboundTotal / pipelineGrandTotal) * 100}%`, background: COLORS.orange }} />
            <div style={{ width: `${(outboundTotal / pipelineGrandTotal) * 100}%`, background: COLORS.blue }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: COLORS.navySoft }}>
            <span>🔻 Entonnoir · {entonnoirTotal}</span>
            <span>📥 Inbound · {inboundTotal}</span>
            <span>📤 Outbound · {outboundTotal}</span>
          </div>
        </Card>

        <SectionTitle>📈 Tendance mensuelle</SectionTitle>
        <ComingSoon note="Nécessite l'historique des deals fermés par mois — pas encore interrogé dans l'API." />

        <SectionTitle>🔁 Deals réactivés récemment</SectionTitle>
        <ComingSoon note="Nécessite de suivre les changements d'étape dans le temps — pas encore tracké." />

        <SectionTitle>🧾 Derniers deals fermés</SectionTitle>
        <ComingSoon note="Nécessite une requête sur les deals hs_is_closed=true — pas encore ajoutée à l'API." />

        <SectionTitle>🏆 Classement de l'équipe</SectionTitle>
        <table style={{ width: "100%", borderCollapse: "collapse", background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 2px rgba(16,24,40,0.04)", marginBottom: 32 }}>
          <thead>
            <tr>
              {["Rep", "🔥 Deals chauds", "📋 Tâches en retard"].map((h) => (
                <th key={h} style={{ textAlign: "left", fontSize: 11.5, color: COLORS.navySoft, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, padding: "10px 16px", background: "#FAFAFB", borderBottom: `1px solid ${COLORS.border}` }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(leaderboard ?? []).map((row, i) => (
              <tr key={row.name}>
                <td style={{ padding: "12px 16px", fontSize: 13.5, color: COLORS.navy, borderBottom: "1px solid #F1F2F5" }}>
                  {i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉"} {row.name}
                </td>
                <td style={{ padding: "12px 16px", fontSize: 13.5, color: COLORS.navy, borderBottom: "1px solid #F1F2F5" }}>{row.closing}</td>
                <td style={{ padding: "12px 16px", fontSize: 13.5, color: COLORS.navy, borderBottom: "1px solid #F1F2F5" }}>{row.overdue}</td>
              </tr>
            ))}
            {!leaderboard && (
              <tr>
                <td colSpan={3} style={{ padding: "12px 16px", fontSize: 13, color: COLORS.navySoft, fontStyle: "italic" }}>
                  Chargement du classement…
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div style={{ fontSize: 11.5, color: COLORS.navySoft, marginTop: -24, marginBottom: 32 }}>
          "Deals fermés" n'est pas encore tracké dans le classement — nécessite une requête sur les deals gagnés par mois.
        </div>

        <SectionTitle>📞 Activité récente</SectionTitle>
        <ComingSoon note="Nécessite un journal d'activité (appels, tâches complétées, deals fermés) — pas encore construit." />

        <SectionTitle>🕐 Séquence active</SectionTitle>
        <ComingSoon note="Nécessite un suivi de streak jour par jour — pas encore stocké quelque part de persistant." />

        <SectionTitle>🗓️ Vue de la semaine</SectionTitle>
        <ComingSoon note="Nécessite un calendrier de rendez-vous — dépend du futur module Rendez-vous." />

        <SectionTitle>🔔 État des connexions</SectionTitle>
        <Card style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid #F1F2F5", fontSize: 13 }}>
            <span><span style={{ width: 8, height: 8, borderRadius: "50%", display: "inline-block", marginRight: 8, background: data ? COLORS.green : COLORS.disabled }} />HubSpot</span>
            <span style={{ color: COLORS.navySoft }}>{data ? "Synchronisé à l'instant" : "En attente…"}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", fontSize: 13 }}>
            <span><span style={{ width: 8, height: 8, borderRadius: "50%", display: "inline-block", marginRight: 8, background: data?.sheetTabUsed ? COLORS.green : COLORS.disabled }} />Google Sheet</span>
            <span style={{ color: COLORS.navySoft }}>{data?.sheetTabUsed ? `Onglet : ${data.sheetTabUsed}` : "En attente…"}</span>
          </div>
        </Card>

        <SectionTitle>🗒️ Bloc-notes rapide</SectionTitle>
        <ComingSoon note="Nécessite un endroit pour stocker des notes persistantes par utilisateur — pas encore construit." />

        <SectionTitle>🔗 Raccourcis rapides</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 32 }}>
          <a href={`https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/objects/0-3/views/all/list`} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
            <Card style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, fontWeight: 600, color: COLORS.navy }}>
              🔶 Ouvrir HubSpot
            </Card>
          </a>
          <a href={GOOGLE_SHEET_URL} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
            <Card style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, fontWeight: 600, color: COLORS.navy }}>
              📊 Ouvrir le Sheet
            </Card>
          </a>
          <a href={FIREFLIES_URL} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
            <Card style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, fontWeight: 600, color: COLORS.navy }}>
              🎙️ Ouvrir Fireflies
            </Card>
          </a>
        </div>

        <div style={{ marginTop: 32, fontSize: 11.5, color: COLORS.navySoft }}>
          {data ? `📊 Dernière synchronisation : ${new Date(data.generatedAt).toLocaleString("fr-CA")}` : ""}
        </div>
      </div>
    </div>
  );
}
