import * as React from 'react'
import { Button, Text } from '@react-email/components'
import { BrandLayout, styles, brand } from './_brand'
import type { TemplateEntry } from './registry'

interface Props {
  symbol?: string
  headline?: string
  detail?: string
  viewUrl?: string
}

const PositionUpdateEmail = ({
  symbol = 'SYM',
  headline = 'تحديث على أداتك',
  detail = '',
  viewUrl = '#',
}: Props) => (
  <BrandLayout preview={`تحديث على ${symbol} — ${headline}`} lang="ar">
    <Text style={styles.h1En}>Position update</Text>
    <Text style={styles.h1}>تحديث على مركزك · {symbol}</Text>
    <Text
      style={{
        ...styles.code,
        color: brand.ink,
        borderColor: brand.goldSoft,
        fontSize: '18px',
        letterSpacing: '0.06em',
      }}
    >
      {headline}
    </Text>
    {detail ? <Text style={styles.text}>{detail}</Text> : null}
    <Text style={styles.textEn}>
      A brand you currently hold — <strong>{symbol}</strong> — has an important update.
    </Text>
    <div style={styles.buttonWrap}>
      <Button style={styles.button} href={viewUrl}>
        فتح المحفظة · Open portfolio
      </Button>
    </div>
  </BrandLayout>
)

export const template = {
  component: PositionUpdateEmail,
  subject: (d: Record<string, any>) =>
    `تحديث على مركزك · ${d.symbol ?? ''} — Position update`,
  displayName: 'Position update',
  previewData: {
    symbol: 'ARAMCO',
    headline: 'تحديث بيانات الرمز',
    detail: 'تم تحديث بيانات هذا الرمز، الرجاء مراجعة المحفظة.',
    viewUrl: 'https://hub.sunkvalue.com/portfolio',
  },
} satisfies TemplateEntry

export default PositionUpdateEmail