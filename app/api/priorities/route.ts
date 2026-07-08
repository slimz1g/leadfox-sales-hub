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
  getOverdueTasks,
  getPrimaryContact,
  hubspotDealUrl,
  PIPELINES,
  STAGES,
} from "@/lib/hubspot";
import { getClosingRows } from "@/lib/googleSheet";
import { findTranscriptByParticipant, firefliesRecordingUrl } from "@/lib/fireflies";

const HUBSPOT_PORTAL_ID = process.env.HUBSPOT_PORTAL_ID!;
const OWNER_ID = process.env.HUBSPOT_OWNER_ID!; // Slim, for the solo deployment

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
    const scope = searchParams.get("scope") === "team" ? "team" : "mine";

    // Helper: include the owner filter only in "mine" scope. Spread this into
    // each filters array below so the same queries work for both scopes.
    const ownerFilter = () =>
      scope === "mine" ? [{ propertyName: "hubspot_owner_id", operator: "EQ" as const, value: OWNER_ID }] : [];

    // Calls run in parallel for speed (a serverless function has a hard time
    // limit — running everything sequentially risked timing out). Rate-limit
    // resilience now lives in lib/hubspot.ts (automatic retry on 429) instead
    // of manual delays here.
    let overdueTasksResult: { results: any[]; total: number } = { results: [], total: 0 };

    const [
      closingSheetRows,
      entonnoirDeals,
      inboundFreshDeals,
      outboundNoShowDeals,
      rvPlanifieInbound,
      rdvPlanifieOutbound,
      remisEtBougePas,
      outboundGeneral,
    ] = await Promise.all([
      getClosingRows(),

      searchDeals(
        [
          {
            filters: [
              { propertyName: "pipeline", operator: "EQ", value: PIPELINES.ENTONNOIR },
              { propertyName: "hs_is_closed", operator: "EQ", value: "false" },
              ...ownerFilter(),
            ],
          },
        ],
        ["dealname", "dealstage", "notes_last_contacted", "notes_next_activity_date", "amount", "closedate"],
        100
      ),

      searchDeals(
        [
          {
            filters: [
              { propertyName: "pipeline", operator: "EQ", value: PIPELINES.INBOUND },
              ...ownerFilter(),
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
        ["dealname", "dealstage", "notes_last_contacted"],
        100
      ),

      searchDeals(
        [
          {
            filters: [
              { propertyName: "pipeline", operator: "EQ", value: PIPELINES.OUTBOUND_COLD_EMAIL },
              ...ownerFilter(),
              { propertyName: "dealstage", operator: "EQ", value: STAGES.OUTBOUND_NO_SHOW },
            ],
          },
        ],
        ["dealname", "notes_last_contacted"],
        50
      ),

      searchDeals(
        [
          {
            filters: [
              { propertyName: "pipeline", operator: "EQ", value: PIPELINES.INBOUND },
              ...ownerFilter(),
              { propertyName: "dealstage", operator: "EQ", value: STAGES.INBOUND_RV_PLANIFIE },
            ],
          },
        ],
        ["dealname", "closedate"],
        50
      ),

      searchDeals(
        [
          {
            filters: [
              { propertyName: "pipeline", operator: "EQ", value: PIPELINES.OUTBOUND_COLD_EMAIL },
              ...ownerFilter(),
              { propertyName: "dealstage", operator: "EQ", value: STAGES.OUTBOUND_RDV_PLANIFIE },
            ],
          },
        ],
        ["dealname", "closedate"],
        50
      ),

      searchDeals(
        [
          {
            filters: [
              ...ownerFilter(),
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
        ["dealname", "dealstage", "notes_last_contacted", "notes_next_activity_date", "hs_v2_date_entered_current_stage"],
        200
      ),

      searchDeals(
        [
          {
            filters: [
              { propertyName: "pipeline", operator: "EQ", value: PIPELINES.OUTBOUND_COLD_EMAIL },
              ...ownerFilter(),
              {
                propertyName: "dealstage",
                operator: "IN",
                values: [STAGES.OUTBOUND_EN_SUIVI, STAGES.OUTBOUND_EMAIL],
              },
            ],
          },
        ],
        ["dealname", "dealstage", "notes_last_contacted"],
        100
      ),
    ]);

    // Overdue tasks require the crm.objects.tasks.read scope. If the key doesn't
    // have it, this fails — we don't want that to break the whole page, so it's
    // fetched separately and degrades gracefully to an empty list.
    try {
      overdueTasksResult = await getOverdueTasks(OWNER_ID, 200);
    } catch (e) {
      console.warn("Skipping overdue tasks (likely missing scope):", e);
    }
    const overdueTasks = overdueTasksResult;

    // ---- P1: Deals qu'on ferme (sheet % >= 40, matched to HubSpot by name) ----
    const closingCandidates = closingSheetRows.filter(
      (r) => r.repSection === "Slim" && r.closingPercent >= 40
    );
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
        if (!contact) {
          firefliesDebug = "Aucun contact associé trouvé sur ce deal HubSpot.";
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
        pipeline: "entonnoir" as const,
        days: daysSince(d.properties.notes_last_contacted),
        hubspotUrl: hubspotDealUrl(HUBSPOT_PORTAL_ID, d.id),
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
        pipeline: "inbound" as const,
        days: daysSince(d.properties.notes_last_contacted),
        hubspotUrl: hubspotDealUrl(HUBSPOT_PORTAL_ID, d.id),
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
        pipeline: stageToPipeline(d.properties.dealstage),
        days,
        overdueRecall,
        hubspotUrl: hubspotDealUrl(HUBSPOT_PORTAL_ID, d.id),
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
        pipeline: "outbound" as const,
        days: daysSince(d.properties.notes_last_contacted),
        hubspotUrl: hubspotDealUrl(HUBSPOT_PORTAL_ID, d.id),
      }));

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      p1_closing: p1,
      p1b_entonnoir_no_followup: {
        total: p1b.length,
        items: p1b.slice(0, 12),
      },
      p2_inbound_fresh: p2,
      p3_no_show: p3,
      p4_stale_planned_meetings: stalePlanned,
      p5_nettoyage: nettoyage,
      overdue_tasks: {
        total: overdueTasks.total,
        items: overdueTasks.results.slice(0, 10),
      },
      p6_outbound_general: p6,
    });
  } catch (err: any) {
    console.error("Error building priorities:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
