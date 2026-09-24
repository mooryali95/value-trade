import * as React from 'react'
import { Button, Text } from '@react-email/components'
import { BrandLayout, styles, brand } from './_brand'
import type { TemplateEntry } from './registry'

interface Props {
  decision?: 'approved' | 'rejected'
  kind?: 'investor' | 'join' | 'new_company'
  fullName?: string | null
  referenceCode?: string | null
  companyNameAr?: string | null
  companyNameEn?: string | null
  /** Optional note from the reviewer (rejections), shown as written. */
  note?: string | null
  signInUrl?: string
  requestUrl?: string
}

/**
 * Decision on an access request. Approvals of company requests are
 * announced by the invitation e-mail itself, and new investors by the
 * account invitation; this message covers rejections and investors who
 * already have an account.
 */
const AccessRequestDecisionEmail = ({
  decision = 'rejected',
  kind = 'investor',
  fullName,
  referenceCode,
  companyNameAr,
  companyNameEn,
  note,
  signInUrl = '#',
  requestUrl = '#',
}: Props) => {
  const hello = fullName ? `مرحبًا ${fullName}، ` : 'مرحبًا، '
  const helloEn = fullName ? `Hello ${fullName}, ` : 'Hello, '
  const ref = referenceCode ? ` (${referenceCode})` : ''
  const coAr = companyNameAr || companyNameEn
  const coEn = companyNameEn || companyNameAr
  if (decision === 'approved') {
    return (
      <BrandLayout preview="تمت الموافقة على طلبك" lang="ar">
        <Text style={styles.h1En}>Request approved</Text>
        <Text style={styles.h1}>تمت الموافقة على طلبك</Text>
        <Text style={styles.text}>
          {hello}وافق فريق <strong>وحدة القيمة</strong> على طلبك{ref}. لديك حساب مسجّل بهذا البريد
          الإلكتروني، فادخل به. يفعّل مدير المنصة حسابك للتداول ويسجّل الإيداعات، وستظهر لك حالة الحساب بعد الدخول.
        </Text>
        <Text style={styles.textEn} dir="ltr">
          {helloEn}the Value Unit team has approved your request{ref}. You already have an account with this
          email address, so simply sign in. The platform administrator activates your account for trading and
          records deposits; your account status is shown after you sign in.
        </Text>
        <div style={styles.buttonWrap}>
          <Button style={styles.button} href={signInUrl}>
            الدخول · Sign in
          </Button>
        </div>
      </BrandLayout>
    )
  }
  const whatAr =
    kind === 'investor'
      ? 'طلب انضمامك بصفتك مستثمرًا'
      : kind === 'new_company'
        ? `طلب تسجيل ${coAr ? `شركة ${coAr}` : 'شركة جديدة'}`
        : `طلب انضمامك إلى ${coAr ?? 'الشركة'}`
  const whatEn =
    kind === 'investor'
      ? 'your request to join as an investor'
      : kind === 'new_company'
        ? `your request to register ${coEn ? coEn : 'a new company'}`
        : `your request to join ${coEn ?? 'the company'}`
  return (
    <BrandLayout preview="بخصوص طلب الانضمام" lang="ar">
      <Text style={styles.h1En}>About your request</Text>
      <Text style={styles.h1}>بخصوص طلب الانضمام</Text>
      <Text style={styles.text}>
        {hello}نعتذر، لم تتم الموافقة على {whatAr}{ref} في <strong>وحدة القيمة</strong>.
      </Text>
      <Text style={styles.textEn} dir="ltr">
        {helloEn}we are sorry, {whatEn}{ref} on Value Unit was not approved.
      </Text>
      {note && (
        <Text style={{ ...styles.text, backgroundColor: brand.ivory, border: `1px solid ${brand.goldSoft}`, borderRadius: '8px', padding: '12px 14px' }} dir="auto">
          {note}
        </Text>
      )}
      <Text style={styles.textEn}>
        يمكنك تقديم طلب جديد متى تغيّرت ظروفك.
        <br />
        <span dir="ltr">You are welcome to submit a new request if your circumstances change.</span>
      </Text>
      <div style={styles.buttonWrap}>
        <Button style={styles.button} href={requestUrl}>
          طلب انضمام · Request access
        </Button>
      </div>
    </BrandLayout>
  )
}

export const template = {
  component: AccessRequestDecisionEmail,
  subject: (d: Record<string, any>) =>
    d.decision === 'approved'
      ? 'تمت الموافقة على طلبك · Request approved — وحدة القيمة'
      : 'بخصوص طلب الانضمام · About your request — وحدة القيمة',
  displayName: 'Access request decision',
  previewData: {
    decision: 'rejected',
    kind: 'new_company',
    fullName: 'Omar',
    referenceCode: 'VU-7KQ2-M9XD',
    companyNameAr: 'شركة مثال',
    companyNameEn: 'Example Co.',
    note: '',
    requestUrl: 'https://hub.sunkvalue.com/request-access',
  },
} satisfies TemplateEntry

export default AccessRequestDecisionEmail
