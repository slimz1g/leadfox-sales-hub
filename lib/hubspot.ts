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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * fetch() with automatic retries on HubSpot's 429 rate-limit response.
 * We keep requests running in parallel (fast — avoids the serverless function
 * timeout) but back off briefly and retry if HubSpot says "too fast". Two
 * retries with increasing backoff handles occasional double-429s that a
 * single retry didn't cover.
 */
async function fetchWithRetry(url: string, options: RequestInit): Promise<Response> {
  const delays = [1200, 2500];
  let res = await fetch(url, options);
  for (const delay of delays) {
    if (res.status !== 429) break;
    await sleep(delay);
    res = await fetch(url, options);
  }
  return res;
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
  const res = await fetchWithRetry(`${HUBSPOT_BASE}/crm/v3/objects/deals/search`, {
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

export type Task = {
  id: string;
  subject: string;
  dueDate: string | null;
  priority: string;
  type: string;
  isOverdue: boolean;
  dealId: string | null;
  dealName: string | null;
};

/**
 * Fetch all open (not completed) tasks for a given owner, with a limit high
 * enough to cover the real volume we've seen (150+ overdue tasks alone).
 * Classification into "overdue" vs "upcoming" happens by the caller using
 * `isOverdue` and `dueDate`.
 */
export async function getOpenTasks(ownerId: string, limit = 250): Promise<Task[]> {
  const now = Date.now();
  const endOfTomorrow = new Date();
  endOfTomorrow.setDate(endOfTomorrow.getDate() + 2);
  endOfTomorrow.setHours(0, 0, 0, 0);

  const res = await fetchWithRetry(`${HUBSPOT_BASE}/crm/v3/objects/tasks/search`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      // Two filter groups = OR'd together: overdue tasks, OR tasks due before
      // the end of tomorrow (covers "upcoming today/tomorrow"). Each group's
      // own filters are AND'd. hs_task_is_open wasn't a filterable/indexed
      // property in testing, so we go back to the field we know works.
      filterGroups: [
        {
          filters: [
            { propertyName: "hubspot_owner_id", operator: "EQ", value: ownerId },
            { propertyName: "hs_task_is_overdue", operator: "EQ", value: "true" },
          ],
        },
        {
          filters: [
            { propertyName: "hubspot_owner_id", operator: "EQ", value: ownerId },
            { propertyName: "hs_task_status", operator: "NEQ", value: "COMPLETED" },
            { propertyName: "hs_timestamp", operator: "LT", value: String(endOfTomorrow.getTime()) },
            { propertyName: "hs_timestamp", operator: "GTE", value: String(now) },
          ],
        },
      ],
      properties: ["hs_task_subject", "hs_timestamp", "hs_task_status", "hs_task_priority", "hs_task_type", "hs_task_is_overdue"],
      sorts: [{ propertyName: "hs_timestamp", direction: "ASCENDING" }],
      limit,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HubSpot task search failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  const rawTasks: any[] = data.results ?? [];
  if (rawTasks.length === 0) return [];

  // Batch-resolve which deal each task is associated with (one call for all
  // tasks, instead of one call per task — critical given the volume here).
  const assocRes = await fetchWithRetry(`${HUBSPOT_BASE}/crm/v3/associations/tasks/deals/batch/read`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ inputs: rawTasks.map((t) => ({ id: t.id })) }),
  });
  const dealIdByTaskId: Record<string, string> = {};
  if (assocRes.ok) {
    const assocData = await assocRes.json();
    for (const result of assocData.results ?? []) {
      const dealId = result.to?.[0]?.toObjectId ?? result.to?.[0]?.id;
      if (dealId) dealIdByTaskId[result.from.id] = String(dealId);
    }
  }

  // Batch-resolve deal names for every unique deal id found above.
  const uniqueDealIds = [...new Set(Object.values(dealIdByTaskId))];
  const dealNameById: Record<string, string> = {};
  if (uniqueDealIds.length > 0) {
    const dealsRes = await fetchWithRetry(`${HUBSPOT_BASE}/crm/v3/objects/deals/batch/read`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        properties: ["dealname"],
        inputs: uniqueDealIds.map((id) => ({ id })),
      }),
    });
    if (dealsRes.ok) {
      const dealsData = await dealsRes.json();
      for (const d of dealsData.results ?? []) {
        dealNameById[d.id] = d.properties?.dealname ?? null;
      }
    }
  }

  return rawTasks.map((t) => {
    const dealId = dealIdByTaskId[t.id] ?? null;
    return {
      id: t.id,
      subject: t.properties.hs_task_subject,
      dueDate: t.properties.hs_timestamp ?? null,
      priority: t.properties.hs_task_priority,
      type: t.properties.hs_task_type,
      isOverdue: t.properties.hs_task_is_overdue === "true",
      dealId,
      dealName: dealId ? dealNameById[dealId] ?? null : null,
    };
  });
}

