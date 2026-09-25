import * as React from 'react'
import { Button, Text } from '@react-email/components'
import { BrandLayout, styles } from './_brand'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({ confirmationUrl }: RecoveryEmailProps) => (
  <BrandLayout preview="إعادة تعيين كلمة المرور في وحدة القيمة" lang="ar">
    <Text style={styles.h1En}>Reset your password</Text>
    <Text style={styles.h1}>إعادة تعيين كلمة المرور</Text>
    <Text style={styles.text}>
      وصلنا طلب لإعادة تعيين كلمة مرور حسابك في <strong>وحدة القيمة</strong>. اضغط
      الزر أدناه لاختيار كلمة مرور جديدة.
    </Text>
    <Text style={styles.textEn}>
      We received a request to reset your Value Unit password. Choose a new one
      using the button below.
    </Text>
    <div style={styles.buttonWrap}>
      <Button style={styles.button} href={confirmationUrl}>
        إعادة التعيين · Reset Password
      </Button>
    </div>
    <Text style={{ ...styles.textEn, marginTop: 22 }}>
      يعمل الرابط مرة واحدة ولفترة محدودة. وبعد حفظ كلمة المرور الجديدة يُسجَّل خروج حسابك من الأجهزة الأخرى.
      <br />
      <span dir="ltr">
        The link works once and for a limited time. Saving the new password signs your account out on other devices.
      </span>
    </Text>
    <Text style={{ ...styles.textEn }}>
      إن لم تطلب ذلك، تجاهل الرسالة ولن يتغير شيء في حسابك.
      <br />
      <span dir="ltr">If you didn't request this, ignore the email; nothing will change.</span>
    </Text>
  </BrandLayout>
)

export default RecoveryEmail
