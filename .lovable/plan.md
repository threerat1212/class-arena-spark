
# Rewards Expansion — ระบบรางวัลครบทั้ง 3 กลุ่ม

ต่อยอดจาก Engagement Engine (Phase 1) ที่มี `award_xp`, `combo_state`, `multiplier_events`, `lucky_drop_log`, `shop_items`, `titles` อยู่แล้ว

## ขอบเขต

### กลุ่ม A — Cosmetic (โชว์อวด ไม่กระทบ balance)
- **Avatar Frames** — กรอบโปรไฟล์ 5 ระดับ (บรอนซ์/เงิน/ทอง/เพชร/ตำนาน)
- **Name Colors** — สีชื่อในกระดานผู้นำ 8 สี
- **Profile Banners** — แบนเนอร์หลังโปรไฟล์ 6 แบบ
- **Title Badges** — ต่อยอดตาราง `titles` ที่มีอยู่ เพิ่ม 10 ฉายาใหม่

### กลุ่ม B — Boosts (มีผลต่อ XP/Combo)
- **XP Potion (1h)** — คูณ XP ×1.5 ใช้ 60 นาที (สร้าง multiplier_event เฉพาะตัว)
- **Combo Shield** — กันการรีเซ็ตคอมโบ 1 ครั้งเมื่อทำผิด
- **Streak Freeze** — กันการหลุด daily streak 1 วัน

### กลุ่ม C — Utility (ช่วยตอนทำ quest/exam)
- **Hint Token** — เปิด hint 1 ข้อใน daily quest
- **Retry Token** — ทำ quest เดิมซ้ำเพื่อชิงคะแนนใหม่ (คะแนนสูงสุดชนะ)
- **Extra Time (+5m)** — ต่อเวลาข้อสอบ 5 นาที (ใช้ก่อนหมดเวลา)

## ช่องทางได้รางวัล (ทั้ง 3 ทาง)

1. **Shop** — ซื้อด้วย Gold (ตาราง `shop_items` มีอยู่แล้ว)
2. **Lucky Drop** — เพิ่ม kind ใหม่ใน `lucky_drop_log` (`xp_potion`, `combo_shield`, `streak_freeze`, `hint_token`, `retry_token`, `extra_time`, `avatar_frame`, `name_color`, `banner`)
3. **Level Unlock** — ตาราง `level_unlocks` map level → reward (auto grant ตอนขึ้นเลเวล)

## Technical Details

### Schema เพิ่ม
- `user_inventory` — เก็บของทุกอย่างที่ user ครอบครอง (frame, banner, boost, token). Columns: `user_id`, `item_kind`, `item_code`, `quantity`, `metadata`, `acquired_at`, `consumed_at`
- `active_cosmetics` (view หรือคอลัมน์ใน `profiles`) — เพิ่ม `active_frame`, `active_banner`, `active_name_color` ใน `profiles`
- `level_unlocks` — `level`, `reward_kind`, `reward_code`, `reward_amount`
- `boost_effects` — track XP potion/combo shield ที่ active อยู่: `user_id`, `effect_kind`, `expires_at`, `used_at`
- ขยาย `award_xp` ให้เช็ก:
  - Combo Shield active → ไม่ reset combo ตอน fail
  - XP Potion active → คูณเพิ่ม (stack กับ event/combo แบบ additive multiplier)
  - Streak Freeze → skip streak reset (บวกใน `claim_daily_bonus`)

### RPC ใหม่
- `use_boost(_kind)` — activate XP potion / combo shield / streak freeze
- `use_hint(_question_id)` — spend hint token, return hint text
- `use_retry(_quest_id)` — reset attempt
- `use_extra_time(_exam_id)` — extend `exam_participants.ends_at`
- `equip_cosmetic(_kind, _code)` — set active frame/banner/color
- `grant_level_rewards(_user_id, _new_level)` — เรียกจาก award_xp เมื่อ leveled_up

### UI
- **`/rewards`** (มีอยู่แล้ว) — เพิ่ม tab Shop / Inventory / Cosmetic Loadout
- **Profile card** — แสดง frame + banner + colored name
- **Leaderboard** — ใช้ active name color
- **Boost HUD** — แสดง active boost + countdown ที่มุมบน (component ใหม่ `ActiveBoostsBar`)
- **Exam page** — ปุ่ม "ใช้ Extra Time" ตอนเหลือ <5 นาที
- **Quest page** — ปุ่ม "ใช้ Hint" / "ใช้ Retry"
- **Admin** — สร้าง `/admin/rewards-catalog` จัดการ shop_items + level_unlocks

### Seed data (migration)
- 5 avatar frames + 8 name colors + 6 banners + 10 titles ใน `shop_items`
- 3 boosts + 3 utility tokens ใน `shop_items`
- 20 level unlocks (Lv 2, 3, 5, 7, 10, 15, 20, 25, 30, 40, 50 → mix ของ cosmetic + boost)
- Lucky drop weights ใน constant table

## ลำดับการ deploy

1. **Migration 1** — schema (`user_inventory`, `level_unlocks`, `boost_effects`, profile columns)
2. **Migration 2** — RPCs ใหม่ + ขยาย `award_xp` + trigger grant_level_rewards
3. **Migration 3** — seed shop items + level unlocks
4. **UI** — Rewards page tabs, ActiveBoostsBar, cosmetic display บน profile/leaderboard
5. **UI** — Hint/Retry/Extra Time buttons ใน quest & exam pages
6. **Admin catalog** — จัดการรางวัล

## Out of scope (ทำเฟสถัดไป)
- Physical rewards, class team rewards, pet/companion, exchange system, seasonal titles

---
ยืนยันแผน → ลุยเลยครับ (ประมาณ 3 migration + 8-10 ไฟล์ UI)
