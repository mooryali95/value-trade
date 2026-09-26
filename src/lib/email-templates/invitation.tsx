import * as React from 'react'
import { Button, Text } from '@react-email/components'
import { BrandLayout, styles, brand } from './_brand'
import type { TemplateEntry } from './registry'

interface Props {
  /** Company name in Arabic and English (the e-mail is bilingual). */
  companyNameAr?: string | null
  companyNameEn?: string | null
  /** Legacy single name (older queued messages). */
  companyName?: string | null
  role?: string
  invitedByEmail?: string | null
  acceptUrl?: string
  /** ISO timestamp of the invitation's expiry. */
  expiresAt?: string | null
}

// Same labels as the app (src/lib/tenants/role-labels.ts, r_role* keys).
const ROLE_AR: Record<string, string> = {
  owner: 'مالك الشركة',
  finance: 'المالية',
  shariah: 'المراجعة الشرعية',
  trader: 'مكتب التداول',
  viewer: 'مطّلع',
}
const ROLE_EN: Record<string, string> = {
  owner: 'Owner',
  finance: 'Finance',
  shariah: 'Shariah review',
  trader: 'Trading desk',
  viewer: 'Viewer',
}

function fmtDate(iso: string | null | undefined, locale: 'ar' | 'en'): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  try {
    return d.toLocaleDateString(locale === 'ar' ? 'ar' : 'en-GB', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'Asia/Riyadh',
    })
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

const InvitationEmail = ({
  companyNameAr,
  companyNameEn,
  companyName,
  role = 'viewer',
  invitedByEmail,
  acceptUrl = '#',
  expiresAt,
}: Props) => {
  const nameAr = companyNameAr || companyName || companyNameEn || 'الشركة'
  const nameEn = companyNameEn || companyName || companyNameAr || 'the company'
  const roleAr = ROLE_AR[role] ?? ROLE_AR.viewer
  const roleEn = ROLE_EN[role] ?? ROLE_EN.viewer
  const untilAr = fmtDate(expiresAt, 'ar')
  const untilEn = fmtDate(expiresAt, 'en')
  return (
    <BrandLayout preview={`دعوة للانضمام إلى ${nameAr} على وحدة القيمة`} lang="ar">
      <Text style={styles.h1En}>You are invited</Text>
      <Text style={styles.h1}>دعوة للانضمام إلى {nameAr}</Text>
      <Text style={styles.text}>
        تلقّيت دعوة{invitedByEmail ? <> من <span dir="ltr">{invitedByEmail}</span></> : null} للانضمام إلى{' '}
        <strong>{nameAr}</strong> على منصة <strong>وحدة القيمة</strong> بدور <strong>{roleAr}</strong>.
        اضغط الزر أدناه لفتح الدعوة؛ وإن لم يكن لديك حساب بعد، فستتمكن من إنشائه وتعيين كلمة المرور من الصفحة نفسها.
      </Text>
      <Text style={styles.textEn} dir="ltr">
        You have been invited to join <strong>{nameEn}</strong> on Value Unit as <strong>{roleEn}</strong>.
        Open the invitation below; if you do not have an account yet, you can create one and set your
        password from the same page.
      </Text>
      <div style={styles.buttonWrap}>
        <Button style={styles.button} href={acceptUrl}>
          فتح الدعوة · Open invitation
        </Button>
      </div>
      <Text style={{ ...styles.textEn, marginTop: 22, color: brand.inkSoft }}>
        {untilAr ? `الدعوة صالحة حتى ${untilAr}، ولا تُقبل إلا من الحساب المسجّل بهذا البريد الإلكتروني.` : 'الدعوة صالحة لمدة 7 أيام، ولا تُقبل إلا من الحساب المسجّل بهذا البريد الإلكتروني.'}
        <br />
        <span dir="ltr">
          {untilEn
            ? `The invitation is valid until ${untilEn} and can only be accepted by the account registered with this email address.`
            : 'The invitation is valid for 7 days and can only be accepted by the account registered with this email address.'}
        </span>
      </Text>
      <Text style={{ ...styles.textEn, color: brand.muted }}>
        إن لم تكن تتوقع هذه الدعوة فتجاهل الرسالة.
        <br />
        <span dir="ltr">If you were not expecting this invitation, you can ignore this email.</span>
      </Text>
    </BrandLayout>
  )
}

export const template = {
  component: InvitationEmail,
  subject: (d: Record<string, any>) =>
    `دعوة للانضمام إلى ${d.companyNameAr || d.companyName || d.companyNameEn || 'شركة'} · Invitation to join ${d.companyNameEn || d.companyName || d.companyNameAr || 'a company'} — وحدة القيمة`,
  displayName: 'Company invitation',
  previewData: {
    companyNameAr: 'شركة مثال',
    companyNameEn: 'Example Co.',
    role: 'finance',
    acceptUrl: 'https://hub.sunkvalue.com/invite/00000000-0000-4000-8000-000000000000',
    expiresAt: '2026-10-01T12:00:00Z',
  },
} satisfies TemplateEntry

export default InvitationEmail