/**
 * Marks a task as completed in HubSpot. Called when the person explicitly
 * clicks "Marquer comme fait" on the dashboard — this is a real write to
 * HubSpot, not just a local dismissal.
 */
export async function completeTask(taskId: string): Promise<void> {
  const res = await fetchWithRetry(`${HUBSPOT_BASE}/crm/v3/objects/tasks/${taskId}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ properties: { hs_task_status: "COMPLETED" } }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HubSpot task update failed (${res.status}): ${body}`);
  }
}

/**
 * Get the first associated contact's phone number for a deal, for the
 * click-to-call (Aircall tel: link) buttons.
 */
export async function getPrimaryContactPhone(dealId: string): Promise<string | null> {
  const contact = await getPrimaryContact(dealId);
  return contact?.phone ?? null;
}

/**
 * Get the first associated contact's phone AND all known emails (primary +
 * secondary) for a deal. HubSpot stores secondary emails separately from the
 * primary "email" property — someone can book a meeting from an address that
 * isn't their primary CRM email, so we need to try all of them against
 * Fireflies, not just the first one.
 */
export async function getPrimaryContact(
  dealId: string
): Promise<{ phone: string | null; email: string | null; emails: string[] } | null> {
  const assocRes = await fetchWithRetry(
    `${HUBSPOT_BASE}/crm/v3/objects/deals/${dealId}/associations/contacts`,
    { headers: authHeaders() }
  );
  if (!assocRes.ok) return null;
  const assocData = await assocRes.json();
  const contactId = assocData.results?.[0]?.id;
  if (!contactId) return null;

  const contactRes = await fetchWithRetry(
    `${HUBSPOT_BASE}/crm/v3/objects/contacts/${contactId}?properties=phone,mobilephone,email,hs_additional_emails`,
    { headers: authHeaders() }
  );
  if (!contactRes.ok) return null;
  const contact = await contactRes.json();
  const phone = contact.properties?.phone || contact.properties?.mobilephone || null;
  const email = contact.properties?.email || null;
  const additional: string[] = (contact.properties?.hs_additional_emails || "")
    .split(";")
    .map((e: string) => e.trim())
    .filter(Boolean);

  const emails = [email, ...additional].filter((e): e is string => !!e);
  return { phone, email, emails };
}

export function hubspotDealUrl(portalId: string, dealId: string) {
  return `https://app.hubspot.com/contacts/${portalId}/record/0-3/${dealId}`;
}

/**
 * Fetch all owners once and build an id → display name map. Used to show
 * "who owns this deal" in the "Toute l'équipe" view without an extra API
 * call per deal (we just add hubspot_owner_id to the properties we already
 * request, then resolve names client-side from this map).
 */
export async function getOwnersMap(): Promise<Record<string, string>> {
  const res = await fetchWithRetry(`${HUBSPOT_BASE}/crm/v3/owners?limit=200`, {
    headers: authHeaders(),
  });
  if (!res.ok) return {};
  const data = await res.json();
  const map: Record<string, string> = {};
  for (const owner of data.results ?? []) {
    const name = [owner.firstName, owner.lastName].filter(Boolean).join(" ") || owner.email;
    map[String(owner.id)] = name;
  }
  return map;
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
