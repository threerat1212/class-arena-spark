import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/exam/$examId")({
  component: ExamLayout,
});

function ExamLayout() {
  return <Outlet />;
}