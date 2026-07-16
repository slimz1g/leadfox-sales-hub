// app/api/priorities/route.ts
// Aggregates HubSpot + Google Sheet + Fireflies into the 6-tier priority list
// documented in "Check-list_des_ventes_Reference.md". This is the real logic —
// no hardcoded example data.

// Vercel's default function timeout (10s on Hobby) is too short once Fireflies
// lookups are added on top of the HubSpot + Sheet calls. This raises it to the
// maximum Hobby allows without needing a paid plan.
export const maxDuration = 60;

import { NextResponse } from "next/server";
import {
  searchDeals,
  getOpenTasks,
  getPrimaryContact,
  hubspotDealUrl,
  getOwnersMap,
  getClosedWonThisMonth,
  STAGE_LABELS,
  PIPELINES,
  STAGES,
} from "@/lib/hubspot";
import { getClosingRows, getMonthlyGoal } from "@/lib/googleSheet";
import { findTranscriptByParticipant, firefliesRecordingUrl } from "@/lib/fireflies";

const HUBSPOT_PORTAL_ID = process.env.HUBSPOT_PORTAL_ID!;
// Sales team roster. Static for now (no auth/user directory yet) — add reps
// here as the team grows. IDs are HubSpot owner IDs.
const SALES_REPS = [
  { id: "396827993", name: "Slim Labassi" },
  { id: "17032870", name: "Alexandre Paquet" },
];

const HOURS_48 = 48 * 60 * 60 * 1000;
const DAYS_60 = 60 * 24 * 60 * 60 * 1000;

function hoursSince(dateStr: string | undefined): number | null {
  if (!dateStr) return null;
  return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60);
}

function daysSince(dateStr: string | undefined): number | null {
  const h = hoursSince(dateStr);
  return h === null ? null : Math.floor(h / 24);
}

