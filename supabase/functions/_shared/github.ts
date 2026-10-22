import { SignJWT, importPKCS8 } from 'npm:jose@5';

const GITHUB_API = 'https://api.github.com';

function appId(): string {
  const value = Deno.env.get('GITHUB_APP_ID');
  if (!value) {
    throw new Error('ENV_MISSING:GITHUB_APP_ID');
  }
  return value;
}

function privateKey(): string {
  const value = Deno.env.get('GITHUB_APP_PRIVATE_KEY');
  if (!value) {
    throw new Error('ENV_MISSING:GITHUB_APP_PRIVATE_KEY');
  }
  // Les secrets Supabase conservent souvent les \n littéraux.
  const normalized = value.replace(/\\n/g, '\n');
  // GitHub télécharge une clé PKCS#1 ; jose.importPKCS8 exige du PKCS#8.
  if (!normalized.includes('BEGIN PRIVATE KEY')) {
    throw new Error(
      'GITHUB_APP_PRIVATE_KEY_FORMAT: convertir la clé PKCS#1 en PKCS#8 avec ' +
        '`openssl pkcs8 -topk8 -nocrypt -in github-app.pem -out github-app-pkcs8.pem`',
    );
  }
  return normalized;
}

async function createAppJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(privateKey(), 'RS256');
  return await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(appId())
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 540)
    .sign(key);
}

/** Jeton d'installation GitHub App, valable une heure. */
export async function installationToken(installationId: number): Promise<string> {
  const jwt = await createAppJwt();
  const response = await fetch(
    `${GITHUB_API}/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );

  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`GITHUB_TOKEN_${response.status}: ${body}`);
  }

  const data = await response.json() as { token?: string };
  if (!data.token) {
    throw new Error('GITHUB_TOKEN_MISSING');
  }
  return data.token;
}

export async function dispatchWorkflow(options: {
  token: string;
  repoFullName: string;
  workflowFile: string;
  ref: string;
  inputs: Record<string, string>;
}): Promise<void> {
  const { token, repoFullName, workflowFile, ref, inputs } = options;
  const workflow = encodeURIComponent(workflowFile);
  const response = await fetch(
    `${GITHUB_API}/repos/${repoFullName}/actions/workflows/${workflow}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref, inputs }),
    },
  );

  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`GITHUB_DISPATCH_${response.status}: ${body}`);
  }
}
