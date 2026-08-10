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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      adhkar_logs: {
        Row: {
          completed: boolean
          date: string
          id: string
          period: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          date: string
          id?: string
          period: string
          user_id?: string
        }
        Update: {
          completed?: boolean
          date?: string
          id?: string
          period?: string
          user_id?: string
        }
        Relationships: []
      }
      checkins: {
        Row: {
          answered: boolean
          checkin_time: string
          created_at: string
          id: string
          tag_label: string | null
          tag_ref_id: string | null
          tag_type: string
          user_id: string
        }
        Insert: {
          answered?: boolean
          checkin_time: string
          created_at?: string
          id?: string
          tag_label?: string | null
          tag_ref_id?: string | null
          tag_type: string
          user_id?: string
        }
        Update: {
          answered?: boolean
          checkin_time?: string
          created_at?: string
          id?: string
          tag_label?: string | null
          tag_ref_id?: string | null
          tag_type?: string
          user_id?: string
        }
        Relationships: []
      }
      custom_habits: {
        Row: {
          archived: boolean
          created_at: string
          domain: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          domain: string
          id?: string
          name: string
          user_id?: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          domain?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      habit_logs: {
        Row: {
          completed: boolean
          date: string
          habit_id: string
          id: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          date: string
          habit_id: string
          id?: string
          user_id?: string
        }
        Update: {
          completed?: boolean
          date?: string
          habit_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "habit_logs_habit_id_fkey"
            columns: ["habit_id"]
            isOneToOne: false
            referencedRelation: "custom_habits"
            referencedColumns: ["id"]
          },
        ]
      }
      kill_list_items: {
        Row: {
          completed: boolean
          created_at: string
          date: string
          id: string
          position: number
          text: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          created_at?: string
          date: string
          id?: string
          position?: number
          text: string
          user_id?: string
        }
        Update: {
          completed?: boolean
          created_at?: string
          date?: string
          id?: string
          position?: number
          text?: string
          user_id?: string
        }
        Relationships: []
      }
      prayers: {
        Row: {
          date: string
          id: string
          logged_at: string | null
          prayer_name: string
          status: string
          user_id: string
        }
        Insert: {
          date: string
          id?: string
          logged_at?: string | null
          prayer_name: string
          status?: string
          user_id?: string
        }
        Update: {
          date?: string
          id?: string
          logged_at?: string | null
          prayer_name?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          asr_madhab: string
          checkin_interval_minutes: number
          checkin_window_end: string
          checkin_window_start: string
          created_at: string
          display_name: string | null
          location_label: string | null
          location_lat: number | null
          location_lng: number | null
          onboarding_completed: boolean
          paused_date: string | null
          pin_hash: string | null
          pin_lock_enabled: boolean
          prayer_calc_method: string
          qada_owed: number
          timezone: string
          traveling_mode: boolean
          user_id: string
        }
        Insert: {
          asr_madhab?: string
          checkin_interval_minutes?: number
          checkin_window_end?: string
          checkin_window_start?: string
          created_at?: string
          display_name?: string | null
          location_label?: string | null
          location_lat?: number | null
          location_lng?: number | null
          onboarding_completed?: boolean
          paused_date?: string | null
          pin_hash?: string | null
          pin_lock_enabled?: boolean
          prayer_calc_method?: string
          qada_owed?: number
          timezone?: string
          traveling_mode?: boolean
          user_id: string
        }
        Update: {
          asr_madhab?: string
          checkin_interval_minutes?: number
          checkin_window_end?: string
          checkin_window_start?: string
          created_at?: string
          display_name?: string | null
          location_label?: string | null
          location_lat?: number | null
          location_lng?: number | null
          onboarding_completed?: boolean
          paused_date?: string | null
          pin_hash?: string | null
          pin_lock_enabled?: boolean
          prayer_calc_method?: string
          qada_owed?: number
          timezone?: string
          traveling_mode?: boolean
          user_id?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth_key: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth_key: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_id?: string
        }
        Update: {
          auth_key?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: []
      }
      quran_sessions: {
        Row: {
          created_at: string
          date: string
          id: string
          juz: number | null
          pages_read: number
          surah: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          juz?: number | null
          pages_read: number
          surah?: string | null
          user_id?: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          juz?: number | null
          pages_read?: number
          surah?: string | null
          user_id?: string
        }
        Relationships: []
      }
      schedule_events: {
        Row: {
          cancelled_on: string | null
          created_at: string
          day_of_week: number | null
          domain: string
          event_date: string | null
          event_time: string | null
          id: string
          is_recurring: boolean
          title: string
          user_id: string
        }
        Insert: {
          cancelled_on?: string | null
          created_at?: string
          day_of_week?: number | null
          domain: string
          event_date?: string | null
          event_time?: string | null
          id?: string
          is_recurring?: boolean
          title: string
          user_id?: string
        }
        Update: {
          cancelled_on?: string | null
          created_at?: string
          day_of_week?: number | null
          domain?: string
          event_date?: string | null
          event_time?: string | null
          id?: string
          is_recurring?: boolean
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          completed: boolean
          created_at: string
          domain: string
          due_date: string | null
          due_time: string | null
          id: string
          title: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          created_at?: string
          domain: string
          due_date?: string | null
          due_time?: string | null
          id?: string
          title: string
          user_id?: string
        }
        Update: {
          completed?: boolean
          created_at?: string
          domain?: string
          due_date?: string | null
          due_time?: string | null
          id?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      weekly_goals: {
        Row: {
          created_at: string
          domain: string
          headline: string
          id: string
          locked: boolean
          milestones: Json
          quran_page_target: number | null
          user_id: string
          week_start_date: string
        }
        Insert: {
          created_at?: string
          domain: string
          headline: string
          id?: string
          locked?: boolean
          milestones?: Json
          quran_page_target?: number | null
          user_id?: string
          week_start_date: string
        }
        Update: {
          created_at?: string
          domain?: string
          headline?: string
          id?: string
          locked?: boolean
          milestones?: Json
          quran_page_target?: number | null
          user_id?: string
          week_start_date?: string
        }
        Relationships: []
      }
      workout_logs: {
        Row: {
          completed: boolean
          created_at: string
          date: string
          id: string
          source: string
          user_id: string
          workout_name: string
        }
        Insert: {
          completed?: boolean
          created_at?: string
          date: string
          id?: string
          source: string
          user_id?: string
          workout_name: string
        }
        Update: {
          completed?: boolean
          created_at?: string
          date?: string
          id?: string
          source?: string
          user_id?: string
          workout_name?: string
        }
        Relationships: []
      }
      workout_schedule: {
        Row: {
          day_of_week: number
          id: string
          time: string | null
          user_id: string
          workout_name: string
        }
        Insert: {
          day_of_week: number
          id?: string
          time?: string | null
          user_id?: string
          workout_name: string
        }
        Update: {
          day_of_week?: number
          id?: string
          time?: string | null
          user_id?: string
          workout_name?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
