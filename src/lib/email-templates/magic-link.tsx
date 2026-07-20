import * as React from 'react'
import { Button, Text } from '@react-email/components'
import { BrandLayout, styles } from './_brand'

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({ confirmationUrl }: MagicLinkEmailProps) => (
  <BrandLayout preview="رابط الدخول إلى وحدة القيمة" lang="ar">
    <Text style={styles.h1En}>Your sign-in link</Text>
    <Text style={styles.h1}>رابط الدخول الآمن</Text>
    <Text style={styles.text}>
      اضغط الزر أدناه لتسجيل الدخول إلى حسابك في <strong>وحدة القيمة</strong>. ينتهي
      هذا الرابط خلال فترة قصيرة لأسباب أمنية.
    </Text>
    <Text style={styles.textEn}>
      Sign in to Value Unit. This link expires shortly for security.
    </Text>
    <div style={styles.buttonWrap}>
      <Button style={styles.button} href={confirmationUrl}>
        تسجيل الدخول · Sign In
      </Button>
    </div>
    <Text style={{ ...styles.textEn, marginTop: 22 }}>
      إذا لم تطلب هذا الرابط، يمكنك تجاهل الرسالة.
      <br />
      If you didn't request this link, you can safely ignore this email.
    </Text>
  </BrandLayout>
)

export default MagicLinkEmail