function stageToPipeline(stageId: string): "entonnoir" | "inbound" | "outbound" | "unknown" {
  const inboundStages: string[] = [
    STAGES.INBOUND_SQL,
    STAGES.INBOUND_1ER_SUIVI,
    STAGES.INBOUND_2E_SUIVI,
    STAGES.INBOUND_3E_SUIVI,
    STAGES.INBOUND_BOUGE_PAS,
    STAGES.INBOUND_REMIS_A_PLUS_TARD,
    STAGES.INBOUND_RV_PLANIFIE,
  ];
  const outboundStages: string[] = [
    STAGES.OUTBOUND_EMAIL,
    STAGES.OUTBOUND_EN_SUIVI,
    STAGES.OUTBOUND_RDV_PLANIFIE,
    STAGES.OUTBOUND_NO_SHOW,
    STAGES.OUTBOUND_BOUGE_PAS,
  ];
  const entonnoirStages: string[] = [
    STAGES.NEGO_EN_COURS,
    STAGES.REMIS_A_PLUS_TARD_ENTONNOIR,
    STAGES.RV_REALISE,
    STAGES.NE_BOUGE_PAS_ENTONNOIR,
    STAGES.GHOSTING,
  ];
  if (inboundStages.includes(stageId)) return "inbound";
  if (outboundStages.includes(stageId)) return "outbound";
  if (entonnoirStages.includes(stageId)) return "entonnoir";
  return "unknown";
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedRepId = searchParams.get("repId");
    const isTeamView = requestedRepId === "team";
    // Default to the first rep on the roster if nothing/invalid was passed.
    const activeRep =
      SALES_REPS.find((r) => r.id === requestedRepId) ?? SALES_REPS[0];
    const OWNER_ID = activeRep.id;

    // Helper: include the owner filter only when viewing a specific rep.
    // Spread this into each filters array below so the same queries work
    // whether we're scoped to one rep or showing the whole team.
    const ownerFilter = () =>
      isTeamView ? [] : [{ propertyName: "hubspot_owner_id", operator: "EQ" as const, value: OWNER_ID }];

    // Calls run in parallel for speed (a serverless function has a hard time
    // limit — running everything sequentially risked timing out). Rate-limit
    // resilience now lives in lib/hubspot.ts (automatic retry on 429) instead
    // of manual delays here.

    const [
      closingSheetRows,
      entonnoirDeals,
      inboundFreshDeals,
      outboundNoShowDeals,
      rvPlanifieInbound,
      rdvPlanifieOutbound,
      remisEtBougePas,
      outboundGeneral,
      ownersMap,
      monthlyGoal,
      closedWonThisMonth,
    ] = await Promise.all([
      getClosingRows(),

      searchDeals(
        [
          {
            filters: [
              { propertyName: "pipeline", operator: "EQ", value: PIPELINES.ENTONNOIR },
              ...ownerFilter(),
              { propertyName: "hs_is_closed", operator: "EQ", value: "false" },
            ],
          },
        ],
        ["dealname", "dealstage", "notes_last_contacted", "notes_next_activity_date", "amount", "closedate", "hubspot_owner_id"],
        100
      ),

      searchDeals(
        [
          {
            filters: [
              { propertyName: "pipeline", operator: "EQ", value: PIPELINES.INBOUND },
              ...ownerFilter(),
              { propertyName: "hs_is_closed", operator: "EQ", value: "false" },
              {
                propertyName: "dealstage",
                operator: "IN",
                values: [
                  STAGES.INBOUND_SQL,
                  STAGES.INBOUND_1ER_SUIVI,
                  STAGES.INBOUND_2E_SUIVI,
                  STAGES.INBOUND_3E_SUIVI,
                ],
              },
            ],
          },
        ],
        ["dealname", "dealstage", "notes_last_contacted", "hubspot_owner_id"],
        100
      ),

      searchDeals(
        [
          {
            filters: [
              { propertyName: "pipeline", operator: "EQ", value: PIPELINES.OUTBOUND_COLD_EMAIL },
              ...ownerFilter(),
              { propertyName: "hs_is_closed", operator: "EQ", value: "false" },
              { propertyName: "dealstage", operator: "EQ", value: STAGES.OUTBOUND_NO_SHOW },
            ],
          },
        ],
        ["dealname", "notes_last_contacted", "hubspot_owner_id"],
        50
      ),

      searchDeals(
        [
          {
            filters: [
              { propertyName: "pipeline", operator: "EQ", value: PIPELINES.INBOUND },
              ...ownerFilter(),
              { propertyName: "hs_is_closed", operator: "EQ", value: "false" },
              { propertyName: "dealstage", operator: "EQ", value: STAGES.INBOUND_RV_PLANIFIE },
            ],
          },
        ],
        ["dealname", "closedate", "hubspot_owner_id"],
        50
      ),

      searchDeals(
        [
          {
            filters: [
              { propertyName: "pipeline", operator: "EQ", value: PIPELINES.OUTBOUND_COLD_EMAIL },
              ...ownerFilter(),
              { propertyName: "hs_is_closed", operator: "EQ", value: "false" },
              { propertyName: "dealstage", operator: "EQ", value: STAGES.OUTBOUND_RDV_PLANIFIE },
            ],
          },
        ],
        ["dealname", "closedate", "hubspot_owner_id"],
        50
      ),

      searchDeals(
        [
          {
            filters: [
              ...ownerFilter(),
              { propertyName: "hs_is_closed", operator: "EQ", value: "false" },
              {
                propertyName: "dealstage",
                operator: "IN",
                values: [
                  STAGES.REMIS_A_PLUS_TARD_ENTONNOIR,
                  STAGES.NE_BOUGE_PAS_ENTONNOIR,
                  STAGES.INBOUND_BOUGE_PAS,
                  STAGES.INBOUND_REMIS_A_PLUS_TARD,
                  STAGES.OUTBOUND_BOUGE_PAS,
                ],
              },
            ],
          },
        ],
        ["dealname", "dealstage", "notes_last_contacted", "notes_next_activity_date", "hs_v2_date_entered_current_stage", "hubspot_owner_id"],
        200
      ),

      searchDeals(
        [
          {
            filters: [
              { propertyName: "pipeline", operator: "EQ", value: PIPELINES.OUTBOUND_COLD_EMAIL },
              ...ownerFilter(),
              { propertyName: "hs_is_closed", operator: "EQ", value: "false" },
              {
                propertyName: "dealstage",
                operator: "IN",
                values: [STAGES.OUTBOUND_EN_SUIVI, STAGES.OUTBOUND_EMAIL],
              },
            ],
          },
        ],
        ["dealname", "dealstage", "notes_last_contacted", "hubspot_owner_id"],
        100
      ),

      isTeamView ? getOwnersMap() : Promise.resolve({} as Record<string, string>),

      // Team-wide monthly goal + actual — fetched regardless of repId, since
      // this is deliberately a single team-wide target, not per-rep. Wrapped
      // so a Sheet hiccup (e.g. current month's column not found yet) doesn't
      // take down the whole page.
      getMonthlyGoal().catch((e) => {
        console.warn("Skipping monthly goal (Sheet read failed):", e);
        return null;
      }),
      getClosedWonThisMonth().catch((e) => {
        console.warn("Skipping closed-won-this-month (HubSpot read failed):", e);
        return { count: 0, amount: 0 };
      }),
    ]);

    // Tasks require the crm.objects.tasks.read (and write, for completing them)
    // scope. If the key doesn't have it, this fails — we don't want that to
    // break the whole page, so it's fetched separately and degrades gracefully.
    let allTasks: Awaited<ReturnType<typeof getOpenTasks>> = [];
    let tasksDebugError: string | null = null;
    try {
      allTasks = await getOpenTasks(OWNER_ID, 200);
    } catch (e: any) {
      tasksDebugError = e.message;
      console.warn("Skipping tasks (likely missing scope):", e);
    }

    const startOfTomorrow = new Date();
    startOfTomorrow.setHours(24, 0, 0, 0);
    const endOfTomorrow = new Date();
    endOfTomorrow.setDate(endOfTomorrow.getDate() + 2);
    endOfTomorrow.setHours(0, 0, 0, 0);

    const overdueTaskList = allTasks.filter((t) => t.isOverdue);
    const upcomingTaskList = allTasks.filter((t) => {
      if (t.isOverdue || !t.dueDate) return false;
      const due = new Date(t.dueDate).getTime();
      return due >= Date.now() && due < endOfTomorrow.getTime();
    });

    // ---- P1: Deals qu'on ferme (sheet % >= 40, matched to HubSpot by name) ----
    const activeRepFirstName = activeRep.name.split(" ")[0].toLowerCase();
    const closingCandidates = isTeamView
      ? closingSheetRows.rows.filter((r) => r.closingPercent >= 40)
      : closingSheetRows.rows.filter((r) => {
          const section = r.repSection.trim().toLowerCase();
          return (section === activeRepFirstName || section === activeRep.name.toLowerCase()) && r.closingPercent >= 40;
        });
    const p1 = await Promise.all(
      closingCandidates.map(async (row) => {
        const match = entonnoirDeals.results.find((d) =>
          d.properties.dealname?.toLowerCase().includes(row.dealName.toLowerCase())
        );
        const contact = match ? await getPrimaryContact(match.id) : null;

        // Fireflies insight — only fetched for P1 (a handful of deals, not the
        // whole pipeline), so it doesn't slow down or risk timing out the
        // main page load. Matched by the contact's email(s) — someone can book
        // a meeting from a secondary address that isn't their primary CRM email,
        // so we try every known email for this contact, not just the first one.
        let fireflies: { insight: string; recordingLabel: string; link: string } | null = null;
        let firefliesDebug = "";
        if (!match) {
          firefliesDebug = `Aucun deal HubSpot trouvé dans l'Entonnoir de ventes correspondant au nom "${row.dealName}" (vérifie l'orthographe exacte, ou que le deal est bien dans cette pipeline).`;
        } else if (!contact) {
          firefliesDebug = "Deal HubSpot trouvé, mais aucun contact associé à ce deal.";
        } else if (contact.emails.length === 0) {
          firefliesDebug = "Le contact associé n'a aucune adresse courriel dans HubSpot.";
        } else {
          const triedEmails: string[] = [];
          for (const email of contact.emails) {
            triedEmails.push(email);
            try {
              const transcript = await findTranscriptByParticipant(email);
              if (transcript) {
                const summary = transcript.summary?.short_summary ?? "";
                const firstSentence = summary.split(/(?<=[.!?])\s/)[0] ?? summary;
                fireflies = {
                  insight: `🎙️ ${firstSentence}`,
                  recordingLabel: `${transcript.title} · ${new Date(transcript.date).toLocaleDateString("fr-CA")} · ${Math.round(transcript.duration)} min`,
                  link: firefliesRecordingUrl(transcript.id),
                };
                break;
              }
            } catch (e: any) {
              firefliesDebug = `Erreur Fireflies (${email}) : ${e.message}`;
              break;
            }
          }
          if (!fireflies && !firefliesDebug) {
            firefliesDebug = `Aucune transcription trouvée pour : ${triedEmails.join(", ")}.`;
          }
        }

        return {
          dealId: match?.id ?? null,
          name: row.dealName,
          pipeline: "entonnoir" as const,
          amount: row.amount,
          percent: row.closingPercent,
          note: row.note,
          dateSuivi: row.dateSuivi,
          phone: contact?.phone ?? null,
          hubspotUrl: match ? hubspotDealUrl(HUBSPOT_PORTAL_ID, match.id) : null,
          ownerName: match ? ownersMap[match.properties.hubspot_owner_id] || null : null,
          fireflies,
          firefliesDebug,
        };
      })
    );

    // ---- P1.5: Entonnoir de ventes, aucun suivi programmé ----
    const p1b = entonnoirDeals.results
      .filter((d) => {
        const next = d.properties.notes_next_activity_date;
        const days = daysSince(d.properties.notes_last_contacted);
        const overdueOrMissing = !next || new Date(next).getTime() < Date.now();
        return overdueOrMissing && days !== null && days >= 10;
      })
      .map((d) => ({
        dealId: d.id,
        name: d.properties.dealname,
        stage: d.properties.dealstage,
        stageLabel: STAGE_LABELS[d.properties.dealstage] || d.properties.dealstage,
        pipeline: "entonnoir" as const,
        days: daysSince(d.properties.notes_last_contacted),
        hubspotUrl: hubspotDealUrl(HUBSPOT_PORTAL_ID, d.id),
        ownerName: ownersMap[d.properties.hubspot_owner_id] || null,
      }))
      .sort((a, b) => (b.days ?? 0) - (a.days ?? 0));

    // ---- P2: Inbound first 4 stages, 48h+ no contact ----
    const p2 = inboundFreshDeals.results
      .filter((d) => {
        const h = hoursSince(d.properties.notes_last_contacted);
        return h === null || h > 48;
      })
      .map((d) => ({
        dealId: d.id,
        name: d.properties.dealname,
        stage: d.properties.dealstage,
        stageLabel: STAGE_LABELS[d.properties.dealstage] || d.properties.dealstage,
        pipeline: "inbound" as const,
        days: daysSince(d.properties.notes_last_contacted),
        hubspotUrl: hubspotDealUrl(HUBSPOT_PORTAL_ID, d.id),
        ownerName: ownersMap[d.properties.hubspot_owner_id] || null,
      }));

    // ---- P3: No Show, 48h+ no contact ----
    const p3 = outboundNoShowDeals.results
      .filter((d) => {
        const h = hoursSince(d.properties.notes_last_contacted);
        return h === null || h > 48;
      })
      .map((d) => ({
        dealId: d.id,
        name: d.properties.dealname,
        pipeline: "outbound" as const,
        hubspotUrl: hubspotDealUrl(HUBSPOT_PORTAL_ID, d.id),
        ownerName: ownersMap[d.properties.hubspot_owner_id] || null,
      }));

    // ---- P4: RV/RDV planifié, meeting date passed, stage unchanged ----
    const stalePlanned = [
      ...rvPlanifieInbound.results.map((d) => ({ ...d, __pipeline: "inbound" as const })),
      ...rdvPlanifieOutbound.results.map((d) => ({ ...d, __pipeline: "outbound" as const })),
    ]
      .filter((d) => d.properties.closedate && new Date(d.properties.closedate).getTime() < Date.now())
      .map((d) => ({
        dealId: d.id,
        name: d.properties.dealname,
        pipeline: d.__pipeline,
        meetingDate: d.properties.closedate,
        hubspotUrl: hubspotDealUrl(HUBSPOT_PORTAL_ID, d.id),
        ownerName: ownersMap[d.properties.hubspot_owner_id] || null,
      }));

    // ---- P5: Remis à plus tard / Bouge pas / tâches en retard ----
    const nettoyage = remisEtBougePas.results.map((d) => {
      const days = daysSince(d.properties.notes_last_contacted);
      const enteredStage = daysSince(d.properties.hs_v2_date_entered_current_stage);
      const isRemisAPlusTard = [
        STAGES.REMIS_A_PLUS_TARD_ENTONNOIR,
        STAGES.INBOUND_REMIS_A_PLUS_TARD,
      ].includes(d.properties.dealstage);

      // "Remis à plus tard" default 60-day recall window when no next activity is set
      const overdueRecall =
        isRemisAPlusTard &&
        !d.properties.notes_next_activity_date &&
        (enteredStage ?? 0) * 24 * 60 * 60 * 1000 >= DAYS_60;

      return {
        dealId: d.id,
        name: d.properties.dealname,
        stage: d.properties.dealstage,
        stageLabel: STAGE_LABELS[d.properties.dealstage] || d.properties.dealstage,
        pipeline: stageToPipeline(d.properties.dealstage),
        days,
        overdueRecall,
        hubspotUrl: hubspotDealUrl(HUBSPOT_PORTAL_ID, d.id),
        ownerName: ownersMap[d.properties.hubspot_owner_id] || null,
      };
    });

    // ---- P6: Outbound general cadence (En Suivi 48h / Email is a lower, weekly cadence) ----
    const p6 = outboundGeneral.results
      .filter((d) => {
        if (d.properties.dealstage === STAGES.OUTBOUND_EMAIL) return false; // weekly cadence, not shown as urgent here
        const h = hoursSince(d.properties.notes_last_contacted);
        return h === null || h > 48;
      })
      .map((d) => ({
        dealId: d.id,
        name: d.properties.dealname,
        stage: d.properties.dealstage,
        stageLabel: STAGE_LABELS[d.properties.dealstage] || d.properties.dealstage,
        pipeline: "outbound" as const,
        days: daysSince(d.properties.notes_last_contacted),
        hubspotUrl: hubspotDealUrl(HUBSPOT_PORTAL_ID, d.id),
        ownerName: ownersMap[d.properties.hubspot_owner_id] || null,
      }));

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      sheetTabUsed: closingSheetRows.tabUsed,
      salesReps: SALES_REPS,
      activeRep: isTeamView ? null : activeRep,
      p1_closing: p1,
      p1b_entonnoir_no_followup: {
        total: p1b.length,
        items: p1b.slice(0, 12),
      },
      p2_inbound_fresh: p2,
      p3_no_show: p3,
      p4_stale_planned_meetings: stalePlanned,
      p5_nettoyage: nettoyage,
      overdue_tasks: overdueTaskList,
      upcoming_tasks: upcomingTaskList,
      tasksDebugError,
      p6_outbound_general: p6,
      monthly_goal: monthlyGoal
        ? {
            monthLabel: monthlyGoal.monthLabel,
            tabUsed: monthlyGoal.tabUsed,
            dealCountTarget: monthlyGoal.dealCountTarget,
            dollarTarget: monthlyGoal.dollarTarget,
            dealCountActual: closedWonThisMonth.count,
            dollarActual: closedWonThisMonth.amount,
          }
        : null,
    });
  } catch (err: any) {
    console.error("Error building priorities:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
