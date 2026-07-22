import * as React from 'react'
import { render } from '@react-email/render'
import { TEMPLATES } from '@/lib/email-templates/registry'

const SITE_NAME = 'Value Unit'
const SENDER_DOMAIN = 'notify.hub.sunkvalue.com'
const FROM_DOMAIN = 'notify.hub.sunkvalue.com'

export type EnqueueResult =
  | { sent: true; messageId: string }
  | { sent: false; reason: 'suppressed' | 'template_not_found' | 'error'; detail?: string }

/**
 * Server-only helper: renders a registered React Email template and enqueues
 * it into the `transactional_emails` pgmq queue. Uses `supabaseAdmin` (service
 * role) and MUST only be called from server-only paths (server functions,
 * server routes, other `.server.ts` files). Never import at module scope of
 * a `.functions.ts` file.
 */
export async function enqueueTransactionalEmail(input: {
  templateName: string
  recipientEmail: string
  templateData?: Record<string, unknown>
  idempotencyKey?: string
  label?: string
}): Promise<EnqueueResult> {
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server')

  const entry = TEMPLATES[input.templateName]
  if (!entry) {
    return { sent: false, reason: 'template_not_found', detail: input.templateName }
  }

  const normalized = input.recipientEmail.toLowerCase()
  const { data: suppressed } = await supabaseAdmin
    .from('suppressed_emails')
    .select('email')
    .eq('email', normalized)
    .maybeSingle()
  if (suppressed) return { sent: false, reason: 'suppressed' }

  const data = input.templateData ?? {}
  const subject =
    typeof entry.subject === 'function' ? entry.subject(data) : entry.subject

  let html: string
  let text: string
  try {
    const element = React.createElement(entry.component, data)
    html = await render(element)
    text = await render(element, { plainText: true })
  } catch (err) {
    return {
      sent: false,
      reason: 'error',
      detail: err instanceof Error ? err.message : String(err),
    }
  }

  const messageId = crypto.randomUUID()
  const idempotencyKey = input.idempotencyKey ?? messageId

  await supabaseAdmin.from('email_send_log').insert({
    message_id: messageId,
    template_name: input.templateName,
    recipient_email: normalized,
    status: 'pending',
    metadata: {
      template_data: data,
      label: input.label ?? input.templateName,
      idempotency_key: idempotencyKey,
    },
  })

  const { error } = await supabaseAdmin.rpc('enqueue_email', {
    queue_name: 'transactional_emails',
    payload: {
      message_id: messageId,
      idempotency_key: idempotencyKey,
      to: normalized,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      sender_domain: SENDER_DOMAIN,
      subject,
      html,
      text,
      purpose: 'transactional',
      label: input.label ?? input.templateName,
      queued_at: new Date().toISOString(),
    },
  })

  if (error) {
    await supabaseAdmin.from('email_send_log').insert({
      message_id: messageId,
      template_name: input.templateName,
      recipient_email: normalized,
      status: 'failed',
      error_message: error.message,
    })
    return { sent: false, reason: 'error', detail: error.message }
  }

  return { sent: true, messageId }
}