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
      active_workout_plans: {
        Row: {
          micro_plan_id: string | null
          routine_plan_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          micro_plan_id?: string | null
          routine_plan_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          micro_plan_id?: string | null
          routine_plan_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "active_workout_plans_micro_plan_same_user"
            columns: ["user_id", "micro_plan_id"]
            referencedRelation: "workout_plans"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "active_workout_plans_routine_plan_same_user"
            columns: ["user_id", "routine_plan_id"]
            referencedRelation: "workout_plans"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      adhkar_logs: {
        Row: {
          completed: boolean
          date: string
          id: string
          period: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          date: string
          id?: string
          period: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          completed?: boolean
          date?: string
          id?: string
          period?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_morning_briefs: {
        Row: {
          brief_date: string
          brief_text: string | null
          created_at: string
          generated_at: string | null
          id: string
          model: string | null
          provider: string | null
          user_id: string
        }
        Insert: {
          brief_date: string
          brief_text?: string | null
          created_at?: string
          generated_at?: string | null
          id?: string
          model?: string | null
          provider?: string | null
          user_id?: string
        }
        Update: {
          brief_date?: string
          brief_text?: string | null
          created_at?: string
          generated_at?: string | null
          id?: string
          model?: string | null
          provider?: string | null
          user_id?: string
        }
        Relationships: []
      }
      ai_usage_log: {
        Row: {
          cached_input_tokens: number
          completion_tokens: number
          cost_usd: number
          created_at: string
          feature: string
          id: number
          input_tokens: number
          key_source: string
          model: string
          prompt_hash: string
          provider: string
          reasoning_tokens: number
          retry_count: number
          succeeded: boolean
          user_id: string
        }
        Insert: {
          cached_input_tokens?: number
          completion_tokens?: number
          cost_usd?: number
          created_at?: string
          feature: string
          id?: never
          input_tokens?: number
          key_source: string
          model: string
          prompt_hash: string
          provider?: string
          reasoning_tokens?: number
          retry_count?: number
          succeeded: boolean
          user_id: string
        }
        Update: {
          cached_input_tokens?: number
          completion_tokens?: number
          cost_usd?: number
          created_at?: string
          feature?: string
          id?: never
          input_tokens?: number
          key_source?: string
          model?: string
          prompt_hash?: string
          provider?: string
          reasoning_tokens?: number
          retry_count?: number
          succeeded?: boolean
          user_id?: string
        }
        Relationships: []
      }
      body_metrics: {
        Row: {
          created_at: string
          date: string
          id: string
          updated_at: string
          user_id: string
          waist_in: number | null
          weight_lb: number | null
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          updated_at?: string
          user_id?: string
          waist_in?: number | null
          weight_lb?: number | null
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          updated_at?: string
          user_id?: string
          waist_in?: number | null
          weight_lb?: number | null
        }
        Relationships: []
      }
      book_ready_notification_log: {
        Row: {
          book_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          book_id: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Update: {
          book_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "book_ready_notification_log_book_same_user"
            columns: ["user_id", "book_id"]
            referencedRelation: "books"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      book_sections: {
        Row: {
          book_id: string
          created_at: string
          id: string
          level: number
          page_end: number | null
          page_start: number | null
          sort_order: number
          summarized_at: string | null
          summarized_by: Database["public"]["Enums"]["extracted_by"] | null
          summary: string | null
          summary_model: string | null
          summary_source_chunk_ids: string[] | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          book_id: string
          created_at?: string
          id?: string
          level?: number
          page_end?: number | null
          page_start?: number | null
          sort_order?: number
          summarized_at?: string | null
          summarized_by?: Database["public"]["Enums"]["extracted_by"] | null
          summary?: string | null
          summary_model?: string | null
          summary_source_chunk_ids?: string[] | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          book_id?: string
          created_at?: string
          id?: string
          level?: number
          page_end?: number | null
          page_start?: number | null
          sort_order?: number
          summarized_at?: string | null
          summarized_by?: Database["public"]["Enums"]["extracted_by"] | null
          summary?: string | null
          summary_model?: string | null
          summary_source_chunk_ids?: string[] | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "book_sections_book_id_fkey"
            columns: ["user_id", "book_id"]
            referencedRelation: "books"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      books: {
        Row: {
          author: string | null
          cover_hue: number | null
          created_at: string
          deck_completed_at: string | null
          deleted_at: string | null
          error_message: string | null
          file_path: string | null
          file_size_bytes: number | null
          id: string
          ingestion_mode: string
          lesson_count: number
          milestone_80_at: string | null
          page_count: number | null
          progress_pct: number
          ready_at: string | null
          stage: Database["public"]["Enums"]["ingest_stage"]
          status: Database["public"]["Enums"]["book_status"]
          title: string
          user_id: string
        }
        Insert: {
          author?: string | null
          cover_hue?: number | null
          created_at?: string
          deck_completed_at?: string | null
          deleted_at?: string | null
          error_message?: string | null
          file_path?: string | null
          file_size_bytes?: number | null
          id?: string
          ingestion_mode?: string
          lesson_count?: number
          milestone_80_at?: string | null
          page_count?: number | null
          progress_pct?: number
          ready_at?: string | null
          stage?: Database["public"]["Enums"]["ingest_stage"]
          status?: Database["public"]["Enums"]["book_status"]
          title: string
          user_id: string
        }
        Update: {
          author?: string | null
          cover_hue?: number | null
          created_at?: string
          deck_completed_at?: string | null
          deleted_at?: string | null
          error_message?: string | null
          file_path?: string | null
          file_size_bytes?: number | null
          id?: string
          ingestion_mode?: string
          lesson_count?: number
          milestone_80_at?: string | null
          page_count?: number | null
          progress_pct?: number
          ready_at?: string | null
          stage?: Database["public"]["Enums"]["ingest_stage"]
          status?: Database["public"]["Enums"]["book_status"]
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      canvas_connections: {
        Row: {
          canvas_user_id: string | null
          canvas_user_name: string | null
          created_at: string
          encrypted_ics_feed_url: string | null
          encrypted_token: string
          ics_feed_url_last4: string | null
          instance_url: string
          last_ics_reconcile_at: string | null
          last_sync_error: string | null
          last_synced_at: string | null
          token_last4: string
          token_status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          canvas_user_id?: string | null
          canvas_user_name?: string | null
          created_at?: string
          encrypted_ics_feed_url?: string | null
          encrypted_token: string
          ics_feed_url_last4?: string | null
          instance_url: string
          last_ics_reconcile_at?: string | null
          last_sync_error?: string | null
          last_synced_at?: string | null
          token_last4: string
          token_status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          canvas_user_id?: string | null
          canvas_user_name?: string | null
          created_at?: string
          encrypted_ics_feed_url?: string | null
          encrypted_token?: string
          ics_feed_url_last4?: string | null
          instance_url?: string
          last_ics_reconcile_at?: string | null
          last_sync_error?: string | null
          last_synced_at?: string | null
          token_last4?: string
          token_status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      canvas_course_mappings: {
        Row: {
          canvas_course_code: string | null
          canvas_course_id: string
          canvas_course_name: string
          class_id: string | null
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          canvas_course_code?: string | null
          canvas_course_id: string
          canvas_course_name: string
          class_id?: string | null
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          canvas_course_code?: string | null
          canvas_course_id?: string
          canvas_course_name?: string
          class_id?: string | null
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "canvas_course_mappings_class_same_user"
            columns: ["user_id", "class_id"]
            referencedRelation: "classes"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      card_states: {
        Row: {
          book_id: string | null
          card_id: string | null
          difficulty: number | null
          due_at: string | null
          id: string
          lapses: number
          last_rating: number | null
          last_review_at: string | null
          learning_steps: number
          question_id: string | null
          reps: number
          stability: number | null
          state: Database["public"]["Enums"]["fsrs_state"]
          user_id: string
        }
        Insert: {
          book_id?: string | null
          card_id?: string | null
          difficulty?: number | null
          due_at?: string | null
          id?: string
          lapses?: number
          last_rating?: number | null
          last_review_at?: string | null
          learning_steps?: number
          question_id?: string | null
          reps?: number
          stability?: number | null
          state?: Database["public"]["Enums"]["fsrs_state"]
          user_id: string
        }
        Update: {
          book_id?: string | null
          card_id?: string | null
          difficulty?: number | null
          due_at?: string | null
          id?: string
          lapses?: number
          last_rating?: number | null
          last_review_at?: string | null
          learning_steps?: number
          question_id?: string | null
          reps?: number
          stability?: number | null
          state?: Database["public"]["Enums"]["fsrs_state"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_states_book_id_fkey"
            columns: ["user_id", "book_id"]
            referencedRelation: "books"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "card_states_card_id_fkey"
            columns: ["user_id", "card_id"]
            referencedRelation: "cards"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "card_states_question_id_fkey"
            columns: ["user_id", "question_id"]
            referencedRelation: "questions"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      cards: {
        Row: {
          answer: string
          book_id: string
          id: string
          lesson_id: string
          prompt: string
          prompt_type: Database["public"]["Enums"]["prompt_type"]
          sort_order: number
          suspended_at: string | null
          suspended_reason: string | null
          user_id: string
        }
        Insert: {
          answer: string
          book_id: string
          id?: string
          lesson_id: string
          prompt: string
          prompt_type: Database["public"]["Enums"]["prompt_type"]
          sort_order?: number
          suspended_at?: string | null
          suspended_reason?: string | null
          user_id: string
        }
        Update: {
          answer?: string
          book_id?: string
          id?: string
          lesson_id?: string
          prompt?: string
          prompt_type?: Database["public"]["Enums"]["prompt_type"]
          sort_order?: number
          suspended_at?: string | null
          suspended_reason?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cards_book_id_fkey"
            columns: ["user_id", "book_id"]
            referencedRelation: "books"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "cards_lesson_id_fkey"
            columns: ["user_id", "lesson_id"]
            referencedRelation: "lessons"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      checkin_allocations: {
        Row: {
          checkin_id: string
          created_at: string
          domain: string | null
          id: string
          is_wasted: boolean
          minutes: number
          user_id: string
        }
        Insert: {
          checkin_id: string
          created_at?: string
          domain?: string | null
          id?: string
          is_wasted?: boolean
          minutes: number
          user_id?: string
        }
        Update: {
          checkin_id?: string
          created_at?: string
          domain?: string | null
          id?: string
          is_wasted?: boolean
          minutes?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checkin_allocations_checkin_same_user"
            columns: ["user_id", "checkin_id"]
            referencedRelation: "checkins"
            referencedColumns: ["user_id", "id"]
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
            foreignKeyName: "checkins_work_session_same_user"
            columns: ["user_id", "work_session_id"]
            referencedRelation: "work_sessions"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      class_assessments: {
        Row: {
          canvas_assignment_id: string | null
          category_id: string | null
          class_id: string
          created_at: string
          date: string
          id: string
          is_excused: boolean
          name: string
          points_earned: number | null
          points_possible: number | null
          points_source: string | null
          task_id: string | null
          type: string
          updated_at: string
          user_id: string
          weight_pct: number | null
        }
        Insert: {
          canvas_assignment_id?: string | null
          category_id?: string | null
          class_id: string
          created_at?: string
          date: string
          id?: string
          is_excused?: boolean
          name: string
          points_earned?: number | null
          points_possible?: number | null
          points_source?: string | null
          task_id?: string | null
          type: string
          updated_at?: string
          user_id?: string
          weight_pct?: number | null
        }
        Update: {
          canvas_assignment_id?: string | null
          category_id?: string | null
          class_id?: string
          created_at?: string
          date?: string
          id?: string
          is_excused?: boolean
          name?: string
          points_earned?: number | null
          points_possible?: number | null
          points_source?: string | null
          task_id?: string | null
          type?: string
          updated_at?: string
          user_id?: string
          weight_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "class_assessments_category_same_user"
            columns: ["user_id", "category_id"]
            referencedRelation: "grade_categories"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "class_assessments_class_same_user"
            columns: ["user_id", "class_id"]
            referencedRelation: "classes"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "class_assessments_task_same_user"
            columns: ["user_id", "task_id"]
            referencedRelation: "tasks"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      class_question_shares: {
        Row: {
          class_id: string
          created_at: string
          id: string
          revoked_at: string | null
          token_hash: string
          user_id: string
        }
        Insert: {
          class_id: string
          created_at?: string
          id?: string
          revoked_at?: string | null
          token_hash: string
          user_id?: string
        }
        Update: {
          class_id?: string
          created_at?: string
          id?: string
          revoked_at?: string | null
          token_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_question_shares_user_id_class_id_fkey"
            columns: ["user_id", "class_id"]
            referencedRelation: "classes"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      classes: {
        Row: {
          allowed_absences: number | null
          attendance_policy: string | null
          code: string
          confidence_rating: number | null
          created_at: string
          difficulty_rating: number | null
          grade_boundaries: Json | null
          id: string
          instructor: string | null
          late_policy: string | null
          position: number | null
          room: string | null
          short_name: string | null
          syllabus_path: string | null
          target_grade_pct: number | null
          term: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          allowed_absences?: number | null
          attendance_policy?: string | null
          code: string
          confidence_rating?: number | null
          created_at?: string
          difficulty_rating?: number | null
          grade_boundaries?: Json | null
          id?: string
          instructor?: string | null
          late_policy?: string | null
          position?: number | null
          room?: string | null
          short_name?: string | null
          syllabus_path?: string | null
          target_grade_pct?: number | null
          term?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          allowed_absences?: number | null
          attendance_policy?: string | null
          code?: string
          confidence_rating?: number | null
          created_at?: string
          difficulty_rating?: number | null
          grade_boundaries?: Json | null
          id?: string
          instructor?: string | null
          late_policy?: string | null
          position?: number | null
          room?: string | null
          short_name?: string | null
          syllabus_path?: string | null
          target_grade_pct?: number | null
          term?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      collegeos_weekly_narratives: {
        Row: {
          created_at: string
          generated_at: string | null
          id: string
          model: string | null
          narrative_text: string | null
          provider: string | null
          user_id: string
          week_start: string
        }
        Insert: {
          created_at?: string
          generated_at?: string | null
          id?: string
          model?: string | null
          narrative_text?: string | null
          provider?: string | null
          user_id?: string
          week_start: string
        }
        Update: {
          created_at?: string
          generated_at?: string | null
          id?: string
          model?: string | null
          narrative_text?: string | null
          provider?: string | null
          user_id?: string
          week_start?: string
        }
        Relationships: []
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
          updated_at: string
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
          updated_at?: string
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
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      coop_tasks: {
        Row: {
          blocked_from: string | null
          blocked_reason: string | null
          blocked_since: string | null
          completed_at: string | null
          created_at: string
          deadline: string | null
          id: string
          status: string
          target_id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          blocked_from?: string | null
          blocked_reason?: string | null
          blocked_since?: string | null
          completed_at?: string | null
          created_at?: string
          deadline?: string | null
          id?: string
          status?: string
          target_id: string
          title: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          blocked_from?: string | null
          blocked_reason?: string | null
          blocked_since?: string | null
          completed_at?: string | null
          created_at?: string
          deadline?: string | null
          id?: string
          status?: string
          target_id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coop_tasks_target_same_user"
            columns: ["user_id", "target_id"]
            referencedRelation: "coop_targets"
            referencedColumns: ["user_id", "id"]
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
      day_starts: {
        Row: {
          created_at: string
          id: string
          local_date: string
          user_id: string
          woke_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          local_date: string
          user_id?: string
          woke_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          local_date?: string
          user_id?: string
          woke_at?: string
        }
        Relationships: []
      }
      deen_habit_logs: {
        Row: {
          completed: boolean
          date: string
          habit_id: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          date: string
          habit_id: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          completed?: boolean
          date?: string
          habit_id?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deen_habit_logs_habit_same_user"
            columns: ["user_id", "habit_id"]
            referencedRelation: "deen_habits"
            referencedColumns: ["user_id", "id"]
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
          cue_time: string | null
          id: string
          name: string
          stage_override: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          anchor_cue?: string | null
          archived?: boolean
          commitment_note?: string | null
          committed_date: string
          created_at?: string
          cue_time?: string | null
          id?: string
          name: string
          stage_override?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          anchor_cue?: string | null
          archived?: boolean
          commitment_note?: string | null
          committed_date?: string
          created_at?: string
          cue_time?: string | null
          id?: string
          name?: string
          stage_override?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      deen_weekly_focus: {
        Row: {
          created_at: string
          habit_id: string
          id: string
          updated_at: string
          user_id: string
          week_start_date: string
        }
        Insert: {
          created_at?: string
          habit_id: string
          id?: string
          updated_at?: string
          user_id?: string
          week_start_date: string
        }
        Update: {
          created_at?: string
          habit_id?: string
          id?: string
          updated_at?: string
          user_id?: string
          week_start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "deen_weekly_focus_habit_same_user"
            columns: ["user_id", "habit_id"]
            referencedRelation: "deen_habits"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      distraction_events: {
        Row: {
          created_at: string
          date: string
          id: string
          reflection_entry_id: string | null
          reflection_tier: number | null
          session_id: string | null
          trigger_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          reflection_entry_id?: string | null
          reflection_tier?: number | null
          session_id?: string | null
          trigger_id: string
          user_id?: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          reflection_entry_id?: string | null
          reflection_tier?: number | null
          session_id?: string | null
          trigger_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "distraction_events_reflection_same_user"
            columns: ["user_id", "reflection_entry_id"]
            referencedRelation: "reflection_entries"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "distraction_events_session_same_user"
            columns: ["user_id", "session_id"]
            referencedRelation: "work_sessions"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "distraction_events_trigger_same_user"
            columns: ["user_id", "trigger_id"]
            referencedRelation: "distraction_triggers"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      distraction_triggers: {
        Row: {
          archived: boolean
          created_at: string
          description: string | null
          domain: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          description?: string | null
          domain: string
          id?: string
          name: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          description?: string | null
          domain?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      due_card_notification_log: {
        Row: {
          created_at: string
          id: string
          sent_date: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          sent_date: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          sent_date?: string
          user_id?: string
        }
        Relationships: []
      }
      evening_closes: {
        Row: {
          closed_at: string
          created_at: string
          id: string
          local_date: string
          user_id: string
        }
        Insert: {
          closed_at?: string
          created_at?: string
          id?: string
          local_date: string
          user_id?: string
        }
        Update: {
          closed_at?: string
          created_at?: string
          id?: string
          local_date?: string
          user_id?: string
        }
        Relationships: []
      }
      exercises: {
        Row: {
          archived: boolean
          created_at: string
          id: string
          name: string
          primary_muscles: string[]
          secondary_muscles: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          id?: string
          name: string
          primary_muscles?: string[]
          secondary_muscles?: string[]
          updated_at?: string
          user_id?: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          id?: string
          name?: string
          primary_muscles?: string[]
          secondary_muscles?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      fitness_benchmarks: {
        Row: {
          created_at: string
          date: string
          exercise_id: string | null
          id: string
          max_reps: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          exercise_id?: string | null
          id?: string
          max_reps: number
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          date?: string
          exercise_id?: string | null
          id?: string
          max_reps?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fitness_benchmarks_exercise_same_user"
            columns: ["user_id", "exercise_id"]
            referencedRelation: "exercises"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      fitness_cycle_anchor: {
        Row: {
          anchor_date: string
          created_at: string
          user_id: string
        }
        Insert: {
          anchor_date: string
          created_at?: string
          user_id: string
        }
        Update: {
          anchor_date?: string
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      fsrs_user_parameters: {
        Row: {
          created_at: string
          loss: number | null
          review_count_at_train: number
          trained_at: string
          updated_at: string
          user_id: string
          weights: number[]
        }
        Insert: {
          created_at?: string
          loss?: number | null
          review_count_at_train: number
          trained_at: string
          updated_at?: string
          user_id: string
          weights: number[]
        }
        Update: {
          created_at?: string
          loss?: number | null
          review_count_at_train?: number
          trained_at?: string
          updated_at?: string
          user_id?: string
          weights?: number[]
        }
        Relationships: []
      }
      goal_milestones: {
        Row: {
          created_at: string
          done_at: string | null
          goal_id: string
          id: string
          month_start: string
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          done_at?: string | null
          goal_id: string
          id?: string
          month_start: string
          title: string
          user_id?: string
        }
        Update: {
          created_at?: string
          done_at?: string | null
          goal_id?: string
          id?: string
          month_start?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goal_milestones_goal_same_user"
            columns: ["user_id", "goal_id"]
            referencedRelation: "goals"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      goals: {
        Row: {
          completed_at: string | null
          created_at: string
          domain: string | null
          id: string
          month_start: string
          rank: number
          reason: string
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          domain?: string | null
          id?: string
          month_start: string
          rank: number
          reason: string
          status?: string
          title: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          domain?: string | null
          id?: string
          month_start?: string
          rank?: number
          reason?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      grade_categories: {
        Row: {
          class_id: string
          created_at: string
          drop_lowest_n: number
          expected_item_count: number
          id: string
          name: string
          updated_at: string
          user_id: string
          weight_pct: number
        }
        Insert: {
          class_id: string
          created_at?: string
          drop_lowest_n?: number
          expected_item_count?: number
          id?: string
          name: string
          updated_at?: string
          user_id?: string
          weight_pct: number
        }
        Update: {
          class_id?: string
          created_at?: string
          drop_lowest_n?: number
          expected_item_count?: number
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
          weight_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "grade_categories_class_same_user"
            columns: ["user_id", "class_id"]
            referencedRelation: "classes"
            referencedColumns: ["user_id", "id"]
          },
        ]
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
            foreignKeyName: "habit_logs_habit_same_user"
            columns: ["user_id", "habit_id"]
            referencedRelation: "custom_habits"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      habit_votes: {
        Row: {
          created_at: string
          date: string
          habit_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          habit_id: string
          id?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          date?: string
          habit_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "habit_votes_habit_same_user"
            columns: ["user_id", "habit_id"]
            referencedRelation: "identity_habits"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      identity_habit_pauses: {
        Row: {
          created_at: string
          habit_id: string
          id: string
          paused_at: string
          resumed_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          habit_id: string
          id?: string
          paused_at: string
          resumed_at?: string | null
          user_id?: string
        }
        Update: {
          created_at?: string
          habit_id?: string
          id?: string
          paused_at?: string
          resumed_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "identity_habit_pauses_user_id_habit_id_fkey"
            columns: ["user_id", "habit_id"]
            referencedRelation: "identity_habits"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      identity_habits: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          identity_statement: string
          kill_reason: string | null
          rank: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          identity_statement: string
          kill_reason?: string | null
          rank: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          identity_statement?: string
          kill_reason?: string | null
          rank?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ingestion_driver_heartbeats: {
        Row: {
          id: number
          last_polled_at: string
        }
        Insert: {
          id: number
          last_polled_at: string
        }
        Update: {
          id?: number
          last_polled_at?: string
        }
        Relationships: []
      }
      ingestion_job_stage_attempts: {
        Row: {
          attempt: number
          chunk_index: number | null
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          job_id: string
          stage: Database["public"]["Enums"]["ingest_stage"]
          started_at: string
          succeeded: boolean | null
          tokens_in: number | null
          tokens_out: number | null
          user_id: string
        }
        Insert: {
          attempt?: number
          chunk_index?: number | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          job_id: string
          stage: Database["public"]["Enums"]["ingest_stage"]
          started_at?: string
          succeeded?: boolean | null
          tokens_in?: number | null
          tokens_out?: number | null
          user_id: string
        }
        Update: {
          attempt?: number
          chunk_index?: number | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          job_id?: string
          stage?: Database["public"]["Enums"]["ingest_stage"]
          started_at?: string
          succeeded?: boolean | null
          tokens_in?: number | null
          tokens_out?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_job_stage_attempts_job_id_fkey"
            columns: ["user_id", "job_id"]
            referencedRelation: "ingestion_jobs"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      ingestion_jobs: {
        Row: {
          book_id: string
          consecutive_skipped_positions: number
          created_at: string
          cursor_attempt: number
          cursor_chunk_index: number | null
          id: string
          last_error: string | null
          leased_until: string | null
          max_attempts: number
          reingest: boolean
          skipped_positions: number
          stage: Database["public"]["Enums"]["ingest_stage"]
          updated_at: string
          user_id: string
        }
        Insert: {
          book_id: string
          consecutive_skipped_positions?: number
          created_at?: string
          cursor_attempt?: number
          cursor_chunk_index?: number | null
          id?: string
          last_error?: string | null
          leased_until?: string | null
          max_attempts?: number
          reingest?: boolean
          skipped_positions?: number
          stage?: Database["public"]["Enums"]["ingest_stage"]
          updated_at?: string
          user_id: string
        }
        Update: {
          book_id?: string
          consecutive_skipped_positions?: number
          created_at?: string
          cursor_attempt?: number
          cursor_chunk_index?: number | null
          id?: string
          last_error?: string | null
          leased_until?: string | null
          max_attempts?: number
          reingest?: boolean
          skipped_positions?: number
          stage?: Database["public"]["Enums"]["ingest_stage"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_jobs_book_id_fkey"
            columns: ["user_id", "book_id"]
            referencedRelation: "books"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      kill_list_items: {
        Row: {
          completed: boolean
          completed_at: string | null
          created_at: string
          date: string
          id: string
          position: number
          text: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          date: string
          id?: string
          position?: number
          text: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          date?: string
          id?: string
          position?: number
          text?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      lecture_recordings: {
        Row: {
          class_id: string
          created_at: string
          duration_seconds: number | null
          id: string
          mime_type: string
          original_filename: string
          recorded_at: string | null
          size_bytes: number
          storage_path: string
          user_id: string
        }
        Insert: {
          class_id: string
          created_at?: string
          duration_seconds?: number | null
          id?: string
          mime_type: string
          original_filename: string
          recorded_at?: string | null
          size_bytes: number
          storage_path: string
          user_id?: string
        }
        Update: {
          class_id?: string
          created_at?: string
          duration_seconds?: number | null
          id?: string
          mime_type?: string
          original_filename?: string
          recorded_at?: string | null
          size_bytes?: number
          storage_path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lecture_recordings_class_same_user"
            columns: ["user_id", "class_id"]
            referencedRelation: "classes"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      lecture_transcripts: {
        Row: {
          attempt_count: number
          claimed_at: string | null
          cost_usd: number | null
          created_at: string
          duration_seconds: number | null
          error_message: string | null
          id: string
          provider: string | null
          recording_id: string
          status: string
          transcript_text: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt_count?: number
          claimed_at?: string | null
          cost_usd?: number | null
          created_at?: string
          duration_seconds?: number | null
          error_message?: string | null
          id?: string
          provider?: string | null
          recording_id: string
          status?: string
          transcript_text?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          attempt_count?: number
          claimed_at?: string | null
          cost_usd?: number | null
          created_at?: string
          duration_seconds?: number | null
          error_message?: string | null
          id?: string
          provider?: string | null
          recording_id?: string
          status?: string
          transcript_text?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lecture_transcripts_recording_same_user"
            columns: ["user_id", "recording_id"]
            referencedRelation: "lecture_recordings"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      lesson_promotions: {
        Row: {
          accepted_text: string
          area_id: string
          cadence: string | null
          created_at: string
          cue: string | null
          id: string
          lesson_id: string
          retired_at: string | null
          started_at: string
          user_id: string
          verdict_due_at: string
        }
        Insert: {
          accepted_text: string
          area_id: string
          cadence?: string | null
          created_at?: string
          cue?: string | null
          id?: string
          lesson_id: string
          retired_at?: string | null
          started_at?: string
          user_id: string
          verdict_due_at?: string
        }
        Update: {
          accepted_text?: string
          area_id?: string
          cadence?: string | null
          created_at?: string
          cue?: string | null
          id?: string
          lesson_id?: string
          retired_at?: string | null
          started_at?: string
          user_id?: string
          verdict_due_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_promotions_user_id_area_id_fkey"
            columns: ["user_id", "area_id"]
            referencedRelation: "user_domains"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "lesson_promotions_user_id_lesson_id_fkey"
            columns: ["user_id", "lesson_id"]
            referencedRelation: "lessons"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      lesson_verdicts: {
        Row: {
          id: string
          promotion_id: string
          reason: string | null
          user_id: string
          verdict: Database["public"]["Enums"]["lesson_verdict"]
          verdict_at: string
        }
        Insert: {
          id?: string
          promotion_id: string
          reason?: string | null
          user_id: string
          verdict: Database["public"]["Enums"]["lesson_verdict"]
          verdict_at?: string
        }
        Update: {
          id?: string
          promotion_id?: string
          reason?: string | null
          user_id?: string
          verdict?: Database["public"]["Enums"]["lesson_verdict"]
          verdict_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_verdicts_user_id_promotion_id_fkey"
            columns: ["user_id", "promotion_id"]
            referencedRelation: "lesson_promotions"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      lessons: {
        Row: {
          action_template: string | null
          book_id: string
          core_claim: string | null
          created_at: string
          embedding: string | null
          embedding_model: string | null
          evidence_strength:
            | Database["public"]["Enums"]["evidence_strength"]
            | null
          extracted_by: Database["public"]["Enums"]["extracted_by"] | null
          id: string
          mechanism: string | null
          page_ref: number | null
          provenance_quote: string
          rank: number | null
          relevance_floor: Database["public"]["Enums"]["relevance_floor_status"]
          section_id: string | null
          source_chunk_id: string | null
          status: Database["public"]["Enums"]["lesson_status"]
          title: string
          user_id: string
        }
        Insert: {
          action_template?: string | null
          book_id: string
          core_claim?: string | null
          created_at?: string
          embedding?: string | null
          embedding_model?: string | null
          evidence_strength?:
            | Database["public"]["Enums"]["evidence_strength"]
            | null
          extracted_by?: Database["public"]["Enums"]["extracted_by"] | null
          id?: string
          mechanism?: string | null
          page_ref?: number | null
          provenance_quote: string
          rank?: number | null
          relevance_floor?: Database["public"]["Enums"]["relevance_floor_status"]
          section_id?: string | null
          source_chunk_id?: string | null
          status?: Database["public"]["Enums"]["lesson_status"]
          title: string
          user_id: string
        }
        Update: {
          action_template?: string | null
          book_id?: string
          core_claim?: string | null
          created_at?: string
          embedding?: string | null
          embedding_model?: string | null
          evidence_strength?:
            | Database["public"]["Enums"]["evidence_strength"]
            | null
          extracted_by?: Database["public"]["Enums"]["extracted_by"] | null
          id?: string
          mechanism?: string | null
          page_ref?: number | null
          provenance_quote?: string
          rank?: number | null
          relevance_floor?: Database["public"]["Enums"]["relevance_floor_status"]
          section_id?: string | null
          source_chunk_id?: string | null
          status?: Database["public"]["Enums"]["lesson_status"]
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lessons_book_id_fkey"
            columns: ["user_id", "book_id"]
            referencedRelation: "books"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "lessons_section_id_fkey"
            columns: ["user_id", "section_id"]
            referencedRelation: "book_sections"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "lessons_source_chunk_id_fkey"
            columns: ["user_id", "source_chunk_id"]
            referencedRelation: "source_chunks"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      mcp_access_tokens: {
        Row: {
          client_kind: string
          created_at: string
          expires_at: string | null
          id: string
          label: string | null
          last_used_at: string | null
          revoked_at: string | null
          scopes: string[]
          token_hash: string
          token_last4: string
          user_id: string
        }
        Insert: {
          client_kind?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          label?: string | null
          last_used_at?: string | null
          revoked_at?: string | null
          scopes: string[]
          token_hash: string
          token_last4: string
          user_id: string
        }
        Update: {
          client_kind?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          label?: string | null
          last_used_at?: string | null
          revoked_at?: string | null
          scopes?: string[]
          token_hash?: string
          token_last4?: string
          user_id?: string
        }
        Relationships: []
      }
      mcp_audit_log: {
        Row: {
          args: NonNullable<Json>
          created_at: string
          id: number
          operation: string
          outcome: string
          result_summary: string | null
          token_id: string | null
          tool_name: string
          transport: string
          user_id: string
        }
        Insert: {
          args: NonNullable<Json>
          created_at?: string
          id?: never
          operation: string
          outcome: string
          result_summary?: string | null
          token_id?: string | null
          tool_name: string
          transport?: string
          user_id: string
        }
        Update: {
          args?: NonNullable<Json>
          created_at?: string
          id?: never
          operation?: string
          outcome?: string
          result_summary?: string | null
          token_id?: string | null
          tool_name?: string
          transport?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_audit_log_token_same_user"
            columns: ["user_id", "token_id"]
            referencedRelation: "mcp_access_tokens"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      mcp_notification_dispatch_log: {
        Row: {
          created_at: string
          id: string
          scheduled_action_id: string
          sent_date: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          scheduled_action_id: string
          sent_date: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          scheduled_action_id?: string
          sent_date?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_notification_dispatch_log_scheduled_action_same_user"
            columns: ["user_id", "scheduled_action_id"]
            referencedRelation: "mcp_scheduled_actions"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      mcp_oauth_clients: {
        Row: {
          client_id: string
          client_name: string | null
          created_at: string
          id: string
          redirect_uris: string[]
          registration_ip_hash: string | null
        }
        Insert: {
          client_id: string
          client_name?: string | null
          created_at?: string
          id?: string
          redirect_uris: string[]
          registration_ip_hash?: string | null
        }
        Update: {
          client_id?: string
          client_name?: string | null
          created_at?: string
          id?: string
          redirect_uris?: string[]
          registration_ip_hash?: string | null
        }
        Relationships: []
      }
      mcp_oauth_codes: {
        Row: {
          client_id: string
          code_challenge: string
          code_challenge_method: string
          code_hash: string
          created_at: string
          expires_at: string
          id: string
          redirect_uri: string
          resource: string | null
          scopes: string[]
          used_at: string | null
          user_id: string
        }
        Insert: {
          client_id: string
          code_challenge: string
          code_challenge_method: string
          code_hash: string
          created_at?: string
          expires_at: string
          id?: string
          redirect_uri: string
          resource?: string | null
          scopes: string[]
          used_at?: string | null
          user_id: string
        }
        Update: {
          client_id?: string
          code_challenge?: string
          code_challenge_method?: string
          code_hash?: string
          created_at?: string
          expires_at?: string
          id?: string
          redirect_uri?: string
          resource?: string | null
          scopes?: string[]
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_oauth_codes_client_id_fkey"
            columns: ["client_id"]
            referencedRelation: "mcp_oauth_clients"
            referencedColumns: ["client_id"]
          },
        ]
      }
      mcp_oauth_refresh_tokens: {
        Row: {
          access_token_id: string
          client_id: string
          created_at: string
          id: string
          rotated_at: string | null
          token_hash: string
          user_id: string
        }
        Insert: {
          access_token_id: string
          client_id: string
          created_at?: string
          id?: string
          rotated_at?: string | null
          token_hash: string
          user_id: string
        }
        Update: {
          access_token_id?: string
          client_id?: string
          created_at?: string
          id?: string
          rotated_at?: string | null
          token_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_oauth_refresh_tokens_client_id_fkey"
            columns: ["client_id"]
            referencedRelation: "mcp_oauth_clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "mcp_oauth_refresh_tokens_token_same_user"
            columns: ["user_id", "access_token_id"]
            referencedRelation: "mcp_access_tokens"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      mcp_rate_limit_buckets: {
        Row: {
          bucket_key: string
          hits: number
          window_start: string
        }
        Insert: {
          bucket_key: string
          hits?: number
          window_start: string
        }
        Update: {
          bucket_key?: string
          hits?: number
          window_start?: string
        }
        Relationships: []
      }
      mcp_scheduled_actions: {
        Row: {
          args: NonNullable<Json>
          attempt_count: number
          created_at: string
          cron_expression: string | null
          id: string
          last_error: string | null
          last_outcome: string | null
          last_run_at: string | null
          next_run_at: string
          operation: string
          run_at: string | null
          status: string
          token_id: string
          tool_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          args: NonNullable<Json>
          attempt_count?: number
          created_at?: string
          cron_expression?: string | null
          id?: string
          last_error?: string | null
          last_outcome?: string | null
          last_run_at?: string | null
          next_run_at: string
          operation: string
          run_at?: string | null
          status?: string
          token_id: string
          tool_name: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          args?: NonNullable<Json>
          attempt_count?: number
          created_at?: string
          cron_expression?: string | null
          id?: string
          last_error?: string | null
          last_outcome?: string | null
          last_run_at?: string | null
          next_run_at?: string
          operation?: string
          run_at?: string | null
          status?: string
          token_id?: string
          tool_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_scheduled_actions_token_same_user"
            columns: ["user_id", "token_id"]
            referencedRelation: "mcp_access_tokens"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      mcp_widgets: {
        Row: {
          created_at: string
          data_source: NonNullable<Json>
          display: NonNullable<Json>
          id: string
          kind: string
          position: number
          slot: string
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          data_source: NonNullable<Json>
          display?: NonNullable<Json>
          id?: string
          kind: string
          position?: number
          slot?: string
          status?: string
          title: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          data_source?: NonNullable<Json>
          display?: NonNullable<Json>
          id?: string
          kind?: string
          position?: number
          slot?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      migration_115_orphaned_group_weight_log: {
        Row: {
          group_archived_at: string | null
          group_id: string
          group_position: number
          id: string
          logged_at: string
          user_id: string
          weight: string
        }
        Insert: {
          group_archived_at?: string | null
          group_id: string
          group_position: number
          id?: string
          logged_at?: string
          user_id: string
          weight: string
        }
        Update: {
          group_archived_at?: string | null
          group_id?: string
          group_position?: number
          id?: string
          logged_at?: string
          user_id?: string
          weight?: string
        }
        Relationships: []
      }
      migration_ledger: {
        Row: {
          applied_at: string
          filename: string
          md5: string
          note: string | null
          status: string
        }
        Insert: {
          applied_at?: string
          filename: string
          md5: string
          note?: string | null
          status?: string
        }
        Update: {
          applied_at?: string
          filename?: string
          md5?: string
          note?: string | null
          status?: string
        }
        Relationships: []
      }
      morning_routine_checks: {
        Row: {
          checked_date: string
          created_at: string
          id: string
          item_id: string
          user_id: string
        }
        Insert: {
          checked_date: string
          created_at?: string
          id?: string
          item_id: string
          user_id?: string
        }
        Update: {
          checked_date?: string
          created_at?: string
          id?: string
          item_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "morning_routine_checks_item_same_user"
            columns: ["user_id", "item_id"]
            referencedRelation: "morning_routine_items"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      morning_routine_items: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          label: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          label: string
          user_id?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          label?: string
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
      notification_reads: {
        Row: {
          date: string
          id: string
          notification_key: string
          read_at: string
          user_id: string
        }
        Insert: {
          date: string
          id?: string
          notification_key: string
          read_at?: string
          user_id?: string
        }
        Update: {
          date?: string
          id?: string
          notification_key?: string
          read_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pending_storage_deletions: {
        Row: {
          attempts: number
          created_at: string
          id: string
          last_error: string | null
          max_attempts: number
          storage_path: string
          user_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          storage_path: string
          user_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          storage_path?: string
          user_id?: string
        }
        Relationships: []
      }
      plan_micro_exercises: {
        Row: {
          exercise_id: string
          goal_type: string
          goal_value: number
          id: string
          notes: string | null
          plan_id: string
          position: number
          schedule_days: number[]
          user_id: string
        }
        Insert: {
          exercise_id: string
          goal_type: string
          goal_value: number
          id?: string
          notes?: string | null
          plan_id: string
          position: number
          schedule_days?: number[]
          user_id?: string
        }
        Update: {
          exercise_id?: string
          goal_type?: string
          goal_value?: number
          id?: string
          notes?: string | null
          plan_id?: string
          position?: number
          schedule_days?: number[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_micro_exercises_exercise_same_user"
            columns: ["user_id", "exercise_id"]
            referencedRelation: "exercises"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "plan_micro_exercises_plan_same_user"
            columns: ["user_id", "plan_id"]
            referencedRelation: "workout_plans"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      plan_session_exercises: {
        Row: {
          duration_minutes: number
          exercise_id: string
          id: string
          load_lb: number | null
          position: number
          session_id: string
          target_reps: number | null
          target_sets: number | null
          user_id: string
        }
        Insert: {
          duration_minutes: number
          exercise_id: string
          id?: string
          load_lb?: number | null
          position: number
          session_id: string
          target_reps?: number | null
          target_sets?: number | null
          user_id?: string
        }
        Update: {
          duration_minutes?: number
          exercise_id?: string
          id?: string
          load_lb?: number | null
          position?: number
          session_id?: string
          target_reps?: number | null
          target_sets?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_session_exercises_exercise_same_user"
            columns: ["user_id", "exercise_id"]
            referencedRelation: "exercises"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "plan_session_exercises_session_same_user"
            columns: ["user_id", "session_id"]
            referencedRelation: "plan_sessions"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      plan_sessions: {
        Row: {
          id: string
          name: string
          plan_id: string
          position: number
          schedule_days: number[]
          start_time: string | null
          user_id: string
          workout_id: string | null
        }
        Insert: {
          id?: string
          name: string
          plan_id: string
          position: number
          schedule_days?: number[]
          start_time?: string | null
          user_id?: string
          workout_id?: string | null
        }
        Update: {
          id?: string
          name?: string
          plan_id?: string
          position?: number
          schedule_days?: number[]
          start_time?: string | null
          user_id?: string
          workout_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_sessions_plan_same_user"
            columns: ["user_id", "plan_id"]
            referencedRelation: "workout_plans"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "plan_sessions_workout_same_user"
            columns: ["user_id", "workout_id"]
            referencedRelation: "workouts"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      practice_test_answers: {
        Row: {
          answered_at: string
          id: string
          practice_test_id: string
          question_id: string
          self_reported_correct: boolean
          user_id: string
        }
        Insert: {
          answered_at?: string
          id?: string
          practice_test_id: string
          question_id: string
          self_reported_correct: boolean
          user_id?: string
        }
        Update: {
          answered_at?: string
          id?: string
          practice_test_id?: string
          question_id?: string
          self_reported_correct?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "practice_test_answers_question_same_user"
            columns: ["user_id", "question_id"]
            referencedRelation: "questions"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "practice_test_answers_test_same_user"
            columns: ["user_id", "practice_test_id"]
            referencedRelation: "practice_tests"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      practice_tests: {
        Row: {
          assessment_id: string
          class_id: string
          completed_at: string | null
          created_at: string
          id: string
          interval_label: string
          question_ids: string[]
          score_pct: number | null
          status: string
          user_id: string
        }
        Insert: {
          assessment_id: string
          class_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          interval_label: string
          question_ids: string[]
          score_pct?: number | null
          status?: string
          user_id?: string
        }
        Update: {
          assessment_id?: string
          class_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          interval_label?: string
          question_ids?: string[]
          score_pct?: number | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "practice_tests_assessment_same_user"
            columns: ["user_id", "assessment_id"]
            referencedRelation: "class_assessments"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "practice_tests_class_same_user"
            columns: ["user_id", "class_id"]
            referencedRelation: "classes"
            referencedColumns: ["user_id", "id"]
          },
        ]
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
          ai_monthly_spend_cap_usd: number | null
          asr_madhab: string
          checkin_interval_minutes: number
          checkin_window_end: string
          checkin_window_start: string
          created_at: string
          display_name: string | null
          evening_close_time: string
          hidden_features: string[]
          location_label: string | null
          location_lat: number | null
          location_lng: number | null
          onboarding_completed: boolean
          paused_date: string | null
          pin_hash: string | null
          pin_lock_enabled: boolean
          prayer_calc_method: string
          qada_owed: number
          sleep_reminder_enabled: boolean
          theme_preset: string
          timezone: string
          tracking_started_on: string | null
          traveling_mode: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_monthly_spend_cap_usd?: number | null
          asr_madhab?: string
          checkin_interval_minutes?: number
          checkin_window_end?: string
          checkin_window_start?: string
          created_at?: string
          display_name?: string | null
          evening_close_time?: string
          hidden_features?: string[]
          location_label?: string | null
          location_lat?: number | null
          location_lng?: number | null
          onboarding_completed?: boolean
          paused_date?: string | null
          pin_hash?: string | null
          pin_lock_enabled?: boolean
          prayer_calc_method?: string
          qada_owed?: number
          sleep_reminder_enabled?: boolean
          theme_preset?: string
          timezone?: string
          tracking_started_on?: string | null
          traveling_mode?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_monthly_spend_cap_usd?: number | null
          asr_madhab?: string
          checkin_interval_minutes?: number
          checkin_window_end?: string
          checkin_window_start?: string
          created_at?: string
          display_name?: string | null
          evening_close_time?: string
          hidden_features?: string[]
          location_label?: string | null
          location_lat?: number | null
          location_lng?: number | null
          onboarding_completed?: boolean
          paused_date?: string | null
          pin_hash?: string | null
          pin_lock_enabled?: boolean
          prayer_calc_method?: string
          qada_owed?: number
          sleep_reminder_enabled?: boolean
          theme_preset?: string
          timezone?: string
          tracking_started_on?: string | null
          traveling_mode?: boolean
          updated_at?: string
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
      questions: {
        Row: {
          active: boolean
          answer: string
          class_id: string
          created_at: string
          id: string
          origin: string
          prompt: string
          source_anchor: string | null
          source_skipped: boolean
          topic: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          answer: string
          class_id: string
          created_at?: string
          id?: string
          origin?: string
          prompt: string
          source_anchor?: string | null
          source_skipped?: boolean
          topic?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          answer?: string
          class_id?: string
          created_at?: string
          id?: string
          origin?: string
          prompt?: string
          source_anchor?: string | null
          source_skipped?: boolean
          topic?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "questions_class_id_fkey"
            columns: ["user_id", "class_id"]
            referencedRelation: "classes"
            referencedColumns: ["user_id", "id"]
          },
        ]
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
            foreignKeyName: "rep_goals_exercise_same_user"
            columns: ["user_id", "exercise_id"]
            referencedRelation: "exercises"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      rescuetime_connections: {
        Row: {
          created_at: string
          encrypted_key: string
          key_last4: string
          last_sync_error: string | null
          last_synced_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          encrypted_key: string
          key_last4: string
          last_sync_error?: string | null
          last_synced_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          encrypted_key?: string
          key_last4?: string
          last_sync_error?: string | null
          last_synced_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      rescuetime_daily_summaries: {
        Row: {
          created_at: string
          distracting_percentage: number | null
          id: string
          neutral_percentage: number | null
          productive_percentage: number | null
          productivity_pulse: number | null
          summary_date: string
          total_hours: number | null
          updated_at: string
          user_id: string
          very_distracting_percentage: number | null
          very_productive_percentage: number | null
        }
        Insert: {
          created_at?: string
          distracting_percentage?: number | null
          id?: string
          neutral_percentage?: number | null
          productive_percentage?: number | null
          productivity_pulse?: number | null
          summary_date: string
          total_hours?: number | null
          updated_at?: string
          user_id: string
          very_distracting_percentage?: number | null
          very_productive_percentage?: number | null
        }
        Update: {
          created_at?: string
          distracting_percentage?: number | null
          id?: string
          neutral_percentage?: number | null
          productive_percentage?: number | null
          productivity_pulse?: number | null
          summary_date?: string
          total_hours?: number | null
          updated_at?: string
          user_id?: string
          very_distracting_percentage?: number | null
          very_productive_percentage?: number | null
        }
        Relationships: []
      }
      reviews: {
        Row: {
          ai_feedback: string | null
          ai_suggested_rating: number | null
          answered_text: string | null
          book_id: string | null
          card_id: string | null
          confidence: Database["public"]["Enums"]["confidence_level"] | null
          correct: boolean | null
          difficulty_after: number | null
          difficulty_before: number | null
          elapsed_ms: number | null
          id: string
          learning_steps_after: number
          question_id: string | null
          rating: number
          request_retention: number
          reviewed_at: string
          scheduled_days: number | null
          session_id: string | null
          stability_after: number | null
          stability_before: number | null
          state_after: Database["public"]["Enums"]["fsrs_state"]
          state_before: Database["public"]["Enums"]["fsrs_state"] | null
          user_id: string
        }
        Insert: {
          ai_feedback?: string | null
          ai_suggested_rating?: number | null
          answered_text?: string | null
          book_id?: string | null
          card_id?: string | null
          confidence?: Database["public"]["Enums"]["confidence_level"] | null
          correct?: boolean | null
          difficulty_after?: number | null
          difficulty_before?: number | null
          elapsed_ms?: number | null
          id?: string
          learning_steps_after: number
          question_id?: string | null
          rating: number
          request_retention: number
          reviewed_at?: string
          scheduled_days?: number | null
          session_id?: string | null
          stability_after?: number | null
          stability_before?: number | null
          state_after: Database["public"]["Enums"]["fsrs_state"]
          state_before?: Database["public"]["Enums"]["fsrs_state"] | null
          user_id: string
        }
        Update: {
          ai_feedback?: string | null
          ai_suggested_rating?: number | null
          answered_text?: string | null
          book_id?: string | null
          card_id?: string | null
          confidence?: Database["public"]["Enums"]["confidence_level"] | null
          correct?: boolean | null
          difficulty_after?: number | null
          difficulty_before?: number | null
          elapsed_ms?: number | null
          id?: string
          learning_steps_after?: number
          question_id?: string | null
          rating?: number
          request_retention?: number
          reviewed_at?: string
          scheduled_days?: number | null
          session_id?: string | null
          stability_after?: number | null
          stability_before?: number | null
          state_after?: Database["public"]["Enums"]["fsrs_state"]
          state_before?: Database["public"]["Enums"]["fsrs_state"] | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_book_id_fkey"
            columns: ["user_id", "book_id"]
            referencedRelation: "books"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "reviews_card_id_fkey"
            columns: ["user_id", "card_id"]
            referencedRelation: "cards"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "reviews_question_id_fkey"
            columns: ["user_id", "question_id"]
            referencedRelation: "questions"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "reviews_session_id_fkey"
            columns: ["user_id", "session_id"]
            referencedRelation: "work_sessions"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      schedule_event_cancellations: {
        Row: {
          created_at: string
          date: string
          event_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          event_id: string
          id?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          date?: string
          event_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_event_cancellations_event_same_user"
            columns: ["user_id", "event_id"]
            referencedRelation: "schedule_events"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      schedule_event_overrides: {
        Row: {
          created_at: string
          date: string
          end_time: string | null
          event_id: string
          event_time: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          end_time?: string | null
          event_id: string
          event_time: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          date?: string
          end_time?: string | null
          event_id?: string
          event_time?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_event_overrides_event_same_user"
            columns: ["user_id", "event_id"]
            referencedRelation: "schedule_events"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      schedule_events: {
        Row: {
          cancelled_on: string | null
          class_group_id: string | null
          class_id: string | null
          created_at: string
          day_of_week: number | null
          domain: string
          end_time: string | null
          event_date: string | null
          event_time: string | null
          id: string
          instructor: string | null
          is_recurring: boolean
          location: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancelled_on?: string | null
          class_group_id?: string | null
          class_id?: string | null
          created_at?: string
          day_of_week?: number | null
          domain: string
          end_time?: string | null
          event_date?: string | null
          event_time?: string | null
          id?: string
          instructor?: string | null
          is_recurring?: boolean
          location?: string | null
          title: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          cancelled_on?: string | null
          class_group_id?: string | null
          class_id?: string | null
          created_at?: string
          day_of_week?: number | null
          domain?: string
          end_time?: string | null
          event_date?: string | null
          event_time?: string | null
          id?: string
          instructor?: string | null
          is_recurring?: boolean
          location?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_events_class_same_user"
            columns: ["user_id", "class_id"]
            referencedRelation: "classes"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      self_explanations: {
        Row: {
          created_at: string
          id: string
          lesson_id: string
          prompt: string
          response: string | null
          session_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          lesson_id: string
          prompt: string
          response?: string | null
          session_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          lesson_id?: string
          prompt?: string
          response?: string | null
          session_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "self_explanations_lesson_id_fkey"
            columns: ["user_id", "lesson_id"]
            referencedRelation: "lessons"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "self_explanations_session_id_fkey"
            columns: ["user_id", "session_id"]
            referencedRelation: "work_sessions"
            referencedColumns: ["user_id", "id"]
          },
        ]
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
            foreignKeyName: "session_sets_exercise_same_user"
            columns: ["user_id", "exercise_id"]
            referencedRelation: "exercises"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "session_sets_session_same_user"
            columns: ["user_id", "session_id"]
            referencedRelation: "workout_sessions"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      sleep_intents: {
        Row: {
          created_at: string
          id: string
          intended_bedtime: string
          intent_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          intended_bedtime: string
          intent_date: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          intended_bedtime?: string
          intent_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sleep_reminder_log: {
        Row: {
          created_at: string
          id: string
          sent_date: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          sent_date: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          sent_date?: string
          user_id?: string
        }
        Relationships: []
      }
      source_chunks: {
        Row: {
          book_id: string
          embedding: string | null
          embedding_model: string | null
          id: string
          page_end: number | null
          page_start: number | null
          section_id: string | null
          sort_order: number
          text: string
          token_count: number | null
          user_id: string
        }
        Insert: {
          book_id: string
          embedding?: string | null
          embedding_model?: string | null
          id?: string
          page_end?: number | null
          page_start?: number | null
          section_id?: string | null
          sort_order?: number
          text: string
          token_count?: number | null
          user_id: string
        }
        Update: {
          book_id?: string
          embedding?: string | null
          embedding_model?: string | null
          id?: string
          page_end?: number | null
          page_start?: number | null
          section_id?: string | null
          sort_order?: number
          text?: string
          token_count?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_chunks_book_id_fkey"
            columns: ["user_id", "book_id"]
            referencedRelation: "books"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "source_chunks_section_id_fkey"
            columns: ["user_id", "section_id"]
            referencedRelation: "book_sections"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      sources: {
        Row: {
          book_id: string | null
          class_id: string | null
          id: string
          kind: string
          user_id: string
        }
        Insert: {
          book_id?: string | null
          class_id?: string | null
          id?: string
          kind: string
          user_id: string
        }
        Update: {
          book_id?: string | null
          class_id?: string | null
          id?: string
          kind?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sources_book_id_fkey"
            columns: ["user_id", "book_id"]
            referencedRelation: "books"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "sources_class_id_fkey"
            columns: ["user_id", "class_id"]
            referencedRelation: "classes"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      staged_deliverables: {
        Row: {
          batch_id: string
          committed_assessment_id: string | null
          confidence: number
          created_at: string
          date: string | null
          id: string
          name: string
          source_snippet: string | null
          type: string
          user_id: string
        }
        Insert: {
          batch_id: string
          committed_assessment_id?: string | null
          confidence: number
          created_at?: string
          date?: string | null
          id?: string
          name: string
          source_snippet?: string | null
          type: string
          user_id?: string
        }
        Update: {
          batch_id?: string
          committed_assessment_id?: string | null
          confidence?: number
          created_at?: string
          date?: string | null
          id?: string
          name?: string
          source_snippet?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staged_deliverables_batch_same_user"
            columns: ["user_id", "batch_id"]
            referencedRelation: "staging_batches"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "staged_deliverables_committed_assessment_same_user"
            columns: ["user_id", "committed_assessment_id"]
            referencedRelation: "class_assessments"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      staging_batches: {
        Row: {
          canvas_announcement_id: string | null
          canvas_assignment_id: string | null
          class_id: string
          created_at: string
          id: string
          raw_text: string | null
          source: string
          status: string
          user_id: string
        }
        Insert: {
          canvas_announcement_id?: string | null
          canvas_assignment_id?: string | null
          class_id: string
          created_at?: string
          id?: string
          raw_text?: string | null
          source: string
          status?: string
          user_id?: string
        }
        Update: {
          canvas_announcement_id?: string | null
          canvas_assignment_id?: string | null
          class_id?: string
          created_at?: string
          id?: string
          raw_text?: string | null
          source?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staging_batches_class_same_user"
            columns: ["user_id", "class_id"]
            referencedRelation: "classes"
            referencedColumns: ["user_id", "id"]
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
          updated_at: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          created_at?: string
          date: string
          id?: string
          prayer_name: string
          slot: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          completed?: boolean
          created_at?: string
          date?: string
          id?: string
          prayer_name?: string
          slot?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          class_id: string | null
          completed: boolean
          completed_at: string | null
          created_at: string
          domain: string | null
          due_date: string | null
          due_time: string | null
          dump_source: string | null
          id: string
          mit_rank: number | null
          planned_date: string | null
          planned_start_time: string | null
          task_type: string | null
          task_type_other_label: string | null
          title: string
          updated_at: string
          user_id: string
          worry_outcome: string | null
        }
        Insert: {
          class_id?: string | null
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          domain?: string | null
          due_date?: string | null
          due_time?: string | null
          dump_source?: string | null
          id?: string
          mit_rank?: number | null
          planned_date?: string | null
          planned_start_time?: string | null
          task_type?: string | null
          task_type_other_label?: string | null
          title: string
          updated_at?: string
          user_id?: string
          worry_outcome?: string | null
        }
        Update: {
          class_id?: string | null
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          domain?: string | null
          due_date?: string | null
          due_time?: string | null
          dump_source?: string | null
          id?: string
          mit_rank?: number | null
          planned_date?: string | null
          planned_start_time?: string | null
          task_type?: string | null
          task_type_other_label?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          worry_outcome?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_class_same_user"
            columns: ["user_id", "class_id"]
            referencedRelation: "classes"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      trigger_action_plans: {
        Row: {
          body: string
          created_at: string
          id: string
          supersede_reason: string | null
          superseded_at: string | null
          trigger_id: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          supersede_reason?: string | null
          superseded_at?: string | null
          trigger_id: string
          updated_at?: string
          user_id?: string
          version: number
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          supersede_reason?: string | null
          superseded_at?: string | null
          trigger_id?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "trigger_action_plans_trigger_same_user"
            columns: ["user_id", "trigger_id"]
            referencedRelation: "distraction_triggers"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      trigger_plan_outcomes: {
        Row: {
          created_at: string
          date: string
          followed: boolean
          id: string
          plan_id: string
          trigger_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          followed: boolean
          id?: string
          plan_id: string
          trigger_id: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          date?: string
          followed?: boolean
          id?: string
          plan_id?: string
          trigger_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trigger_plan_outcomes_plan_same_user"
            columns: ["user_id", "plan_id"]
            referencedRelation: "trigger_action_plans"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "trigger_plan_outcomes_trigger_same_user"
            columns: ["user_id", "trigger_id"]
            referencedRelation: "distraction_triggers"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      ulm_weekly_recaps: {
        Row: {
          created_at: string
          id: string
          overall_retention_pct: number
          strongest_book_id: string | null
          strongest_book_title: string | null
          trend: string
          user_id: string
          weakest_book_id: string | null
          weakest_book_title: string | null
          week_start: string
        }
        Insert: {
          created_at?: string
          id?: string
          overall_retention_pct: number
          strongest_book_id?: string | null
          strongest_book_title?: string | null
          trend: string
          user_id?: string
          weakest_book_id?: string | null
          weakest_book_title?: string | null
          week_start: string
        }
        Update: {
          created_at?: string
          id?: string
          overall_retention_pct?: number
          strongest_book_id?: string | null
          strongest_book_title?: string | null
          trend?: string
          user_id?: string
          weakest_book_id?: string | null
          weakest_book_title?: string | null
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "ulm_weekly_recaps_strongest_book_same_user"
            columns: ["user_id", "strongest_book_id"]
            referencedRelation: "books"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "ulm_weekly_recaps_weakest_book_same_user"
            columns: ["user_id", "weakest_book_id"]
            referencedRelation: "books"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      user_ai_preferences: {
        Row: {
          created_at: string
          model_tier: string
          provider: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          model_tier?: string
          provider?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          model_tier?: string
          provider?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_api_keys: {
        Row: {
          created_at: string
          encrypted_key: string
          key_last4: string
          label: string | null
          provider: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          encrypted_key: string
          key_last4: string
          label?: string | null
          provider: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          encrypted_key?: string
          key_last4?: string
          label?: string | null
          provider?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_domains: {
        Row: {
          archived_at: string | null
          created_at: string
          depth: string
          id: string
          key: string
          position: number
          updated_at: string
          user_id: string
          weight: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          depth?: string
          id?: string
          key: string
          position: number
          updated_at?: string
          user_id?: string
          weight?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          depth?: string
          id?: string
          key?: string
          position?: number
          updated_at?: string
          user_id?: string
          weight?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          ai_grading_enabled: boolean
          daily_new_limit: number
          desired_retention: number
          notification_enabled: boolean
          notification_time: string
          session_target_minutes: number
          updated_at: string
          user_id: string
          weekday_baselines: number[] | null
        }
        Insert: {
          ai_grading_enabled?: boolean
          daily_new_limit?: number
          desired_retention?: number
          notification_enabled?: boolean
          notification_time?: string
          session_target_minutes?: number
          updated_at?: string
          user_id?: string
          weekday_baselines?: number[] | null
        }
        Update: {
          ai_grading_enabled?: boolean
          daily_new_limit?: number
          desired_retention?: number
          notification_enabled?: boolean
          notification_time?: string
          session_target_minutes?: number
          updated_at?: string
          user_id?: string
          weekday_baselines?: number[] | null
        }
        Relationships: []
      }
      user_stats: {
        Row: {
          current_streak: number
          freezes_available: number
          freezes_used_total: number
          last_session_date: string | null
          longest_streak: number
          sessions_this_week: number
          total_reviews: number
          total_sessions: number
          user_id: string
          week_start_date: string | null
        }
        Insert: {
          current_streak?: number
          freezes_available?: number
          freezes_used_total?: number
          last_session_date?: string | null
          longest_streak?: number
          sessions_this_week?: number
          total_reviews?: number
          total_sessions?: number
          user_id?: string
          week_start_date?: string | null
        }
        Update: {
          current_streak?: number
          freezes_available?: number
          freezes_used_total?: number
          last_session_date?: string | null
          longest_streak?: number
          sessions_this_week?: number
          total_reviews?: number
          total_sessions?: number
          user_id?: string
          week_start_date?: string | null
        }
        Relationships: []
      }
      user_subdomains: {
        Row: {
          archived_at: string | null
          config: NonNullable<Json>
          created_at: string
          domain_id: string
          id: string
          key: string
          kind: string | null
          label: string
          position: number
          updated_at: string
          user_id: string
          widgets: NonNullable<Json>
        }
        Insert: {
          archived_at?: string | null
          config?: NonNullable<Json>
          created_at?: string
          domain_id: string
          id?: string
          key: string
          kind?: string | null
          label: string
          position: number
          updated_at?: string
          user_id?: string
          widgets?: NonNullable<Json>
        }
        Update: {
          archived_at?: string | null
          config?: NonNullable<Json>
          created_at?: string
          domain_id?: string
          id?: string
          key?: string
          kind?: string | null
          label?: string
          position?: number
          updated_at?: string
          user_id?: string
          widgets?: NonNullable<Json>
        }
        Relationships: [
          {
            foreignKeyName: "user_subdomains_domain_same_user"
            columns: ["user_id", "domain_id"]
            referencedRelation: "user_domains"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      weekly_goals: {
        Row: {
          created_at: string
          domain: string
          headline: string
          id: string
          locked: boolean
          milestones: NonNullable<Json>
          quran_page_target: number | null
          updated_at: string
          user_id: string
          week_start_date: string
        }
        Insert: {
          created_at?: string
          domain: string
          headline: string
          id?: string
          locked?: boolean
          milestones?: NonNullable<Json>
          quran_page_target?: number | null
          updated_at?: string
          user_id?: string
          week_start_date: string
        }
        Update: {
          created_at?: string
          domain?: string
          headline?: string
          id?: string
          locked?: boolean
          milestones?: NonNullable<Json>
          quran_page_target?: number | null
          updated_at?: string
          user_id?: string
          week_start_date?: string
        }
        Relationships: []
      }
      whoop_connections: {
        Row: {
          access_token_last4: string
          connected_at: string
          created_at: string
          encrypted_access_token: string
          encrypted_refresh_token: string
          scope: string
          token_expires_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token_last4: string
          connected_at?: string
          created_at?: string
          encrypted_access_token: string
          encrypted_refresh_token: string
          scope: string
          token_expires_at: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token_last4?: string
          connected_at?: string
          created_at?: string
          encrypted_access_token?: string
          encrypted_refresh_token?: string
          scope?: string
          token_expires_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      work_session_objectives: {
        Row: {
          completed: boolean
          completed_at: string | null
          created_at: string
          custom_text: string | null
          id: string
          kill_list_item_id: string | null
          kind: string
          position: number
          session_id: string
          task_id: string | null
          user_id: string
        }
        Insert: {
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          custom_text?: string | null
          id?: string
          kill_list_item_id?: string | null
          kind: string
          position: number
          session_id: string
          task_id?: string | null
          user_id?: string
        }
        Update: {
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          custom_text?: string | null
          id?: string
          kill_list_item_id?: string | null
          kind?: string
          position?: number
          session_id?: string
          task_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_session_objectives_kill_list_item_same_user"
            columns: ["user_id", "kill_list_item_id"]
            referencedRelation: "kill_list_items"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "work_session_objectives_session_same_user"
            columns: ["user_id", "session_id"]
            referencedRelation: "work_sessions"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "work_session_objectives_task_same_user"
            columns: ["user_id", "task_id"]
            referencedRelation: "tasks"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      work_sessions: {
        Row: {
          cards_reviewed: number | null
          class_id: string | null
          counts_toward_hours: boolean | null
          created_at: string
          ended_at: string | null
          goal_minutes: number | null
          hour_notified_at: string | null
          id: string
          kill_list_item_id: string | null
          kind: string
          local_date: string | null
          new_cards_introduced: number | null
          promotion_id: string | null
          rep_goal_id: string | null
          started_at: string
          study_methods: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          cards_reviewed?: number | null
          class_id?: string | null
          counts_toward_hours?: never
          created_at?: string
          ended_at?: string | null
          goal_minutes?: number | null
          hour_notified_at?: string | null
          id?: string
          kill_list_item_id?: string | null
          kind?: string
          local_date?: string | null
          new_cards_introduced?: number | null
          promotion_id?: string | null
          rep_goal_id?: string | null
          started_at?: string
          study_methods?: string[]
          updated_at?: string
          user_id?: string
        }
        Update: {
          cards_reviewed?: number | null
          class_id?: string | null
          counts_toward_hours?: never
          created_at?: string
          ended_at?: string | null
          goal_minutes?: number | null
          hour_notified_at?: string | null
          id?: string
          kill_list_item_id?: string | null
          kind?: string
          local_date?: string | null
          new_cards_introduced?: number | null
          promotion_id?: string | null
          rep_goal_id?: string | null
          started_at?: string
          study_methods?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_sessions_class_same_user"
            columns: ["user_id", "class_id"]
            referencedRelation: "classes"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "work_sessions_kill_list_item_fkey"
            columns: ["user_id", "kill_list_item_id"]
            referencedRelation: "kill_list_items"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "work_sessions_promotion_fkey"
            columns: ["user_id", "promotion_id"]
            referencedRelation: "lesson_promotions"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "work_sessions_rep_goal_fkey"
            columns: ["user_id", "rep_goal_id"]
            referencedRelation: "rep_goals"
            referencedColumns: ["user_id", "id"]
          },
        ]
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
            foreignKeyName: "workout_exercises_exercise_same_user"
            columns: ["user_id", "exercise_id"]
            referencedRelation: "exercises"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "workout_exercises_workout_same_user"
            columns: ["user_id", "workout_id"]
            referencedRelation: "workouts"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      workout_plans: {
        Row: {
          archived: boolean
          created_at: string
          id: string
          kind: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          id?: string
          kind: string
          name: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          id?: string
          kind?: string
          name?: string
          updated_at?: string
          user_id?: string
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
            foreignKeyName: "workout_schedule_workout_same_user"
            columns: ["user_id", "workout_id"]
            referencedRelation: "workouts"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      workout_sessions: {
        Row: {
          created_at: string
          date: string
          id: string
          plan_session_id: string | null
          source: string
          user_id: string
          workout_id: string | null
          workout_name: string | null
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          plan_session_id?: string | null
          source: string
          user_id?: string
          workout_id?: string | null
          workout_name?: string | null
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          plan_session_id?: string | null
          source?: string
          user_id?: string
          workout_id?: string | null
          workout_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workout_sessions_plan_session_same_user"
            columns: ["user_id", "plan_session_id"]
            referencedRelation: "plan_sessions"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "workout_sessions_workout_same_user"
            columns: ["user_id", "workout_id"]
            referencedRelation: "workouts"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      workouts: {
        Row: {
          archived: boolean
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      advance_ingestion_cursor: {
        Args: {
          p_expected_attempt: number
          p_expected_chunk_index: number
          p_expected_stage: Database["public"]["Enums"]["ingest_stage"]
          p_job_id: string
          p_next_chunk_index: number
          p_next_stage: Database["public"]["Enums"]["ingest_stage"]
        }
        Returns: {
          book_id: string
          consecutive_skipped_positions: number
          created_at: string
          cursor_attempt: number
          cursor_chunk_index: number | null
          id: string
          last_error: string | null
          leased_until: string | null
          max_attempts: number
          reingest: boolean
          skipped_positions: number
          stage: Database["public"]["Enums"]["ingest_stage"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "ingestion_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      book_is_deleted: { Args: { p_book_id: string }; Returns: boolean }
      claim_ingestion_job: {
        Args: Record<PropertyKey, never>
        Returns: {
          book_id: string
          consecutive_skipped_positions: number
          created_at: string
          cursor_attempt: number
          cursor_chunk_index: number | null
          id: string
          last_error: string | null
          leased_until: string | null
          max_attempts: number
          reingest: boolean
          skipped_positions: number
          stage: Database["public"]["Enums"]["ingest_stage"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "ingestion_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_lecture_transcription_job: {
        Args: Record<PropertyKey, never>
        Returns: {
          attempt_count: number
          claimed_at: string | null
          cost_usd: number | null
          created_at: string
          duration_seconds: number | null
          error_message: string | null
          id: string
          provider: string | null
          recording_id: string
          status: string
          transcript_text: string | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "lecture_transcripts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_staging_batch: { Args: { p_batch_id: string }; Returns: string }
      complete_session: {
        Args: { p_book_strengths?: Json; p_session_id: string }
        Returns: Json
      }
      complete_target: { Args: { p_target_id: string }; Returns: undefined }
      confirm_storage_deleted: {
        Args: { p_storage_path: string }
        Returns: undefined
      }
      confirm_workout_session: {
        Args: {
          p_date: string
          p_sets: Json
          p_workout_id: string
          p_workout_name: string
        }
        Returns: string
      }
      delete_book: { Args: { p_book_id: string }; Returns: Json }
      delete_class_assessment: {
        Args: { p_assessment_id: string }
        Returns: undefined
      }
      delete_coop_target: { Args: { p_target_id: string }; Returns: undefined }
      finalize_staging_batch: { Args: { p_batch_id: string }; Returns: boolean }
      get_session_queue: {
        Args: { p_limit_due: number; p_limit_new: number }
        Returns: {
          book_id: string
          card_id: string
          question_id: string
          queue_position: number
          reason: string
        }[]
      }
      get_vault_secrets: {
        Args: { secret_names: string[] }
        Returns: {
          decrypted_secret: string
          name: string
        }[]
      }
      mcp_oauth_prune_stale_clients: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      mcp_oauth_refresh_grant: {
        Args: {
          p_expires_at: string
          p_label: string
          p_new_access_token_hash: string
          p_new_access_token_last4: string
          p_new_refresh_token_hash: string
          p_refresh_token_hash: string
        }
        Returns: Json
      }
      mcp_rate_limit_consume: {
        Args: { p_keys: string[]; p_limits: number[]; p_window_seconds: number }
        Returns: Json
      }
      mcp_rate_limit_note_failure: {
        Args: { p_key: string; p_limit: number; p_window_seconds: number }
        Returns: Json
      }
      mcp_rate_limit_prune: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      merge_subdomain_config: {
        Args: { p_patch: Json; p_subdomain_id: string }
        Returns: {
          archived_at: string | null
          config: NonNullable<Json>
          created_at: string
          domain_id: string
          id: string
          key: string
          kind: string | null
          label: string
          position: number
          updated_at: string
          user_id: string
          widgets: NonNullable<Json>
        }
        SetofOptions: {
          from: "*"
          to: "user_subdomains"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      purge_user_data: { Args: { p_user_id: string }; Returns: undefined }
      record_plan_outcome: {
        Args: {
          p_date: string
          p_followed: boolean
          p_new_plan_body?: string
          p_reason?: string
          p_trigger_id: string
        }
        Returns: undefined
      }
      reorder_coop_target: {
        Args: { p_new_position: number; p_target_id: string }
        Returns: undefined
      }
      requeue_lecture_transcription: {
        Args: { p_recording_id: string }
        Returns: {
          attempt_count: number
          claimed_at: string | null
          cost_usd: number | null
          created_at: string
          duration_seconds: number | null
          error_message: string | null
          id: string
          provider: string | null
          recording_id: string
          status: string
          transcript_text: string | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "lecture_transcripts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      restore_book: {
        Args: { p_book_id: string }
        Returns: {
          author: string | null
          cover_hue: number | null
          created_at: string
          deck_completed_at: string | null
          deleted_at: string | null
          error_message: string | null
          file_path: string | null
          file_size_bytes: number | null
          id: string
          ingestion_mode: string
          lesson_count: number
          milestone_80_at: string | null
          page_count: number | null
          progress_pct: number
          ready_at: string | null
          stage: Database["public"]["Enums"]["ingest_stage"]
          status: Database["public"]["Enums"]["book_status"]
          title: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "books"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_allocation_checkin: {
        Args: {
          p_allocations: Json
          p_wasted_minutes: number
          p_window_end: string
          p_window_start: string
        }
        Returns: string
      }
      save_trigger_plan: {
        Args: { p_body: string; p_reason?: string; p_trigger_id: string }
        Returns: {
          body: string
          created_at: string
          id: string
          supersede_reason: string | null
          superseded_at: string | null
          trigger_id: string
          updated_at: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "trigger_action_plans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_workout: {
        Args: { p_exercises: Json; p_name: string; p_workout_id: string }
        Returns: undefined
      }
      seed_meditations_deck: { Args: { p_lessons: Json }; Returns: Json }
      skip_ingestion_cursor_position: {
        Args: {
          p_expected_attempt: number
          p_expected_chunk_index: number
          p_expected_stage: Database["public"]["Enums"]["ingest_stage"]
          p_job_id: string
          p_next_chunk_index: number
          p_next_stage: Database["public"]["Enums"]["ingest_stage"]
          p_skip_reason: string
        }
        Returns: {
          book_id: string
          consecutive_skipped_positions: number
          created_at: string
          cursor_attempt: number
          cursor_chunk_index: number | null
          id: string
          last_error: string | null
          leased_until: string | null
          max_attempts: number
          reingest: boolean
          skipped_positions: number
          stage: Database["public"]["Enums"]["ingest_stage"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "ingestion_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_session: {
        Args: { p_local_date: string }
        Returns: {
          cards_reviewed: number | null
          class_id: string | null
          counts_toward_hours: boolean | null
          created_at: string
          ended_at: string | null
          goal_minutes: number | null
          hour_notified_at: string | null
          id: string
          kill_list_item_id: string | null
          kind: string
          local_date: string | null
          new_cards_introduced: number | null
          promotion_id: string | null
          rep_goal_id: string | null
          started_at: string
          study_methods: string[]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "work_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_question_review: {
        Args: {
          p_ai_feedback: string
          p_ai_suggested_rating: number
          p_answered_text: string
          p_confidence?: Database["public"]["Enums"]["confidence_level"]
          p_correct?: boolean
          p_elapsed_ms: number
          p_next_state: Json
          p_question_id: string
          p_rating: number
          p_session_id: string
        }
        Returns: {
          ai_feedback: string | null
          ai_suggested_rating: number | null
          answered_text: string | null
          book_id: string | null
          card_id: string | null
          confidence: Database["public"]["Enums"]["confidence_level"] | null
          correct: boolean | null
          difficulty_after: number | null
          difficulty_before: number | null
          elapsed_ms: number | null
          id: string
          learning_steps_after: number
          question_id: string | null
          rating: number
          request_retention: number
          reviewed_at: string
          scheduled_days: number | null
          session_id: string | null
          stability_after: number | null
          stability_before: number | null
          state_after: Database["public"]["Enums"]["fsrs_state"]
          state_before: Database["public"]["Enums"]["fsrs_state"] | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "reviews"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_review: {
        Args: {
          p_ai_feedback: string
          p_ai_suggested_rating: number
          p_answered_text: string
          p_card_id: string
          p_confidence?: Database["public"]["Enums"]["confidence_level"]
          p_elapsed_ms: number
          p_next_state: Json
          p_rating: number
          p_session_id: string
        }
        Returns: {
          ai_feedback: string | null
          ai_suggested_rating: number | null
          answered_text: string | null
          book_id: string | null
          card_id: string | null
          confidence: Database["public"]["Enums"]["confidence_level"] | null
          correct: boolean | null
          difficulty_after: number | null
          difficulty_before: number | null
          elapsed_ms: number | null
          id: string
          learning_steps_after: number
          question_id: string | null
          rating: number
          request_retention: number
          reviewed_at: string
          scheduled_days: number | null
          session_id: string | null
          stability_after: number | null
          stability_before: number | null
          state_after: Database["public"]["Enums"]["fsrs_state"]
          state_before: Database["public"]["Enums"]["fsrs_state"] | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "reviews"
          isOneToOne: true
          isSetofReturn: false
        }
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
      book_status: "uploading" | "processing" | "ready" | "failed"
      confidence_level: "sure" | "think_so" | "guessing"
      evidence_strength: "author_anecdote" | "single_study" | "strong_research"
      extracted_by: "model" | "heuristic" | "seed"
      fsrs_state: "new" | "learning" | "review" | "relearning"
      ingest_stage:
        | "queued"
        | "extracting_text"
        | "parsing_structure"
        | "chunking"
        | "embedding"
        | "extracting_lessons"
        | "merging"
        | "verifying_grounding"
        | "generating_cards"
        | "finalizing"
        | "done"
        | "failed"
      lesson_status: "active" | "archived" | "rejected"
      lesson_verdict: "adopted" | "abandoned" | "still_testing"
      prompt_type: "free_recall" | "application" | "cloze" | "why"
      relevance_floor_status: "not_checked" | "passed" | "failed"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      book_status: ["uploading", "processing", "ready", "failed"],
      confidence_level: ["sure", "think_so", "guessing"],
      evidence_strength: ["author_anecdote", "single_study", "strong_research"],
      extracted_by: ["model", "heuristic", "seed"],
      fsrs_state: ["new", "learning", "review", "relearning"],
      ingest_stage: [
        "queued",
        "extracting_text",
        "parsing_structure",
        "chunking",
        "embedding",
        "extracting_lessons",
        "merging",
        "verifying_grounding",
        "generating_cards",
        "finalizing",
        "done",
        "failed",
      ],
      lesson_status: ["active", "archived", "rejected"],
      lesson_verdict: ["adopted", "abandoned", "still_testing"],
      prompt_type: ["free_recall", "application", "cloze", "why"],
      relevance_floor_status: ["not_checked", "passed", "failed"],
    },
  },
} as const

