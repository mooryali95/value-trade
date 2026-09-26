import type { ComponentType } from 'react'

/**
 * Template data as it reaches a template at runtime: untyped JSON from the
 * queue, the send route and the admin preview. Every template therefore
 * declares all of its props optional (with defaults), which is what lets its
 * component be stored as a `ComponentType<TemplateData>`.
 */
export type TemplateData = Record<string, unknown>

export interface TemplateEntry {
  component: ComponentType<TemplateData>
  subject: string | ((data: TemplateData) => string)
  displayName?: string
  previewData?: TemplateData
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
import { template as accessRequestReceivedTemplate } from './access-request-received'
import { template as accessRequestDecisionTemplate } from './access-request-decision'

export const TEMPLATES: Record<string, TemplateEntry> = {
  invitation: invitationTemplate,
  'price-alert': priceAlertTemplate,
  'shariah-decision': shariahDecisionTemplate,
  'position-update': positionUpdateTemplate,
  'ops-alert': opsAlertTemplate,
  'access-request-received': accessRequestReceivedTemplate,
  'access-request-decision': accessRequestDecisionTemplate,
}
