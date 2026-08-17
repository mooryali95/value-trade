import type { ComponentType } from 'react'

export interface TemplateEntry {
  component: ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  displayName?: string
  previewData?: Record<string, any>
  /** Fixed recipient — overrides caller-provided recipientEmail when set. */
  to?: string
}

/**
 * Template registry — maps template names to their React Email components.
 * Import and register new templates here after creating them in this directory.
 *
 * Example:
 *   import { template as welcomeTemplate } from './welcome'
 *   // then add to TEMPLATES: 'welcome': welcomeTemplate
 */
import { template as invitationTemplate } from './invitation'
import { template as priceAlertTemplate } from './price-alert'
import { template as shariahDecisionTemplate } from './shariah-decision'
import { template as positionUpdateTemplate } from './position-update'
import { template as opsAlertTemplate } from './ops-alert'

export const TEMPLATES: Record<string, TemplateEntry> = {
  invitation: invitationTemplate,
  'price-alert': priceAlertTemplate,
  'shariah-decision': shariahDecisionTemplate,
  'position-update': positionUpdateTemplate,
  'ops-alert': opsAlertTemplate,
}
