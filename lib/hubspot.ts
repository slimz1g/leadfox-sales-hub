// lib/hubspot.ts
// Real HubSpot API client. Server-side only — never import this from a client component,
// since HUBSPOT_PRIVATE_APP_TOKEN must stay secret.

const HUBSPOT_BASE = "https://api.hubapi.com";

function authHeaders() {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) {
    throw new Error("HUBSPOT_PRIVATE_APP_TOKEN is not set in the environment.");
  }
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export type DealFilter = {
  propertyName: string;
  operator: "EQ" | "NEQ" | "LT" | "LTE" | "GT" | "GTE" | "IN" | "NOT_IN" | "HAS_PROPERTY" | "NOT_HAS_PROPERTY";
  value?: string;
  values?: string[];
};

export type Deal = {
  id: string;
  properties: Record<string, string>;
};

/**
 * Search deals with property filters. Mirrors the filterGroups shape used
 * throughout our HubSpot discovery work (AND within a group, OR across groups).
 */
export async function searchDeals(
  filterGroups: { filters: DealFilter[] }[],
  properties: string[],
  limit = 100
): Promise<{ results: Deal[]; total: number }> {
  const res = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/deals/search`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ filterGroups, properties, limit }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HubSpot deal search failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return { results: data.results ?? [], total: data.total ?? 0 };
}

/**
 * Fetch overdue tasks (hs_task_is_overdue = true) for a given owner.
 */
export async function getOverdueTasks(ownerId: string, limit = 100) {
  const res = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/tasks/search`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [
            { propertyName: "hubspot_owner_id", operator: "EQ", value: ownerId },
            { propertyName: "hs_task_is_overdue", operator: "EQ", value: "true" },
          ],
        },
      ],
      properties: ["hs_task_subject", "hs_timestamp", "hs_task_status", "hs_task_priority", "hs_task_type"],
      limit,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HubSpot task search failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return { results: data.results ?? [], total: data.total ?? 0 };
}

/**
 * Get the first associated contact's phone number for a deal, for the
 * click-to-call (Aircall tel: link) buttons.
 */
export async function getPrimaryContactPhone(dealId: string): Promise<string | null> {
  const assocRes = await fetch(
    `${HUBSPOT_BASE}/crm/v3/objects/deals/${dealId}/associations/contacts`,
    { headers: authHeaders() }
  );
  if (!assocRes.ok) return null;
  const assocData = await assocRes.json();
  const contactId = assocData.results?.[0]?.id;
  if (!contactId) return null;

  const contactRes = await fetch(
    `${HUBSPOT_BASE}/crm/v3/objects/contacts/${contactId}?properties=phone,mobilephone`,
    { headers: authHeaders() }
  );
  if (!contactRes.ok) return null;
  const contact = await contactRes.json();
  const phone = contact.properties?.phone || contact.properties?.mobilephone;
  return phone || null;
}

export function hubspotDealUrl(portalId: string, dealId: string) {
  return `https://app.hubspot.com/contacts/${portalId}/record/0-3/${dealId}`;
}

// Pipeline + stage IDs discovered during the design phase (see reference doc).
export const PIPELINES = {
  ENTONNOIR: "2041621",
  INBOUND: "3649420",
  OUTBOUND_COLD_EMAIL: "863513235",
};

export const STAGES = {
  NEGO_EN_COURS: "3377465",
  REMIS_A_PLUS_TARD_ENTONNOIR: "3377466",
  RV_REALISE: "2041623",
  NE_BOUGE_PAS_ENTONNOIR: "127152554",
  GHOSTING: "59133512",
  INBOUND_SQL: "3649421",
  INBOUND_1ER_SUIVI: "3649422",
  INBOUND_2E_SUIVI: "3649423",
  INBOUND_3E_SUIVI: "3649424",
  INBOUND_BOUGE_PAS: "59187110",
  INBOUND_REMIS_A_PLUS_TARD: "181089388",
  INBOUND_RV_PLANIFIE: "5246379",
  OUTBOUND_EMAIL: "1291665788",
  OUTBOUND_EN_SUIVI: "1291665784",
  OUTBOUND_RDV_PLANIFIE: "1291665785",
  OUTBOUND_NO_SHOW: "1294421337",
  OUTBOUND_BOUGE_PAS: "1294334843",
};
