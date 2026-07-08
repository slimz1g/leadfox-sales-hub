// lib/fireflies.ts
// Real Fireflies.ai GraphQL API client. Server-side only.

const FIREFLIES_ENDPOINT = "https://api.fireflies.ai/graphql";

function authHeaders() {
  const apiKey = process.env.FIREFLIES_API_KEY;
  if (!apiKey) {
    throw new Error("FIREFLIES_API_KEY is not set in the environment.");
  }
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

export type FirefliesTranscript = {
  id: string;
  title: string;
  date: string;
  duration: number;
  summary: {
    short_summary: string;
    action_items: string;
  } | null;
};

/**
 * Find the most recent transcript for a given contact email. This is the most
 * reliable match today (better than searching by name, which can collide).
 *
 * ⚠️ Known limitation: this does a live search per deal card, which doesn't scale
 * well if the dashboard shows many deals at once. The better long-term fix is a
 * stored Fireflies transcript link per HubSpot deal (the person mentioned HubSpot
 * already has Fireflies recording links added to some deals) — check for a HubSpot
 * property like `fireflies_recording_url` or similar before falling back to search.
 */
export async function findTranscriptByParticipant(
  email: string
): Promise<FirefliesTranscript | null> {
  const query = `
    query Transcripts($participantEmail: String) {
      transcripts(participant_email: $participantEmail, limit: 1) {
        id
        title
        date
        duration
        summary {
          short_summary
          action_items
        }
      }
    }
  `;

  const res = await fetch(FIREFLIES_ENDPOINT, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ query, variables: { participantEmail: email } }),
  });

  if (!res.ok) {
    throw new Error(`Fireflies API error (${res.status}): ${await res.text()}`);
  }

  const { data, errors } = await res.json();
  if (errors) throw new Error(`Fireflies GraphQL error: ${JSON.stringify(errors)}`);

  const transcript = data?.transcripts?.[0];
  return transcript ?? null;
}

export function firefliesRecordingUrl(transcriptId: string) {
  return `https://app.fireflies.ai/view/${transcriptId}`;
}
