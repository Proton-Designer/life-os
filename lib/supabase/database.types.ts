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
      body_metrics: {
        Row: {
          created_at: string
          date: string
          id: string
          user_id: string
          waist_in: number | null
          weight_lb: number | null
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          user_id?: string
          waist_in?: number | null
          weight_lb?: number | null
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          user_id?: string
          waist_in?: number | null
          weight_lb?: number | null
        }
        Relationships: []
      }
      checkin_allocations: {
        Row: {
          checkin_id: string
          created_at: string
          domain: string
          id: string
          minutes: number
          user_id: string
        }
        Insert: {
          checkin_id: string
          created_at?: string
          domain: string
          id?: string
          minutes: number
          user_id?: string
        }
        Update: {
          checkin_id?: string
          created_at?: string
          domain?: string
          id?: string
          minutes?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checkin_allocations_checkin_id_fkey"
            columns: ["checkin_id"]
            isOneToOne: false
            referencedRelation: "checkins"
            referencedColumns: ["id"]
          },
        ]
      }
      checkins: {
        Row: {
          answered: boolean
          checkin_time: string
          created_at: string
          id: string
          kind: string
          tag_label: string | null
          tag_ref_id: string | null
          tag_type: string | null
          user_id: string
          window_end: string | null
          window_start: string | null
          work_session_id: string | null
        }
        Insert: {
          answered?: boolean
          checkin_time: string
          created_at?: string
          id?: string
          kind?: string
          tag_label?: string | null
          tag_ref_id?: string | null
          tag_type?: string | null
          user_id?: string
          window_end?: string | null
          window_start?: string | null
          work_session_id?: string | null
        }
        Update: {
          answered?: boolean
          checkin_time?: string
          created_at?: string
          id?: string
          kind?: string
          tag_label?: string | null
          tag_ref_id?: string | null
          tag_type?: string | null
          user_id?: string
          window_end?: string | null
          window_start?: string | null
          work_session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checkins_work_session_id_fkey"
            columns: ["work_session_id"]
            isOneToOne: false
            referencedRelation: "work_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      coop_targets: {
        Row: {
          completed_at: string | null
          created_at: string
          deadline: string | null
          id: string
          position: number | null
          status: string
          title: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          deadline?: string | null
          id?: string
          position?: number | null
          status?: string
          title: string
          user_id?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          deadline?: string | null
          id?: string
          position?: number | null
          status?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      coop_tasks: {
        Row: {
          blocked_from: string | null
          created_at: string
          deadline: string | null
          id: string
          status: string
          target_id: string
          title: string
          user_id: string
        }
        Insert: {
          blocked_from?: string | null
          created_at?: string
          deadline?: string | null
          id?: string
          status?: string
          target_id: string
          title: string
          user_id?: string
        }
        Update: {
          blocked_from?: string | null
          created_at?: string
          deadline?: string | null
          id?: string
          status?: string
          target_id?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coop_tasks_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "coop_targets"
            referencedColumns: ["id"]
          },
        ]
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
      deen_habit_logs: {
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
            foreignKeyName: "deen_habit_logs_habit_id_fkey"
            columns: ["habit_id"]
            isOneToOne: false
            referencedRelation: "deen_habits"
            referencedColumns: ["id"]
          },
        ]
      }
      deen_habits: {
        Row: {
          anchor_cue: string | null
          archived: boolean
          commitment_note: string | null
          committed_date: string
          created_at: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          anchor_cue?: string | null
          archived?: boolean
          commitment_note?: string | null
          committed_date: string
          created_at?: string
          id?: string
          name: string
          user_id?: string
        }
        Update: {
          anchor_cue?: string | null
          archived?: boolean
          commitment_note?: string | null
          committed_date?: string
          created_at?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      deen_weekly_focus: {
        Row: {
          created_at: string
          habit_id: string
          id: string
          user_id: string
          week_start_date: string
        }
        Insert: {
          created_at?: string
          habit_id: string
          id?: string
          user_id?: string
          week_start_date: string
        }
        Update: {
          created_at?: string
          habit_id?: string
          id?: string
          user_id?: string
          week_start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "deen_weekly_focus_habit_id_fkey"
            columns: ["habit_id"]
            isOneToOne: false
            referencedRelation: "deen_habits"
            referencedColumns: ["id"]
          },
        ]
      }
      exercises: {
        Row: {
          archived: boolean
          created_at: string
          id: string
          name: string
          primary_muscles: string[]
          secondary_muscles: string[]
          user_id: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          id?: string
          name: string
          primary_muscles?: string[]
          secondary_muscles?: string[]
          user_id?: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          id?: string
          name?: string
          primary_muscles?: string[]
          secondary_muscles?: string[]
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
      notification_log: {
        Row: {
          created_at: string
          id: string
          notif_key: string
          notif_type: string
          sent_date: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notif_key: string
          notif_type: string
          sent_date: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notif_key?: string
          notif_type?: string
          sent_date?: string
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
      reflection_entries: {
        Row: {
          created_at: string
          date: string
          id: string
          tier: number
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          tier: number
          user_id?: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          tier?: number
          user_id?: string
        }
        Relationships: []
      }
      rep_goals: {
        Row: {
          active_days: number[]
          archived: boolean
          created_at: string
          daily_target: number
          exercise_id: string
          id: string
          user_id: string
        }
        Insert: {
          active_days?: number[]
          archived?: boolean
          created_at?: string
          daily_target: number
          exercise_id: string
          id?: string
          user_id?: string
        }
        Update: {
          active_days?: number[]
          archived?: boolean
          created_at?: string
          daily_target?: number
          exercise_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rep_goals_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
        ]
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
      session_sets: {
        Row: {
          created_at: string
          exercise_id: string | null
          exercise_name: string
          id: string
          load: number | null
          position: number
          reps: number
          session_id: string
          sets: number
          user_id: string
        }
        Insert: {
          created_at?: string
          exercise_id?: string | null
          exercise_name: string
          id?: string
          load?: number | null
          position: number
          reps: number
          session_id: string
          sets: number
          user_id?: string
        }
        Update: {
          created_at?: string
          exercise_id?: string | null
          exercise_name?: string
          id?: string
          load?: number | null
          position?: number
          reps?: number
          session_id?: string
          sets?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_sets_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_sets_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "workout_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sunnah_logs: {
        Row: {
          completed: boolean
          created_at: string
          date: string
          id: string
          prayer_name: string
          slot: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          created_at?: string
          date: string
          id?: string
          prayer_name: string
          slot: string
          user_id?: string
        }
        Update: {
          completed?: boolean
          created_at?: string
          date?: string
          id?: string
          prayer_name?: string
          slot?: string
          user_id?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          completed: boolean
          completed_at: string | null
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
          completed_at?: string | null
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
          completed_at?: string | null
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
      work_sessions: {
        Row: {
          created_at: string
          ended_at: string | null
          id: string
          started_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          id?: string
          started_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          id?: string
          started_at?: string
          user_id?: string
        }
        Relationships: []
      }
      workout_exercises: {
        Row: {
          exercise_id: string
          id: string
          position: number
          target_load: number | null
          target_reps_high: number
          target_reps_low: number
          target_sets: number
          user_id: string
          workout_id: string
        }
        Insert: {
          exercise_id: string
          id?: string
          position: number
          target_load?: number | null
          target_reps_high: number
          target_reps_low: number
          target_sets: number
          user_id?: string
          workout_id: string
        }
        Update: {
          exercise_id?: string
          id?: string
          position?: number
          target_load?: number | null
          target_reps_high?: number
          target_reps_low?: number
          target_sets?: number
          user_id?: string
          workout_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workout_exercises_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_exercises_workout_id_fkey"
            columns: ["workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
        ]
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
          duration_minutes: number | null
          id: string
          time: string | null
          user_id: string
          workout_id: string | null
          workout_name: string
        }
        Insert: {
          day_of_week: number
          duration_minutes?: number | null
          id?: string
          time?: string | null
          user_id?: string
          workout_id?: string | null
          workout_name: string
        }
        Update: {
          day_of_week?: number
          duration_minutes?: number | null
          id?: string
          time?: string | null
          user_id?: string
          workout_id?: string | null
          workout_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "workout_schedule_workout_id_fkey"
            columns: ["workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
        ]
      }
      workout_sessions: {
        Row: {
          created_at: string
          date: string
          id: string
          source: string
          user_id: string
          workout_id: string | null
          workout_name: string | null
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          source: string
          user_id?: string
          workout_id?: string | null
          workout_name?: string | null
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          source?: string
          user_id?: string
          workout_id?: string | null
          workout_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workout_sessions_workout_id_fkey"
            columns: ["workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
        ]
      }
      workouts: {
        Row: {
          archived: boolean
          created_at: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          id?: string
          name: string
          user_id?: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      complete_target: { Args: { p_target_id: string }; Returns: undefined }
      confirm_workout_session: {
        Args: {
          p_date: string
          p_sets: Json
          p_workout_id: string
          p_workout_name: string
        }
        Returns: string
      }
      get_vault_secrets: {
        Args: { secret_names: string[] }
        Returns: {
          decrypted_secret: string
          name: string
        }[]
      }
      reorder_coop_target: {
        Args: { p_new_position: number; p_target_id: string }
        Returns: undefined
      }
      save_allocation_checkin: {
        Args: {
          p_allocations: Json
          p_window_end: string
          p_window_start: string
        }
        Returns: string
      }
      upsert_session_hour: {
        Args: {
          p_domain: string
          p_session_id: string
          p_window_end: string
          p_window_start: string
        }
        Returns: string
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

