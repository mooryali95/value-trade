import * as React from 'react'
import { Button, Text } from '@react-email/components'
import { BrandLayout, styles } from './_brand'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({ confirmationUrl }: InviteEmailProps) => (
  <BrandLayout preview="دعوة للانضمام إلى وحدة القيمة" lang="ar">
    <Text style={styles.h1En}>You've been invited</Text>
    <Text style={styles.h1}>دعوة للانضمام</Text>
    <Text style={styles.text}>
      لقد تمّت دعوتك للانضمام إلى منصّة <strong>وحدة القيمة</strong>. اضغط الزر أدناه
      لقبول الدعوة وإكمال إنشاء حسابك.
    </Text>
    <Text style={styles.textEn}>
      You've been invited to Value Unit. Accept the invitation to activate your
      account.
    </Text>
    <div style={styles.buttonWrap}>
      <Button style={styles.button} href={confirmationUrl}>
        قبول الدعوة · Accept Invitation
      </Button>
    </div>
    <Text style={{ ...styles.textEn, marginTop: 22 }}>
      إن لم تكن تتوقّع هذه الدعوة، يمكنك تجاهل الرسالة.
      <br />
      If you weren't expecting this invitation, you can safely ignore it.
    </Text>
  </BrandLayout>
)

export default InviteEmail
