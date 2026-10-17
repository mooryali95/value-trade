import * as React from 'react'
import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'

// Value Unit — private-bank stationery tokens (hex for email client compatibility).
export const brand = {
  bg: '#ffffff',
  paper: '#FFFDF8',
  ivory: '#F6F0E1',
  ink: '#0B1E3A',
  inkDeep: '#07152B',
  inkSoft: '#46546E',
  gold: '#C7A467',
  goldDeep: '#9C7638',
  goldSoft: '#E6D7B2',
  border: '#ECE4D0',
  burgundy: '#6E1F2A',
  muted: '#8A8577',
}

const fontStack =
  "'Tajawal', 'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, Arial, sans-serif"
const serifStack = "Georgia, 'Times New Roman', serif"

export const styles = {
  main: {
    backgroundColor: brand.bg,
    fontFamily: fontStack,
    margin: 0,
    padding: '40px 12px',
    color: brand.ink,
  } as React.CSSProperties,
  container: {
    maxWidth: '580px',
    margin: '0 auto',
    backgroundColor: brand.paper,
    border: `1px solid ${brand.border}`,
    borderRadius: '4px',
    overflow: 'hidden',
  } as React.CSSProperties,
  goldBar: {
    height: '3px',
    lineHeight: '3px',
    fontSize: '1px',
    backgroundColor: brand.gold,
    margin: 0,
  } as React.CSSProperties,
  header: {
    backgroundColor: brand.ink,
    padding: '34px 32px 30px',
    textAlign: 'center' as const,
  },
  monogram: {
    display: 'inline-block',
    width: '46px',
    height: '46px',
    lineHeight: '44px',
    border: `1px solid ${brand.gold}`,
    borderRadius: '50%',
    color: brand.gold,
    fontFamily: serifStack,
    fontSize: '18px',
    letterSpacing: '0.04em',
    margin: '0 auto',
    textAlign: 'center' as const,
  } as React.CSSProperties,
  brandTitle: {
    fontFamily: fontStack,
    fontSize: '22px',
    color: '#FFFDF8',
    margin: '14px 0 2px',
    fontWeight: 700 as const,
    letterSpacing: '0.02em',
  },
  brandRow: {
    fontFamily: serifStack,
    fontSize: '11px',
    letterSpacing: '0.42em',
    color: brand.gold,
    textTransform: 'uppercase' as const,
    margin: 0,
  },
  dots: {
    fontSize: '9px',
    letterSpacing: '0.8em',
    color: brand.gold,
    margin: '16px 0 0',
    textAlign: 'center' as const,
  },
  hairline: {
    border: 'none',
    borderTop: `1px solid ${brand.goldSoft}`,
    margin: '8px 40px 0',
  },
  body: {
    padding: '18px 40px 34px',
  },
  h1En: {
    fontFamily: serifStack,
    fontSize: '11px',
    color: brand.goldDeep,
    letterSpacing: '0.32em',
    textTransform: 'uppercase' as const,
    margin: '22px 0 8px',
  },
  h1: {
    fontFamily: fontStack,
    fontSize: '24px',
    fontWeight: 700 as const,
    color: brand.ink,
    lineHeight: 1.4,
    margin: '0 0 18px',
    textAlign: 'start' as const,
  },
  text: {
    fontFamily: fontStack,
    fontSize: '15px',
    color: brand.ink,
    lineHeight: 1.9,
    margin: '0 0 14px',
  },
  textEn: {
    fontFamily: fontStack,
    fontSize: '13px',
    color: brand.inkSoft,
    lineHeight: 1.75,
    margin: '0 0 22px',
    direction: 'ltr' as const,
    textAlign: 'left' as const,
  },
  button: {
    display: 'inline-block',
    backgroundColor: brand.ink,
    color: '#FFFDF8',
    fontFamily: fontStack,
    fontSize: '14px',
    fontWeight: 700 as const,
    letterSpacing: '0.05em',
    borderRadius: '2px',
    padding: '15px 34px',
    textDecoration: 'none',
    borderBottom: `2px solid ${brand.gold}`,
  } as React.CSSProperties,
  buttonWrap: {
    textAlign: 'center' as const,
    margin: '14px 0 8px',
  },
  code: {
    fontFamily: "'JetBrains Mono', Menlo, Consolas, monospace",
    fontSize: '30px',
    letterSpacing: '0.5em',
    color: brand.ink,
    backgroundColor: brand.ivory,
    borderTop: `1px solid ${brand.gold}`,
    borderBottom: `1px solid ${brand.gold}`,
    borderLeft: 'none',
    borderRight: 'none',
    borderRadius: '0',
    padding: '22px 24px',
    textAlign: 'center' as const,
    margin: '12px 0 26px',
    fontWeight: 700 as const,
    direction: 'ltr' as const,
  } as React.CSSProperties,
  footer: {
    backgroundColor: brand.ivory,
    borderTop: `1px solid ${brand.border}`,
    padding: '24px 32px 26px',
    textAlign: 'center' as const,
  },
  footerBrand: {
    fontFamily: serifStack,
    fontSize: '11px',
    color: brand.goldDeep,
    letterSpacing: '0.36em',
    textTransform: 'uppercase' as const,
    margin: '0 0 8px',
  },
  footerText: {
    fontFamily: fontStack,
    fontSize: '11px',
    color: brand.muted,
    lineHeight: 1.7,
    margin: '0 0 2px',
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
          <Text style={styles.goldBar}>&nbsp;</Text>
          <Section style={styles.header}>
            <Text style={styles.monogram}>VU</Text>
            <Text style={styles.brandTitle}>وحدة القيمة</Text>
            <Text style={styles.brandRow}>Value&nbsp;Unit</Text>
          </Section>
          <Section style={styles.body}>{children}</Section>
          <Section style={styles.footer}>
            <Text style={styles.footerBrand}>Value Unit · وحدة القيمة</Text>
            <Text style={styles.footerText}>سوق خاصة لوحدات العلامات والأدوات المالية</Text>
            <Text style={styles.footerText}>Private market for stocks, funds, sukuk and brand units</Text>
            <Text style={{ ...styles.footerText, color: brand.goldDeep, marginTop: 8 }}>
              hub.sunkvalue.com
            </Text>
          </Section>
          <Text style={styles.goldBar}>&nbsp;</Text>
        </Container>
      </Body>
    </Html>
  )
}
