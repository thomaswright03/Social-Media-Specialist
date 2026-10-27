// Reports to Hitta, Thomas's personal assistant that calls him. The Social
// Media Specialist reports only what needs him: new posts waiting for his OK
// (normal, once a day), an approved post Instagram refused (normal), and a
// specialist that can't do its job, like an expired Instagram token (normal).
// A post going out as planned is routine and isn't reported. Hitta reads the
// title and summary aloud, so they're plain sentences with no markdown or
// links.
//
// Needs HITTA_API_KEY (the specialist's own key). A 201 means Hitta got it; a
// 401 means the key is wrong.

export type HittaUrgency = "urgent" | "normal" | "low";

export type HittaReport = {
  project: string;
  /** One line, heard first. */
  title: string;
  /** Two to five sentences: what happened, what's needed, key numbers or dates. */
  summary: string;
  /** urgent: Hitta calls right away. normal: next time Thomas talks to Hitta. low: FYI. */
  urgency: HittaUrgency;
};

export const HITTA_URL = "https://34-67-123-90.sslip.io/reports";
export const HITTA_PROJECT = "Social Media Specialist";

export type HittaResult = { ok: boolean; status: number | null; message: string };

const HITTA_TIMEOUT_MS = 15_000;

export async function sendHittaReport(report: HittaReport, fetchImpl: typeof fetch = fetch): Promise<HittaResult> {
  const key = process.env.HITTA_API_KEY?.trim();
  if (!key) return { ok: false, status: null, message: "HITTA_API_KEY isn't set." };
  let res: Response;
  try {
    res = await fetchImpl(HITTA_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(HITTA_TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, status: null, message: `Hitta couldn't be reached: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (res.status === 201) return { ok: true, status: 201, message: "Hitta got it (201)." };
  if (res.status === 401) return { ok: false, status: 401, message: "Hitta refused the key (401): HITTA_API_KEY is wrong." };
  const text = await res.text().catch(() => "");
  return { ok: false, status: res.status, message: `Hitta answered ${res.status}: ${text.slice(0, 200)}` };
}
