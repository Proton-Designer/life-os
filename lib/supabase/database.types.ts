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
            isOneToOne: false
            referencedRelation: "workout_plans"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "active_workout_plans_routine_plan_same_user"
            columns: ["user_id", "routine_plan_id"]
            isOneToOne: false
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
      book_sections: {
        Row: {
          book_id: string
          id: string
          level: number
          page_end: number | null
          page_start: number | null
          sort_order: number
          title: string | null
          user_id: string
        }
        Insert: {
          book_id: string
          id?: string
          level?: number
          page_end?: number | null
          page_start?: number | null
          sort_order?: number
          title?: string | null
          user_id: string
        }
        Update: {
          book_id?: string
          id?: string
          level?: number
          page_end?: number | null
          page_start?: number | null
          sort_order?: number
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "book_sections_book_id_fkey"
            columns: ["user_id", "book_id"]
            isOneToOne: false
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
          lesson_count: number
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
          lesson_count?: number
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
          lesson_count?: number
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
      card_states: {
        Row: {
          book_id: string | null
          card_id: string
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
          card_id: string
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
          card_id?: string
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
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "card_states_card_id_fkey"
            columns: ["user_id", "card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "card_states_question_id_fkey"
            columns: ["user_id", "question_id"]
            isOneToOne: false
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
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cards_book_id_fkey"
            columns: ["user_id", "book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "cards_lesson_id_fkey"
            columns: ["user_id", "lesson_id"]
            isOneToOne: false
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
            isOneToOne: false
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
            isOneToOne: false
            referencedRelation: "work_sessions"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      class_assessments: {
        Row: {
          class_id: string
          created_at: string
          date: string
          id: string
          is_excused: boolean
          name: string
          points_earned: number | null
          points_possible: number | null
          task_id: string | null
          type: string
          user_id: string
          weight_pct: number | null
        }
        Insert: {
          class_id: string
          created_at?: string
          date: string
          id?: string
          is_excused?: boolean
          name: string
          points_earned?: number | null
          points_possible?: number | null
          task_id?: string | null
          type: string
          user_id?: string
          weight_pct?: number | null
        }
        Update: {
          class_id?: string
          created_at?: string
          date?: string
          id?: string
          is_excused?: boolean
          name?: string
          points_earned?: number | null
          points_possible?: number | null
          task_id?: string | null
          type?: string
          user_id?: string
          weight_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "class_assessments_class_same_user"
            columns: ["user_id", "class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "class_assessments_task_same_user"
            columns: ["user_id", "task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      classes: {
        Row: {
          code: string
          confidence_rating: number | null
          created_at: string
          difficulty_rating: number | null
          id: string
          instructor: string | null
          position: number | null
          room: string | null
          short_name: string | null
          syllabus_path: string | null
          target_grade_pct: number | null
          user_id: string
        }
        Insert: {
          code: string
          confidence_rating?: number | null
          created_at?: string
          difficulty_rating?: number | null
          id?: string
          instructor?: string | null
          position?: number | null
          room?: string | null
          short_name?: string | null
          syllabus_path?: string | null
          target_grade_pct?: number | null
          user_id?: string
        }
        Update: {
          code?: string
          confidence_rating?: number | null
          created_at?: string
          difficulty_rating?: number | null
          id?: string
          instructor?: string | null
          position?: number | null
          room?: string | null
          short_name?: string | null
          syllabus_path?: string | null
          target_grade_pct?: number | null
          user_id?: string
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
          completed_at: string | null
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
          completed_at?: string | null
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
          completed_at?: string | null
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
            foreignKeyName: "coop_tasks_target_same_user"
            columns: ["user_id", "target_id"]
            isOneToOne: false
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
            foreignKeyName: "deen_habit_logs_habit_same_user"
            columns: ["user_id", "habit_id"]
            isOneToOne: false
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
            foreignKeyName: "deen_weekly_focus_habit_same_user"
            columns: ["user_id", "habit_id"]
            isOneToOne: false
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
          trigger_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          reflection_entry_id?: string | null
          reflection_tier?: number | null
          trigger_id: string
          user_id?: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          reflection_entry_id?: string | null
          reflection_tier?: number | null
          trigger_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "distraction_events_reflection_same_user"
            columns: ["user_id", "reflection_entry_id"]
            isOneToOne: false
            referencedRelation: "reflection_entries"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "distraction_events_trigger_same_user"
            columns: ["user_id", "trigger_id"]
            isOneToOne: false
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
          user_id: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          description?: string | null
          domain: string
          id?: string
          name: string
          user_id?: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          description?: string | null
          domain?: string
          id?: string
          name?: string
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
      fitness_benchmarks: {
        Row: {
          created_at: string
          date: string
          exercise_id: string | null
          id: string
          max_reps: number
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          exercise_id?: string | null
          id?: string
          max_reps: number
          user_id?: string
        }
        Update: {
          created_at?: string
          date?: string
          exercise_id?: string | null
          id?: string
          max_reps?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fitness_benchmarks_exercise_same_user"
            columns: ["user_id", "exercise_id"]
            isOneToOne: false
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
            isOneToOne: false
            referencedRelation: "custom_habits"
            referencedColumns: ["user_id", "id"]
          },
        ]
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
            isOneToOne: false
            referencedRelation: "ingestion_jobs"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      ingestion_jobs: {
        Row: {
          book_id: string
          created_at: string
          cursor_attempt: number
          cursor_chunk_index: number | null
          id: string
          last_error: string | null
          leased_until: string | null
          max_attempts: number
          reingest: boolean
          stage: Database["public"]["Enums"]["ingest_stage"]
          updated_at: string
          user_id: string
        }
        Insert: {
          book_id: string
          created_at?: string
          cursor_attempt?: number
          cursor_chunk_index?: number | null
          id?: string
          last_error?: string | null
          leased_until?: string | null
          max_attempts?: number
          reingest?: boolean
          stage?: Database["public"]["Enums"]["ingest_stage"]
          updated_at?: string
          user_id: string
        }
        Update: {
          book_id?: string
          created_at?: string
          cursor_attempt?: number
          cursor_chunk_index?: number | null
          id?: string
          last_error?: string | null
          leased_until?: string | null
          max_attempts?: number
          reingest?: boolean
          stage?: Database["public"]["Enums"]["ingest_stage"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_jobs_book_id_fkey"
            columns: ["user_id", "book_id"]
            isOneToOne: false
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
          user_id?: string
        }
        Relationships: []
      }
      lessons: {
        Row: {
          action_template: string | null
          book_id: string
          core_claim: string | null
          created_at: string
          embedding: string | null
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
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "lessons_section_id_fkey"
            columns: ["user_id", "section_id"]
            isOneToOne: false
            referencedRelation: "book_sections"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "lessons_source_chunk_id_fkey"
            columns: ["user_id", "source_chunk_id"]
            isOneToOne: false
            referencedRelation: "source_chunks"
            referencedColumns: ["user_id", "id"]
          },
        ]
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
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "plan_micro_exercises_plan_same_user"
            columns: ["user_id", "plan_id"]
            isOneToOne: false
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
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "plan_session_exercises_session_same_user"
            columns: ["user_id", "session_id"]
            isOneToOne: false
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
            isOneToOne: false
            referencedRelation: "workout_plans"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "plan_sessions_workout_same_user"
            columns: ["user_id", "workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
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
          asr_madhab: string
          checkin_interval_minutes: number
          checkin_window_end: string
          checkin_window_start: string
          created_at: string
          display_name: string | null
          evening_close_time: string
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
          tracking_started_on: string | null
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
          evening_close_time?: string
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
          tracking_started_on?: string | null
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
          evening_close_time?: string
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
          tracking_started_on?: string | null
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
            isOneToOne: false
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
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["user_id", "id"]
          },
        ]
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
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "reviews_card_id_fkey"
            columns: ["user_id", "card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "reviews_question_id_fkey"
            columns: ["user_id", "question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "reviews_session_id_fkey"
            columns: ["user_id", "session_id"]
            isOneToOne: false
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
            isOneToOne: false
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
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          end_time?: string | null
          event_id: string
          event_time: string
          id?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          date?: string
          end_time?: string | null
          event_id?: string
          event_time?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_event_overrides_event_same_user"
            columns: ["user_id", "event_id"]
            isOneToOne: false
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
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_events_class_same_user"
            columns: ["user_id", "class_id"]
            isOneToOne: false
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
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "self_explanations_session_id_fkey"
            columns: ["user_id", "session_id"]
            isOneToOne: false
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
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "session_sets_session_same_user"
            columns: ["user_id", "session_id"]
            isOneToOne: false
            referencedRelation: "workout_sessions"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      source_chunks: {
        Row: {
          book_id: string
          embedding: string | null
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
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "source_chunks_section_id_fkey"
            columns: ["user_id", "section_id"]
            isOneToOne: false
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
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "sources_class_id_fkey"
            columns: ["user_id", "class_id"]
            isOneToOne: false
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
          task_type: string | null
          task_type_other_label: string | null
          title: string
          user_id: string
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
          task_type?: string | null
          task_type_other_label?: string | null
          title: string
          user_id?: string
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
          task_type?: string | null
          task_type_other_label?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_class_same_user"
            columns: ["user_id", "class_id"]
            isOneToOne: false
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
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "trigger_action_plans_trigger_same_user"
            columns: ["user_id", "trigger_id"]
            isOneToOne: false
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
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          followed: boolean
          id?: string
          plan_id: string
          trigger_id: string
          user_id?: string
        }
        Update: {
          created_at?: string
          date?: string
          followed?: boolean
          id?: string
          plan_id?: string
          trigger_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trigger_plan_outcomes_plan_same_user"
            columns: ["user_id", "plan_id"]
            isOneToOne: false
            referencedRelation: "trigger_action_plans"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "trigger_plan_outcomes_trigger_same_user"
            columns: ["user_id", "trigger_id"]
            isOneToOne: false
            referencedRelation: "distraction_triggers"
            referencedColumns: ["user_id", "id"]
          },
        ]
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
          config: Json
          created_at: string
          domain_id: string
          id: string
          key: string
          kind: string | null
          label: string
          position: number
          updated_at: string
          user_id: string
          widgets: Json
        }
        Insert: {
          archived_at?: string | null
          config?: Json
          created_at?: string
          domain_id: string
          id?: string
          key: string
          kind?: string | null
          label: string
          position: number
          updated_at?: string
          user_id?: string
          widgets?: Json
        }
        Update: {
          archived_at?: string | null
          config?: Json
          created_at?: string
          domain_id?: string
          id?: string
          key?: string
          kind?: string | null
          label?: string
          position?: number
          updated_at?: string
          user_id?: string
          widgets?: Json
        }
        Relationships: [
          {
            foreignKeyName: "user_subdomains_domain_same_user"
            columns: ["user_id", "domain_id"]
            isOneToOne: false
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
          cards_reviewed: number | null
          counts_toward_hours: boolean | null
          created_at: string
          ended_at: string | null
          id: string
          kill_list_item_id: string | null
          kind: string
          local_date: string | null
          new_cards_introduced: number | null
          promotion_id: string | null
          rep_goal_id: string | null
          started_at: string
          user_id: string
        }
        Insert: {
          cards_reviewed?: number | null
          counts_toward_hours?: boolean | null
          created_at?: string
          ended_at?: string | null
          id?: string
          kill_list_item_id?: string | null
          kind?: string
          local_date?: string | null
          new_cards_introduced?: number | null
          promotion_id?: string | null
          rep_goal_id?: string | null
          started_at?: string
          user_id?: string
        }
        Update: {
          cards_reviewed?: number | null
          counts_toward_hours?: boolean | null
          created_at?: string
          ended_at?: string | null
          id?: string
          kill_list_item_id?: string | null
          kind?: string
          local_date?: string | null
          new_cards_introduced?: number | null
          promotion_id?: string | null
          rep_goal_id?: string | null
          started_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_sessions_kill_list_item_fkey"
            columns: ["user_id", "kill_list_item_id"]
            isOneToOne: false
            referencedRelation: "kill_list_items"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "work_sessions_rep_goal_fkey"
            columns: ["user_id", "rep_goal_id"]
            isOneToOne: false
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
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "workout_exercises_workout_same_user"
            columns: ["user_id", "workout_id"]
            isOneToOne: false
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
          user_id: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          id?: string
          kind: string
          name: string
          user_id?: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          id?: string
          kind?: string
          name?: string
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
            isOneToOne: false
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
            isOneToOne: false
            referencedRelation: "plan_sessions"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "workout_sessions_workout_same_user"
            columns: ["user_id", "workout_id"]
            isOneToOne: false
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
          created_at: string
          cursor_attempt: number
          cursor_chunk_index: number | null
          id: string
          last_error: string | null
          leased_until: string | null
          max_attempts: number
          reingest: boolean
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
        Args: never
        Returns: {
          book_id: string
          created_at: string
          cursor_attempt: number
          cursor_chunk_index: number | null
          id: string
          last_error: string | null
          leased_until: string | null
          max_attempts: number
          reingest: boolean
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
      complete_session: { Args: { p_session_id: string }; Returns: Json }
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
      get_session_queue: {
        Args: { p_limit_due: number; p_limit_new: number }
        Returns: {
          book_id: string
          card_id: string
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
      merge_subdomain_config: {
        Args: { p_patch: Json; p_subdomain_id: string }
        Returns: {
          archived_at: string | null
          config: Json
          created_at: string
          domain_id: string
          id: string
          key: string
          kind: string | null
          label: string
          position: number
          updated_at: string
          user_id: string
          widgets: Json
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
          lesson_count: number
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
      start_session: {
        Args: { p_local_date: string }
        Returns: {
          cards_reviewed: number | null
          counts_toward_hours: boolean | null
          created_at: string
          ended_at: string | null
          id: string
          kill_list_item_id: string | null
          kind: string
          local_date: string | null
          new_cards_introduced: number | null
          promotion_id: string | null
          rep_goal_id: string | null
          started_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "work_sessions"
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
      prompt_type: ["free_recall", "application", "cloze", "why"],
      relevance_floor_status: ["not_checked", "passed", "failed"],
    },
  },
} as const

