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
      achievements: {
        Row: {
          code: string
          created_at: string
          criteria_type: string
          criteria_value: number
          description: string | null
          gold_bonus: number
          grants_title_code: string | null
          hint: string | null
          icon: string | null
          id: string
          is_hidden: boolean
          name: string
          rarity: string
          title_text: string | null
          xp_bonus: number
        }
        Insert: {
          code: string
          created_at?: string
          criteria_type: string
          criteria_value: number
          description?: string | null
          gold_bonus?: number
          grants_title_code?: string | null
          hint?: string | null
          icon?: string | null
          id?: string
          is_hidden?: boolean
          name: string
          rarity?: string
          title_text?: string | null
          xp_bonus?: number
        }
        Update: {
          code?: string
          created_at?: string
          criteria_type?: string
          criteria_value?: number
          description?: string | null
          gold_bonus?: number
          grants_title_code?: string | null
          hint?: string | null
          icon?: string | null
          id?: string
          is_hidden?: boolean
          name?: string
          rarity?: string
          title_text?: string | null
          xp_bonus?: number
        }
        Relationships: []
      }
      announcements: {
        Row: {
          author_id: string
          body: string | null
          classroom_id: string
          created_at: string
          id: string
          is_pinned: boolean
          title: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body?: string | null
          classroom_id: string
          created_at?: string
          id?: string
          is_pinned?: boolean
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string | null
          classroom_id?: string
          created_at?: string
          id?: string
          is_pinned?: boolean
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      assignment_comments: {
        Row: {
          assignment_id: string
          author_id: string
          content: string
          created_at: string
          id: string
          is_edited: boolean
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          assignment_id: string
          author_id: string
          content: string
          created_at?: string
          id?: string
          is_edited?: boolean
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          assignment_id?: string
          author_id?: string
          content?: string
          created_at?: string
          id?: string
          is_edited?: boolean
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_comments_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "assignment_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      assignments: {
        Row: {
          allow_late: boolean
          assignment_type: string
          attachments: Json
          classroom_id: string
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          late_penalty_percent: number
          max_score: number
          rubric: Json | null
          sample_video_url: string | null
          status: string
          title: string
          updated_at: string
          xp_reward: number
        }
        Insert: {
          allow_late?: boolean
          assignment_type?: string
          attachments?: Json
          classroom_id: string
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          late_penalty_percent?: number
          max_score?: number
          rubric?: Json | null
          sample_video_url?: string | null
          status?: string
          title: string
          updated_at?: string
          xp_reward?: number
        }
        Update: {
          allow_late?: boolean
          assignment_type?: string
          attachments?: Json
          classroom_id?: string
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          late_penalty_percent?: number
          max_score?: number
          rubric?: Json | null
          sample_video_url?: string | null
          status?: string
          title?: string
          updated_at?: string
          xp_reward?: number
        }
        Relationships: [
          {
            foreignKeyName: "assignments_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_records: {
        Row: {
          id: string
          marked_at: string
          note: string | null
          session_id: string
          status: Database["public"]["Enums"]["attendance_status"]
          user_id: string
        }
        Insert: {
          id?: string
          marked_at?: string
          note?: string | null
          session_id: string
          status?: Database["public"]["Enums"]["attendance_status"]
          user_id: string
        }
        Update: {
          id?: string
          marked_at?: string
          note?: string | null
          session_id?: string
          status?: Database["public"]["Enums"]["attendance_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "attendance_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "attendance_sessions_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_sessions: {
        Row: {
          check_in_code: string | null
          check_in_expires_at: string | null
          check_in_opens_at: string | null
          classroom_id: string
          created_at: string
          id: string
          session_date: string
          title: string
        }
        Insert: {
          check_in_code?: string | null
          check_in_expires_at?: string | null
          check_in_opens_at?: string | null
          classroom_id: string
          created_at?: string
          id?: string
          session_date?: string
          title: string
        }
        Update: {
          check_in_code?: string | null
          check_in_expires_at?: string | null
          check_in_opens_at?: string | null
          classroom_id?: string
          created_at?: string
          id?: string
          session_date?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_sessions_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
        ]
      }
      badges: {
        Row: {
          code: string
          created_at: string
          description: string | null
          icon: string | null
          id: string
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      bookings: {
        Row: {
          approved_at: string | null
          approver_id: string | null
          created_at: string
          ends_at: string
          guest_email: string | null
          guest_name: string | null
          guest_phone: string | null
          id: string
          notes: string | null
          purpose: string
          rejection_reason: string | null
          room_id: string
          starts_at: string
          status: Database["public"]["Enums"]["booking_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          approved_at?: string | null
          approver_id?: string | null
          created_at?: string
          ends_at: string
          guest_email?: string | null
          guest_name?: string | null
          guest_phone?: string | null
          id?: string
          notes?: string | null
          purpose: string
          rejection_reason?: string | null
          room_id: string
          starts_at: string
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          approved_at?: string | null
          approver_id?: string | null
          created_at?: string
          ends_at?: string
          guest_email?: string | null
          guest_name?: string | null
          guest_phone?: string | null
          id?: string
          notes?: string | null
          purpose?: string
          rejection_reason?: string | null
          room_id?: string
          starts_at?: string
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      canva_assignments: {
        Row: {
          canva_url: string
          created_at: string
          id: string
          opened_at: string | null
          session_id: string
          student_id: string
          updated_at: string
        }
        Insert: {
          canva_url: string
          created_at?: string
          id?: string
          opened_at?: string | null
          session_id: string
          student_id: string
          updated_at?: string
        }
        Update: {
          canva_url?: string
          created_at?: string
          id?: string
          opened_at?: string | null
          session_id?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "canva_assignments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "canva_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      canva_sessions: {
        Row: {
          classroom_id: string
          created_at: string
          created_by: string
          description: string | null
          id: string
          title: string
          updated_at: string
        }
        Insert: {
          classroom_id: string
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          title: string
          updated_at?: string
        }
        Update: {
          classroom_id?: string
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "canva_sessions_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_conversations: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      classroom_members: {
        Row: {
          classroom_id: string
          id: string
          joined_at: string
          user_id: string
        }
        Insert: {
          classroom_id: string
          id?: string
          joined_at?: string
          user_id: string
        }
        Update: {
          classroom_id?: string
          id?: string
          joined_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "classroom_members_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
        ]
      }
      classroom_scores: {
        Row: {
          classroom_id: string
          created_at: string
          id: string
          perfect_scores: number
          quests_completed: number
          streak_days: number
          updated_at: string
          user_id: string
          xp: number
        }
        Insert: {
          classroom_id: string
          created_at?: string
          id?: string
          perfect_scores?: number
          quests_completed?: number
          streak_days?: number
          updated_at?: string
          user_id: string
          xp?: number
        }
        Update: {
          classroom_id?: string
          created_at?: string
          id?: string
          perfect_scores?: number
          quests_completed?: number
          streak_days?: number
          updated_at?: string
          user_id?: string
          xp?: number
        }
        Relationships: []
      }
      classrooms: {
        Row: {
          created_at: string
          description: string | null
          grade_level: string | null
          id: string
          join_code: string
          name: string
          owner_id: string
          subject: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          grade_level?: string | null
          id?: string
          join_code?: string
          name: string
          owner_id: string
          subject?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          grade_level?: string | null
          id?: string
          join_code?: string
          name?: string
          owner_id?: string
          subject?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      daily_quest_attempts: {
        Row: {
          ai_feedback: string | null
          answers: Json
          completed_at: string
          gold_awarded: number
          id: string
          max_score: number
          per_question: Json | null
          quest_id: string
          score: number
          user_id: string
          xp_awarded: number
        }
        Insert: {
          ai_feedback?: string | null
          answers: Json
          completed_at?: string
          gold_awarded?: number
          id?: string
          max_score?: number
          per_question?: Json | null
          quest_id: string
          score?: number
          user_id: string
          xp_awarded?: number
        }
        Update: {
          ai_feedback?: string | null
          answers?: Json
          completed_at?: string
          gold_awarded?: number
          id?: string
          max_score?: number
          per_question?: Json | null
          quest_id?: string
          score?: number
          user_id?: string
          xp_awarded?: number
        }
        Relationships: []
      }
      daily_quest_question_progress: {
        Row: {
          answer: string | null
          created_at: string
          id: string
          q_index: number
          quest_id: string
          result: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          answer?: string | null
          created_at?: string
          id?: string
          q_index: number
          quest_id: string
          result?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          answer?: string | null
          created_at?: string
          id?: string
          q_index?: number
          quest_id?: string
          result?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      daily_quests: {
        Row: {
          classroom_id: string
          created_at: string
          created_by: string
          difficulty: string
          expires_at: string | null
          id: string
          is_active: boolean
          is_secret: boolean
          lesson_id: string | null
          max_gold_reward: number
          max_xp_reward: number
          min_level: number
          questions: Json
          required_title_code: string | null
          title: string
          topic: string | null
        }
        Insert: {
          classroom_id: string
          created_at?: string
          created_by: string
          difficulty?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          is_secret?: boolean
          lesson_id?: string | null
          max_gold_reward?: number
          max_xp_reward?: number
          min_level?: number
          questions: Json
          required_title_code?: string | null
          title: string
          topic?: string | null
        }
        Update: {
          classroom_id?: string
          created_at?: string
          created_by?: string
          difficulty?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          is_secret?: boolean
          lesson_id?: string | null
          max_gold_reward?: number
          max_xp_reward?: number
          min_level?: number
          questions?: Json
          required_title_code?: string | null
          title?: string
          topic?: string | null
        }
        Relationships: []
      }
      flashcard_decks: {
        Row: {
          classroom_id: string | null
          created_at: string
          description: string | null
          id: string
          is_public: boolean
          owner_id: string
          title: string
          updated_at: string
        }
        Insert: {
          classroom_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_public?: boolean
          owner_id: string
          title: string
          updated_at?: string
        }
        Update: {
          classroom_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_public?: boolean
          owner_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      flashcard_reviews: {
        Row: {
          card_id: string
          ease: number
          id: string
          last_reviewed_at: string
          next_review_at: string
          review_count: number
          user_id: string
        }
        Insert: {
          card_id: string
          ease?: number
          id?: string
          last_reviewed_at?: string
          next_review_at?: string
          review_count?: number
          user_id: string
        }
        Update: {
          card_id?: string
          ease?: number
          id?: string
          last_reviewed_at?: string
          next_review_at?: string
          review_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flashcard_reviews_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "flashcards"
            referencedColumns: ["id"]
          },
        ]
      }
      flashcards: {
        Row: {
          back: string
          created_at: string
          deck_id: string
          front: string
          id: string
          idx: number
        }
        Insert: {
          back: string
          created_at?: string
          deck_id: string
          front: string
          id?: string
          idx?: number
        }
        Update: {
          back?: string
          created_at?: string
          deck_id?: string
          front?: string
          id?: string
          idx?: number
        }
        Relationships: [
          {
            foreignKeyName: "flashcards_deck_id_fkey"
            columns: ["deck_id"]
            isOneToOne: false
            referencedRelation: "flashcard_decks"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_contents: {
        Row: {
          classroom_id: string
          content: string
          created_at: string
          created_by: string
          id: string
          lesson_date: string
          topic: string
          updated_at: string
        }
        Insert: {
          classroom_id: string
          content: string
          created_at?: string
          created_by: string
          id?: string
          lesson_date?: string
          topic: string
          updated_at?: string
        }
        Update: {
          classroom_id?: string
          content?: string
          created_at?: string
          created_by?: string
          id?: string
          lesson_date?: string
          topic?: string
          updated_at?: string
        }
        Relationships: []
      }
      materials: {
        Row: {
          classroom_id: string
          created_at: string
          description: string | null
          id: string
          lesson_id: string | null
          title: string
          url: string | null
        }
        Insert: {
          classroom_id: string
          created_at?: string
          description?: string | null
          id?: string
          lesson_id?: string | null
          title: string
          url?: string | null
        }
        Update: {
          classroom_id?: string
          created_at?: string
          description?: string | null
          id?: string
          lesson_id?: string | null
          title?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "materials_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materials_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lesson_contents"
            referencedColumns: ["id"]
          },
        ]
      }
      mission_progress: {
        Row: {
          ai_xp_awarded: number
          completed_at: string | null
          id: string
          item_id: string | null
          mission_id: string
          participation_xp_awarded: number
          quality_xp_awarded: number
          reviewed_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_xp_awarded?: number
          completed_at?: string | null
          id?: string
          item_id?: string | null
          mission_id: string
          participation_xp_awarded?: number
          quality_xp_awarded?: number
          reviewed_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_xp_awarded?: number
          completed_at?: string | null
          id?: string
          item_id?: string | null
          mission_id?: string
          participation_xp_awarded?: number
          quality_xp_awarded?: number
          reviewed_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mission_progress_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "weekly_mission_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mission_progress_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "weekly_missions"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          is_read: boolean
          link: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active_title_id: string | null
          avatar_url: string | null
          bio: string | null
          birthday: string | null
          birthday_visited: boolean
          created_at: string
          display_name: string | null
          early_bird_quests: number
          gold: number
          grade_level: string | null
          id: string
          last_login_bonus_date: string | null
          last_quest_date: string | null
          level: number
          max_perfect_streak: number
          night_owl_quests: number
          perfect_scores: number
          perfect_streak: number
          quests_completed: number
          speed_demon_quests: number
          streak_days: number
          updated_at: string
          weekend_warrior_quests: number
          xp: number
        }
        Insert: {
          active_title_id?: string | null
          avatar_url?: string | null
          bio?: string | null
          birthday?: string | null
          birthday_visited?: boolean
          created_at?: string
          display_name?: string | null
          early_bird_quests?: number
          gold?: number
          grade_level?: string | null
          id: string
          last_login_bonus_date?: string | null
          last_quest_date?: string | null
          level?: number
          max_perfect_streak?: number
          night_owl_quests?: number
          perfect_scores?: number
          perfect_streak?: number
          quests_completed?: number
          speed_demon_quests?: number
          streak_days?: number
          updated_at?: string
          weekend_warrior_quests?: number
          xp?: number
        }
        Update: {
          active_title_id?: string | null
          avatar_url?: string | null
          bio?: string | null
          birthday?: string | null
          birthday_visited?: boolean
          created_at?: string
          display_name?: string | null
          early_bird_quests?: number
          gold?: number
          grade_level?: string | null
          id?: string
          last_login_bonus_date?: string | null
          last_quest_date?: string | null
          level?: number
          max_perfect_streak?: number
          night_owl_quests?: number
          perfect_scores?: number
          perfect_streak?: number
          quests_completed?: number
          speed_demon_quests?: number
          streak_days?: number
          updated_at?: string
          weekend_warrior_quests?: number
          xp?: number
        }
        Relationships: []
      }
      quality_marks: {
        Row: {
          assignment_id: string | null
          awarded_at: string
          awarded_by: string
          classroom_id: string
          id: string
          label: string
          mark_type: string
          mission_id: string | null
          user_id: string
          xp_bonus: number
        }
        Insert: {
          assignment_id?: string | null
          awarded_at?: string
          awarded_by?: string
          classroom_id: string
          id?: string
          label: string
          mark_type: string
          mission_id?: string | null
          user_id: string
          xp_bonus?: number
        }
        Update: {
          assignment_id?: string | null
          awarded_at?: string
          awarded_by?: string
          classroom_id?: string
          id?: string
          label?: string
          mark_type?: string
          mission_id?: string | null
          user_id?: string
          xp_bonus?: number
        }
        Relationships: [
          {
            foreignKeyName: "quality_marks_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_marks_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_marks_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "weekly_missions"
            referencedColumns: ["id"]
          },
        ]
      }
      quests: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          gold_reward: number
          id: string
          is_active: boolean
          title: string
          xp_reward: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          gold_reward?: number
          id?: string
          is_active?: boolean
          title: string
          xp_reward?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          gold_reward?: number
          id?: string
          is_active?: boolean
          title?: string
          xp_reward?: number
        }
        Relationships: []
      }
      quiz_answers: {
        Row: {
          answer_idx: number
          answered_at: string
          id: string
          is_correct: boolean
          question_id: string
          score_awarded: number
          session_id: string
          time_taken_ms: number
          user_id: string
        }
        Insert: {
          answer_idx: number
          answered_at?: string
          id?: string
          is_correct?: boolean
          question_id: string
          score_awarded?: number
          session_id: string
          time_taken_ms?: number
          user_id: string
        }
        Update: {
          answer_idx?: number
          answered_at?: string
          id?: string
          is_correct?: boolean
          question_id?: string
          score_awarded?: number
          session_id?: string
          time_taken_ms?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quiz_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "quiz_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "quiz_questions_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_answers_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "quiz_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_participants: {
        Row: {
          display_name: string
          id: string
          joined_at: string
          session_id: string
          total_score: number
          user_id: string
        }
        Insert: {
          display_name: string
          id?: string
          joined_at?: string
          session_id: string
          total_score?: number
          user_id: string
        }
        Update: {
          display_name?: string
          id?: string
          joined_at?: string
          session_id?: string
          total_score?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quiz_participants_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "quiz_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_questions: {
        Row: {
          correct_idx: number
          created_at: string
          id: string
          idx: number
          options: Json
          points: number
          question: string
          session_id: string
          time_limit_seconds: number
        }
        Insert: {
          correct_idx: number
          created_at?: string
          id?: string
          idx: number
          options: Json
          points?: number
          question: string
          session_id: string
          time_limit_seconds?: number
        }
        Update: {
          correct_idx?: number
          created_at?: string
          id?: string
          idx?: number
          options?: Json
          points?: number
          question?: string
          session_id?: string
          time_limit_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "quiz_questions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "quiz_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_sessions: {
        Row: {
          classroom_id: string
          created_at: string
          current_question_idx: number
          finished_at: string | null
          host_id: string
          id: string
          join_code: string
          question_started_at: string | null
          started_at: string | null
          status: string
          title: string
        }
        Insert: {
          classroom_id: string
          created_at?: string
          current_question_idx?: number
          finished_at?: string | null
          host_id: string
          id?: string
          join_code?: string
          question_started_at?: string | null
          started_at?: string | null
          status?: string
          title: string
        }
        Update: {
          classroom_id?: string
          created_at?: string
          current_question_idx?: number
          finished_at?: string | null
          host_id?: string
          id?: string
          join_code?: string
          question_started_at?: string | null
          started_at?: string | null
          status?: string
          title?: string
        }
        Relationships: []
      }
      rooms: {
        Row: {
          amenities: string[]
          building: string | null
          capacity: number
          created_at: string
          description: string | null
          floor: number | null
          id: string
          image_url: string | null
          is_active: boolean
          location: string | null
          name: string
          room_type: string
          updated_at: string
        }
        Insert: {
          amenities?: string[]
          building?: string | null
          capacity?: number
          created_at?: string
          description?: string | null
          floor?: number | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          location?: string | null
          name: string
          room_type?: string
          updated_at?: string
        }
        Update: {
          amenities?: string[]
          building?: string | null
          capacity?: number
          created_at?: string
          description?: string | null
          floor?: number | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          location?: string | null
          name?: string
          room_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      shop_items: {
        Row: {
          created_at: string
          description: string | null
          gold_price: number
          icon: string | null
          id: string
          is_active: boolean
          kind: string
          name: string
          title_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          gold_price: number
          icon?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          name: string
          title_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          gold_price?: number
          icon?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          name?: string
          title_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shop_items_title_id_fkey"
            columns: ["title_id"]
            isOneToOne: false
            referencedRelation: "titles"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_purchases: {
        Row: {
          gold_spent: number
          id: string
          item_id: string
          purchased_at: string
          user_id: string
        }
        Insert: {
          gold_spent: number
          id?: string
          item_id: string
          purchased_at?: string
          user_id: string
        }
        Update: {
          gold_spent?: number
          id?: string
          item_id?: string
          purchased_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_purchases_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "shop_items"
            referencedColumns: ["id"]
          },
        ]
      }
      signup_rate_limit: {
        Row: {
          created_at: string
          id: number
          ip: string
        }
        Insert: {
          created_at?: string
          id?: number
          ip: string
        }
        Update: {
          created_at?: string
          id?: number
          ip?: string
        }
        Relationships: []
      }
      student_passwords: {
        Row: {
          password: string
          updated_at: string
          user_id: string
        }
        Insert: {
          password: string
          updated_at?: string
          user_id: string
        }
        Update: {
          password?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      submissions: {
        Row: {
          assignment_id: string
          attachments: Json
          content: string | null
          feedback: string | null
          file_url: string | null
          graded_at: string | null
          group_member_ids: string[] | null
          id: string
          is_late: boolean
          score: number | null
          submitted_at: string
          user_id: string
        }
        Insert: {
          assignment_id: string
          attachments?: Json
          content?: string | null
          feedback?: string | null
          file_url?: string | null
          graded_at?: string | null
          group_member_ids?: string[] | null
          id?: string
          is_late?: boolean
          score?: number | null
          submitted_at?: string
          user_id: string
        }
        Update: {
          assignment_id?: string
          attachments?: Json
          content?: string | null
          feedback?: string | null
          file_url?: string | null
          graded_at?: string | null
          group_member_ids?: string[] | null
          id?: string
          is_late?: boolean
          score?: number | null
          submitted_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "submissions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_applications: {
        Row: {
          created_at: string
          id: string
          note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      term_bonus_rules: {
        Row: {
          bonus_points: number
          classroom_id: string | null
          created_at: string
          created_by: string
          criteria_json: Json
          grade_level: string | null
          id: string
          is_active: boolean
          name: string
          rule_type: string
          updated_at: string
        }
        Insert: {
          bonus_points?: number
          classroom_id?: string | null
          created_at?: string
          created_by?: string
          criteria_json?: Json
          grade_level?: string | null
          id?: string
          is_active?: boolean
          name: string
          rule_type: string
          updated_at?: string
        }
        Update: {
          bonus_points?: number
          classroom_id?: string | null
          created_at?: string
          created_by?: string
          criteria_json?: Json
          grade_level?: string | null
          id?: string
          is_active?: boolean
          name?: string
          rule_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "term_bonus_rules_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
        ]
      }
      titles: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      user_achievements: {
        Row: {
          achievement_id: string
          id: string
          unlocked_at: string
          user_id: string
        }
        Insert: {
          achievement_id: string
          id?: string
          unlocked_at?: string
          user_id: string
        }
        Update: {
          achievement_id?: string
          id?: string
          unlocked_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_badges: {
        Row: {
          awarded_at: string
          badge_id: string
          id: string
          user_id: string
        }
        Insert: {
          awarded_at?: string
          badge_id: string
          id?: string
          user_id: string
        }
        Update: {
          awarded_at?: string
          badge_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_badges_badge_id_fkey"
            columns: ["badge_id"]
            isOneToOne: false
            referencedRelation: "badges"
            referencedColumns: ["id"]
          },
        ]
      }
      user_quests: {
        Row: {
          completed_at: string | null
          id: string
          quest_id: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          id?: string
          quest_id: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          id?: string
          quest_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_quests_quest_id_fkey"
            columns: ["quest_id"]
            isOneToOne: false
            referencedRelation: "quests"
            referencedColumns: ["id"]
          },
        ]
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
      user_titles: {
        Row: {
          awarded_at: string
          id: string
          is_active: boolean
          title_id: string
          user_id: string
        }
        Insert: {
          awarded_at?: string
          id?: string
          is_active?: boolean
          title_id: string
          user_id: string
        }
        Update: {
          awarded_at?: string
          id?: string
          is_active?: boolean
          title_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_titles_title_id_fkey"
            columns: ["title_id"]
            isOneToOne: false
            referencedRelation: "titles"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_mission_items: {
        Row: {
          created_at: string
          description: string | null
          id: string
          mission_id: string
          required: boolean
          sort_order: number
          source_id: string | null
          source_table: string | null
          title: string
          type: string
          xp_max: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          mission_id: string
          required?: boolean
          sort_order?: number
          source_id?: string | null
          source_table?: string | null
          title: string
          type: string
          xp_max?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          mission_id?: string
          required?: boolean
          sort_order?: number
          source_id?: string | null
          source_table?: string | null
          title?: string
          type?: string
          xp_max?: number
        }
        Relationships: [
          {
            foreignKeyName: "weekly_mission_items_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "weekly_missions"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_mission_recaps: {
        Row: {
          ai_summary: string | null
          audience: string
          classroom_id: string
          created_by: string
          generated_at: string
          id: string
          mission_id: string
          summary: Json
          user_id: string | null
        }
        Insert: {
          ai_summary?: string | null
          audience?: string
          classroom_id: string
          created_by?: string
          generated_at?: string
          id?: string
          mission_id: string
          summary?: Json
          user_id?: string | null
        }
        Update: {
          ai_summary?: string | null
          audience?: string
          classroom_id?: string
          created_by?: string
          generated_at?: string
          id?: string
          mission_id?: string
          summary?: Json
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "weekly_mission_recaps_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_mission_recaps_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "weekly_missions"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_mission_team_members: {
        Row: {
          contribution_mark: number
          helper_mark: boolean
          id: string
          joined_at: string
          role_label: string | null
          team_id: string
          user_id: string
        }
        Insert: {
          contribution_mark?: number
          helper_mark?: boolean
          id?: string
          joined_at?: string
          role_label?: string | null
          team_id: string
          user_id: string
        }
        Update: {
          contribution_mark?: number
          helper_mark?: boolean
          id?: string
          joined_at?: string
          role_label?: string | null
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_mission_team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "weekly_mission_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_mission_teams: {
        Row: {
          contribution_target: number
          created_at: string
          created_by: string
          id: string
          mission_id: string
          name: string
          team_goal: string | null
        }
        Insert: {
          contribution_target?: number
          created_at?: string
          created_by?: string
          id?: string
          mission_id: string
          name: string
          team_goal?: string | null
        }
        Update: {
          contribution_target?: number
          created_at?: string
          created_by?: string
          id?: string
          mission_id?: string
          name?: string
          team_goal?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "weekly_mission_teams_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "weekly_missions"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_missions: {
        Row: {
          classroom_id: string
          closed_at: string | null
          created_at: string
          created_by: string
          flashcard_deck_id: string | null
          id: string
          main_assignment_id: string | null
          participation_xp: number
          practice_quest_id: string | null
          published_at: string | null
          quality_xp_max: number
          status: string
          team_mode: boolean
          title: string
          updated_at: string
          week_end: string
          week_start: string
        }
        Insert: {
          classroom_id: string
          closed_at?: string | null
          created_at?: string
          created_by?: string
          flashcard_deck_id?: string | null
          id?: string
          main_assignment_id?: string | null
          participation_xp?: number
          practice_quest_id?: string | null
          published_at?: string | null
          quality_xp_max?: number
          status?: string
          team_mode?: boolean
          title: string
          updated_at?: string
          week_end: string
          week_start: string
        }
        Update: {
          classroom_id?: string
          closed_at?: string | null
          created_at?: string
          created_by?: string
          flashcard_deck_id?: string | null
          id?: string
          main_assignment_id?: string | null
          participation_xp?: number
          practice_quest_id?: string | null
          published_at?: string | null
          quality_xp_max?: number
          status?: string
          team_mode?: boolean
          title?: string
          updated_at?: string
          week_end?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_missions_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_missions_flashcard_deck_id_fkey"
            columns: ["flashcard_deck_id"]
            isOneToOne: false
            referencedRelation: "flashcard_decks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_missions_main_assignment_id_fkey"
            columns: ["main_assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_missions_practice_quest_id_fkey"
            columns: ["practice_quest_id"]
            isOneToOne: false
            referencedRelation: "daily_quests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_missions_practice_quest_id_fkey"
            columns: ["practice_quest_id"]
            isOneToOne: false
            referencedRelation: "daily_quests_safe"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      attendance_sessions_safe: {
        Row: {
          check_in_code: string | null
          check_in_expires_at: string | null
          check_in_opens_at: string | null
          classroom_id: string | null
          created_at: string | null
          id: string | null
          session_date: string | null
          title: string | null
        }
        Insert: {
          check_in_code?: never
          check_in_expires_at?: string | null
          check_in_opens_at?: string | null
          classroom_id?: string | null
          created_at?: string | null
          id?: string | null
          session_date?: string | null
          title?: string | null
        }
        Update: {
          check_in_code?: never
          check_in_expires_at?: string | null
          check_in_opens_at?: string | null
          classroom_id?: string | null
          created_at?: string | null
          id?: string | null
          session_date?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_sessions_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_quests_safe: {
        Row: {
          classroom_id: string | null
          created_at: string | null
          created_by: string | null
          difficulty: string | null
          expires_at: string | null
          id: string | null
          is_active: boolean | null
          is_secret: boolean | null
          lesson_id: string | null
          max_gold_reward: number | null
          max_xp_reward: number | null
          min_level: number | null
          questions: Json | null
          required_title_code: string | null
          title: string | null
          topic: string | null
        }
        Insert: {
          classroom_id?: string | null
          created_at?: string | null
          created_by?: string | null
          difficulty?: string | null
          expires_at?: string | null
          id?: string | null
          is_active?: boolean | null
          is_secret?: boolean | null
          lesson_id?: string | null
          max_gold_reward?: number | null
          max_xp_reward?: number | null
          min_level?: number | null
          questions?: never
          required_title_code?: string | null
          title?: string | null
          topic?: string | null
        }
        Update: {
          classroom_id?: string | null
          created_at?: string | null
          created_by?: string | null
          difficulty?: string | null
          expires_at?: string | null
          id?: string | null
          is_active?: boolean | null
          is_secret?: boolean | null
          lesson_id?: string | null
          max_gold_reward?: number | null
          max_xp_reward?: number | null
          min_level?: number | null
          questions?: never
          required_title_code?: string | null
          title?: string | null
          topic?: string | null
        }
        Relationships: []
      }
      leaderboard: {
        Row: {
          active_title: string | null
          avatar_url: string | null
          display_name: string | null
          gold: number | null
          id: string | null
          level: number | null
          perfect_scores: number | null
          quests_completed: number | null
          streak_days: number | null
          xp: number | null
        }
        Relationships: []
      }
      quiz_questions_safe: {
        Row: {
          correct_idx: number | null
          created_at: string | null
          id: string | null
          idx: number | null
          options: Json | null
          points: number | null
          question: string | null
          session_id: string | null
          time_limit_seconds: number | null
        }
        Relationships: [
          {
            foreignKeyName: "quiz_questions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "quiz_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      approve_teacher_application: {
        Args: { _user_id: string }
        Returns: undefined
      }
      award_quest_attempt: {
        Args: {
          _answers: Json
          _feedback: string
          _max_score: number
          _per_question: Json
          _quest_id: string
          _score: number
        }
        Returns: Json
      }
      check_and_award_achievements: {
        Args: { _user_id: string }
        Returns: undefined
      }
      check_birthday_visit: { Args: never; Returns: Json }
      claim_achievement: { Args: { _achievement_id: string }; Returns: Json }
      claim_daily_bonus: { Args: never; Returns: Json }
      complete_quest: { Args: { _quest_id: string }; Returns: Json }
      finalize_my_quest_progress: { Args: { _quest_id: string }; Returns: Json }
      finalize_quest_from_progress: {
        Args: { _quest_id: string; _user_id: string }
        Returns: Json
      }
      finish_quiz_session: { Args: { _session_id: string }; Returns: undefined }
      get_classroom_join_code: {
        Args: { _classroom_id: string }
        Returns: string
      }
      get_quest_for_grading: { Args: { _quest_id: string }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_assignment_owner: {
        Args: { _assignment_id: string; _user_id: string }
        Returns: boolean
      }
      is_attendance_session_owner: {
        Args: { _session_id: string; _user_id: string }
        Returns: boolean
      }
      is_classroom_member: {
        Args: { _classroom_id: string; _user_id: string }
        Returns: boolean
      }
      is_classroom_owner: {
        Args: { _classroom_id: string; _user_id: string }
        Returns: boolean
      }
      is_teacher_of_user: {
        Args: { _teacher: string; _user: string }
        Returns: boolean
      }
      is_weekly_mission_member: {
        Args: { _mission_id: string; _user_id: string }
        Returns: boolean
      }
      is_weekly_mission_owner: {
        Args: { _mission_id: string; _user_id: string }
        Returns: boolean
      }
      is_weekly_team_member: {
        Args: { _team_id: string; _user_id: string }
        Returns: boolean
      }
      join_classroom_by_code: { Args: { _code: string }; Returns: string }
      join_quiz_by_code: { Args: { _code: string }; Returns: Json }
      next_quiz_question: { Args: { _session_id: string }; Returns: Json }
      open_attendance_check_in: {
        Args: { p_minutes?: number; p_session_id: string }
        Returns: {
          code: string
          expires_at: string
        }[]
      }
      purchase_shop_item: { Args: { _item_id: string }; Returns: Json }
      reject_teacher_application: {
        Args: { _note?: string; _user_id: string }
        Returns: undefined
      }
      reset_birthday_flag_if_needed: {
        Args: { _user_id: string }
        Returns: undefined
      }
      reveal_quiz_question: {
        Args: { _session_id: string }
        Returns: undefined
      }
      self_check_in: {
        Args: { p_code: string }
        Returns: {
          out_session_id: string
          status: string
        }[]
      }
      set_active_title: { Args: { _title_id: string }; Returns: undefined }
      start_quiz_session: { Args: { _session_id: string }; Returns: undefined }
      strip_quest_answer_keys: { Args: { qs: Json }; Returns: Json }
      submit_quiz_answer: {
        Args: { _answer_idx: number; _question_id: string }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin" | "teacher" | "student" | "guest" | "room_admin"
      attendance_status: "present" | "late" | "absent" | "excused"
      booking_status: "pending" | "approved" | "rejected" | "cancelled"
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
    Enums: {
      app_role: ["admin", "teacher", "student", "guest", "room_admin"],
      attendance_status: ["present", "late", "absent", "excused"],
      booking_status: ["pending", "approved", "rejected", "cancelled"],
    },
  },
} as const
