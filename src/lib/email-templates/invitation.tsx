import * as React from 'react'
import { Button, Text } from '@react-email/components'
import { BrandLayout, styles, brand } from './_brand'
import type { TemplateEntry } from './registry'

interface Props {
  companyName?: string
  role?: string
  invitedByEmail?: string | null
  acceptUrl?: string
}

const roleLabelAr: Record<string, string> = {
  finance: 'مالية',
  shariah: 'مراجعة شرعية',
  trader: 'تداول',
  viewer: 'مطّلع',
  owner: 'مالك',
}

const InvitationEmail = ({
  companyName = 'شركتك',
  role = 'trader',
  invitedByEmail,
  acceptUrl = '#',
}: Props) => (
  <BrandLayout preview={`دعوة للانضمام إلى ${companyName} على وحدة القيمة`} lang="ar">
    <Text style={styles.h1En}>You are invited</Text>
    <Text style={styles.h1}>دعوة للانضمام إلى {companyName}</Text>
    <Text style={styles.text}>
      تمّت دعوتك{invitedByEmail ? ` من ${invitedByEmail}` : ''} للانضمام إلى{' '}
      <strong>{companyName}</strong> على منصّة <strong>وحدة القيمة</strong> بصلاحية{' '}
      <strong>{roleLabelAr[role] ?? role}</strong>.
    </Text>
    <Text style={styles.textEn}>
      You've been invited to join <strong>{companyName}</strong> on Value Unit as{' '}
      <strong>{role}</strong>.
    </Text>
    <div style={styles.buttonWrap}>
      <Button style={styles.button} href={acceptUrl}>
        قبول الدعوة · Accept Invitation
      </Button>
    </div>
    <Text style={{ ...styles.textEn, marginTop: 22, color: brand.inkSoft }}>
      تنتهي هذه الدعوة خلال 7 أيام.
      <br />
      This invitation expires in 7 days.
    </Text>
  </BrandLayout>
)

export const template = {
  component: InvitationEmail,
  subject: (d: Record<string, any>) =>
    `دعوة للانضمام إلى ${d.companyName ?? 'وحدة القيمة'} — Invitation`,
  displayName: 'Company invitation',
  previewData: {
    companyName: 'مثال — Example Co.',
    role: 'trader',
    invitedByEmail: 'owner@example.com',
    acceptUrl: 'https://hub.sunkvalue.com/invitations?token=preview',
  },
} satisfies TemplateEntry

export default InvitationEmail