import * as React from 'react'
import { Button, Text } from '@react-email/components'
import { BrandLayout, styles, brand } from './_brand'
import type { TemplateEntry } from './registry'

interface Props {
  fullName?: string | null
  referenceCode?: string | null
  kind?: 'investor' | 'join' | 'new_company'
  companyNameAr?: string | null
  companyNameEn?: string | null
  statusUrl?: string
}

/** Acknowledgement of an access request, with its reference code. */
const AccessRequestReceivedEmail = ({
  fullName,
  referenceCode,
  kind = 'investor',
  companyNameAr,
  companyNameEn,
  statusUrl = '#',
}: Props) => {
  const coAr = companyNameAr || companyNameEn
  const coEn = companyNameEn || companyNameAr
  const whatAr =
    kind === 'investor'
      ? 'طلب انضمامك إلى المنصة بصفتك مستثمرًا'
      : kind === 'new_company'
        ? `طلب تسجيل شركة جديدة${coAr ? ` (${coAr})` : ''}`
        : `طلب انضمامك إلى ${coAr ? coAr : 'شركة مسجّلة'}`
  const whatEn =
    kind === 'investor'
      ? 'your request to join the platform as an investor'
      : kind === 'new_company'
        ? `your request to register a new company${coEn ? ` (${coEn})` : ''}`
        : `your request to join ${coEn ? coEn : 'a registered company'}`
  const nextAr =
    kind === 'join'
      ? 'يراجع مالك الشركة أو مدير المنصة طلبك، وتصلك دعوة بالبريد الإلكتروني عند الموافقة.'
      : 'يراجع فريق المنصة طلبك، ويصلك بريد إلكتروني بالقرار.'
  const nextEn =
    kind === 'join'
      ? "The company's owner or the platform administrator reviews it; you will receive an invitation by email if it is approved."
      : 'The platform team reviews it and will email you the decision.'
  return (
    <BrandLayout preview={`استلمنا طلبك · ${referenceCode ?? ''}`} lang="ar">
      <Text style={styles.h1En}>Request received</Text>
      <Text style={styles.h1}>استلمنا طلبك</Text>
      <Text style={styles.text}>
        {fullName ? `مرحبًا ${fullName}، ` : 'مرحبًا، '}استلمنا {whatAr} في <strong>وحدة القيمة</strong>. {nextAr}
      </Text>
      <Text style={styles.textEn} dir="ltr">
        {fullName ? `Hello ${fullName}, ` : 'Hello, '}we have received {whatEn} on Value Unit. {nextEn}
      </Text>
      {referenceCode && (
        <>
          <Text style={{ ...styles.textEn, margin: '0 0 6px', textAlign: 'center' as const }}>
            الرقم المرجعي · Reference
          </Text>
          <Text style={{ ...styles.code, fontSize: '20px', letterSpacing: '0.18em' }} dir="ltr">
            {referenceCode}
          </Text>
        </>
      )}
      <div style={styles.buttonWrap}>
        <Button style={styles.button} href={statusUrl}>
          متابعة حالة الطلب · Check request status
        </Button>
      </div>
      <Text style={{ ...styles.textEn, marginTop: 22, color: brand.muted }}>
        إن لم تقدّم هذا الطلب فتجاهل الرسالة، ولن يُتخذ أي إجراء آخر.
        <br />
        <span dir="ltr">If you did not submit this request, ignore this email; nothing else will happen.</span>
      </Text>
    </BrandLayout>
  )
}

export const template = {
  component: AccessRequestReceivedEmail,
  subject: (d: Record<string, any>) =>
    `استلمنا طلبك · Request received${d.referenceCode ? ` (${d.referenceCode})` : ''} — وحدة القيمة`,
  displayName: 'Access request received',
  previewData: {
    fullName: 'سارة',
    referenceCode: 'VU-7KQ2-M9XD',
    kind: 'investor',
    statusUrl: 'https://hub.sunkvalue.com/request-access?ref=VU-7KQ2-M9XD',
  },
} satisfies TemplateEntry

export default AccessRequestReceivedEmail
