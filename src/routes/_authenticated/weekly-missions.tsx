import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  BookOpen,
  Brain,
  CalendarCheck,
  CheckCircle2,
  ClipboardList,
  ClipboardCheck,
  Crown,
  FileCheck2,
  Flame,
  Layers,
  LineChart,
  Loader2,
  Rocket,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  Users,
  Wand2,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/use-auth";
import { tr } from "@/i18n";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/weekly-missions")({
  component: WeeklyMissionsPage,
});

type ClassroomRow = Pick<
  Database["public"]["Tables"]["classrooms"]["Row"],
  "id" | "name" | "subject" | "grade_level" | "description" | "owner_id"
>;
type ClassroomMemberWithClassroom = Pick<
  Database["public"]["Tables"]["classroom_members"]["Row"],
  "classroom_id"
> & {
  classrooms?: ClassroomRow | ClassroomRow[] | null;
};
type AssignmentRow = Pick<
  Database["public"]["Tables"]["assignments"]["Row"],
  | "id"
  | "classroom_id"
  | "title"
  | "description"
  | "due_date"
  | "max_score"
  | "xp_reward"
  | "status"
  | "created_at"
>;
type SubmissionRow = Pick<
  Database["public"]["Tables"]["submissions"]["Row"],
  "assignment_id" | "score" | "graded_at" | "submitted_at" | "user_id"
>;
type QuestRow = Pick<
  Database["public"]["Views"]["daily_quests_safe"]["Row"],
  | "id"
  | "classroom_id"
  | "title"
  | "topic"
  | "difficulty"
  | "max_xp_reward"
  | "max_gold_reward"
  | "min_level"
  | "created_at"
  | "expires_at"
>;
type QuestAttemptRow = Pick<
  Database["public"]["Tables"]["daily_quest_attempts"]["Row"],
  | "id"
  | "quest_id"
  | "score"
  | "max_score"
  | "xp_awarded"
  | "gold_awarded"
  | "completed_at"
  | "user_id"
>;
type DeckRow = Pick<
  Database["public"]["Tables"]["flashcard_decks"]["Row"],
  "id" | "title" | "description" | "classroom_id" | "owner_id" | "is_public" | "created_at"
>;
type FlashcardLiteRow = Pick<Database["public"]["Tables"]["flashcards"]["Row"], "id" | "deck_id">;
type FlashcardReviewLiteRow = Pick<
  Database["public"]["Tables"]["flashcard_reviews"]["Row"],
  "card_id" | "ease" | "next_review_at" | "review_count"
>;
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type WeeklyMissionRow = Database["public"]["Tables"]["weekly_missions"]["Row"];
type WeeklyMissionItemRow = Database["public"]["Tables"]["weekly_mission_items"]["Row"];
type WeeklyMissionItemInsert = Database["public"]["Tables"]["weekly_mission_items"]["Insert"];
type WeeklyMissionTeamRow = Database["public"]["Tables"]["weekly_mission_teams"]["Row"];
type WeeklyMissionTeamMemberRow =
  Database["public"]["Tables"]["weekly_mission_team_members"]["Row"];
type MissionProgressRow = Database["public"]["Tables"]["mission_progress"]["Row"];
type MissionProgressInsert = Database["public"]["Tables"]["mission_progress"]["Insert"];
type WeeklyMissionRecapRow = Database["public"]["Tables"]["weekly_mission_recaps"]["Row"];
type TermBonusRuleRow = Database["public"]["Tables"]["term_bonus_rules"]["Row"];
type ClassroomMemberRow = Pick<
  Database["public"]["Tables"]["classroom_members"]["Row"],
  "classroom_id" | "user_id" | "joined_at"
>;
type ProfileNameRow = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "display_name" | "avatar_url"
>;
type DeckWithStats = DeckRow & {
  card_count: number;
  due_count: number;
  reviewed_count: number;
  mastered_count: number;
  mastery_pct: number;
};
type MissionStep = {
  title: string;
  detail: string;
  meta: string;
  progress: number;
  icon: ReactNode;
  href: "/classrooms" | "/quests" | "/flashcards";
};
type CampaignState = {
  schemaReady: boolean;
  mission: WeeklyMissionRow | null;
  items: WeeklyMissionItemRow[];
};
type TeamState = {
  schemaReady: boolean;
  teams: WeeklyMissionTeamRow[];
  members: WeeklyMissionTeamMemberRow[];
};
type BonusState = {
  schemaReady: boolean;
  rules: TermBonusRuleRow[];
};
type ProgressState = {
  schemaReady: boolean;
  rows: MissionProgressRow[];
};
type RecapState = {
  schemaReady: boolean;
  recaps: WeeklyMissionRecapRow[];
};
type MissionStatus = "draft" | "published" | "closed";
type WeekRange = {
  startIso: string;
  endIso: string;
};

const emptyCampaignState: CampaignState = { schemaReady: true, mission: null, items: [] };
const emptyTeamState: TeamState = { schemaReady: true, teams: [], members: [] };
const emptyBonusState: BonusState = { schemaReady: true, rules: [] };
const emptyProgressState: ProgressState = { schemaReady: true, rows: [] };
const emptyRecapState: RecapState = { schemaReady: true, recaps: [] };
const roleLabels = ["ผู้ประสานงาน", "นักออกแบบ", "ผู้ตรวจงาน", "ผู้นำเสนอ"];

