import * as React from 'react'
import { Button, Text } from '@react-email/components'
import { BrandLayout, styles, brand } from './_brand'

interface EmailChangeEmailProps {
  siteName: string
  oldEmail: string
  email: string
  newEmail: string
  confirmationUrl: string
}

export const EmailChangeEmail = ({
  oldEmail,
  newEmail,
  confirmationUrl,
}: EmailChangeEmailProps) => (
  <BrandLayout preview="تأكيد تغيير البريد الإلكتروني" lang="ar">
    <Text style={styles.h1En}>Confirm email change</Text>
    <Text style={styles.h1}>تأكيد تغيير البريد الإلكتروني</Text>
    <Text style={styles.text}>
      طلبت تغيير عنوان البريد الإلكتروني المسجّل في <strong>وحدة القيمة</strong> من:
    </Text>
    <Text style={{ ...styles.text, color: brand.inkSoft }}>
      <strong>{oldEmail}</strong> ← <strong>{newEmail}</strong>
    </Text>
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

export default EmailChangeEmail
