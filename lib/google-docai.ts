import { JWT } from 'google-auth-library';

function loadServiceAccount(): any | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  const trimmed = raw.trim();
  try {
    if (trimmed.startsWith('{')) return JSON.parse(trimmed);
    // otherwise assume base64
    return JSON.parse(Buffer.from(trimmed, 'base64').toString('utf8'));
  } catch (e) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON or base64-encoded JSON');
  }
}

let cachedJwt: JWT | null = null;
function getAuthClient(): JWT {
  if (cachedJwt) return cachedJwt;
  const sa = loadServiceAccount();
  if (!sa) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set');
  cachedJwt = new JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  return cachedJwt;
}

export function isDocAiConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLOUD_PROJECT_ID &&
    process.env.GOOGLE_CLOUD_LOCATION &&
    process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID &&
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  );
}

export type OcrResult = {
  text: string;
  pageCount: number;
  mimeType: string;
};

export async function ocrDocument(
  bytes: Buffer,
  mimeType: string = 'application/pdf'
): Promise<OcrResult> {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  const location = process.env.GOOGLE_CLOUD_LOCATION || 'us';
  const processorId = process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID;
  if (!projectId || !processorId) throw new Error('Document AI env vars are not set');

  const auth = getAuthClient();
  // google-auth-library v10+ returns { token, res } — not a plain string.
  // Normalise so `Bearer <token>` is always a real OAuth access token.
  const tokenResp = await auth.getAccessToken();
  const token = typeof tokenResp === 'string' ? tokenResp : tokenResp?.token;
  if (!token) throw new Error('Failed to get Google access token');

  const url = `https://${location}-documentai.googleapis.com/v1/projects/${projectId}/locations/${location}/processors/${processorId}:process`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      rawDocument: {
        content: bytes.toString('base64'),
        mimeType,
      },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    // Log the full body server-side so we can diagnose auth errors from logs.
    console.error('[google-docai] Document AI error:', {
      status: res.status,
      projectId,
      location,
      processorId,
      url,
      body: errBody,
    });
    throw new Error(`Document AI ${res.status}: ${errBody.slice(0, 2000)}`);
  }

  const data = await res.json();
  const doc = data?.document;
  const text: string = doc?.text || '';
  const pageCount: number = Array.isArray(doc?.pages) ? doc.pages.length : 0;
  return { text, pageCount, mimeType };
}
