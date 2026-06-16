import { Router, Request, Response } from 'express'
import {
  getBrandList,
  updateBrandMeta,
  renameBrand,
  deleteBrandMaster,
} from '../db/queries.js'

const router = Router()

function ok<T>(res: Response, data: T, status = 200) {
  res.status(status).json({ success: true, data, timestamp: new Date().toISOString() })
}
function fail(res: Response, message: string, status = 500) {
  res.status(status).json({ success: false, error: message, timestamp: new Date().toISOString() })
}

// GET /api/brands — ブランドマスタ一覧（色・市民権対象・イベント数・最終開催日つき）
router.get('/', async (_req: Request, res: Response) => {
  try {
    ok(res, await getBrandList())
  } catch (err: any) { fail(res, err.message) }
})

// PATCH /api/brands/:name — メタ更新（color / citizenship_target / sort_order）
router.patch('/:name', async (req: Request, res: Response) => {
  const name = decodeURIComponent(req.params.name)
  const { color, citizenship_target, sort_order } = req.body ?? {}
  const patch: { color?: string | null; citizenship_target?: boolean; sort_order?: number } = {}
  if (color !== undefined) patch.color = typeof color === 'string' && color.trim() ? color.trim() : null
  if (citizenship_target !== undefined) patch.citizenship_target = !!citizenship_target
  if (sort_order !== undefined) patch.sort_order = Number(sort_order) || 0
  try {
    await updateBrandMeta(name, patch)
    ok(res, { name, ...patch })
  } catch (err: any) { fail(res, err.message) }
})

// POST /api/brands/:name/rename — 改名（全イベントへ自動反映）
router.post('/:name/rename', async (req: Request, res: Response) => {
  const oldName = decodeURIComponent(req.params.name)
  const newName = typeof req.body?.newName === 'string' ? req.body.newName.trim() : ''
  if (!newName) return fail(res, 'newName が必要です', 400)
  try {
    await renameBrand(oldName, newName)
    ok(res, { oldName, newName })
  } catch (err: any) { fail(res, err.message) }
})

// DELETE /api/brands/:name — マスタ削除（該当イベントは未分類に戻す）
router.delete('/:name', async (req: Request, res: Response) => {
  const name = decodeURIComponent(req.params.name)
  try {
    await deleteBrandMaster(name)
    ok(res, { name })
  } catch (err: any) { fail(res, err.message) }
})

export default router
