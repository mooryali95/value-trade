import * as React from 'react'
import { Button, Text } from '@react-email/components'
import { BrandLayout, styles, brand } from './_brand'
import type { TemplateEntry } from './registry'

interface Props {
  job?: string
  severity?: 'fail' | 'warn'
  headline?: string
  detail?: string
  metricLabel?: string
  metricValue?: string
  viewUrl?: string
}

const OpsAlertEmail = ({
  job = 'smoke',
  severity = 'fail',
  headline = 'فشل متكرر في اختبار الدخان',
  detail = '—',
  metricLabel = 'التفاصيل',
  metricValue = '—',
  viewUrl = '#',
}: Props) => {
  const color = severity === 'fail' ? brand.burgundy : brand.goldDeep
  return (
    <BrandLayout preview={`تنبيه تشغيلي · ${job} · ${headline}`} lang="ar">
      <Text style={styles.h1En}>Operations alert</Text>
      <Text style={styles.h1}>تنبيه تشغيلي · {job}</Text>
      <Text style={styles.text}>
        <strong>{headline}</strong>
      </Text>
      <Text style={{ ...styles.code, color, borderColor: brand.goldSoft, fontSize: '18px' }}>
        {metricLabel}: {metricValue}
      </Text>
      <Text style={styles.text}>{detail}</Text>
      <Text style={styles.textEn}>
        Job <strong>{job}</strong> reported a {severity === 'fail' ? 'failure' : 'warning'}.
        {' '}
        {metricLabel}: {metricValue}. Open the operations page for the latest report.
      </Text>
      <div style={styles.buttonWrap}>
        <Button style={styles.button} href={viewUrl}>
          آخر تقرير · Open latest report
        </Button>
      </div>
    </BrandLayout>
  )
}

export const template: TemplateEntry = {
  component: OpsAlertEmail,
  displayName: 'Ops alert',
  subject: (d) => `تنبيه تشغيلي · ${d['job'] ?? 'ops'} · ${d['headline'] ?? ''}`,
  previewData: {
    job: 'smoke',
    severity: 'fail',
    headline: 'فشل متكرر في اختبار الدخان',
    detail: '2 فشل متتاليان',
    metricLabel: 'الفشل المتتالي',
    metricValue: '2',
    viewUrl: 'https://hub.sunkvalue.com/admin/ops',
  },
}

export default OpsAlertEmail
