import * as React from 'react'
import { Button, Text } from '@react-email/components'
import { BrandLayout, styles, brand } from './_brand'
import type { TemplateEntry } from './registry'

interface Props {
  symbol?: string
  status?: 'halal' | 'non_halal' | 'reviewing'
  reason?: string
  reviewerName?: string
  viewUrl?: string
}

const statusAr: Record<string, string> = {
  halal: 'مقبول شرعاً',
  non_halal: 'غير مقبول شرعاً',
  reviewing: 'قيد المراجعة',
}
const statusEn: Record<string, string> = {
  halal: 'Shariah-compliant',
  non_halal: 'Non-compliant',
  reviewing: 'Under review',
}
const statusColor: Record<string, string> = {
  halal: '#2E7D5B',
  non_halal: brand.burgundy,
  reviewing: brand.goldDeep,
}

const ShariahDecisionEmail = ({
  symbol = 'SYM',
  status = 'reviewing',
  reason,
  reviewerName,
  viewUrl = '#',
}: Props) => (
  <BrandLayout preview={`قرار شرعي · ${symbol} · ${statusAr[status]}`} lang="ar">
    <Text style={styles.h1En}>Shariah decision</Text>
    <Text style={styles.h1}>قرار شرعي · {symbol}</Text>
    <Text
      style={{
        ...styles.code,
        color: statusColor[status],
        fontSize: '18px',
        letterSpacing: '0.14em',
        padding: '14px 20px',
      }}
    >
      {statusAr[status]} · {statusEn[status]}
    </Text>
    {reason ? (
      <>
        <Text style={styles.text}>
          <strong>سبب القرار:</strong> {reason}
        </Text>
      </>
    ) : null}
    <Text style={styles.textEn}>
      A new Shariah decision has been recorded for <strong>{symbol}</strong>
      {reviewerName ? ` by ${reviewerName}` : ''}. You are receiving this because
      you follow or hold a related position.
    </Text>
    <div style={styles.buttonWrap}>
      <Button style={styles.button} href={viewUrl}>
        عرض القرار · View Decision
      </Button>
    </div>
    <Text style={{ ...styles.textEn, marginTop: 22, color: brand.inkSoft }}>
      هذا الحكم نتيجة المراجعة الشرعية في منصّة وحدة القيمة، ولا يُعدّ نصيحة استثمارية.
      <br />
      This ruling is the outcome of Value Unit's Shariah review, not investment advice.
    </Text>
  </BrandLayout>
)

export const template = {
  component: ShariahDecisionEmail,
  subject: (d: Record<string, any>) =>
    `قرار شرعي · ${d.symbol ?? ''} — Shariah decision`,
  displayName: 'Shariah decision',
  previewData: {
    symbol: 'SAMPLE',
    status: 'halal',
    reason: 'نص توضيحي لسبب الحكم (معاينة).',
    viewUrl: 'https://hub.sunkvalue.com/shariah',
  },
} satisfies TemplateEntry

export default ShariahDecisionEmail