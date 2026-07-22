import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { tr } from "@/i18n";

/**
 * Inline editor for the current user's display_name.
 * Renders `children` as the visible name plus a pencil button; click to edit.
 */
export function DisplayNameEditor({
  currentName,
  className,
  headingClassName,
}: {
  currentName: string | null | undefined;
  className?: string;
  headingClassName?: string;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentName ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    const name = value.trim();
    if (!user) return;
    if (!name) {
      toast.error(tr("กรุณาใส่ชื่อ"));
      return;
    }
    if (name === (currentName ?? "")) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: name })
      .eq("id", user.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(tr("แก้ไขชื่อเรียบร้อย"));
    setEditing(false);
    qc.invalidateQueries();
  }

  if (editing) {
    return (
      <div className={`flex items-center gap-2 ${className ?? ""}`}>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") {
              setEditing(false);
              setValue(currentName ?? "");
            }
          }}
          maxLength={120}
          autoFocus
          className="h-11 w-64 text-2xl font-semibold"
          placeholder={tr("ชื่อของคุณ")}
        />
        <Button size="icon" onClick={save} disabled={saving} title={tr("บันทึก")}>
          <Check className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="outline"
          onClick={() => {
            setEditing(false);
            setValue(currentName ?? "");
          }}
          disabled={saving}
          title={tr("ยกเลิก")}
        >
          <X className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <span className={headingClassName}>{currentName || tr("ผู้ใช้")}</span>
      <Button
        size="icon"
        variant="ghost"
        className="size-8"
        onClick={() => {
          setValue(currentName ?? "");
          setEditing(true);
        }}
        title={tr("แก้ไขชื่อ")}
      >
        <Pencil className="size-4" />
      </Button>
    </span>
  );
}
