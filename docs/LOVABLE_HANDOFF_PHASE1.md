# งานต่อจากนี้: Gamification Phase 1 — Deployment & Smoke Test

## Context
มีนักพัฒนา (AI agent ตัวก่อน) push Phase 1 "Engagement Engine" ของระบบ gamification มาแล้วบน branch main (commit ล่าสุด `918a635`, tag `gamification-phase-1`). โค้ดทั้งหมด build/typecheck ผ่านแล้ว แต่ยัง **ไม่ได้ deploy จริงบน Supabase** — ต้องทำขั้นต่อไปนี้

## อ่านก่อน
- `docs/superpowers/specs/2026-07-20-gamification-engagement-engine-design.md` — design เต็ม
- `docs/superpowers/plans/2026-07-20-gamification-engagement-engine.md` — plan 19 tasks พร้อม smoke-test checklist (Task 19 Step 6)

## ฟีเจอร์ที่เพิ่มใน Phase 1
- **Combo system** — ตอบถูกติดต่อกัน → multiplier 1.0× → 2.0× (cap), หักเมื่อผิด/วาง 30 นาที/ขึ้นวันใหม่
- **Perfect bonus** — คะแนนเต็ม → +50% XP (cap +100) เป็น transaction แยก
- **Multiplier events** — "ชั่วโมงพิเศษ!" double-XP ที่ admin สร้างหรือ auto-spawn
- **Lucky drops** — 8%+ chance หลัง action สำเร็จ: gold/XP/cosmetic voucher/rare title
- ทั้งหมดวิ่งผ่าน `award_xp()` RPC ที่มีอยู่แล้ว (single funnel)

## Task 1: Run migration บน Supabase
ไฟล์ migration: `supabase/migrations/20260720100000_engagement_engine.sql`

รัน:
```bash
supabase db push
```

ถ้ามี error เรื่อง `has_role` ไม่พบ — function นี้มีอยู่แล้วใน migration เก่า (`20260525144942_200fc4ca...sql`) ให้ตรวจก่อนว่า migration sequence ครบ

หลัง push แล้วตรวจ:
```sql
-- ต้องเห็น enum values ใหม่
SELECT enumlabel FROM pg_enum WHERE enumtypid = 'app_xp_source'::regtype;
-- expected: daily_quest, attendance, weekly_mission, daily_bonus, achievement,
--           shop_purchase, admin_adjustment, exam, lucky_drop, perfect_bonus,
--           submission, quiz

-- ต้องเห็นตารางใหม่
SELECT tablename FROM pg_tables WHERE schemaname='public'
  AND tablename IN ('combo_state','multiplier_events','lucky_drop_log');

-- ต้องเห็น function ใหม่
SELECT proname FROM pg_proc WHERE proname='combo_multiplier';
SELECT proname FROM pg_proc WHERE proname='award_xp'; -- ควรมี return type ใหม่
```

## Task 2: Deploy edge function
ไฟล์: `supabase/functions/spawn-weekly-multiplier/index.ts`

```bash
supabase functions deploy spawn-weekly-multiplier
```

ทดสอบ manual:
```bash
curl -X POST https://fkjazvlqfgycoauemopz.functions.supabase.co/spawn-weekly-multiplier \
  -H "Authorization: Bearer <anon-key>" \
  -H "Content-Type: application/json" \
  -d '{}'
```
Expected response: `{"spawned":true,"events":[...]}` หรือ `{"skipped":"event already scheduled"}`

## Task 3: Schedule cron weekly
Lovable ไม่สามารถรัน `pg_cron` extension ได้ตรง ๆ ถ้าไม่ได้ enable — ให้ชี้แจงให้ผู้ใช้ทำ manual ผ่าน Dashboard:

**Dashboard → Database → Query Tool** รัน:
```sql
-- ต้องมี pg_cron + pg_net extension ก่อน
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'spawn-multiplier-weekly',
  '0 6 * * 1',   -- Monday 06:00 UTC = 13:00 Bangkok
  $$SELECT net.http_post(
    url := 'https://fkjazvlqfgycoauemopz.functions.supabase.co/spawn-weekly-multiplier',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := '{}'::jsonb
  )$$
);
```

ถ้า plan ไม่มี pg_net ให้ใช้ Supabase Dashboard → Functions → Triggers สร้าง scheduled function แทน

## Task 4: Smoke test (ตาม plan Task 19 Step 6)
ทำตาม checklist นี้ทีละขั้น และรายงานผล:

1. **Daily quest perfect score** → ดู BonusBreakdown แสดง combo + perfect + อาจมี lucky
2. **Daily quest ตอบผิด** → combo reset เป็น 0
3. **Teacher ตรวจ assignment** (trigger `award_submission_grade`) → XP เพิ่ม + combo +1
4. **Attendance check-in** → XP เพิ่ม + combo +1
5. **Quiz finish** → top 3 ได้ XP พร้อม outcome
6. **รอ 31+ นาที แล้วทำ quest ใหม่** → combo reset เป็น 1
7. **Admin สร้าง multiplier event คลุม "now"** → action ถัดไป ×2 + banner ขึ้นบน dashboard
8. **ปิด banner** → ไม่ขึ้นอีกหลัง refresh
9. **ตรวจ ledger integrity** — สำคัญที่สุด:
```sql
SELECT p.id, p.xp, SUM(t.amount) AS ledger_sum
FROM profiles p
JOIN xp_transactions t ON t.user_id = p.id
GROUP BY p.id, p.xp
HAVING p.xp <> SUM(t.amount);
```
Expected: **zero rows** (ถ้ามี rows หมายความว่า `award_xp()` มี bug ต้องแก้)

## Task 5 (ตัวเลือก): แก้ pre-existing bug ของ Lovable
ไฟล์ `src/routes/_authenticated/exam.$examId.edit.tsx:198` อ้าง path `/exam/` ที่ผิด — ควรเป็น `/exam` หรือ `/exam/$examId` ตาม context. (error นี้มาจาก commit `f14e37a` ของ Lovable ก่อน Phase 1)

## เสร็จแล้วรายงาน
- migration ผ่าน/มี error อะไร
- smoke test 9 ข้อผ่านกี่ข้อ ตกข้อไหน
- ledger integrity query คืนกี่แถว
- ถ้ามี bug ใน code Phase 1 ให้ระบุไฟล์:บรรทัด แล้วจะแก้ใน commit ถัดไป

อย่าเริ่ม Phase 2 (Mastery Loop) จนกว่า Phase 1 deploy ผ่าน + smoke test ผ่านครบ
