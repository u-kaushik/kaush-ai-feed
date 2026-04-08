import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'out', 'morning-email.html');
const envPath = path.join(root, '.env');

async function loadDotEnv() {
  try {
    const raw = await readFile(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index === -1) continue;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^['\"]|['\"]$/g, '');
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // optional local env file
  }
}

function parseBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

function buildSubject() {
  const prefix = process.env.DIGEST_SUBJECT_PREFIX || '[AI Digest]';
  const date = new Date().toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  return `${prefix} Morning briefing, ${date}`;
}

async function main() {
  await loadDotEnv();
  const html = await readFile(htmlPath, 'utf8');
  const host = requiredEnv('DIGEST_SMTP_HOST');
  const port = Number(process.env.DIGEST_SMTP_PORT || 587);
  const secure = parseBoolean(process.env.DIGEST_SMTP_SECURE, false);
  const user = requiredEnv('DIGEST_SMTP_USER');
  const pass = requiredEnv('DIGEST_SMTP_PASS');
  const to = requiredEnv('DIGEST_TO_EMAIL');
  const fromEmail = requiredEnv('DIGEST_FROM_EMAIL');
  const fromName = process.env.DIGEST_FROM_NAME || 'AI Digest';

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  await transporter.sendMail({
    from: `${fromName} <${fromEmail}>`,
    to,
    subject: buildSubject(),
    html,
    text: 'Your AI Digest HTML email is attached in the HTML body. If this client blocks HTML, open out/morning-email.html locally.',
  });

  console.log(`ai-digest: sent test email to ${to}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
