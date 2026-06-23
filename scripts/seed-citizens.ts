/**
 * Seed clubVERSE citizenship data.
 * 35 citizens as of 2026-05-07.
 * Usage: node --import tsx scripts/seed-citizens.ts
 */
import 'dotenv/config'
import { createClient } from '@libsql/client'

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
})

type CitizenshipType = 'honorary' | 'general' | 'associate'

interface SeedCitizen {
  verse_id: string
  vrchat_display_name: string
  discord_id: string
  citizenship_type: CitizenshipType
  granted_date: string  // YYYY-MM-DD
}

// Source: ユーザー提供の clubVERSE 市民権リスト（2026-05-07 時点）
const CITIZENS: SeedCitizen[] = [
  // 🎖️ 名誉市民 (Honorary Citizen) — 8名
  { verse_id: '25-A-0001', vrchat_display_name: '3rd910',           discord_id: '@3rd910',         citizenship_type: 'honorary', granted_date: '2025-12-17' },
  { verse_id: '25-A-0002', vrchat_display_name: 'アネバネ',          discord_id: '@AneBne',         citizenship_type: 'honorary', granted_date: '2025-12-17' },
  { verse_id: '25-A-0003', vrchat_display_name: 'うさのぎ',          discord_id: '@うさのぎ',        citizenship_type: 'honorary', granted_date: '2025-12-18' },
  { verse_id: '25-A-0012', vrchat_display_name: 'ディッセン',         discord_id: '@ディッセン',      citizenship_type: 'honorary', granted_date: '2025-12-19' },
  { verse_id: '25-A-0015', vrchat_display_name: 'Nori_Usa',         discord_id: '@Nori_Usa',       citizenship_type: 'honorary', granted_date: '2025-12-19' },
  { verse_id: '25-A-0018', vrchat_display_name: 'Ryo-01',           discord_id: '@Ryo-1',          citizenship_type: 'honorary', granted_date: '2025-12-19' },
  { verse_id: '25-A-0026', vrchat_display_name: 'マーマイとうふ',     discord_id: '@マーマイとうふ',  citizenship_type: 'honorary', granted_date: '2026-02-12' },
  { verse_id: '25-A-0029', vrchat_display_name: 'Nseエヌセ',         discord_id: '@Nseエヌセ',      citizenship_type: 'honorary', granted_date: '2026-04-11' },

  // 👤 一般市民 (General Citizen) — 22名
  { verse_id: '25-B-0004', vrchat_display_name: 'ninf00',                discord_id: '@darkelf00',                citizenship_type: 'general', granted_date: '2025-12-18' },
  { verse_id: '25-B-0005', vrchat_display_name: 'pepopo',                discord_id: '@ぺぽぽ',                    citizenship_type: 'general', granted_date: '2025-12-18' },
  { verse_id: '25-B-0006', vrchat_display_name: 'フラクタ（Furakuta）',   discord_id: '@フラクタ',                  citizenship_type: 'general', granted_date: '2025-12-18' },
  { verse_id: '25-B-0007', vrchat_display_name: 'ヴぇるはると',           discord_id: '@velhart7',                 citizenship_type: 'general', granted_date: '2025-12-18' },
  { verse_id: '25-B-0008', vrchat_display_name: 'm4tcha_no_kona',        discord_id: '@抹茶。',                    citizenship_type: 'general', granted_date: '2025-12-18' },
  { verse_id: '25-B-0009', vrchat_display_name: 'takaたか',              discord_id: '@TAKA',                     citizenship_type: 'general', granted_date: '2025-12-18' },
  { verse_id: '25-B-0010', vrchat_display_name: 'なめこ_nameko',         discord_id: '@なめこ',                    citizenship_type: 'general', granted_date: '2025-12-18' },
  { verse_id: '25-B-0011', vrchat_display_name: 'デューイ',              discord_id: '@duey',                     citizenship_type: 'general', granted_date: '2025-12-18' },
  { verse_id: '25-B-0013', vrchat_display_name: 'AKT・エイト',           discord_id: '@AKT・エイト',               citizenship_type: 'general', granted_date: '2025-12-19' },
  { verse_id: '25-B-0014', vrchat_display_name: 'Rikku-chan',            discord_id: '@Rikkuchanリックちゃん',     citizenship_type: 'general', granted_date: '2025-12-19' },
  { verse_id: '25-B-0016', vrchat_display_name: 'kokonattu',             discord_id: '@kokonattu',                citizenship_type: 'general', granted_date: '2025-12-19' },
  { verse_id: '25-B-0017', vrchat_display_name: 'ともちtm',              discord_id: '@ともち',                    citizenship_type: 'general', granted_date: '2025-12-19' },
  { verse_id: '25-B-0019', vrchat_display_name: 'IWieldKeys',            discord_id: '@IWieldKeys',               citizenship_type: 'general', granted_date: '2025-12-24' },
  { verse_id: '25-B-0020', vrchat_display_name: 'ルイ・ボス・チャ',      discord_id: '@ルイ・ボス・チャ',          citizenship_type: 'general', granted_date: '2025-12-25' },
  { verse_id: '25-B-0021', vrchat_display_name: 'スレイ|Sray_AI',        discord_id: '@スレイ｜Sray_AI',           citizenship_type: 'general', granted_date: '2026-01-16' },
  { verse_id: '25-B-0022', vrchat_display_name: 'ガラック-ErimGarak',    discord_id: '@ガラック-ErimGarak',        citizenship_type: 'general', granted_date: '2026-01-16' },
  { verse_id: '25-B-0023', vrchat_display_name: '黒猫（KURONEKO）',      discord_id: '@黒猫（KURONEKO）',          citizenship_type: 'general', granted_date: '2026-01-16' },
  { verse_id: '25-B-0024', vrchat_display_name: 'ぎんまくら',            discord_id: '@銀杏まくら（ぎんまくら）',  citizenship_type: 'general', granted_date: '2026-01-16' },
  { verse_id: '25-B-0025', vrchat_display_name: '花見月VRC',             discord_id: '@花見月',                    citizenship_type: 'general', granted_date: '2026-01-23' },
  { verse_id: '25-B-0027', vrchat_display_name: 'AkimotoTeppei',         discord_id: '@秋本',                      citizenship_type: 'general', granted_date: '2026-02-14' },
  { verse_id: '25-B-0028', vrchat_display_name: 'えふもち｜fmochi',      discord_id: '@えふもち',                  citizenship_type: 'general', granted_date: '2026-03-20' },
  { verse_id: '25-B-0034', vrchat_display_name: 'みそ汁700円',           discord_id: '@みそ汁700円',               citizenship_type: 'general', granted_date: '2026-05-07' },

  // 🔰 準市民 (Associate Citizen) — 5名
  { verse_id: '25-C-0030', vrchat_display_name: '栗鼠野デール',          discord_id: '@栗鼠野 デール',             citizenship_type: 'associate', granted_date: '2026-04-16' },
  { verse_id: '25-C-0031', vrchat_display_name: '鯖さん_sabasan',        discord_id: '@鯖さん',                    citizenship_type: 'associate', granted_date: '2026-04-16' },
  { verse_id: '25-C-0032', vrchat_display_name: 'ムートン（負け犬）',    discord_id: '@ムートン@負け犬⚠🎹',      citizenship_type: 'associate', granted_date: '2026-04-16' },
  { verse_id: '25-C-0033', vrchat_display_name: 'りんしあ',              discord_id: '@りんしあ',                  citizenship_type: 'associate', granted_date: '2026-04-24' },
  { verse_id: '25-C-0035', vrchat_display_name: 'いそかぜ',              discord_id: '@いそかぜ',                  citizenship_type: 'associate', granted_date: '2026-05-07' },
]

