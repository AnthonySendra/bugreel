import nodemailer from 'nodemailer'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

interface EmailMessage {
  to: string
  subject: string
  html: string
}

interface EmailProvider {
  send(message: EmailMessage): Promise<void>
}

function createSmtpProvider(): EmailProvider {
  const host = process.env.NUXT_EMAIL_SMTP_HOST
  const port = parseInt(process.env.NUXT_EMAIL_SMTP_PORT || '587', 10)
  const user = process.env.NUXT_EMAIL_SMTP_USER
  const pass = process.env.NUXT_EMAIL_SMTP_PASS

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user ? { user, pass } : undefined,
  })

  return {
    async send(message: EmailMessage) {
      await transporter.sendMail({
        from: process.env.NUXT_EMAIL_FROM,
        to: message.to,
        subject: message.subject,
        html: message.html,
      })
    },
  }
}

function createResendProvider(): EmailProvider {
  const apiKey = process.env.NUXT_EMAIL_RESEND_API_KEY

  return {
    async send(message: EmailMessage) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.NUXT_EMAIL_FROM,
          to: message.to,
          subject: message.subject,
          html: message.html,
        }),
      })
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`Resend API error ${res.status}: ${body}`)
      }
    },
  }
}

function createConsoleProvider(): EmailProvider {
  return {
    async send(message: EmailMessage) {
      console.log(`[email-console] To: ${message.to}`)
      console.log(`[email-console] Subject: ${message.subject}`)
      console.log(`[email-console] Body:\n${message.html}\n`)
    },
  }
}

// Resolve provider once at startup
const providerName = process.env.NUXT_EMAIL_PROVIDER || ''

let provider: EmailProvider | null = null

if (providerName === 'smtp') {
  provider = createSmtpProvider()
} else if (providerName === 'resend') {
  provider = createResendProvider()
} else if (providerName === 'console') {
  provider = createConsoleProvider()
}

/** Whether email sending is configured (any provider set) */
export function isEmailEnabled(): boolean {
  return provider !== null
}

/** Send an email. No-op if email is not configured. */
export async function sendEmail(message: EmailMessage): Promise<void> {
  if (!provider) return
  await provider.send(message)
}

// ── Email template helpers ──────────────────────────────────────────

function baseUrl(): string {
  return process.env.NUXT_PUBLIC_BASE_URL || 'http://localhost:7777'
}

export function sendVerificationEmail(to: string, token: string): Promise<void> {
  const url = `${baseUrl()}/verify-email?token=${token}`
  return sendEmail({
    to,
    subject: 'Verify your email — Bugreel',
    html: `
      <h2>Welcome to Bugreel!</h2>
      <p>Click the link below to verify your email address:</p>
      <p><a href="${esc(url)}">${esc(url)}</a></p>
      <p>This link expires in 24 hours.</p>
    `,
  })
}

export function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const url = `${baseUrl()}/auth/reset-password?token=${token}`
  return sendEmail({
    to,
    subject: 'Reset your password — Bugreel',
    html: `
      <h2>Password Reset</h2>
      <p>Click the link below to reset your password:</p>
      <p><a href="${esc(url)}">${esc(url)}</a></p>
      <p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>
    `,
  })
}

export function sendWorkspaceInviteEmail(to: string, workspaceName: string, inviterEmail: string): Promise<void> {
  const url = baseUrl()
  return sendEmail({
    to,
    subject: `You've been invited to "${workspaceName}" — Bugreel`,
    html: `
      <h2>Workspace Invitation</h2>
      <p><strong>${esc(inviterEmail)}</strong> invited you to join the workspace <strong>${esc(workspaceName)}</strong> on Bugreel.</p>
      <p><a href="${esc(url)}">Open Bugreel</a></p>
    `,
  })
}

export function sendCommentReplyEmail(to: string, reelId: string, commenterEmail: string, commentContent: string): Promise<void> {
  const url = `${baseUrl()}/reel/${reelId}`
  return sendEmail({
    to,
    subject: `New reply in a thread you're part of — Bugreel`,
    html: `
      <h2>New Reply</h2>
      <p><strong>${esc(commenterEmail)}</strong> replied in a comment thread you're part of:</p>
      <blockquote style="border-left:3px solid #ff4070;padding:8px 12px;margin:12px 0;color:#555">${esc(commentContent)}</blockquote>
      <p><a href="${esc(url)}">View the reel</a></p>
    `,
  })
}

export function sendNewCommentOnReelEmail(to: string, reelId: string, commenterEmail: string, commentContent: string): Promise<void> {
  const url = `${baseUrl()}/reel/${reelId}`
  return sendEmail({
    to,
    subject: `New comment on your reel — Bugreel`,
    html: `
      <h2>New Comment</h2>
      <p><strong>${esc(commenterEmail)}</strong> commented on your reel:</p>
      <blockquote style="border-left:3px solid #ff4070;padding:8px 12px;margin:12px 0;color:#555">${esc(commentContent)}</blockquote>
      <p><a href="${esc(url)}">View the reel</a></p>
    `,
  })
}
