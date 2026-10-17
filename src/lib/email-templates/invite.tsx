import * as React from 'react'
import { Button, Text } from '@react-email/components'
import { BrandLayout, styles, brand } from './_brand'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

/**
 * Supabase Auth invitation (sent for an approved investor, or for someone
 * invited to a company who has no account yet): the link signs the person
 * in once and opens the page where they choose their password.
 */
export const InviteEmail = ({ confirmationUrl }: InviteEmailProps) => (
  <BrandLayout preview="أنشئ حسابك في وحدة القيمة" lang="ar">
    <Text style={styles.h1En}>Create your account</Text>
    <Text style={styles.h1}>أنشئ حسابك في وحدة القيمة</Text>
    <Text style={styles.text}>
      وُجّهت إليك دعوة إلى منصة <strong>وحدة القيمة</strong>، السوق الخاصة بالدعوة ضمن منظومة وحدة القيمة للأسهم والصناديق والصكوك ووحدات العلامات التجارية.
      اضغط الزر أدناه لتفعيل حسابك واختيار كلمة المرور.
    </Text>
    <Text style={styles.textEn} dir="ltr">
      You have been invited to Value Unit, the private, invitation-only market of the Value Unit ecosystem for stocks, funds, sukuk and brand units. Use the
      button below to activate your account and choose your password.
    </Text>
    <div style={styles.buttonWrap}>
      <Button style={styles.button} href={confirmationUrl}>
        تعيين كلمة المرور · Set your password
      </Button>
    </div>
    <Text style={{ ...styles.textEn, marginTop: 22, color: brand.inkSoft }}>
      الرابط صالح لفترة محدودة ولمرة واحدة. وإن انتهت صلاحيته فاطلب رابطًا جديدًا من صفحة الدعوة أو من صفحة الدخول.
      <br />
      <span dir="ltr">
        The link works once and for a limited time. If it has expired, request a new one from the invitation page
        or the sign-in page.
      </span>
    </Text>
    <Text style={{ ...styles.textEn, color: brand.muted }}>
      إن لم تكن تتوقع هذه الدعوة فتجاهل الرسالة.
      <br />
      <span dir="ltr">If you were not expecting this invitation, you can ignore this email.</span>
    </Text>
  </BrandLayout>
)

export default InviteEmail
