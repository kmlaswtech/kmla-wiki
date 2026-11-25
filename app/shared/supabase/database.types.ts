export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admin_log: {
        Row: {
          action: string
          created_at: string
          id: number
          note: string | null
          page_title: string | null
          pseudonym: string | null
          reason: string
          revision_id: number | null
        }
        ComputedFields: never
        Insert: {
          action: string
          created_at?: string
          id?: never
          note?: string | null
          page_title?: string | null
          pseudonym?: string | null
          reason: string
          revision_id?: number | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: never
          note?: string | null
          page_title?: string | null
          pseudonym?: string | null
          reason?: string
          revision_id?: number | null
        }
        Relationships: []
      }
      ban_log: {
        Row: {
          ends_at: string | null
          id: number
          lifted_at: string | null
          page_title: string
          pseudonym: string
          reason: string
          revision_id: number | null
          starts_at: string
        }
        ComputedFields: never
        Insert: {
          ends_at?: string | null
          id?: never
          lifted_at?: string | null
          page_title: string
          pseudonym: string
          reason: string
          revision_id?: number | null
          starts_at?: string
        }
        Update: {
          ends_at?: string | null
          id?: never
          lifted_at?: string | null
          page_title?: string
          pseudonym?: string
          reason?: string
          revision_id?: number | null
          starts_at?: string
        }
        Relationships: []
      }
      images: {
        Row: {
          bytes: number
          created_at: string
          deleted_at: string | null
          height: number
          id: string
          storage_path: string
          width: number
        }
        ComputedFields: never
        Insert: {
          bytes: number
          created_at?: string
          deleted_at?: string | null
          height: number
          id: string
          storage_path: string
          width: number
        }
        Update: {
          bytes?: number
          created_at?: string
          deleted_at?: string | null
          height?: number
          id?: string
          storage_path?: string
          width?: number
        }
        Relationships: []
      }
      page_refs: {
        Row: {
          from_page_id: number
          kind: string
          target_key: string
        }
        ComputedFields: never
        Insert: {
          from_page_id: number
          kind: string
          target_key: string
        }
        Update: {
          from_page_id?: number
          kind?: string
          target_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "page_refs_from_page_id_fkey"
            columns: ["from_page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
      }
      pages: {
        Row: {
          created_at: string
          current_revision_id: number | null
          deleted_at: string | null
          id: number
          namespace: string | null
          parent_key: string | null
          protection: string
          redirect_key: string | null
          redirect_target: string | null
          title: string
          title_key: string | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          current_revision_id?: number | null
          deleted_at?: string | null
          id?: never
          namespace?: never
          parent_key?: never
          protection?: string
          redirect_key?: never
          redirect_target?: string | null
          title: string
          title_key?: never
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_revision_id?: number | null
          deleted_at?: string | null
          id?: never
          namespace?: never
          parent_key?: never
          protection?: string
          redirect_key?: never
          redirect_target?: string | null
          title?: string
          title_key?: never
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pages_current_revision_fkey"
            columns: ["current_revision_id"]
            isOneToOne: false
            referencedRelation: "revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      revisions: {
        Row: {
          author_pseudonym: string
          body: NonNullable<Json>
          body_text: string | null
          created_at: string
          hidden_at: string | null
          id: number
          kind: string
          page_id: number
          parent_revision_id: number | null
          summary: string
          text_added: number
          text_removed: number
          text_size: number
        }
        ComputedFields: never
        Insert: {
          author_pseudonym: string
          body: NonNullable<Json>
          body_text?: never
          created_at?: string
          hidden_at?: string | null
          id?: never
          kind: string
          page_id: number
          parent_revision_id?: number | null
          summary?: string
          text_added: number
          text_removed: number
          text_size: number
        }
        Update: {
          author_pseudonym?: string
          body?: NonNullable<Json>
          body_text?: never
          created_at?: string
          hidden_at?: string | null
          id?: never
          kind?: string
          page_id?: number
          parent_revision_id?: number | null
          summary?: string
          text_added?: number
          text_removed?: number
          text_size?: number
        }
        Relationships: [
          {
            foreignKeyName: "revisions_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revisions_parent_revision_id_fkey"
            columns: ["parent_revision_id"]
            isOneToOne: false
            referencedRelation: "revisions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_count: { Args: Record<PropertyKey, never>; Returns: number }
      ban_editor: {
        Args: { p_length: string; p_reason: string; p_revision_id: number }
        Returns: number
      }
      bulk_revert: {
        Args: {
          p_from_revision_id: number
          p_items: Json
          p_lookup_id: string
          p_reason: string
        }
        Returns: {
          outcome: string
          page_id: number
          page_title: string
        }[]
      }
      change_ban_end: {
        Args: { p_ban_log_id: number; p_length: string; p_reason: string }
        Returns: undefined
      }
      count_open_reports: { Args: Record<PropertyKey, never>; Returns: number }
      delete_page: {
        Args: { p_page_id: number; p_reason: string }
        Returns: undefined
      }
      find_author_lookup: { Args: { p_revision_id: number }; Returns: string }
      get_author_lookup: {
        Args: { p_lookup_id: string }
        Returns: {
          expires_at: string
          hidden_at: string
          is_current: boolean
          page_title: string
          pseudonym: string
          source_revision_id: number
        }[]
      }
      get_my_status: {
        Args: Record<PropertyKey, never>
        Returns: {
          ban_ends_at: string
          ban_reason: string
          banned: boolean
          is_admin: boolean
          is_member: boolean
          verified: boolean
          verified_until: string
        }[]
      }
      get_page_view: {
        Args: {
          p_follow_redirect?: boolean
          p_revision_id?: number
          p_title: string
        }
        Returns: Json
      }
      grant_admin: {
        Args: { p_reason: string; p_revision_id: number }
        Returns: undefined
      }
      keepalive: { Args: Record<PropertyKey, never>; Returns: boolean }
      lift_ban: {
        Args: { p_ban_log_id: number; p_reason: string }
        Returns: undefined
      }
      list_admins: {
        Args: Record<PropertyKey, never>
        Returns: {
          admin_handle: string
          is_me: boolean
        }[]
      }
      list_all_pages: {
        Args: { p_after?: string; p_limit?: number; p_namespace?: string }
        Returns: {
          title: string
        }[]
      }
      list_author_edits: {
        Args: {
          p_before_revision_id?: number
          p_limit?: number
          p_lookup_id: string
        }
        Returns: {
          created_at: string
          hidden_at: string
          is_current: boolean
          kind: string
          page_deleted: boolean
          page_id: number
          page_title: string
          parent_revision_id: number
          pseudonym: string
          revision_id: number
          summary: string
          text_added: number
          text_removed: number
        }[]
      }
      list_my_author_lookups: {
        Args: Record<PropertyKey, never>
        Returns: {
          expires_at: string
          lookup_id: string
          page_title: string
          pseudonym: string
          source_revision_id: number
        }[]
      }
      list_open_reports: {
        Args: Record<PropertyKey, never>
        Returns: {
          dismissed_count: number
          first_reported_at: string
          hidden_at: string
          is_current: boolean
          page_deleted: boolean
          page_id: number
          page_title: string
          parent_revision_id: number
          pseudonym: string
          reports: Json
          revision_created_at: string
          revision_id: number
        }[]
      }
      mark_image_deleted: { Args: { p_image_id: string }; Returns: undefined }
      move_page: {
        Args: {
          p_leave_redirect?: boolean
          p_new_title: string
          p_title: string
        }
        Returns: {
          page_id: number
          revision_id: number
          title: string
        }[]
      }
      my_pseudonym: { Args: { p_page_id: number }; Returns: string }
      open_author_lookup: {
        Args: { p_reason: string; p_revision_id: number }
        Returns: string
      }
      orphan_pages: {
        Args: { p_after?: string; p_limit?: number }
        Returns: {
          title: string
        }[]
      }
      page_backlinks: { Args: { p_title_key: string }; Returns: Json }
      page_sizes: {
        Args: {
          p_limit?: number
          p_longest?: boolean
          p_namespace?: string
          p_offset?: number
        }
        Returns: {
          text_size: number
          title: string
        }[]
      }
      preview_bulk_revert: {
        Args: { p_from_revision_id?: number; p_lookup_id: string }
        Returns: {
          current_revision_id: number
          edit_count: number
          has_move: boolean
          kept_count: number
          move_leftover: boolean
          page_id: number
          page_title: string
          restore_revision_id: number
          status: string
        }[]
      }
      random_page: { Args: Record<PropertyKey, never>; Returns: string }
      record_member_verification: {
        Args: {
          p_auth_user_id: string
          p_kmla_profile_id: number
          p_valid_for?: string
        }
        Returns: undefined
      }
      redirect_issues: {
        Args: { p_limit?: number }
        Returns: {
          next: string
          target: string
          title: string
        }[]
      }
      register_image: {
        Args: { p_height: number; p_image_id: string; p_width: number }
        Returns: undefined
      }
      report_revision: {
        Args: { p_category: string; p_note?: string; p_revision_id: number }
        Returns: undefined
      }
      resolve_body: { Args: { p_body: Json }; Returns: Json }
      resolve_images: { Args: { p_body: Json }; Returns: Json }
      resolve_redirect: {
        Args: { p_stop_key?: string; p_title: string }
        Returns: {
          status: string
          title: string
          via: string
        }[]
      }
      resolve_reports: {
        Args: { p_resolution: string; p_revision_id: number }
        Returns: number
      }
      restore_page: {
        Args: { p_page_id: number; p_reason: string }
        Returns: undefined
      }
      revert_and_hide_revision: {
        Args: { p_reason: string; p_revision_id: number }
        Returns: undefined
      }
      revert_page: {
        Args: { p_revision_id: number; p_summary?: string }
        Returns: {
          page_id: number
          revision_id: number
          title: string
        }[]
      }
      revoke_admin: {
        Args: { p_admin_handle: string; p_reason: string }
        Returns: undefined
      }
      revoke_member_verification: {
        Args: { p_auth_user_id: string }
        Returns: undefined
      }
      save_revision: {
        Args: {
          p_base_revision_id: number
          p_body: Json
          p_summary?: string
          p_title: string
        }
        Returns: {
          page_id: number
          revision_id: number
          title: string
        }[]
      }
      search_pages: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          matched_redirect: string
          rank: number
          snippet: string
          title: string
        }[]
      }
      set_protection: {
        Args: { p_level: string; p_page_id: number; p_reason: string }
        Returns: undefined
      }
      set_revision_hidden: {
        Args: { p_hidden: boolean; p_reason: string; p_revision_id: number }
        Returns: undefined
      }
      suggest_titles: {
        Args: {
          p_limit?: number
          p_pattern: string
          p_prefix?: string
          p_query: string
        }
        Returns: {
          redirect_target: string
          title: string
        }[]
      }
      wanted_pages: {
        Args: { p_limit?: number }
        Returns: {
          ref_count: number
          title_key: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
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
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
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
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
