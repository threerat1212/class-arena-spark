import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, KeyRound } from "lucide-react";
import { tr } from "@/i18n";
import { rpcJoinExamByCode } from "@/lib/exam.functions";

export const Route = createFileRoute("/_authenticated/exam/join")({
  component: JoinExamPage,
});

function JoinExamPage() {
  const nav = useNavigate();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (code.trim().length < 6) {
      toast.error(tr("กรอกรหัส 6 หลัก"));
      return;
    }
    setLoading(true);
    try {
      const result = await rpcJoinExamByCode(code.trim().toUpperCase());
      nav({ to: "/exam/$examId", params: { examId: result.exam_id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tr("เข้าร่วมสอบไม่สำเร็จ"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[60vh] grid place-items-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="size-14 mx-auto rounded-xl bg-primary/15 grid place-items-center mb-2">
            <KeyRound className="size-7 text-primary" />
          </div>
          <CardTitle className="text-2xl">{tr("เข้าสอบ")}</CardTitle>
          <p className="text-sm text-muted-foreground">{tr("กรอกรหัส 6 หลักจากครู")}</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="exam-code">{tr("รหัสสอบ")}</Label>
              <Input
                id="exam-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={6}
                placeholder="ABC123"
                className="text-center text-2xl font-mono tracking-widest h-14"
                autoFocus
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={loading || code.length < 6}
            >
              {loading && <Loader2 className="size-4 mr-2 animate-spin" />}
              {tr("เข้าสอบ")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
