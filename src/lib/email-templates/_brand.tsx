import * as React from 'react'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'

// Value Unit — luxury brand tokens (hex for email client compatibility).
export const brand = {
  bg: '#ffffff',
  paper: '#FBFAF6',
  ivory: '#F5EFDF',
  ink: '#0B1E3A',
  inkSoft: '#3A4A66',
  gold: '#C7A467',
  goldDeep: '#A17A3E',
  goldSoft: '#E8DBB8',
  border: '#E9E2D0',
  burgundy: '#6E1F2A',
  muted: '#7A7A7A',
}

const fontStack =
  "'Tajawal', 'Segoe UI', Tahoma, Geneva, Verdana, Arial, sans-serif"

export const styles = {
  main: {
    backgroundColor: brand.bg,
    fontFamily: fontStack,
    margin: 0,
    padding: '32px 12px',
    color: brand.ink,
  } as React.CSSProperties,
  container: {
    maxWidth: '560px',
    margin: '0 auto',
    backgroundColor: brand.paper,
    border: `1px solid ${brand.border}`,
    borderRadius: '12px',
    overflow: 'hidden',
  } as React.CSSProperties,
  header: {
    padding: '28px 32px 20px',
    borderBottom: `1px solid ${brand.border}`,
    textAlign: 'center' as const,
  },
  brandRow: {
    fontFamily: fontStack,
    fontSize: '13px',
    letterSpacing: '0.28em',
    color: brand.goldDeep,
    textTransform: 'uppercase' as const,
    margin: 0,
    fontWeight: 700 as const,
  },
  brandTitle: {
    fontFamily: fontStack,
    fontSize: '22px',
    color: brand.ink,
    margin: '6px 0 0',
    fontWeight: 700 as const,
    letterSpacing: '0.02em',
  },
  dots: {
    fontSize: '10px',
    letterSpacing: '0.6em',
    color: brand.gold,
    margin: '14px 0 0',
    textAlign: 'center' as const,
  },
  hairline: {
    border: 'none',
    borderTop: `1px solid ${brand.goldSoft}`,
    margin: '24px 32px',
  },
  body: {
    padding: '8px 32px 28px',
  },
  h1: {
    fontFamily: fontStack,
    fontSize: '20px',
    fontWeight: 700 as const,
    color: brand.ink,
    margin: '18px 0 6px',
    textAlign: 'start' as const,
  },
  h1En: {
    fontFamily: fontStack,
    fontSize: '13px',
    fontWeight: 500 as const,
    color: brand.inkSoft,
    letterSpacing: '0.14em',
    textTransform: 'uppercase' as const,
    margin: '0 0 18px',
  },
  text: {
    fontFamily: fontStack,
    fontSize: '15px',
    color: brand.ink,
    lineHeight: 1.75,
    margin: '0 0 14px',
  },
  textEn: {
    fontFamily: fontStack,
    fontSize: '13px',
    color: brand.inkSoft,
    lineHeight: 1.7,
    margin: '0 0 22px',
  },
  button: {
    display: 'inline-block',
    backgroundColor: brand.ink,
    color: '#ffffff',
    fontFamily: fontStack,
    fontSize: '14px',
    fontWeight: 700 as const,
    letterSpacing: '0.06em',
    borderRadius: '6px',
    padding: '14px 28px',
    textDecoration: 'none',
    border: `1px solid ${brand.goldDeep}`,
  } as React.CSSProperties,
  buttonWrap: {
    textAlign: 'center' as const,
    margin: '10px 0 6px',
  },
  code: {
    fontFamily: "'JetBrains Mono', Menlo, Consolas, monospace",
    fontSize: '28px',
    letterSpacing: '0.5em',
    color: brand.ink,
    backgroundColor: brand.ivory,
    border: `1px solid ${brand.goldSoft}`,
    borderRadius: '8px',
    padding: '18px 24px',
    textAlign: 'center' as const,
    margin: '10px 0 24px',
    fontWeight: 700 as const,
  } as React.CSSProperties,
  footer: {
    borderTop: `1px solid ${brand.border}`,
    padding: '18px 32px 24px',
    textAlign: 'center' as const,
  },
  footerText: {
    fontFamily: fontStack,
    fontSize: '11px',
    color: brand.muted,
    letterSpacing: '0.08em',
    margin: '0 0 4px',
  },
  footerBrand: {
    fontFamily: fontStack,
    fontSize: '11px',
    color: brand.goldDeep,
    letterSpacing: '0.24em',
    textTransform: 'uppercase' as const,
    margin: 0,
    fontWeight: 700 as const,
  },
}

export function BrandLayout({
  preview,
  children,
  lang = 'ar',
}: {
  preview: string
  children: React.ReactNode
  lang?: 'ar' | 'en'
}) {
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  return (
    <Html lang={lang} dir={dir}>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.main}>
        <Container style={styles.container}>
          <Section style={styles.header}>
            <Text style={styles.brandRow}>Value&nbsp;·&nbsp;Unit</Text>
            <Heading style={styles.brandTitle}>وحدة القيمة</Heading>
            <Text style={styles.dots}>• • • • • • •</Text>
          </Section>
          <Section style={styles.body}>{children}</Section>
          <Hr style={styles.hairline} />
          <Section style={styles.footer}>
            <Text style={styles.footerBrand}>Value Unit</Text>
            <Text style={styles.footerText}>
              hub.sunkvalue.com · سوق خاصة لوحدات العلامات التجارية · Private market for brand units
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}