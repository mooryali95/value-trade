import * as React from 'react'
import { Button, Text } from '@react-email/components'
import { BrandLayout, styles, brand } from './_brand'
import type { TemplateEntry } from './registry'

interface Props {
  symbol?: string
  direction?: 'above' | 'below'
  targetPrice?: string
  currentPrice?: string
  currency?: string
  viewUrl?: string
}

const PriceAlertEmail = ({
  symbol = 'SYM',
  direction = 'above',
  targetPrice = '0.00',
  currentPrice = '0.00',
  currency = 'SAR',
  viewUrl = '#',
}: Props) => {
  const dirAr = direction === 'above' ? 'أعلى من' : 'أدنى من'
  const dirEn = direction === 'above' ? 'crossed above' : 'crossed below'
  const color = direction === 'above' ? '#2E7D5B' : brand.burgundy
  return (
    <BrandLayout preview={`تنبيه سعر · ${symbol} ${dirAr} ${targetPrice} ${currency}`} lang="ar">
      <Text style={styles.h1En}>Price alert</Text>
      <Text style={styles.h1}>تنبيه سعر · {symbol}</Text>
      <Text style={styles.text}>
        وصل سعر <strong>{symbol}</strong> إلى مستوى تنبيهك: {dirAr}{' '}
        <strong>
          {targetPrice} {currency}
        </strong>
        .
      </Text>
      <Text
        style={{
          ...styles.code,
          color,
          borderColor: brand.goldSoft,
          fontSize: '22px',
          letterSpacing: '0.12em',
        }}
      >
        {currentPrice} {currency}
      </Text>
      <Text style={styles.textEn}>
        <strong>{symbol}</strong> {dirEn} your alert at{' '}
        <strong>
          {targetPrice} {currency}
        </strong>
        . Current price shown above.
      </Text>
      <div style={styles.buttonWrap}>
        <Button style={styles.button} href={viewUrl}>
          فتح المنصّة · Open Value Unit
        </Button>
      </div>
      <Text style={{ ...styles.textEn, marginTop: 22 }}>
        لست مهتماً بهذه التنبيهات؟ يمكنك تعطيلها من إعدادات محفظتك.
        <br />
        You can disable alerts anytime from your portfolio settings.
      </Text>
    </BrandLayout>
  )
}

export const template = {
  component: PriceAlertEmail,
  subject: (d: Record<string, any>) =>
    `تنبيه سعر · ${d.symbol ?? ''} — Price alert`,
  displayName: 'Price alert',
  previewData: {
    symbol: 'SAMPLE',
    direction: 'above',
    targetPrice: '32.50',
    currentPrice: '32.68',
    currency: 'SAR',
    viewUrl: 'https://hub.sunkvalue.com/portfolio',
  },
} satisfies TemplateEntry

export default PriceAlertEmail