function WeeklyMissionsPage() {
  const { user, roles } = useAuth();
  const queryClient = useQueryClient();
  const primaryRole: "admin" | "teacher" | "student" = roles.includes("admin")
    ? "admin"
    : roles.includes("teacher")
      ? "teacher"
      : "student";
  const isStaff = primaryRole !== "student";
  const [selectedClassroomId, setSelectedClassroomId] = useState<string | null>(null);
  const weekRange = useMemo(() => getCurrentWeekRange(), []);

  const { data: profile } = useQuery({
    queryKey: ["weekly-profile", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user!.id)
        .single();
      if (error) throw error;
      return data as ProfileRow;
    },
    enabled: !!user,
  });

  const { data: classrooms = [], isLoading: loadingClassrooms } = useQuery({
    queryKey: ["weekly-classrooms", user?.id, primaryRole],
    queryFn: async () => {
      if (!user) return [];
      if (primaryRole === "admin") {
        const { data, error } = await supabase
          .from("classrooms")
          .select("id,name,subject,grade_level,description,owner_id")
          .order("created_at", { ascending: false })
          .limit(16);
        if (error) throw error;
        return (data ?? []) as ClassroomRow[];
      }

      const [ownedResult, joinedResult] = await Promise.all([
        supabase
          .from("classrooms")
          .select("id,name,subject,grade_level,description,owner_id")
          .eq("owner_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("classroom_members")
          .select("classroom_id,classrooms(id,name,subject,grade_level,description,owner_id)")
          .eq("user_id", user.id),
      ]);
      if (ownedResult.error) throw ownedResult.error;
      if (joinedResult.error) throw joinedResult.error;

      const merged = new Map<string, ClassroomRow>();
      for (const classroom of (ownedResult.data ?? []) as ClassroomRow[]) {
        merged.set(classroom.id, classroom);
      }
      for (const member of (joinedResult.data ?? []) as ClassroomMemberWithClassroom[]) {
        const relation = Array.isArray(member.classrooms)
          ? member.classrooms[0]
          : member.classrooms;
        if (relation?.id) merged.set(relation.id, relation);
      }
      return [...merged.values()];
    },
    enabled: !!user,
  });

  const classroomIds = classrooms.map((classroom) => classroom.id);
  const currentClassroom = useMemo(
    () =>
      classrooms.find((classroom) => classroom.id === selectedClassroomId) ?? classrooms[0] ?? null,
    [classrooms, selectedClassroomId],
  );
  const currentClassroomId = currentClassroom?.id ?? null;

  const { data: campaignState = emptyCampaignState } = useQuery({
    queryKey: ["weekly-campaign", currentClassroomId, weekRange.startIso],
    queryFn: async (): Promise<CampaignState> => {
      if (!currentClassroomId) return emptyCampaignState;
      const { data: mission, error: missionError } = await supabase
        .from("weekly_missions")
        .select(
          "id,classroom_id,title,week_start,week_end,main_assignment_id,practice_quest_id,flashcard_deck_id,participation_xp,quality_xp_max,status,team_mode,created_by,published_at,closed_at,created_at,updated_at",
        )
        .eq("classroom_id", currentClassroomId)
        .eq("week_start", weekRange.startIso)
        .maybeSingle();

      if (missionError) return { schemaReady: false, mission: null, items: [] };
      if (!mission) return { schemaReady: true, mission: null, items: [] };

      const { data: items, error: itemError } = await supabase
        .from("weekly_mission_items")
        .select(
          "id,mission_id,type,title,description,xp_max,required,sort_order,source_table,source_id,created_at",
        )
        .eq("mission_id", mission.id)
        .order("sort_order", { ascending: true });

      if (itemError) return { schemaReady: false, mission, items: [] };
      return {
        schemaReady: true,
        mission,
        items: (items ?? []) as WeeklyMissionItemRow[],
      };
    },
    enabled: !!currentClassroomId,
  });

  const { data: teamState = emptyTeamState } = useQuery({
    queryKey: ["weekly-campaign-teams", campaignState.mission?.id],
    queryFn: async (): Promise<TeamState> => {
      const missionId = campaignState.mission?.id;
      if (!missionId) return emptyTeamState;
      const { data: teams, error: teamError } = await supabase
        .from("weekly_mission_teams")
        .select("id,mission_id,name,team_goal,contribution_target,created_by,created_at")
        .eq("mission_id", missionId)
        .order("created_at", { ascending: true });
      if (teamError) return { schemaReady: false, teams: [], members: [] };

      const teamIds = (teams ?? []).map((team) => team.id);
      if (teamIds.length === 0) {
        return { schemaReady: true, teams: (teams ?? []) as WeeklyMissionTeamRow[], members: [] };
      }

      const { data: members, error: memberError } = await supabase
        .from("weekly_mission_team_members")
        .select("id,team_id,user_id,role_label,contribution_mark,helper_mark,joined_at")
        .in("team_id", teamIds);
      if (memberError) return { schemaReady: false, teams: [], members: [] };
      return {
        schemaReady: true,
        teams: (teams ?? []) as WeeklyMissionTeamRow[],
        members: (members ?? []) as WeeklyMissionTeamMemberRow[],
      };
    },
    enabled: !!campaignState.mission?.id,
  });

  const { data: classroomMemberCount = 0 } = useQuery({
    queryKey: ["weekly-classroom-member-count", currentClassroomId],
    queryFn: async () => {
      if (!currentClassroomId) return 0;
      const { count } = await supabase
        .from("classroom_members")
        .select("*", { count: "exact", head: true })
        .eq("classroom_id", currentClassroomId);
      return count ?? 0;
    },
    enabled: !!currentClassroomId,
  });

  const { data: classroomMembers = [] } = useQuery({
    queryKey: ["weekly-classroom-members", currentClassroomId],
    queryFn: async () => {
      if (!currentClassroomId) return [];
      const { data, error } = await supabase
        .from("classroom_members")
        .select("classroom_id,user_id,joined_at")
        .eq("classroom_id", currentClassroomId)
        .order("joined_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ClassroomMemberRow[];
    },
    enabled: !!currentClassroomId,
  });
  const classroomMemberIds = classroomMembers.map((member) => member.user_id);

  const { data: memberProfiles = [] } = useQuery({
    queryKey: ["weekly-member-profiles", classroomMemberIds.join(",")],
    queryFn: async () => {
      if (classroomMemberIds.length === 0) return [];
      const { data, error } = await supabase
        .from("profiles")
        .select("id,display_name,avatar_url")
        .in("id", classroomMemberIds);
      if (error) throw error;
      return (data ?? []) as ProfileNameRow[];
    },
    enabled: classroomMemberIds.length > 0,
  });

  const { data: bonusState = emptyBonusState } = useQuery({
    queryKey: ["weekly-bonus-rules", currentClassroomId],
    queryFn: async (): Promise<BonusState> => {
      if (!currentClassroomId) return emptyBonusState;
      const { data, error } = await supabase
        .from("term_bonus_rules")
        .select(
          "id,grade_level,classroom_id,name,rule_type,bonus_points,criteria_json,is_active,created_by,created_at,updated_at",
        )
        .eq("is_active", true)
        .or(`classroom_id.eq.${currentClassroomId},classroom_id.is.null`)
        .limit(6);
      if (error) return { schemaReady: false, rules: [] };
      return { schemaReady: true, rules: (data ?? []) as TermBonusRuleRow[] };
    },
    enabled: !!currentClassroomId,
  });

  const { data: assignments = [] } = useQuery({
    queryKey: ["weekly-assignments", classroomIds.join(",")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("assignments")
        .select("id,classroom_id,title,description,due_date,max_score,xp_reward,status,created_at")
        .in("classroom_id", classroomIds)
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      return (data ?? []) as AssignmentRow[];
    },
    enabled: classroomIds.length > 0,
  });

  const assignmentIds = assignments.map((assignment) => assignment.id);
  const { data: submissions = [] } = useQuery({
    queryKey: ["weekly-submissions", user?.id, assignmentIds.join(",")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("submissions")
        .select("assignment_id,score,graded_at,submitted_at,user_id")
        .eq("user_id", user!.id)
        .in("assignment_id", assignmentIds);
      if (error) throw error;
      return (data ?? []) as SubmissionRow[];
    },
    enabled: !!user && assignmentIds.length > 0,
  });

  const { data: quests = [] } = useQuery({
    queryKey: ["weekly-practice-quests", classroomIds.join(",")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_quests_safe")
        .select(
          "id,classroom_id,title,topic,difficulty,max_xp_reward,max_gold_reward,min_level,created_at,expires_at",
        )
        .eq("is_active", true)
        .in("classroom_id", classroomIds)
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      return (data ?? []) as QuestRow[];
    },
    enabled: classroomIds.length > 0,
  });

  const questIds = quests.map((quest) => quest.id).filter((id): id is string => !!id);
  const { data: questAttempts = [] } = useQuery({
    queryKey: ["weekly-quest-attempts", user?.id, questIds.join(",")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_quest_attempts")
        .select("id,quest_id,score,max_score,xp_awarded,gold_awarded,completed_at,user_id")
        .eq("user_id", user!.id)
        .in("quest_id", questIds);
      if (error) throw error;
      return (data ?? []) as QuestAttemptRow[];
    },
    enabled: !!user && questIds.length > 0,
  });

  const { data: decks = [] } = useQuery({
    queryKey: ["weekly-flashcard-decks", user?.id, classroomIds.join(",")],
    queryFn: async () => {
      if (!user) return [];
      const [classDecksResult, ownDecksResult] = await Promise.all([
        classroomIds.length
          ? supabase
              .from("flashcard_decks")
              .select("id,title,description,classroom_id,owner_id,is_public,created_at")
              .in("classroom_id", classroomIds)
              .order("created_at", { ascending: false })
              .limit(40)
          : Promise.resolve({ data: [] as DeckRow[], error: null }),
        supabase
          .from("flashcard_decks")
          .select("id,title,description,classroom_id,owner_id,is_public,created_at")
          .eq("owner_id", user.id)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      if (classDecksResult.error) throw classDecksResult.error;
      if (ownDecksResult.error) throw ownDecksResult.error;

      const deckMap = new Map<string, DeckRow>();
      for (const deck of [
        ...((classDecksResult.data ?? []) as DeckRow[]),
        ...((ownDecksResult.data ?? []) as DeckRow[]),
      ]) {
        deckMap.set(deck.id, deck);
      }
      const deckRows = [...deckMap.values()];
      const deckIds = deckRows.map((deck) => deck.id);
      if (deckIds.length === 0) return [];

      const { data: cardData, error: cardError } = await supabase
        .from("flashcards")
        .select("id,deck_id")
        .in("deck_id", deckIds);
      if (cardError) throw cardError;
      const cardRows = (cardData ?? []) as FlashcardLiteRow[];
      const cardIds = cardRows.map((card) => card.id);
      const { data: reviewData, error: reviewError } = cardIds.length
        ? await supabase
            .from("flashcard_reviews")
            .select("card_id,ease,next_review_at,review_count")
            .eq("user_id", user.id)
            .in("card_id", cardIds)
        : { data: [] as FlashcardReviewLiteRow[], error: null };
      if (reviewError) throw reviewError;

      const cardsByDeck = new Map<string, FlashcardLiteRow[]>();
      for (const card of cardRows) {
        cardsByDeck.set(card.deck_id, [...(cardsByDeck.get(card.deck_id) ?? []), card]);
      }
      const reviewByCard = new Map(
        ((reviewData ?? []) as FlashcardReviewLiteRow[]).map((review) => [review.card_id, review]),
      );
      const now = Date.now();
      return deckRows.map((deck): DeckWithStats => {
        const cards = cardsByDeck.get(deck.id) ?? [];
        const reviews = cards
          .map((card) => reviewByCard.get(card.id))
          .filter((review): review is FlashcardReviewLiteRow => !!review);
        const reviewedCount = reviews.length;
        const dueReviewed = reviews.filter(
          (review) => new Date(review.next_review_at).getTime() <= now,
        ).length;
        const masteredCount = reviews.filter((review) => review.ease >= 3).length;
        const masteryPct = cards.length
          ? clampPct((reviewedCount / cards.length) * 60 + (masteredCount / cards.length) * 40)
          : 0;
        return {
          ...deck,
          card_count: cards.length,
          due_count: Math.max(0, cards.length - reviewedCount) + dueReviewed,
          reviewed_count: reviewedCount,
          mastered_count: masteredCount,
          mastery_pct: masteryPct,
        };
      });
    },
    enabled: !!user,
  });

  const classroomAssignments = sortAssignments(
    assignments.filter((assignment) => assignment.classroom_id === currentClassroomId),
  );
  const classroomQuests = quests.filter((quest) => quest.classroom_id === currentClassroomId);
  const classroomDecks = decks.filter(
    (deck) =>
      deck.classroom_id === currentClassroomId ||
      (!deck.classroom_id && deck.owner_id === user?.id),
  );
  const focus = getSessionFocus(currentClassroom);
  const activeMission = campaignState.mission;
  const campaignItems = campaignState.items;
  const mainCampaignItem = campaignItems.find((item) => item.type === "main_work") ?? null;
  const questCampaignItem = campaignItems.find((item) => item.type === "ai_quest") ?? null;
  const flashcardCampaignItem = campaignItems.find((item) => item.type === "flashcard") ?? null;
  const recommendedTeamMode = classroomMemberCount >= 5;
  const autoAssignment = classroomAssignments[0] ?? null;
  const autoQuest = classroomQuests[0] ?? null;
  const autoDeck = classroomDecks.sort((a, b) => b.due_count - a.due_count)[0] ?? null;
  const classroomAssignmentIds = classroomAssignments.map((assignment) => assignment.id);
  const classroomQuestIds = classroomQuests
    .map((quest) => quest.id)
    .filter((id): id is string => !!id);

  const { data: staffSubmissions = [] } = useQuery({
    queryKey: [
      "weekly-classroom-submissions",
      currentClassroomId,
      classroomAssignmentIds.join(","),
    ],
    queryFn: async () => {
      if (classroomAssignmentIds.length === 0) return [];
      const { data, error } = await supabase
        .from("submissions")
        .select("assignment_id,score,graded_at,submitted_at,user_id")
        .in("assignment_id", classroomAssignmentIds);
      if (error) throw error;
      return (data ?? []) as SubmissionRow[];
    },
    enabled: isStaff && classroomAssignmentIds.length > 0,
  });

  const { data: staffQuestAttempts = [] } = useQuery({
    queryKey: ["weekly-classroom-quest-attempts", currentClassroomId, classroomQuestIds.join(",")],
    queryFn: async () => {
      if (classroomQuestIds.length === 0) return [];
      const { data, error } = await supabase
        .from("daily_quest_attempts")
        .select("id,quest_id,score,max_score,xp_awarded,gold_awarded,completed_at,user_id")
        .in("quest_id", classroomQuestIds);
      if (error) throw error;
      return (data ?? []) as QuestAttemptRow[];
    },
    enabled: isStaff && classroomQuestIds.length > 0,
  });

  const { data: progressState = emptyProgressState } = useQuery({
    queryKey: ["weekly-mission-progress", activeMission?.id, isStaff ? "all" : user?.id],
    queryFn: async (): Promise<ProgressState> => {
      if (!activeMission?.id || !user) return emptyProgressState;
      let query = supabase
        .from("mission_progress")
        .select(
          "id,mission_id,item_id,user_id,status,participation_xp_awarded,quality_xp_awarded,ai_xp_awarded,completed_at,reviewed_at,updated_at",
        )
        .eq("mission_id", activeMission.id);
      if (!isStaff) query = query.eq("user_id", user.id);
      const { data, error } = await query.order("updated_at", { ascending: false });
      if (error) return { schemaReady: false, rows: [] };
      return { schemaReady: true, rows: (data ?? []) as MissionProgressRow[] };
    },
    enabled: !!activeMission?.id && !!user,
  });

  const { data: recapState = emptyRecapState } = useQuery({
    queryKey: ["weekly-mission-recaps", activeMission?.id, isStaff ? "staff" : user?.id],
    queryFn: async (): Promise<RecapState> => {
      if (!activeMission?.id || !user) return emptyRecapState;
      let query = supabase
        .from("weekly_mission_recaps")
        .select(
          "id,mission_id,classroom_id,user_id,audience,summary,ai_summary,generated_at,created_by",
        )
        .eq("mission_id", activeMission.id);
      if (!isStaff) query = query.or(`audience.eq.student,user_id.eq.${user.id}`);
      const { data, error } = await query.order("generated_at", { ascending: false }).limit(6);
      if (error) return { schemaReady: false, recaps: [] };
      return { schemaReady: true, recaps: (data ?? []) as WeeklyMissionRecapRow[] };
    },
    enabled: !!activeMission?.id && !!user,
  });

  const [draftTitle, setDraftTitle] = useState("");
  const [selectedAssignmentId, setSelectedAssignmentId] = useState("none");
  const [selectedQuestId, setSelectedQuestId] = useState("none");
  const [selectedDeckId, setSelectedDeckId] = useState("none");
  const [participationXp, setParticipationXp] = useState(30);
  const [qualityXpMax, setQualityXpMax] = useState(60);
  const [builderTeamMode, setBuilderTeamMode] = useState(recommendedTeamMode);

  useEffect(() => {
    setDraftTitle(activeMission?.title ?? `${focus}: ${currentClassroom?.name ?? ""}`.trim());
    setSelectedAssignmentId(activeMission?.main_assignment_id ?? autoAssignment?.id ?? "none");
    setSelectedQuestId(activeMission?.practice_quest_id ?? autoQuest?.id ?? "none");
    setSelectedDeckId(activeMission?.flashcard_deck_id ?? autoDeck?.id ?? "none");
    setParticipationXp(activeMission?.participation_xp ?? (autoAssignment ? 30 : 20));
    setQualityXpMax(activeMission?.quality_xp_max ?? autoAssignment?.xp_reward ?? 60);
    setBuilderTeamMode(activeMission?.team_mode ?? recommendedTeamMode);
  }, [
    activeMission?.id,
    activeMission?.updated_at,
    autoAssignment?.id,
    autoDeck?.id,
    autoQuest?.id,
    currentClassroom?.name,
    focus,
    recommendedTeamMode,
  ]);

  const mainAssignment =
    selectedAssignmentId === "none"
      ? null
      : (classroomAssignments.find((assignment) => assignment.id === selectedAssignmentId) ??
        autoAssignment);
  const mainSubmission = mainAssignment
    ? submissions.find((submission) => submission.assignment_id === mainAssignment.id)
    : null;
  const practiceQuest =
    selectedQuestId === "none"
      ? null
      : (classroomQuests.find((quest) => quest.id === selectedQuestId) ?? autoQuest);
  const practiceAttempt = practiceQuest
    ? questAttempts.find((attempt) => attempt.quest_id === practiceQuest.id)
    : null;
  const flashcardDeck =
    selectedDeckId === "none"
      ? null
      : (classroomDecks.find((deck) => deck.id === selectedDeckId) ?? autoDeck);

  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      if (!user || !currentClassroom) throw new Error(tr("ไม่พบห้องเรียน"));
      const title = draftTitle.trim() || `${focus}: ${currentClassroom.name}`;
      const nextParticipationXp = Math.max(0, Math.min(100, Math.round(participationXp)));
      const nextQualityXpMax = Math.max(0, Math.min(200, Math.round(qualityXpMax)));
      const payload = {
        classroom_id: currentClassroom.id,
        title,
        week_start: weekRange.startIso,
        week_end: weekRange.endIso,
        main_assignment_id: mainAssignment?.id ?? null,
        practice_quest_id: practiceQuest?.id ?? null,
        flashcard_deck_id: flashcardDeck?.id ?? null,
        participation_xp: nextParticipationXp,
        quality_xp_max: nextQualityXpMax,
        status: activeMission?.status === "published" ? "published" : "draft",
        team_mode: builderTeamMode,
        created_by: user.id,
      };

      const { data: mission, error: missionError } = await supabase
        .from("weekly_missions")
        .upsert(payload, { onConflict: "classroom_id,week_start" })
        .select("id")
        .single();
      if (missionError) throw missionError;

      const missionItems = buildMissionItemInserts({
        missionId: mission.id,
        mainAssignment,
        practiceQuest,
        flashcardDeck,
        focus,
      });

      await supabase.from("weekly_mission_items").delete().eq("mission_id", mission.id);
      if (missionItems.length > 0) {
        const { error: itemError } = await supabase
          .from("weekly_mission_items")
          .insert(missionItems);
        if (itemError) throw itemError;
      }
      return mission.id;
    },
    onSuccess: async () => {
      toast.success(tr("บันทึก draft ภารกิจสัปดาห์แล้ว"));
      await queryClient.invalidateQueries({ queryKey: ["weekly-campaign"] });
    },
    onError: (error) => {
      toast.error(getSchemaAwareError(error));
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async (status: MissionStatus) => {
      if (!activeMission) throw new Error(tr("ยังไม่มี draft mission"));
      if (status === "closed") {
        // Use the close_weekly_mission RPC so XP is batch-awarded to every
        // student with progress. The RPC also sets status='closed' and
        // closed_at=now() atomically, so a separate table update is not needed.
        const { data, error } = await supabase.rpc("close_weekly_mission", {
          _mission_id: activeMission.id,
        });
        if (error) throw error;
        return {
          status,
          results: (data ?? []) as { user_id: string; xp_awarded: number }[],
        };
      }
      // status is narrowed to "draft" | "published" here; closed_at is unchanged
      // because closing is handled above via the close_weekly_mission RPC.
      const { error } = await supabase
        .from("weekly_missions")
        .update({
          status,
          published_at:
            status === "published" ? new Date().toISOString() : activeMission.published_at,
          closed_at: activeMission.closed_at,
        })
        .eq("id", activeMission.id);
      if (error) throw error;
      return { status, results: null };
    },
    onSuccess: async ({ status, results }) => {
      if (status === "closed" && results) {
        const totalUsers = results.length;
        const totalXp = results.reduce((sum, r) => sum + (r.xp_awarded ?? 0), 0);
        toast.success(
          `${tr("ปิดรอบภารกิจสัปดาห์แล้ว")} — ${tr("มอบ")} ${totalXp} XP ${tr("ให้")} ${totalUsers} ${tr("คน")}`,
        );
      } else {
        toast.success(
          status === "published" ? tr("เผยแพร่ภารกิจสัปดาห์แล้ว") : tr("ปิดรอบภารกิจสัปดาห์แล้ว"),
        );
      }
      await queryClient.invalidateQueries({ queryKey: ["weekly-campaign"] });
      await queryClient.invalidateQueries({ queryKey: ["weekly-mission-progress"] });
      if (status === "closed") {
        // XP balances changed — refresh everywhere XP is shown.
        await queryClient.invalidateQueries({ queryKey: ["xp-transactions"] });
        await queryClient.invalidateQueries({ queryKey: ["xp-summary"] });
        await queryClient.invalidateQueries({ queryKey: ["profile"] });
      }
    },
    onError: (error) => {
      toast.error(getSchemaAwareError(error));
    },
  });

  const createTeamsMutation = useMutation({
    mutationFn: async () => {
      if (!activeMission || !user) throw new Error(tr("บันทึก draft mission ก่อน"));
      if (classroomMembers.length === 0) throw new Error(tr("ยังไม่มีนักเรียนในห้องนี้"));

      const existingTeamIds = teamState.teams.map((team) => team.id);
      if (existingTeamIds.length > 0) {
        const { error: memberDeleteError } = await supabase
          .from("weekly_mission_team_members")
          .delete()
          .in("team_id", existingTeamIds);
        if (memberDeleteError) throw memberDeleteError;
      }

      const { error: teamDeleteError } = await supabase
        .from("weekly_mission_teams")
        .delete()
        .eq("mission_id", activeMission.id);
      if (teamDeleteError) throw teamDeleteError;

      const teamCount = Math.max(1, Math.ceil(classroomMembers.length / 4));
      const teamPayload = Array.from({ length: teamCount }, (_, index) => ({
        mission_id: activeMission.id,
        name: `${tr("ทีม")} ${index + 1}`,
        team_goal: tr("แบ่งบทบาทให้ครบ ทำงานหลักในคาบ และช่วยกันเก็บ milestone"),
        contribution_target: 100,
        created_by: user.id,
      }));
      const { data: teams, error: teamInsertError } = await supabase
        .from("weekly_mission_teams")
        .insert(teamPayload)
        .select("id,name");
      if (teamInsertError) throw teamInsertError;

      const teamRows = (teams ?? []) as Pick<WeeklyMissionTeamRow, "id" | "name">[];
      const memberPayload = classroomMembers.map((member, index) => ({
        team_id: teamRows[index % teamRows.length].id,
        user_id: member.user_id,
        role_label: roleLabels[index % roleLabels.length],
        contribution_mark: 0,
        helper_mark: false,
      }));
      const { error: memberInsertError } = await supabase
        .from("weekly_mission_team_members")
        .insert(memberPayload);
      if (memberInsertError) throw memberInsertError;
      return teamRows.length;
    },
    onSuccess: async (teamCount) => {
      toast.success(`${tr("สร้างทีมแล้ว")} ${teamCount} ${tr("ทีม")}`);
      await queryClient.invalidateQueries({ queryKey: ["weekly-campaign-teams"] });
    },
    onError: (error) => {
      toast.error(getSchemaAwareError(error));
    },
  });

  const syncProgressMutation = useMutation({
    mutationFn: async () => {
      if (!activeMission) throw new Error(tr("ยังไม่มี mission"));
      if (campaignItems.length === 0) throw new Error(tr("ยังไม่มีรายการ mission"));
      if (classroomMembers.length === 0) throw new Error(tr("ยังไม่มีนักเรียนในห้องนี้"));

      const rows = buildProgressInserts({
        mission: activeMission,
        items: campaignItems,
        members: classroomMembers,
        assignments: classroomAssignments,
        submissions: staffSubmissions,
        attempts: staffQuestAttempts,
      });
      const { error } = await supabase
        .from("mission_progress")
        .upsert(rows, { onConflict: "mission_id,item_id,user_id" });
      if (error) throw error;
      return rows.length;
    },
    onSuccess: async (rowCount) => {
      toast.success(`${tr("sync progress แล้ว")} ${rowCount} ${tr("รายการ")}`);
      await queryClient.invalidateQueries({ queryKey: ["weekly-mission-progress"] });
    },
    onError: (error) => {
      toast.error(getSchemaAwareError(error));
    },
  });

  const createRecapMutation = useMutation({
    mutationFn: async () => {
      if (!activeMission || !currentClassroom || !user) throw new Error(tr("ยังไม่มี mission"));
      const recap = buildTeacherRecap({
        mission: activeMission,
        classroom: currentClassroom,
        itemCount: campaignItems.length,
        memberCount: classroomMembers.length,
        progressRows: progressState.rows,
        submissions: staffSubmissions,
        attempts: staffQuestAttempts,
      });
      const { error } = await supabase.from("weekly_mission_recaps").insert({
        mission_id: activeMission.id,
        classroom_id: currentClassroom.id,
        user_id: null,
        audience: "teacher",
        summary: recap.summary,
        ai_summary: recap.aiSummary,
        created_by: user.id,
      });
      if (error) throw error;
      return recap.aiSummary;
    },
    onSuccess: async () => {
      toast.success(tr("สร้าง recap สัปดาห์แล้ว"));
      await queryClient.invalidateQueries({ queryKey: ["weekly-mission-recaps"] });
    },
    onError: (error) => {
      toast.error(getSchemaAwareError(error));
    },
  });

  const mainProgress = getMainProgress(mainAssignment, mainSubmission, isStaff);
  const practiceProgress = getPracticeProgress(practiceQuest, practiceAttempt, profile);
  const flashcardProgress = flashcardDeck ? flashcardDeck.mastery_pct : 0;
  const missionProgress = clampPct((mainProgress + practiceProgress + flashcardProgress) / 3);
  const doneCount = [mainProgress, practiceProgress, flashcardProgress].filter(
    (value) => value >= 100,
  ).length;

  const missionSteps: MissionStep[] = [
    {
      title: mainCampaignItem?.title ?? mainAssignment?.title ?? `${focus} งานหลักในคาบ`,
      detail:
        mainCampaignItem?.description ??
        mainAssignment?.description ??
        "ใช้เวลาคาบเรียนทำงานชิ้นเดียวให้เห็นผลงานจริง ครูตรวจงานหลักเองและให้ feedback ท้ายรอบ",
      meta: mainCampaignItem
        ? `${mainCampaignItem.required ? tr("ต้องทำ") : tr("งานเสริม")} · +${
            mainCampaignItem.xp_max
          } XP`
        : mainAssignment?.due_date
          ? `กำหนดส่ง ${formatDate(mainAssignment.due_date)}`
          : `ครูตรวจเอง, +${mainAssignment?.xp_reward ?? 100} XP`,
      progress: mainProgress,
      icon: <ClipboardList className="size-5" />,
      href: "/classrooms",
    },
    {
      title: questCampaignItem?.title ?? practiceQuest?.title ?? "Practice Quest จาก AI",
      detail:
        questCampaignItem?.description ??
        practiceQuest?.topic ??
        "โจทย์สั้นสำหรับเก็บแต้มระหว่างสัปดาห์ AI ตรวจแบบให้คะแนนตามสัดส่วนที่ทำได้",
      meta: questCampaignItem
        ? `${questCampaignItem.required ? tr("ต้องทำ") : tr("งานเสริม")} · +${
            questCampaignItem.xp_max
          } XP`
        : practiceQuest
          ? `+${practiceQuest.max_xp_reward ?? 0} XP, +${practiceQuest.max_gold_reward ?? 0} Gold`
          : "เหมาะกับงานสั้น 5-10 นาที",
      progress: practiceProgress,
      icon: <Sparkles className="size-5" />,
      href: "/quests",
    },
    {
      title:
        flashcardCampaignItem?.title ?? flashcardDeck?.title ?? "Flashcard ก่อนเจอครูครั้งหน้า",
      detail:
        flashcardCampaignItem?.description ??
        flashcardDeck?.description ??
        "ทบทวนคำสำคัญหรือขั้นตอนทำงานก่อนคาบถัดไป ให้เด็กที่มีเวลาน้อยยังตามได้",
      meta: flashcardCampaignItem
        ? `${flashcardCampaignItem.required ? tr("ต้องทำ") : tr("งานเสริม")} · +${
            flashcardCampaignItem.xp_max
          } XP`
        : flashcardDeck
          ? `${flashcardDeck.due_count} บัตรถึงรอบ, mastery ${flashcardDeck.mastery_pct}%`
          : "เป้าหมาย 8-12 บัตรต่อสัปดาห์",
      progress: flashcardProgress,
      icon: <Brain className="size-5" />,
      href: "/flashcards",
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6 lg:p-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <Badge variant="outline" className="mb-3 gap-1.5">
            <CalendarCheck className="size-3.5" />
            {tr("Weekly mission loop")}
          </Badge>
          <h1 className="font-display text-3xl font-semibold md:text-4xl">{tr("ภารกิจสัปดาห์")}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground md:text-base">
            {tr(
              "จัดรอบเรียน 2 ชั่วโมงต่อห้องให้เป็น 1 งานหลักในคาบ, 1-2 งานเสริมจาก AI, flashcard สั้น ๆ และสรุปคะแนนท้ายสัปดาห์",
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to="/quests">
              <Sparkles className="size-4" />
              {tr("เปิด Practice Quest")}
            </Link>
          </Button>
          <Button asChild>
            <Link to="/flashcards">
              <Layers className="size-4" />
              {tr("ทบทวน Flashcard")}
            </Link>
          </Button>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SystemMetric
          icon={<ClipboardList className="size-5" />}
          label={tr("งานหลัก")}
          value="1"
          detail={tr("ครูตรวจเอง")}
        />
        <SystemMetric
          icon={<Zap className="size-5" />}
          label={tr("งานเสริม")}
          value="1-2"
          detail={tr("AI ตรวจตามสัดส่วน")}
          tone="xp"
        />
        <SystemMetric
          icon={<Users className="size-5" />}
          label={tr("ทีม")}
          value="1-4"
          detail={tr("เดี่ยวหรือกลุ่มเล็ก")}
        />
        <SystemMetric
          icon={<Crown className="size-5" />}
          label={tr("อันดับ")}
          value={tr("ห้อง + สายชั้น")}
          detail={tr("ใช้คะแนนพิเศษท้ายเทอมได้")}
          tone="gold"
        />
      </section>

      <CampaignBriefPanel
        mission={activeMission}
        schemaReady={campaignState.schemaReady}
        weekRange={weekRange}
        classroom={currentClassroom}
        focus={focus}
        itemCount={campaignItems.length}
        isStaff={isStaff}
        isSaving={saveDraftMutation.isPending}
        isUpdatingStatus={updateStatusMutation.isPending}
        onSaveDraft={() => saveDraftMutation.mutate()}
        onPublish={() => updateStatusMutation.mutate("published")}
        onClose={() => updateStatusMutation.mutate("closed")}
      />

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">{tr("เลือกห้องสำหรับรอบนี้")}</p>
              <p className="text-sm text-muted-foreground">
                {tr("ระบบจะดึงงาน, quest และ deck ที่เกี่ยวกับห้องนั้นมาประกอบเป็นภารกิจ")}
              </p>
            </div>
            <Badge variant="secondary">
              {classrooms.length} {tr("ห้อง")}
            </Badge>
          </div>
          {loadingClassrooms ? (
            <p className="text-sm text-muted-foreground">{tr("กำลังโหลด…")}</p>
          ) : classrooms.length === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/25 p-4">
              <p className="text-sm text-muted-foreground">
                {tr("ยังไม่พบห้องเรียน เพิ่มหรือเข้าร่วมห้องก่อนเพื่อสร้างภารกิจสัปดาห์")}
              </p>
              <Button asChild variant="outline">
                <Link to="/classrooms">
                  <BookOpen className="size-4" />
                  {tr("ไปที่ห้องเรียน")}
                </Link>
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {classrooms.map((classroom) => {
                const selected = classroom.id === currentClassroom?.id;
                return (
                  <Button
                    key={classroom.id}
                    type="button"
                    variant={selected ? "default" : "outline"}
                    onClick={() => setSelectedClassroomId(classroom.id)}
                    className="min-w-11"
                  >
                    {classroom.name}
                  </Button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {isStaff && (
        <TeacherMissionBuilderPanel
          title={draftTitle}
          assignments={classroomAssignments}
          quests={classroomQuests}
          decks={classroomDecks}
          selectedAssignmentId={selectedAssignmentId}
          selectedQuestId={selectedQuestId}
          selectedDeckId={selectedDeckId}
          participationXp={participationXp}
          qualityXpMax={qualityXpMax}
          teamMode={builderTeamMode}
          schemaReady={campaignState.schemaReady}
          hasClassroom={!!currentClassroom}
          isSaving={saveDraftMutation.isPending}
          isUpdatingStatus={updateStatusMutation.isPending}
          hasMission={!!activeMission}
          missionStatus={activeMission?.status ?? "draft"}
          onTitleChange={setDraftTitle}
          onAssignmentChange={setSelectedAssignmentId}
          onQuestChange={setSelectedQuestId}
          onDeckChange={setSelectedDeckId}
          onParticipationXpChange={setParticipationXp}
          onQualityXpMaxChange={setQualityXpMax}
          onTeamModeChange={setBuilderTeamMode}
          onSaveDraft={() => saveDraftMutation.mutate()}
          onPublish={() => updateStatusMutation.mutate("published")}
          onClose={() => updateStatusMutation.mutate("closed")}
        />
      )}

      <section className="grid gap-4 lg:grid-cols-[1.35fr_0.85fr]">
        <Card className="overflow-hidden border-primary/25 bg-[linear-gradient(135deg,var(--card),color-mix(in_oklch,var(--accent)_22%,var(--card)))]">
          <CardHeader className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="font-display text-2xl">
                  {currentClassroom?.name ?? tr("Weekly mission preview")}
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {currentClassroom
                    ? `${currentClassroom.grade_level ?? tr("ไม่ระบุชั้น")} · ${
                        currentClassroom.subject ?? focus
                      }`
                    : tr("เลือกห้องเพื่อดูภารกิจรายสัปดาห์")}
                </p>
              </div>
              <Badge className="gap-1">
                <Target className="size-3.5" />
                {doneCount}/3
              </Badge>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">{tr("ความพร้อมของรอบสัปดาห์")}</span>
                <span className="font-semibold">{missionProgress}%</span>
              </div>
              <Progress value={missionProgress} className="h-2.5" />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {missionSteps.map((step) => (
              <MissionRow key={step.title} step={step} currentClassroomId={currentClassroomId} />
            ))}
          </CardContent>
        </Card>

        {isStaff ? (
          <TeacherWeeklyPanel
            assignments={classroomAssignments}
            quests={classroomQuests}
            decks={classroomDecks}
            focus={focus}
          />
        ) : (
          <StudentWeeklyPanel
            profile={profile}
            mainProgress={mainProgress}
            practiceProgress={practiceProgress}
            flashcardProgress={flashcardProgress}
            progressRows={progressState.rows}
            recaps={recapState.recaps}
          />
        )}
      </section>

      {isStaff ? (
        <SessionDashboardPanel
          mission={activeMission}
          progressState={progressState}
          recapState={recapState}
          itemCount={campaignItems.length}
          memberCount={classroomMembers.length}
          submissionCount={staffSubmissions.length}
          attemptCount={staffQuestAttempts.length}
          isSyncing={syncProgressMutation.isPending}
          isCreatingRecap={createRecapMutation.isPending}
          onSyncProgress={() => syncProgressMutation.mutate()}
          onCreateRecap={() => createRecapMutation.mutate()}
        />
      ) : (
        <StudentRecapPanel progressRows={progressState.rows} recaps={recapState.recaps} />
      )}

      <section className="grid gap-4 lg:grid-cols-2">
        <TeamPlannerPanel
          mission={activeMission}
          teamState={teamState}
          memberCount={classroomMemberCount}
          teamMode={activeMission?.team_mode ?? recommendedTeamMode}
          memberProfiles={memberProfiles}
          isCreatingTeams={createTeamsMutation.isPending}
          onCreateTeams={() => createTeamsMutation.mutate()}
        />

        <BonusPathPanel rules={bonusState.rules} schemaReady={bonusState.schemaReady} />
      </section>
    </div>
  );
}

function SystemMetric({
  icon,
  label,
  value,
  detail,
  tone = "primary",
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  detail: string;
  tone?: "primary" | "gold" | "xp";
}) {
  const toneClass =
    tone === "gold"
      ? "bg-[color-mix(in_oklch,var(--gold)_13%,var(--card))] text-[color:var(--gold)]"
      : tone === "xp"
        ? "bg-[color-mix(in_oklch,var(--xp)_13%,var(--card))] text-[color:var(--xp)]"
        : "bg-primary/10 text-primary";
  const iconMotionClass = tone === "xp" ? "scholar-progress-ring" : "";
  return (
    <Card className={tone === "gold" ? "scholar-metric scholar-reward-cue" : "scholar-metric"}>
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={`grid size-11 shrink-0 place-items-center rounded-md ${toneClass} ${iconMotionClass}`}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm text-muted-foreground">{label}</p>
          <p className="truncate text-xl font-semibold">{value}</p>
          <p className="truncate text-xs text-muted-foreground">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function CampaignBriefPanel({
  mission,
  schemaReady,
  weekRange,
  classroom,
  focus,
  itemCount,
  isStaff,
  isSaving,
  isUpdatingStatus,
  onSaveDraft,
  onPublish,
  onClose,
}: {
  mission: WeeklyMissionRow | null;
  schemaReady: boolean;
  weekRange: WeekRange;
  classroom: ClassroomRow | null;
  focus: string;
  itemCount: number;
  isStaff: boolean;
  isSaving: boolean;
  isUpdatingStatus: boolean;
  onSaveDraft: () => void;
  onPublish: () => void;
  onClose: () => void;
}) {
  const status = mission?.status ?? "template";
  const statusMeta = getMissionStatusMeta(status, schemaReady);
  const disabled = isSaving || isUpdatingStatus;

  return (
    <Card>
      <CardContent className="grid gap-4 p-4 lg:grid-cols-[1.4fr_0.9fr] lg:items-center">
        <div className="flex min-w-0 gap-3">
          <div className="grid size-11 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <FileCheck2 className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-xl font-semibold">
                {mission?.title ?? `${focus}: ${classroom?.name ?? tr("ยังไม่ได้เลือกห้อง")}`}
              </h2>
              <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
            </div>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              {tr("รอบ")} {formatDate(weekRange.startIso)} - {formatDate(weekRange.endIso)} ·{" "}
              {mission ? tr("บันทึกเป็น campaign แล้ว") : tr("สร้างจากข้อมูลเดิมเป็น preview")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant="outline" className="gap-1">
                <ClipboardList className="size-3.5" />
                {itemCount || 3} {tr("รายการ")}
              </Badge>
              <Badge variant="outline" className="gap-1">
                <Zap className="size-3.5" />
                {mission?.participation_xp ?? 30}+{mission?.quality_xp_max ?? 60} XP
              </Badge>
              <Badge variant="outline" className="gap-1">
                <Users className="size-3.5" />
                {mission?.team_mode ? tr("เปิดทีม") : tr("ทีมตามกิจกรรม")}
              </Badge>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-start gap-2 lg:justify-end">
          {isStaff ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={onSaveDraft}
                disabled={!schemaReady || !classroom || disabled}
              >
                {isSaving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FileCheck2 className="size-4" />
                )}
                {tr("บันทึก draft")}
              </Button>
              <Button
                type="button"
                onClick={onPublish}
                disabled={!schemaReady || !mission || mission.status === "published" || disabled}
              >
                {isUpdatingStatus ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Rocket className="size-4" />
                )}
                {tr("เผยแพร่")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={!schemaReady || !mission || mission.status === "closed" || disabled}
              >
                <ShieldCheck className="size-4" />
                {tr("ปิดรอบ")}
              </Button>
              {!schemaReady && (
                <p className="basis-full text-xs text-muted-foreground">
                  {tr("รอ apply migration weekly_mission_system ก่อนบันทึกลงฐานข้อมูล")}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {mission?.status === "published"
                ? tr("ภารกิจนี้เผยแพร่แล้ว ทำให้ครบก่อนเจอครูครั้งหน้า")
                : tr("ครูกำลังจัดรอบสัปดาห์นี้ ระบบจะแสดง preview ให้ก่อน")}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function TeacherMissionBuilderPanel({
  title,
  assignments,
  quests,
  decks,
  selectedAssignmentId,
  selectedQuestId,
  selectedDeckId,
  participationXp,
  qualityXpMax,
  teamMode,
  schemaReady,
  hasClassroom,
  hasMission,
  missionStatus,
  isSaving,
  isUpdatingStatus,
  onTitleChange,
  onAssignmentChange,
  onQuestChange,
  onDeckChange,
  onParticipationXpChange,
  onQualityXpMaxChange,
  onTeamModeChange,
  onSaveDraft,
  onPublish,
  onClose,
}: {
  title: string;
  assignments: AssignmentRow[];
  quests: QuestRow[];
  decks: DeckWithStats[];
  selectedAssignmentId: string;
  selectedQuestId: string;
  selectedDeckId: string;
  participationXp: number;
  qualityXpMax: number;
  teamMode: boolean;
  schemaReady: boolean;
  hasClassroom: boolean;
  hasMission: boolean;
  missionStatus: string;
  isSaving: boolean;
  isUpdatingStatus: boolean;
  onTitleChange: (value: string) => void;
  onAssignmentChange: (value: string) => void;
  onQuestChange: (value: string) => void;
  onDeckChange: (value: string) => void;
  onParticipationXpChange: (value: number) => void;
  onQualityXpMaxChange: (value: number) => void;
  onTeamModeChange: (value: boolean) => void;
  onSaveDraft: () => void;
  onPublish: () => void;
  onClose: () => void;
}) {
  const disabled = isSaving || isUpdatingStatus;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="font-display flex items-center gap-2 text-xl">
              <Wand2 className="size-5 text-primary" />
              {tr("Mission Builder")}
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {tr("เลือกงานหลัก, Practice Quest, Flashcard และกติกาทีมสำหรับรอบ 2 ชั่วโมง")}
            </p>
          </div>
          <Badge variant="outline">
            {assignments.length + quests.length + decks.length} assets
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-2">
            <Label htmlFor="weekly-mission-title">{tr("ชื่อภารกิจ")}</Label>
            <Input
              id="weekly-mission-title"
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              placeholder={tr("เช่น Canva design sprint: ม.3/1")}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="weekly-participation-xp">{tr("Participation XP")}</Label>
              <Input
                id="weekly-participation-xp"
                type="number"
                min={0}
                max={100}
                value={participationXp}
                onChange={(event) => onParticipationXpChange(Number(event.target.value) || 0)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="weekly-quality-xp">{tr("Quality XP สูงสุด")}</Label>
              <Input
                id="weekly-quality-xp"
                type="number"
                min={0}
                max={200}
                value={qualityXpMax}
                onChange={(event) => onQualityXpMaxChange(Number(event.target.value) || 0)}
              />
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <SelectField
            id="weekly-main-work"
            label={tr("งานหลักในคาบ")}
            value={selectedAssignmentId}
            emptyLabel={tr("ไม่ผูกงานหลัก")}
            onChange={onAssignmentChange}
            options={assignments.map((assignment) => ({
              value: assignment.id,
              label: `${assignment.title} · ${assignment.xp_reward} XP`,
            }))}
          />
          <SelectField
            id="weekly-practice-quest"
            label={tr("Practice Quest")}
            value={selectedQuestId}
            emptyLabel={tr("ไม่ผูก quest")}
            onChange={onQuestChange}
            options={quests
              .filter((quest): quest is QuestRow & { id: string } => !!quest.id)
              .map((quest) => ({
                value: quest.id,
                label: `${quest.title} · ${quest.max_xp_reward ?? 0} XP`,
              }))}
          />
          <SelectField
            id="weekly-flashcard-deck"
            label={tr("Flashcard deck")}
            value={selectedDeckId}
            emptyLabel={tr("ไม่ผูก deck")}
            onChange={onDeckChange}
            options={decks.map((deck) => ({
              value: deck.id,
              label: `${deck.title} · ${deck.card_count} cards`,
            }))}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-muted/20 p-4">
          <div className="min-w-0">
            <Label htmlFor="weekly-team-mode" className="text-sm">
              {tr("เปิด Team Rally")}
            </Label>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              {tr("เหมาะกับห้อง 5-30 คน แบ่งบทบาท 1-4 คนต่อทีมและใช้ helper mark ได้")}
            </p>
          </div>
          <Switch id="weekly-team-mode" checked={teamMode} onCheckedChange={onTeamModeChange} />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={onSaveDraft}
            disabled={!schemaReady || !hasClassroom || disabled}
          >
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FileCheck2 className="size-4" />
            )}
            {tr("บันทึก mission")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onPublish}
            disabled={!schemaReady || !hasMission || missionStatus === "published" || disabled}
          >
            {isUpdatingStatus ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Rocket className="size-4" />
            )}
            {tr("เผยแพร่ให้เด็ก")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={!schemaReady || !hasMission || missionStatus === "closed" || disabled}
          >
            <ShieldCheck className="size-4" />
            {tr("ปิดรอบ")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SelectField({
  id,
  label,
  value,
  emptyLabel,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  emptyLabel: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="none">{emptyLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function MissionRow({
  step,
  currentClassroomId,
}: {
  step: MissionStep;
  currentClassroomId: string | null;
}) {
  return (
    <div className="scholar-metric rounded-lg border bg-card/85 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            {step.icon}
          </span>
          <div className="min-w-0 space-y-1">
            <p className="font-medium leading-tight">{step.title}</p>
            <p className="line-clamp-2 text-sm leading-5 text-muted-foreground">{step.detail}</p>
            <p className="text-xs text-muted-foreground">{step.meta}</p>
          </div>
        </div>
        <Button asChild size="sm" variant="outline">
          {step.href === "/classrooms" && currentClassroomId ? (
            <Link to="/classrooms/$id" params={{ id: currentClassroomId }}>
              {tr("เปิด")}
              <ArrowRight className="size-4" />
            </Link>
          ) : (
            <Link to={step.href}>
              {tr("เปิด")}
              <ArrowRight className="size-4" />
            </Link>
          )}
        </Button>
      </div>
      <div className="mt-3 space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">{tr("ความคืบหน้า")}</span>
          <span className="font-medium">{step.progress}%</span>
        </div>
        <Progress value={step.progress} className="h-2" />
      </div>
    </div>
  );
}

function TeacherWeeklyPanel({
  assignments,
  quests,
  decks,
  focus,
}: {
  assignments: AssignmentRow[];
  quests: QuestRow[];
  decks: DeckWithStats[];
  focus: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display flex items-center gap-2 text-xl">
          <CalendarCheck className="size-5 text-primary" />
          {tr("ตัวช่วยจัดคาบครู")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-muted/20 p-4">
          <p className="text-sm font-medium">{focus}</p>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            {tr(
              "ใช้เป็นกรอบ 2 ชั่วโมง: เปิดโจทย์, ให้เด็กทำงาน, ปิดด้วย recap และมอบงาน AI สั้น ๆ",
            )}
          </p>
        </div>
        <div className="grid gap-2">
          <TeacherReadiness
            label={tr("งานหลักพร้อมใช้")}
            value={assignments.length}
            ready={assignments.length > 0}
          />
          <TeacherReadiness
            label={tr("Practice Quest เปิดอยู่")}
            value={quests.length}
            ready={quests.length > 0}
          />
          <TeacherReadiness
            label={tr("Deck สำหรับทวน")}
            value={decks.length}
            ready={decks.length > 0}
          />
        </div>
        <div className="space-y-2 rounded-lg border p-4">
          <p className="text-sm font-medium">{tr("ลำดับคาบที่แนะนำ")}</p>
          <ol className="space-y-2 text-sm text-muted-foreground">
            <li>1. {tr("เปิดเป้าหมายและเกณฑ์คะแนน 10 นาที")}</li>
            <li>2. {tr("ทำงานหลักเดี่ยวหรือกลุ่ม 70 นาที")}</li>
            <li>3. {tr("ให้ AI practice และ flashcard เป็นงานเสริม 20 นาที")}</li>
            <li>4. {tr("สรุปอันดับ, feedback และเป้าหมายก่อนคาบหน้า")}</li>
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}

function StudentWeeklyPanel({
  profile,
  mainProgress,
  practiceProgress,
  flashcardProgress,
  progressRows,
  recaps,
}: {
  profile?: ProfileRow | null;
  mainProgress: number;
  practiceProgress: number;
  flashcardProgress: number;
  progressRows: MissionProgressRow[];
  recaps: WeeklyMissionRecapRow[];
}) {
  const streak = profile?.streak_days ?? 0;
  const syncedDone = progressRows.filter((row) =>
    ["submitted", "reviewed", "completed"].includes(row.status),
  ).length;
  const latestRecap = recaps[0]?.ai_summary;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display flex items-center gap-2 text-xl">
          <Flame className="size-5 text-primary" />
          {tr("ก่อนเจอครูครั้งหน้า")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <StudentPulse label={tr("งานหลัก")} value={mainProgress} />
          <StudentPulse label={tr("Quest")} value={practiceProgress} />
          <StudentPulse label={tr("Flashcard")} value={flashcardProgress} />
        </div>
        <div className="rounded-lg border bg-muted/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">{tr("Weekly streak")}</p>
            <Badge variant="outline">{streak} วัน</Badge>
          </div>
          <p className="mt-2 text-sm leading-5 text-muted-foreground">
            {tr(
              "เก็บให้ครบ 3 ส่วนเพื่อให้คะแนนสัปดาห์นี้นิ่งขึ้น แล้วใช้ leaderboard ดูว่าควรดันเพิ่มตรงไหน",
            )}
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">{tr("Synced checklist")}</p>
            <Badge variant={syncedDone > 0 ? "default" : "outline"}>
              {syncedDone}/{Math.max(progressRows.length, 3)}
            </Badge>
          </div>
          <p className="mt-2 text-sm leading-5 text-muted-foreground">
            {latestRecap ??
              tr("เมื่อครู sync รอบนี้ ระบบจะแสดง checklist และ recap ให้เห็นชัดขึ้น")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to="/hall-of-fame">
              <Trophy className="size-4" />
              {tr("ดูอันดับ")}
            </Link>
          </Button>
          <Button asChild>
            <Link to="/weekly-missions">
              <Target className="size-4" />
              {tr("อัปเดตรอบนี้")}
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SessionDashboardPanel({
  mission,
  progressState,
  recapState,
  itemCount,
  memberCount,
  submissionCount,
  attemptCount,
  isSyncing,
  isCreatingRecap,
  onSyncProgress,
  onCreateRecap,
}: {
  mission: WeeklyMissionRow | null;
  progressState: ProgressState;
  recapState: RecapState;
  itemCount: number;
  memberCount: number;
  submissionCount: number;
  attemptCount: number;
  isSyncing: boolean;
  isCreatingRecap: boolean;
  onSyncProgress: () => void;
  onCreateRecap: () => void;
}) {
  const submittedRows = progressState.rows.filter((row) =>
    ["submitted", "reviewed", "completed"].includes(row.status),
  ).length;
  const reviewedRows = progressState.rows.filter((row) => row.status === "reviewed").length;
  const completedRows = progressState.rows.filter((row) => row.status === "completed").length;
  const progressPct = progressState.rows.length
    ? clampPct((submittedRows / progressState.rows.length) * 100)
    : 0;
  const latestRecap = recapState.recaps[0];
  const disabled = !mission || !progressState.schemaReady || isSyncing || isCreatingRecap;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="font-display flex items-center gap-2 text-xl">
              <ClipboardCheck className="size-5 text-primary" />
              {tr("Session Dashboard")}
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {tr("sync งานทั้งห้อง, ดูสถานะ และสร้าง recap สำหรับปิดรอบสัปดาห์")}
            </p>
          </div>
          <Badge variant={progressState.schemaReady ? "default" : "outline"}>
            {progressState.schemaReady ? tr("progress พร้อม") : tr("รอ migration")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SessionMetric label={tr("นักเรียน")} value={memberCount} />
          <SessionMetric label={tr("รายการ mission")} value={itemCount || 3} />
          <SessionMetric label={tr("ส่งงานหลัก")} value={submissionCount} />
          <SessionMetric label={tr("ทำ AI quest")} value={attemptCount} />
        </div>

        <div className="rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{tr("Progress sync")}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {submittedRows} {tr("รายการมีความคืบหน้า")} · {reviewedRows}{" "}
                {tr("รายการครูตรวจแล้ว")} · {completedRows} {tr("รายการ AI ทำครบ")}
              </p>
            </div>
            <Badge variant="outline">
              {progressState.rows.length} {tr("rows")}
            </Badge>
          </div>
          <Progress value={progressPct} className="mt-3 h-2.5" />
        </div>

        {latestRecap ? (
          <div className="rounded-lg border bg-muted/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{tr("Recap ล่าสุด")}</p>
              <Badge variant="outline">{formatDate(latestRecap.generated_at)}</Badge>
            </div>
            <p className="mt-2 text-sm leading-5 text-muted-foreground">
              {latestRecap.ai_summary ?? tr("มี recap แล้ว")}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
            {tr("ยังไม่มี recap สัปดาห์นี้ หลัง sync progress แล้วให้สร้าง recap เพื่อใช้ปิดคาบ")}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={onSyncProgress} disabled={!mission || isSyncing}>
            {isSyncing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <LineChart className="size-4" />
            )}
            {tr("sync progress")}
          </Button>
          <Button type="button" variant="outline" onClick={onCreateRecap} disabled={disabled}>
            {isCreatingRecap ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FileCheck2 className="size-4" />
            )}
            {tr("สร้าง recap")}
          </Button>
        </div>
        {!progressState.schemaReady && (
          <p className="text-xs text-muted-foreground">
            {tr("รอ apply migration mission_progress และ weekly_mission_recaps ก่อนใช้งานจริง")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function StudentRecapPanel({
  progressRows,
  recaps,
}: {
  progressRows: MissionProgressRow[];
  recaps: WeeklyMissionRecapRow[];
}) {
  const doneRows = progressRows.filter((row) =>
    ["submitted", "reviewed", "completed"].includes(row.status),
  ).length;
  const progressPct = progressRows.length ? clampPct((doneRows / progressRows.length) * 100) : 0;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardTitle className="font-display flex items-center gap-2 text-xl">
            <FileCheck2 className="size-5 text-primary" />
            {tr("Weekly Recap")}
          </CardTitle>
          <Badge variant={progressRows.length > 0 ? "default" : "outline"}>
            {doneRows}/{Math.max(progressRows.length, 3)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Progress value={progressPct} className="h-2.5" />
        {progressRows.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-3">
            {progressRows.slice(0, 3).map((row) => (
              <div key={row.id} className="rounded-lg border p-3">
                <p className="text-sm font-medium">{tr(row.status)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  +{row.participation_xp_awarded + row.quality_xp_awarded + row.ai_xp_awarded} XP
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {tr("รอครู sync progress รอบนี้ แล้ว checklist รายสัปดาห์จะแสดงตรงนี้")}
          </p>
        )}
        {recaps[0]?.ai_summary && (
          <p className="rounded-lg border bg-muted/20 p-3 text-sm leading-5 text-muted-foreground">
            {recaps[0].ai_summary}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function SessionMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card/80 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

function TeacherReadiness({
  label,
  value,
  ready,
}: {
  label: string;
  value: number;
  ready: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
      <span className="text-sm">{label}</span>
      <Badge variant={ready ? "default" : "outline"}>{value}</Badge>
    </div>
  );
}

function StudentPulse({
  label,
  value,
  suffix = "%",
}: {
  label: string;
  value: number;
  suffix?: string;
}) {
  return (
    <div className="scholar-metric rounded-lg border bg-card/80 p-3 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">
        {value}
        {suffix}
      </p>
    </div>
  );
}

function TeamPlannerPanel({
  mission,
  teamState,
  memberCount,
  teamMode,
  memberProfiles,
  isCreatingTeams,
  onCreateTeams,
}: {
  mission: WeeklyMissionRow | null;
  teamState: TeamState;
  memberCount: number;
  teamMode: boolean;
  memberProfiles: ProfileNameRow[];
  isCreatingTeams: boolean;
  onCreateTeams: () => void;
}) {
  const suggestedTeamCount = Math.max(1, Math.ceil(Math.max(memberCount, 1) / 4));
  const memberByTeam = new Map<string, WeeklyMissionTeamMemberRow[]>();
  const profileById = new Map(memberProfiles.map((profile) => [profile.id, profile]));
  for (const member of teamState.members) {
    memberByTeam.set(member.team_id, [...(memberByTeam.get(member.team_id) ?? []), member]);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardTitle className="font-display flex items-center gap-2 text-xl">
            <Users className="size-5 text-primary" />
            {tr("Team Rally")}
          </CardTitle>
          <Badge variant={teamMode ? "default" : "outline"}>
            {teamMode ? tr("เปิดใช้ทีม") : tr("พร้อมใช้เมื่อครูเปิด")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <StudentPulse label={tr("สมาชิก")} value={memberCount} suffix="" />
          <StudentPulse label={tr("ทีมแนะนำ")} value={suggestedTeamCount} suffix="" />
          <StudentPulse label={tr("ทีมจริง")} value={teamState.teams.length} suffix="" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onCreateTeams}
            disabled={!mission || !teamMode || memberCount === 0 || isCreatingTeams}
          >
            {isCreatingTeams ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Users className="size-4" />
            )}
            {tr("สร้างทีมอัตโนมัติ")}
          </Button>
          <Badge variant="outline">
            {tr("สูงสุด")} 4 {tr("คนต่อทีม")}
          </Badge>
        </div>
        <div className="space-y-2">
          {teamState.teams.length > 0 ? (
            teamState.teams.map((team) => (
              <div key={team.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">{team.name}</p>
                  <Badge variant="outline">
                    {(memberByTeam.get(team.id) ?? []).length} {tr("คน")}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {team.team_goal ?? tr("เก็บ contribution mark และ helper mark จากกิจกรรมนี้")}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(memberByTeam.get(team.id) ?? []).map((member) => {
                    const profile = profileById.get(member.user_id);
                    return (
                      <Badge key={member.id} variant="secondary" className="gap-1">
                        <span className="max-w-28 truncate">
                          {profile?.display_name ?? tr("นักเรียน")}
                        </span>
                        <span className="text-muted-foreground">
                          {member.role_label ?? tr("สมาชิก")}
                        </span>
                      </Badge>
                    );
                  })}
                </div>
              </div>
            ))
          ) : (
            <>
              <RallyLine
                icon={<Users className="size-4" />}
                title={tr("ทีมชั่วคราว 1-4 คน")}
                detail={tr("ระบบรองรับห้อง 5-30 คน โดยไม่ล็อกทีมถาวรทั้งเทอม")}
              />
              <RallyLine
                icon={<LineChart className="size-4" />}
                title={tr("Contribution mark")}
                detail={tr("ครูใช้บันทึกการช่วยงานและบทบาทในทีมหลังจบกิจกรรม")}
              />
              <RallyLine
                icon={<CheckCircle2 className="size-4" />}
                title={tr("Helper mark")}
                detail={tr("ใช้เป็น milestone ที่ช่วยเด็กซึ่งไม่ติดอันดับยังได้คะแนนพิเศษ")}
              />
            </>
          )}
        </div>
        {!mission && (
          <p className="text-xs text-muted-foreground">
            {tr("บันทึก draft mission ก่อนจึงจะสร้างทีมและสมาชิกลงฐานข้อมูลได้")}
          </p>
        )}
        {mission && !teamState.schemaReady && (
          <p className="text-xs text-muted-foreground">
            {tr("รอ apply migration ส่วน team ก่อนอ่านรายชื่อทีมจริง")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function BonusPathPanel({
  rules,
  schemaReady,
}: {
  rules: TermBonusRuleRow[];
  schemaReady: boolean;
}) {
  const fallbackRules = [
    {
      name: tr("อันดับรายห้องและสายชั้น"),
      rule_type: "leaderboard",
      bonus_points: 2,
      detail: tr("ใช้ leaderboard แต่จำกัดผลจากการ farm activity ซ้ำ"),
    },
    {
      name: tr("ทำ Weekly Mission ครบ 70%"),
      rule_type: "milestone",
      bonus_points: 2,
      detail: tr("ให้เด็กส่วนใหญ่ยังมีทางเก็บคะแนนพิเศษได้"),
    },
    {
      name: tr("Helper mark จากงานทีม"),
      rule_type: "helper",
      bonus_points: 1,
      detail: tr("ให้รางวัลการช่วยเพื่อนและการทำงานร่วมกัน"),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardTitle className="font-display flex items-center gap-2 text-xl">
            <Trophy className="size-5 text-primary" />
            {tr("Recap + Bonus Path")}
          </CardTitle>
          <Badge variant={rules.length > 0 ? "default" : "outline"}>
            {rules.length > 0 ? tr("กติกาจริง") : tr("กติกาแนะนำ")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {rules.length > 0
          ? rules.map((rule) => (
              <BonusRuleLine
                key={rule.id}
                name={rule.name}
                type={rule.rule_type}
                points={rule.bonus_points}
                detail={describeCriteria(rule.criteria_json)}
              />
            ))
          : fallbackRules.map((rule) => (
              <BonusRuleLine
                key={rule.name}
                name={rule.name}
                type={rule.rule_type}
                points={rule.bonus_points}
                detail={rule.detail}
              />
            ))}
        {!schemaReady && (
          <p className="text-xs text-muted-foreground">
            {tr("รอ apply migration term_bonus_rules ก่อนดึงกติกาคะแนนพิเศษจริง")}
          </p>
        )}
        <Button asChild variant="outline" className="w-full justify-between">
          <Link to="/bonus-center">
            {tr("เปิด Bonus Center")}
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function RallyLine({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className="flex gap-3 rounded-lg border p-3">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
        {icon}
      </span>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm leading-5 text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function BonusRuleLine({
  name,
  type,
  points,
  detail,
}: {
  name: string;
  type: string;
  points: number;
  detail: string;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{name}</p>
          <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline">{type}</Badge>
          <Badge>{points} pts</Badge>
        </div>
      </div>
    </div>
  );
}

function buildProgressInserts({
  mission,
  items,
  members,
  assignments,
  submissions,
  attempts,
}: {
  mission: WeeklyMissionRow;
  items: WeeklyMissionItemRow[];
  members: ClassroomMemberRow[];
  assignments: AssignmentRow[];
  submissions: SubmissionRow[];
  attempts: QuestAttemptRow[];
}): MissionProgressInsert[] {
  const assignmentById = new Map(assignments.map((assignment) => [assignment.id, assignment]));
  return members.flatMap((member) =>
    items.map((item): MissionProgressInsert => {
      if (item.type === "main_work") {
        const assignmentId = item.source_id ?? mission.main_assignment_id;
        const assignment = assignmentId ? assignmentById.get(assignmentId) : undefined;
        const submission = submissions.find(
          (row) => row.user_id === member.user_id && row.assignment_id === assignmentId,
        );
        const scoreRatio =
          typeof submission?.score === "number"
            ? submission.score / Math.max(1, assignment?.max_score ?? 100)
            : 0;
        return {
          mission_id: mission.id,
          item_id: item.id,
          user_id: member.user_id,
          status: submission?.graded_at
            ? "reviewed"
            : submission?.submitted_at
              ? "submitted"
              : "not_started",
          participation_xp_awarded: submission?.submitted_at ? mission.participation_xp : 0,
          quality_xp_awarded: submission?.graded_at
            ? Math.round(clampPct(scoreRatio * 100) * (mission.quality_xp_max / 100))
            : 0,
          ai_xp_awarded: 0,
          completed_at: submission?.submitted_at ?? null,
          reviewed_at: submission?.graded_at ?? null,
        };
      }

      if (item.type === "ai_quest") {
        const questId = item.source_id ?? mission.practice_quest_id;
        const attempt = attempts
          .filter((row) => row.user_id === member.user_id && row.quest_id === questId)
          .sort(
            (a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime(),
          )[0];
        return {
          mission_id: mission.id,
          item_id: item.id,
          user_id: member.user_id,
          status: attempt ? "completed" : "not_started",
          participation_xp_awarded: 0,
          quality_xp_awarded: 0,
          ai_xp_awarded: attempt?.xp_awarded ?? 0,
          completed_at: attempt?.completed_at ?? null,
          reviewed_at: attempt?.completed_at ?? null,
        };
      }

      return {
        mission_id: mission.id,
        item_id: item.id,
        user_id: member.user_id,
        status: item.source_id ? "in_progress" : "not_started",
        participation_xp_awarded: 0,
        quality_xp_awarded: 0,
        ai_xp_awarded: 0,
        completed_at: null,
        reviewed_at: null,
      };
    }),
  );
}

function buildTeacherRecap({
  mission,
  classroom,
  itemCount,
  memberCount,
  progressRows,
  submissions,
  attempts,
}: {
  mission: WeeklyMissionRow;
  classroom: ClassroomRow;
  itemCount: number;
  memberCount: number;
  progressRows: MissionProgressRow[];
  submissions: SubmissionRow[];
  attempts: QuestAttemptRow[];
}) {
  const submittedRows = progressRows.filter((row) =>
    ["submitted", "reviewed", "completed"].includes(row.status),
  ).length;
  const reviewedRows = progressRows.filter((row) => row.status === "reviewed").length;
  const completedRows = progressRows.filter((row) => row.status === "completed").length;
  const expectedRows = memberCount * Math.max(1, itemCount || 3);
  const progressPct = expectedRows ? clampPct((submittedRows / expectedRows) * 100) : 0;
  const summary: Json = {
    mission_id: mission.id,
    classroom_id: classroom.id,
    member_count: memberCount,
    item_count: itemCount || 3,
    progress_rows: progressRows.length,
    submitted_rows: submittedRows,
    reviewed_rows: reviewedRows,
    completed_rows: completedRows,
    assignment_submissions: submissions.length,
    ai_attempts: attempts.length,
    progress_pct: progressPct,
  };
  const aiSummary = `${classroom.name}: ${progressPct}% ของ checklist มีความคืบหน้า, งานหลักส่งแล้ว ${submissions.length} รายการ, AI quest ทำแล้ว ${attempts.length} ครั้ง. รอบถัดไปควรปิดงานหลักที่ยังไม่ส่งและให้ helper mark กับทีมที่ช่วยกันชัดเจน`;
  return { summary, aiSummary };
}

function getCurrentWeekRange(reference = new Date()): WeekRange {
  const start = new Date(reference);
  const day = start.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + diffToMonday);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return {
    startIso: toDateIso(start),
    endIso: toDateIso(end),
  };
}

function toDateIso(value: Date) {
  return value.toISOString().slice(0, 10);
}

function getMissionStatusMeta(status: string, schemaReady: boolean) {
  if (!schemaReady) return { label: tr("รอ migration"), variant: "outline" as const };
  if (status === "published") return { label: tr("เผยแพร่แล้ว"), variant: "default" as const };
  if (status === "closed") return { label: tr("ปิดรอบแล้ว"), variant: "secondary" as const };
  if (status === "draft") return { label: tr("draft"), variant: "outline" as const };
  return { label: tr("preview"), variant: "outline" as const };
}

function buildMissionItemInserts({
  missionId,
  mainAssignment,
  practiceQuest,
  flashcardDeck,
  focus,
}: {
  missionId: string;
  mainAssignment: AssignmentRow | null;
  practiceQuest: QuestRow | null;
  flashcardDeck: DeckWithStats | null;
  focus: string;
}): WeeklyMissionItemInsert[] {
  return [
    {
      mission_id: missionId,
      type: "main_work",
      title: mainAssignment?.title ?? `${focus} งานหลักในคาบ`,
      description:
        mainAssignment?.description ??
        "งานหลักที่ครูตรวจเอง ใช้เก็บ participation XP ก่อนและ quality XP หลังตรวจ",
      xp_max: mainAssignment?.xp_reward ?? 90,
      required: true,
      sort_order: 1,
      source_table: mainAssignment ? "assignments" : null,
      source_id: mainAssignment?.id ?? null,
    },
    {
      mission_id: missionId,
      type: "ai_quest",
      title: practiceQuest?.title ?? "Practice Quest จาก AI",
      description:
        practiceQuest?.topic ??
        "โจทย์ฝึกทักษะที่ AI ตรวจแบบให้คะแนนตามสัดส่วนความถูกต้องและความพยายาม",
      xp_max: practiceQuest?.max_xp_reward ?? 80,
      required: true,
      sort_order: 2,
      source_table: practiceQuest ? "daily_quests" : null,
      source_id: practiceQuest?.id ?? null,
    },
    {
      mission_id: missionId,
      type: "flashcard",
      title: flashcardDeck?.title ?? "Flashcard ก่อนเจอครูครั้งหน้า",
      description:
        flashcardDeck?.description ??
        "ทบทวนคำสำคัญก่อนคาบถัดไป ให้ XP จาก milestone เพื่อกันการกดซ้ำเพื่อ farm คะแนน",
      xp_max: 40,
      required: false,
      sort_order: 3,
      source_table: flashcardDeck ? "flashcard_decks" : null,
      source_id: flashcardDeck?.id ?? null,
    },
  ];
}

function describeCriteria(criteria: Json) {
  if (!criteria || typeof criteria !== "object" || Array.isArray(criteria)) {
    return tr("ดูรายละเอียดกติกาจากครู");
  }
  const entries = Object.entries(criteria)
    .filter(([, value]) => value !== null && value !== undefined)
    .slice(0, 2)
    .map(([key, value]) => `${key}: ${String(value)}`);
  return entries.length > 0 ? entries.join(", ") : tr("ดูรายละเอียดกติกาจากครู");
}

function getSchemaAwareError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("weekly_missions") ||
    message.includes("weekly_mission_items") ||
    message.includes("weekly_mission_teams") ||
    message.includes("weekly_mission_team_members") ||
    message.includes("mission_progress") ||
    message.includes("weekly_mission_recaps") ||
    message.includes("term_bonus_rules") ||
    message.includes("schema cache")
  ) {
    return tr("ยังไม่ได้ apply migration weekly_mission_system ใน Supabase");
  }
  return message;
}

function clampPct(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function sortAssignments(assignments: AssignmentRow[]) {
  return [...assignments].sort((a, b) => {
    const aTime = new Date(a.due_date ?? a.created_at).getTime();
    const bTime = new Date(b.due_date ?? b.created_at).getTime();
    return aTime - bTime;
  });
}

function getMainProgress(
  assignment: AssignmentRow | null,
  submission: SubmissionRow | null | undefined,
  isStaff: boolean,
) {
  if (!assignment) return isStaff ? 20 : 0;
  if (!submission) return isStaff ? 70 : 15;
  if (typeof submission.score === "number") {
    return clampPct((submission.score / Math.max(1, assignment.max_score)) * 100);
  }
  return submission.submitted_at ? 65 : 15;
}

function getPracticeProgress(
  quest: QuestRow | null,
  attempt: QuestAttemptRow | null | undefined,
  profile?: ProfileRow | null,
) {
  if (attempt?.max_score) return clampPct((attempt.score / attempt.max_score) * 100);
  if (profile?.last_quest_date && isWithinDays(profile.last_quest_date, 7)) return 100;
  return quest ? 20 : 0;
}

function isWithinDays(value: string, days: number) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return false;
  return Date.now() - time <= days * 24 * 60 * 60 * 1000;
}

function getSessionFocus(classroom: ClassroomRow | null) {
  const haystack = `${classroom?.name ?? ""} ${classroom?.subject ?? ""} ${
    classroom?.grade_level ?? ""
  }`.toLowerCase();
  if (haystack.includes("canva") || haystack.includes("ม.3")) return "Canva design sprint";
  if (haystack.includes("ม.4") || haystack.includes("ออกแบบ") || haystack.includes("เทคโนโลยี")) {
    return "ออกแบบและเทคโนโลยี sprint";
  }
  return "ทักษะประจำสัปดาห์";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
  }).format(new Date(value));
}