async function seed() {
  const summary = {
    honorary: CITIZENS.filter(c => c.citizenship_type === 'honorary').length,
    general: CITIZENS.filter(c => c.citizenship_type === 'general').length,
    associate: CITIZENS.filter(c => c.citizenship_type === 'associate').length,
  }
  console.log(`\n🎖️  clubVERSE 市民権データを投入します`)
  console.log(`   名誉: ${summary.honorary}名 / 一般: ${summary.general}名 / 準: ${summary.associate}名 (計 ${CITIZENS.length}名)\n`)

  // citizens テーブルが既に存在することを期待（schema.tsで作成される）
  // ローカルから直接走らせる場合は、サーバーが一度立ち上がっていないとテーブルが無い可能性があるので念のため作成
  await client.execute(`
    CREATE TABLE IF NOT EXISTS citizens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      verse_id TEXT NOT NULL UNIQUE,
      vrchat_display_name TEXT NOT NULL,
      discord_id TEXT,
      citizenship_type TEXT NOT NULL CHECK(citizenship_type IN ('honorary','general','associate')),
      granted_date TEXT NOT NULL,
      brand TEXT NOT NULL DEFAULT 'clubVERSE',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `)

  let inserted = 0
  let updated = 0

  for (const c of CITIZENS) {
    // UPSERT: verse_id をキーに既存があれば内容を更新（VRC名/Discord等を後から修正できるよう）
    const existing = await client.execute({
      sql: `SELECT id FROM citizens WHERE verse_id = ?`,
      args: [c.verse_id],
    })
    if (existing.rows.length > 0) {
      await client.execute({
        sql: `UPDATE citizens
              SET vrchat_display_name = ?, discord_id = ?, citizenship_type = ?, granted_date = ?, brand = 'clubVERSE'
              WHERE verse_id = ?`,
        args: [c.vrchat_display_name, c.discord_id, c.citizenship_type, c.granted_date, c.verse_id],
      })
      updated++
    } else {
      await client.execute({
        sql: `INSERT INTO citizens (verse_id, vrchat_display_name, discord_id, citizenship_type, granted_date, brand)
              VALUES (?, ?, ?, ?, ?, 'clubVERSE')`,
        args: [c.verse_id, c.vrchat_display_name, c.discord_id, c.citizenship_type, c.granted_date],
      })
      inserted++
    }
  }

  console.log(`✓ 投入完了: 新規 ${inserted}件 / 更新 ${updated}件`)

  // 投入確認
  const result = await client.execute(`SELECT citizenship_type, COUNT(*) as cnt FROM citizens WHERE brand = 'clubVERSE' GROUP BY citizenship_type`)
  console.log(`\n📊 DB内のclubVERSE市民数:`)
  for (const row of result.rows) {
    console.log(`   ${row.citizenship_type}: ${row.cnt}名`)
  }
}

seed().catch(err => {
  console.error('❌ エラー:', err)
  process.exit(1)
})
