import * as React from 'react'
import { Text } from '@react-email/components'
import { BrandLayout, styles } from './_brand'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <BrandLayout preview="رمز التحقّق الخاص بك" lang="ar">
    <Text style={styles.h1En}>Verification code</Text>
    <Text style={styles.h1}>رمز التحقّق</Text>
    <Text style={styles.text}>
      استخدم الرمز التالي لتأكيد هويّتك في <strong>وحدة القيمة</strong>:
    </Text>
    <Text style={styles.code}>{token}</Text>
    <Text style={styles.textEn}>
      Use this code to confirm your identity on Value Unit. It expires shortly.
    </Text>
    <Text style={{ ...styles.textEn, marginTop: 12 }}>
      إن لم تطلب ذلك، تجاهل الرسالة ولن يتم أي إجراء.
      <br />
      If you didn't request this, ignore the email.
    </Text>
  </BrandLayout>
)

export default ReauthenticationEmail
