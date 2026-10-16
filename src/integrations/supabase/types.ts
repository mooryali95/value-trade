export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      access_requests: {
        Row: {
          assigned_role: Database["public"]["Enums"]["company_role"] | null
          created_at: string
          email: string
          full_name: string
          id: string
          join_method: string
          new_company_name_ar: string | null
          new_company_name_en: string | null
          reference_code: string
          rejection_reason: string | null
          requested_company_id: string | null
          resulting_invitation_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          sector: string | null
          status: string
        }
        Insert: {
          assigned_role?: Database["public"]["Enums"]["company_role"] | null
          created_at?: string
          email: string
          full_name: string
          id?: string
          join_method: string
          new_company_name_ar?: string | null
          new_company_name_en?: string | null
          reference_code?: string
          rejection_reason?: string | null
          requested_company_id?: string | null
          resulting_invitation_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sector?: string | null
          status?: string
        }
        Update: {
          assigned_role?: Database["public"]["Enums"]["company_role"] | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          join_method?: string
          new_company_name_ar?: string | null
          new_company_name_en?: string | null
          reference_code?: string
          rejection_reason?: string | null
          requested_company_id?: string | null
          resulting_invitation_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sector?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "access_requests_requested_company_id_fkey"
            columns: ["requested_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_requests_resulting_invitation_id_fkey"
            columns: ["resulting_invitation_id"]
            isOneToOne: false
            referencedRelation: "company_invitations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string
          company_id: string | null
          created_at: string
          entity: string
          entity_id: string | null
          id: string
          metadata: Json
        }
        Insert: {
          action: string
          actor_id: string
          company_id?: string | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: string
          metadata?: Json
        }
        Update: {
          action?: string
          actor_id?: string
          company_id?: string | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: string
          metadata?: Json
        }
        Relationships: []
      }
      brands: {
        Row: {
          asset_class: string
          company_id: string | null
          created_at: string
          id: string
          name_ar: string
          name_en: string
          published: boolean
          reference_price: number
          sector: string | null
          slug: string
          source_submission_id: string | null
          symbol: string
          updated_at: string
        }
        Insert: {
          asset_class?: string
          company_id?: string | null
          created_at?: string
          id?: string
          name_ar: string
          name_en: string
          published?: boolean
          reference_price?: number
          sector?: string | null
          slug: string
          source_submission_id?: string | null
          symbol: string
          updated_at?: string
        }
        Update: {
          asset_class?: string
          company_id?: string | null
          created_at?: string
          id?: string
          name_ar?: string
          name_en?: string
          published?: boolean
          reference_price?: number
          sector?: string | null
          slug?: string
          source_submission_id?: string | null
          symbol?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brands_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brands_source_submission_id_fkey"
            columns: ["source_submission_id"]
            isOneToOne: false
            referencedRelation: "product_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_ledger: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          created_by: string | null
          id: string
          kind: string
          note: string | null
          ref_order_id: string | null
          user_id: string
        }
        Insert: {
          amount: number
          balance_after: number
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          note?: string | null
          ref_order_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          note?: string | null
          ref_order_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_ledger_ref_order_id_fkey"
            columns: ["ref_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name_ar: string
          name_en: string
          plan: string
          sector: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name_ar: string
          name_en: string
          plan?: string
          sector?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name_ar?: string
          name_en?: string
          plan?: string
          sector?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      company_brands: {
        Row: {
          added_at: string
          added_by: string | null
          brand_symbol: string
          company_id: string
          id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          brand_symbol: string
          company_id: string
          id?: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          brand_symbol?: string
          company_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_brands_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          company_id: string
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          role: Database["public"]["Enums"]["company_role"]
          status: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          company_id: string
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          role: Database["public"]["Enums"]["company_role"]
          status?: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          company_id?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          role?: Database["public"]["Enums"]["company_role"]
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_invitations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_members: {
        Row: {
          company_id: string
          id: string
          invited_by: string | null
          joined_at: string
          role: Database["public"]["Enums"]["company_role"]
          user_id: string
        }
        Insert: {
          company_id: string
          id?: string
          invited_by?: string | null
          joined_at?: string
          role?: Database["public"]["Enums"]["company_role"]
          user_id: string
        }
        Update: {
          company_id?: string
          id?: string
          invited_by?: string | null
          joined_at?: string
          role?: Database["public"]["Enums"]["company_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      launch_review_holds: {
        Row: {
          created_at: string
          detail: Json
          had_trader_role: boolean
          id: string
          reason: string
          resolved_at: string | null
          resolved_by: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          detail?: Json
          had_trader_role?: boolean
          id?: string
          reason: string
          resolved_at?: string | null
          resolved_by?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          detail?: Json
          had_trader_role?: boolean
          id?: string
          reason?: string
          resolved_at?: string | null
          resolved_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          position_updates_email: boolean
          price_alerts_email: boolean
          shariah_decisions_email: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          position_updates_email?: boolean
          price_alerts_email?: boolean
          shariah_decisions_email?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          position_updates_email?: boolean
          price_alerts_email?: boolean
          shariah_decisions_email?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ops_run_log: {
        Row: {
          created_at: string
          detail: string | null
          duration_ms: number | null
          id: string
          job: string
          metrics: Json
          status: string
        }
        Insert: {
          created_at?: string
          detail?: string | null
          duration_ms?: number | null
          id?: string
          job: string
          metrics?: Json
          status: string
        }
        Update: {
          created_at?: string
          detail?: string | null
          duration_ms?: number | null
          id?: string
          job?: string
          metrics?: Json
          status?: string
        }
        Relationships: []
      }
      ops_settings: {
        Row: {
          alert_max_per_window: number
          alert_window_minutes: number
          created_at: string
          cron_latency_budget_ms: number
          email_retry_attempts: number
          id: number
          smoke_fail_threshold: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          alert_max_per_window?: number
          alert_window_minutes?: number
          created_at?: string
          cron_latency_budget_ms?: number
          email_retry_attempts?: number
          id?: number
          smoke_fail_threshold?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          alert_max_per_window?: number
          alert_window_minutes?: number
          created_at?: string
          cron_latency_budget_ms?: number
          email_retry_attempts?: number
          id?: number
          smoke_fail_threshold?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      orders: {
        Row: {
          asset_class: string
          created_at: string
          filled_at: string | null
          filled_notional: number
          filled_price: number | null
          filled_qty: number
          id: string
          price: number | null
          qty: number
          side: string
          status: string
          symbol: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          asset_class?: string
          created_at?: string
          filled_at?: string | null
          filled_notional?: number
          filled_price?: number | null
          filled_qty?: number
          id?: string
          price?: number | null
          qty: number
          side: string
          status?: string
          symbol: string
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          asset_class?: string
          created_at?: string
          filled_at?: string | null
          filled_notional?: number
          filled_price?: number | null
          filled_qty?: number
          id?: string
          price?: number | null
          qty?: number
          side?: string
          status?: string
          symbol?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      orders_audit: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          id: string
          new_price: number | null
          new_qty: number | null
          new_status: string | null
          order_id: string
          previous_price: number | null
          previous_qty: number | null
          previous_status: string | null
          related_order_id: string | null
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_price?: number | null
          new_qty?: number | null
          new_status?: string | null
          order_id: string
          previous_price?: number | null
          previous_qty?: number | null
          previous_status?: string | null
          related_order_id?: string | null
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_price?: number | null
          new_qty?: number | null
          new_status?: string | null
          order_id?: string
          previous_price?: number | null
          previous_qty?: number | null
          previous_status?: string | null
          related_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_audit_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_audit_related_order_id_fkey"
            columns: ["related_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolios: {
        Row: {
          cash_balance: number
          created_at: string
          currency: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cash_balance?: number
          created_at?: string
          currency?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cash_balance?: number
          created_at?: string
          currency?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      positions: {
        Row: {
          asset_class: string
          avg_price: number
          cost_basis: number
          created_at: string
          id: string
          qty: number
          symbol: string
          updated_at: string
          user_id: string
        }
        Insert: {
          asset_class?: string
          avg_price?: number
          cost_basis: number
          created_at?: string
          id?: string
          qty?: number
          symbol: string
          updated_at?: string
          user_id: string
        }
        Update: {
          asset_class?: string
          avg_price?: number
          cost_basis?: number
          created_at?: string
          id?: string
          qty?: number
          symbol?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      price_alerts: {
        Row: {
          active: boolean
          created_at: string
          direction: string
          id: string
          symbol: string
          target_price: number
          triggered_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          direction: string
          id?: string
          symbol: string
          target_price: number
          triggered_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          direction?: string
          id?: string
          symbol?: string
          target_price?: number
          triggered_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      product_submissions: {
        Row: {
          asset_class: string
          company_id: string
          created_at: string
          id: string
          listing_decided_at: string | null
          listing_decided_by: string | null
          listing_reason: string | null
          name_ar: string
          name_en: string
          offering_details: Json
          prospectus_url: string | null
          review_reason: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          sector: string | null
          shariah_decision_id: string | null
          status: string
          submitted_at: string
          submitted_by: string
          symbol: string
          updated_at: string
        }
        Insert: {
          asset_class: string
          company_id: string
          created_at?: string
          id?: string
          listing_decided_at?: string | null
          listing_decided_by?: string | null
          listing_reason?: string | null
          name_ar: string
          name_en: string
          offering_details?: Json
          prospectus_url?: string | null
          review_reason?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          sector?: string | null
          shariah_decision_id?: string | null
          status?: string
          submitted_at?: string
          submitted_by: string
          symbol: string
          updated_at?: string
        }
        Update: {
          asset_class?: string
          company_id?: string
          created_at?: string
          id?: string
          listing_decided_at?: string | null
          listing_decided_by?: string | null
          listing_reason?: string | null
          name_ar?: string
          name_en?: string
          offering_details?: Json
          prospectus_url?: string | null
          review_reason?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          sector?: string | null
          shariah_decision_id?: string | null
          status?: string
          submitted_at?: string
          submitted_by?: string
          symbol?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_submissions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_submissions_shariah_decision_fk"
            columns: ["shariah_decision_id"]
            isOneToOne: false
            referencedRelation: "shariah_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          locale: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          locale?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          locale?: string
          updated_at?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          count: number
          key: string
          window_seconds: number | null
          window_start: string
        }
        Insert: {
          count?: number
          key: string
          window_seconds?: number | null
          window_start: string
        }
        Update: {
          count?: number
          key?: string
          window_seconds?: number | null
          window_start?: string
        }
        Relationships: []
      }
      shariah_decision_audit: {
        Row: {
          change_reason: string | null
          changed_at: string
          changed_by: string | null
          decision_id: string
          id: string
          new_reason: string | null
          new_status: string
          previous_reason: string | null
          previous_status: string | null
        }
        Insert: {
          change_reason?: string | null
          changed_at?: string
          changed_by?: string | null
          decision_id: string
          id?: string
          new_reason?: string | null
          new_status: string
          previous_reason?: string | null
          previous_status?: string | null
        }
        Update: {
          change_reason?: string | null
          changed_at?: string
          changed_by?: string | null
          decision_id?: string
          id?: string
          new_reason?: string | null
          new_status?: string
          previous_reason?: string | null
          previous_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shariah_decision_audit_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "shariah_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      shariah_decisions: {
        Row: {
          change_reason: string | null
          created_at: string
          effective_at: string
          id: string
          reason: string | null
          reviewer_id: string | null
          status: string
          symbol: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          change_reason?: string | null
          created_at?: string
          effective_at?: string
          id?: string
          reason?: string | null
          reviewer_id?: string | null
          status: string
          symbol: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          change_reason?: string | null
          created_at?: string
          effective_at?: string
          id?: string
          reason?: string | null
          reviewer_id?: string | null
          status?: string
          symbol?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      submission_documents: {
        Row: {
          company_id: string
          created_at: string
          file_name: string
          file_path: string
          id: string
          mime_type: string | null
          size_bytes: number | null
          submission_id: string
          uploaded_by: string
        }
        Insert: {
          company_id: string
          created_at?: string
          file_name: string
          file_path: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          submission_id: string
          uploaded_by: string
        }
        Update: {
          company_id?: string
          created_at?: string
          file_name?: string
          file_path?: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          submission_id?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "submission_documents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_documents_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "product_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      symbol_watchers: {
        Row: {
          asset_class: string
          created_at: string
          id: string
          symbol: string
          user_id: string
        }
        Insert: {
          asset_class?: string
          created_at?: string
          id?: string
          symbol: string
          user_id: string
        }
        Update: {
          asset_class?: string
          created_at?: string
          id?: string
          symbol?: string
          user_id?: string
        }
        Relationships: []
      }
      trades: {
        Row: {
          asset_class: string
          buy_order_id: string | null
          buyer_id: string
          created_at: string
          id: string
          price: number
          qty: number
          sell_order_id: string | null
          seller_id: string
          symbol: string
        }
        Insert: {
          asset_class?: string
          buy_order_id?: string | null
          buyer_id: string
          created_at?: string
          id?: string
          price: number
          qty: number
          sell_order_id?: string | null
          seller_id: string
          symbol: string
        }
        Update: {
          asset_class?: string
          buy_order_id?: string | null
          buyer_id?: string
          created_at?: string
          id?: string
          price?: number
          qty?: number
          sell_order_id?: string | null
          seller_id?: string
          symbol?: string
        }
        Relationships: [
          {
            foreignKeyName: "trades_buy_order_id_fkey"
            columns: ["buy_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trades_sell_order_id_fkey"
            columns: ["sell_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_issuances: {
        Row: {
          created_at: string
          id: string
          issued_by: string
          note: string | null
          price: number
          qty: number
          symbol: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          issued_by: string
          note?: string | null
          price: number
          qty: number
          symbol: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          issued_by?: string
          note?: string | null
          price?: number
          qty?: number
          symbol?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_company_invitation: {
        Args: { _actor_email: string; _actor_id: string; _token: string }
        Returns: string
      }
      access_request_reference: { Args: never; Returns: string }
      admin_pending_activations: {
        Args: { _actor_id: string; _limit?: number }
        Returns: {
          created_at: string
          email: string
          email_confirmed: boolean
          full_name: string
          on_hold: boolean
          pending_company_invitations: number
          request_id: string
          request_reference: string
          requested_at: string
          source: string
          user_id: string
        }[]
      }
      apply_trade_position: {
        Args: {
          _asset_class: string
          _price: number
          _qty: number
          _side: string
          _symbol: string
          _user_id: string
        }
        Returns: undefined
      }
      approve_access_request: {
        Args: {
          _actor_id: string
          _request_id: string
          _role?: Database["public"]["Enums"]["company_role"]
          _sector?: string
          _slug?: string
        }
        Returns: {
          company_id: string
          invitation_id: string
          invitation_token: string
        }[]
      }
      approve_listing: {
        Args: {
          _actor_id: string
          _holder_id?: string
          _issue_price?: number
          _note?: string
          _qty?: number
          _reference_price: number
          _submission_id: string
        }
        Returns: {
          brand_id: string
          issuance_id: string
          published: boolean
          reference_price: number
          submission_id: string
          symbol: string
        }[]
      }
      band_reference_price: { Args: { _symbol: string }; Returns: number }
      band_tick_edges: {
        Args: { _ref: number }
        Returns: Record<string, unknown>
      }
      buying_power: { Args: { _user_id: string }; Returns: number }
      cancel_order: {
        Args: { _order_id: string; _user_id: string }
        Returns: {
          filled_qty: number
          order_id: string
          status: string
        }[]
      }
      cancel_shariah_blocked_buys: {
        Args: { _actor?: string; _symbol: string }
        Returns: number
      }
      check_access_request_status_ref: {
        Args: { _email: string; _ref: string }
        Returns: {
          join_method: string
          reviewed_at: string
          status: string
        }[]
      }
      check_rate_limit: {
        Args: { _key: string; _limit: number; _window_seconds: number }
        Returns: boolean
      }
      close_instrument_orders: {
        Args: { _action: string; _actor?: string; _symbol: string }
        Returns: number
      }
      company_brand_count: { Args: { _company_id: string }; Returns: number }
      company_has_member_email: {
        Args: { _company_id: string; _email: string }
        Returns: boolean
      }
      create_company_invitation: {
        Args: {
          _actor_id: string
          _company_id: string
          _email: string
          _role: Database["public"]["Enums"]["company_role"]
        }
        Returns: {
          accepted_at: string | null
          accepted_by: string | null
          company_id: string
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          role: Database["public"]["Enums"]["company_role"]
          status: string
          token: string
        }
        SetofOptions: {
          from: "*"
          to: "company_invitations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_shariah_status: { Args: { _symbol: string }; Returns: string }
      deactivate_trader: {
        Args: { _actor_id: string; _user_id: string }
        Returns: number
      }
      decline_listing: {
        Args: { _actor_id: string; _reason: string; _submission_id: string }
        Returns: {
          status: string
          submission_id: string
        }[]
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      engine_cancel_order: {
        Args: { _action: string; _actor?: string; _order_id: string }
        Returns: undefined
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      get_company_by_slug_public: {
        Args: { _slug: string }
        Returns: {
          id: string
          name_ar: string
          name_en: string
          slug: string
        }[]
      }
      get_market_snapshot: {
        Args: { _symbols: string[] }
        Returns: {
          change_24h_pct: number
          last_price: number
          symbol: string
          volume_24h: number
        }[]
      }
      get_order_book: {
        Args: { _depth?: number; _symbol: string }
        Returns: {
          price: number
          qty: number
          side: string
        }[]
      }
      get_symbol_last_trade: {
        Args: { _symbol: string }
        Returns: {
          last_price: number
          traded_at: string
        }[]
      }
      get_symbol_market_stats: {
        Args: { _symbol: string }
        Returns: {
          change_24h_pct: number
          last_price: number
          last_traded_at: string
          trade_count_24h: number
          volume_24h: number
        }[]
      }
      has_company_role: {
        Args: {
          _company_id: string
          _role: Database["public"]["Enums"]["company_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      integrity_report: {
        Args: never
        Returns: {
          check_key: string
          ok: boolean
          sample: Json
          violations: number
        }[]
      }
      invitation_preview: {
        Args: { _token: string }
        Returns: {
          company_id: string
          company_name_ar: string
          company_name_en: string
          email: string
          expires_at: string
          invitation_id: string
          role: Database["public"]["Enums"]["company_role"]
          status: string
        }[]
      }
      is_company_member: {
        Args: { _company_id: string; _user_id: string }
        Returns: boolean
      }
      is_company_owner: {
        Args: { _company_id: string; _user_id: string }
        Returns: boolean
      }
      issue_units: {
        Args: {
          _actor_id: string
          _note?: string
          _price: number
          _qty: number
          _symbol: string
          _user_id: string
        }
        Returns: string
      }
      list_my_trades: {
        Args: { _limit?: number; _symbol?: string; _user_id: string }
        Returns: {
          asset_class: string
          created_at: string
          id: string
          order_id: string
          price: number
          qty: number
          side: string
          symbol: string
        }[]
      }
      market_instrument_rows: {
        Args: { _brand_id?: string; _company_id?: string }
        Returns: {
          asset_class: string
          brand_id: string
          change_24h_pct: number
          company_id: string
          company_name_ar: string
          company_name_en: string
          last_price: number
          last_trade_at: string
          name_ar: string
          name_en: string
          reference_price: number
          sector: string
          shariah_status: string
          slug: string
          symbol: string
          trades_24h: number
          volume_24h_units: number
          volume_24h_value: number
        }[]
      }
      match_order: {
        Args: {
          _asset_class: string
          _limit_price?: number
          _qty: number
          _side: string
          _symbol: string
          _type: string
          _user_id: string
        }
        Returns: {
          avg_price: number
          filled_qty: number
          order_id: string
          status: string
        }[]
      }
      money_prorata: {
        Args: { _amount: number; _part: number; _whole: number }
        Returns: number
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      open_buy_reserve: { Args: { _user_id: string }; Returns: number }
      portfolio_positions: {
        Args: { _user_id: string }
        Returns: {
          asset_class: string
          avg_price: number
          band_reference: number
          cost_basis: number
          last_price: number
          last_trade_at: string
          name_ar: string
          name_en: string
          published: boolean
          qty: number
          reserved_qty: number
          slug: string
          symbol: string
          updated_at: string
        }[]
      }
      post_cash_movement: {
        Args: {
          _actor_id?: string
          _amount: number
          _kind: string
          _note?: string
          _ref_order_id?: string
          _user_id: string
        }
        Returns: number
      }
      public_candles: {
        Args: { _interval?: string; _limit?: number; _symbol: string }
        Returns: {
          bucket_start: string
          close_price: number
          high_price: number
          low_price: number
          open_price: number
          trade_count: number
          volume_units: number
        }[]
      }
      public_company_profile: {
        Args: { _id: string }
        Returns: {
          id: string
          name_ar: string
          name_en: string
          sector: string
        }[]
      }
      public_instrument: {
        Args: { _slug: string }
        Returns: {
          asset_class: string
          band_high: number
          band_low: number
          band_reference: number
          change_24h_pct: number
          company_id: string
          company_name_ar: string
          company_name_en: string
          day_high: number
          day_low: number
          day_open: number
          last_price: number
          last_trade_at: string
          name_ar: string
          name_en: string
          reference_price: number
          sector: string
          shariah_status: string
          slug: string
          symbol: string
          trades_24h: number
          volume_24h_units: number
          volume_24h_value: number
        }[]
      }
      public_market_overview: {
        Args: { _company_id?: string }
        Returns: {
          asset_class: string
          change_24h_pct: number
          company_id: string
          company_name_ar: string
          company_name_en: string
          last_price: number
          last_trade_at: string
          name_ar: string
          name_en: string
          reference_price: number
          sector: string
          shariah_status: string
          slug: string
          symbol: string
          trades_24h: number
          volume_24h_units: number
          volume_24h_value: number
        }[]
      }
      public_market_summary: {
        Args: never
        Returns: {
          last_trade_at: string
          listed_count: number
          trades_24h: number
          volume_24h_value: number
        }[]
      }
      public_recent_trades: {
        Args: { _limit?: number; _symbol: string }
        Returns: {
          price: number
          qty: number
          traded_at: string
        }[]
      }
      public_shariah_rulings: {
        Args: never
        Returns: {
          effective_at: string
          name_ar: string
          name_en: string
          reason: string
          slug: string
          status: string
          symbol: string
        }[]
      }
      rate_limit_bucket: {
        Args: { _at: string; _window_seconds: number }
        Returns: string
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      reject_access_request: {
        Args: { _actor_id: string; _reason?: string; _request_id: string }
        Returns: undefined
      }
      renew_company_invitation: {
        Args: {
          _actor_id: string
          _invitation_id: string
          _rotate_token?: boolean
        }
        Returns: {
          accepted_at: string | null
          accepted_by: string | null
          company_id: string
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          role: Database["public"]["Enums"]["company_role"]
          status: string
          token: string
        }
        SetofOptions: {
          from: "*"
          to: "company_invitations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      replace_order: {
        Args: {
          _order_id: string
          _price: number
          _qty: number
          _user_id: string
        }
        Returns: {
          avg_price: number
          filled_qty: number
          order_id: string
          status: string
        }[]
      }
      restore_order: {
        Args: { _order_id: string; _user_id: string }
        Returns: {
          avg_price: number
          filled_qty: number
          order_id: string
          status: string
        }[]
      }
      review_submission: {
        Args: {
          _decision: string
          _reason?: string
          _replace_ruling?: boolean
          _reviewer_id: string
          _submission_id: string
        }
        Returns: {
          brand_id: string
          previous_ruling: string
          ruling_id: string
          ruling_recorded: boolean
          status: string
          submission_id: string
          symbol: string
        }[]
      }
      reviewer_instruments: {
        Args: { _actor_id: string }
        Returns: {
          asset_class: string
          has_company: boolean
          name_ar: string
          name_en: string
          published: boolean
          ruling_effective_at: string
          sector: string
          shariah_status: string
          slug: string
          submission_status: string
          symbol: string
        }[]
      }
      search_companies_public: {
        Args: { _query: string }
        Returns: {
          id: string
          name_ar: string
          name_en: string
          slug: string
        }[]
      }
      set_instrument_published: {
        Args: { _actor_id: string; _published: boolean; _symbol: string }
        Returns: {
          brand_id: string
          cancelled_orders: number
          changed: boolean
          company_id: string
          published: boolean
          symbol: string
        }[]
      }
      set_reference_price: {
        Args: { _actor_id: string; _price: number; _symbol: string }
        Returns: {
          brand_id: string
          changed: boolean
          previous_price: number
          reference_price: number
          symbol: string
        }[]
      }
      shariah_decision_is_mine: {
        Args: { _decision_id: string }
        Returns: boolean
      }
      update_shariah_decision: {
        Args: {
          _actor_id: string
          _change_reason: string
          _decision_id: string
          _reason: string
          _status: string
        }
        Returns: {
          decision_id: string
          previous_status: string
          status: string
          symbol: string
        }[]
      }
    }
    Enums: {
      app_role:
        | "platform_admin"
        | "shariah_board"
        | "company_owner"
        | "brand_manager"
        | "trader"
      company_role: "owner" | "finance" | "shariah" | "trader" | "viewer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "platform_admin",
        "shariah_board",
        "company_owner",
        "brand_manager",
        "trader",
      ],
      company_role: ["owner", "finance", "shariah", "trader", "viewer"],
    },
  },
} as const
