import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { PanelSkeleton, WeeklyGoalsHeaderSkeleton } from "@/components/shell/route-skeleton";

// Mirrors WeekCalendarView (components/calendar/week-calendar-view.tsx):
// WeeklyGoalsHeader, then the "Week" hour-grid Panel.
export default function CalendarLoading() {
  return (
    <PageContainer>
      <PageHeader title="This week" />
      <WeeklyGoalsHeaderSkeleton />
      <PanelSkeleton titleWidth="w-16" bodyHeight="h-[480px]" />
    </PageContainer>
  );
}
