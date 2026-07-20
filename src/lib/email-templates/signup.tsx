import * as React from 'react'
import { Button, Text } from '@react-email/components'
import { BrandLayout, styles } from './_brand'

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({ recipient, confirmationUrl }: SignupEmailProps) => (
  <BrandLayout preview="تأكيد بريدك الإلكتروني في وحدة القيمة" lang="ar">
    <Text style={styles.h1En}>Confirm your email</Text>
    <Text style={styles.h1}>تأكيد البريد الإلكتروني</Text>
    <Text style={styles.text}>
      مرحباً بك في <strong>وحدة القيمة</strong>. لإتمام إنشاء حسابك، فضلاً قم بتأكيد
      بريدك الإلكتروني <strong>{recipient}</strong> عبر الضغط على الزر أدناه.
    </Text>
    <Text style={styles.textEn}>
      Please confirm your address to activate your Value Unit account. This link is
      valid for a limited time.
    </Text>
    <div style={styles.buttonWrap}>
      <Button style={styles.button} href={confirmationUrl}>
        تأكيد البريد · Verify Email
      </Button>
    </div>
    <Text style={{ ...styles.textEn, marginTop: 22 }}>
      إذا لم تُنشئ هذا الحساب، يمكنك تجاهل هذه الرسالة بأمان.
      <br />
      If you didn't create an account, you can safely ignore this email.
    </Text>
  </BrandLayout>
)

export default SignupEmail
