// lib/googleSheet.ts
// Reads the "Pipeline vendeur" Google Sheet for closing %, notes, and follow-up dates.
// Uses a Google Service Account (server-side only) — the sheet must be shared with the
// service account's email (found in your service account JSON as "client_email").
// This avoids a full per-user OAuth flow, which is overkill for a solo internal tool.

import { google } from "googleapis";

const SHEET_ID = "1-TicSgs0Ds6-_6DOZ1m-7Bm2LVCM5eqNcFoe4-lJZBI";
const SHEET_TAB = "Pipeline vendeur - juil '26"; // ⚠️ this tab name changes monthly — see note below

export type ClosingRow = {
  dealName: string;
  amount: string;
  closingPercent: number;
  note: string;
  dateSuivi: string;
  repSection: string; // which "rep header" this row falls under in the sheet
};

function getAuth() {
  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountKey) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set in the environment.");
  }
  const credentials = JSON.parse(serviceAccountKey);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

/**
 * Reads the sheet and returns rows grouped under their rep section header
 * (e.g. "Slim", "Alexandre Paquet"), stopping logic mirrors what we found
 * manually: a bare name in column A with no other columns filled = a new
 * rep section starts.
 */
export async function getClosingRows(): Promise<ClosingRow[]> {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const range = `'${SHEET_TAB}'!A13:L200`; // starts after the header row we found at row 13
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range,
  });

  const rows = res.data.values ?? [];
  const parsed: ClosingRow[] = [];
  let currentRep = "";

  for (const row of rows) {
    const [name, amount, percent, , , , , , , note, dateSuivi] = row;
    if (!name) continue;

    const isRepHeader = !amount && !percent; // bare name row = new rep section
    if (isRepHeader) {
      currentRep = name.trim();
      continue;
    }

    parsed.push({
      dealName: name.trim(),
      amount: amount ?? "",
      closingPercent: percent ? parseFloat(String(percent).replace("%", "").replace(",", ".")) : 0,
      note: note ?? "",
      dateSuivi: dateSuivi ?? "",
      repSection: currentRep,
    });
  }

  return parsed;
}

/**
 * ⚠️ Known limitation: the sheet tab is named per-month ("Pipeline vendeur - juil '26"),
 * and history shows a new tab is created monthly (juin '26, mai '26, etc.). This will
 * silently break at the start of each month. Options for later:
 *   1. List all sheet tabs via spreadsheets.get and pick the most recent "Pipeline vendeur - *" tab automatically
 *   2. Ask the team to stop renaming tabs monthly and just keep one running tab
 * Flagging here rather than solving now — worth a decision before this ships.
 */
