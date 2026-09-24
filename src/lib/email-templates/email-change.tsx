import * as React from 'react'
import { Button, Text } from '@react-email/components'
import { BrandLayout, styles, brand } from './_brand'

interface EmailChangeEmailProps {
  siteName: string
  /** The hook may omit the previous address; `email` is the fallback. */
  oldEmail?: string | null
  email?: string | null
  newEmail?: string | null
  confirmationUrl: string
}

export const EmailChangeEmail = ({
  oldEmail,
  email,
  newEmail,
  confirmationUrl,
}: EmailChangeEmailProps) => {
  const from = oldEmail || email || null
  const to = newEmail || null
  return (
  <BrandLayout preview="تأكيد تغيير البريد الإلكتروني" lang="ar">
    <Text style={styles.h1En}>Confirm email change</Text>
    <Text style={styles.h1}>تأكيد تغيير البريد الإلكتروني</Text>
    <Text style={styles.text}>
      {from || to
        ? 'طلبت تغيير عنوان البريد الإلكتروني المسجّل في حسابك على وحدة القيمة:'
        : 'طلبت تغيير عنوان البريد الإلكتروني المسجّل في حسابك على وحدة القيمة.'}
    </Text>
    {(from || to) && (
      <Text style={{ ...styles.text, color: brand.inkSoft }} dir="ltr">
        {from ? <strong>{from}</strong> : null}
        {from && to ? ' → ' : null}
        {to ? <strong>{to}</strong> : null}
      </Text>
    )}
    <Text style={styles.textEn}>
      You requested to change your Value Unit email address. Confirm below.
    </Text>
    <div style={styles.buttonWrap}>
      <Button style={styles.button} href={confirmationUrl}>
        تأكيد التغيير · Confirm Change
      </Button>
    </div>
    <Text style={{ ...styles.textEn, marginTop: 22, color: brand.burgundy }}>
      إن لم تطلب هذا التغيير، فيرجى تأمين حسابك فوراً وتغيير كلمة المرور.
      <br />
      If you didn't request this change, secure your account immediately.
    </Text>
  </BrandLayout>
  )
}

export default EmailChangeEmail
