/**
 * IndexedDB 工具：对局记录、课程进度与棋局诊断结果持久化。
 *
 * 数据库：learning-go
 * 表：
 *   games           — 对局记录（SGF + 元数据）
 *   courseProgress  — 课程学习进度
 *   diagnostics     — 棋局诊断结果（按 gameId 唯一，v2 新增）
 */

const DB_NAME = 'learning-go'
const DB_VERSION = 2

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('games')) {
        db.createObjectStore('games', { keyPath: 'id', autoIncrement: true })
      }
      if (!db.objectStoreNames.contains('courseProgress')) {
        db.createObjectStore('courseProgress', { keyPath: 'courseId' })
      }
      if (!db.objectStoreNames.contains('diagnostics')) {
        db.createObjectStore('diagnostics', { keyPath: 'gameId' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** 对局记录 */
export interface GameRecord {
  id?: number
  boardSize: number
  komi: number
  mode: string
  result: string
  sgf: string
  moves: { n: number; color: number; vertex: [number, number] | null; pass: boolean }[]
  createdAt: string
}

/** 保存一局对局 */
export async function saveGame(record: Omit<GameRecord, 'id'>): Promise<number> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('games', 'readwrite')
    const store = tx.objectStore('games')
    const req = store.add({ ...record, createdAt: new Date().toISOString() })
    req.onsuccess = () => resolve(req.result as number)
    req.onerror = () => reject(req.error)
  })
}

/** 获取所有对局列表（按时间倒序，最近 50 局） */
export async function listGames(limit = 50): Promise<GameRecord[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('games', 'readonly')
    const store = tx.objectStore('games')
    const req = store.getAll()
    req.onsuccess = () => {
      const all = (req.result as GameRecord[]).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      resolve(all.slice(0, limit))
    }
    req.onerror = () => reject(req.error)
  })
}

/** 按 id 获取单局对局记录 */
export async function getGameById(id: number): Promise<GameRecord | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('games', 'readonly')
    const store = tx.objectStore('games')
    const req = store.get(id)
    req.onsuccess = () => resolve((req.result as GameRecord) ?? null)
    req.onerror = () => reject(req.error)
  })
}

/** 删除一局对局 */
export async function deleteGame(id: number): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('games', 'readwrite')
    const store = tx.objectStore('games')
    const req = store.delete(id)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

/** 课程进度 */
export interface CourseProgress {
  courseId: number
  completedSteps: number
  totalSteps: number
  lastStepIndex: number
  /** 各题星级（stepId -> 1~3 星：3=一次答对、2=重试后答对、1=看过答案） */
  stars?: Record<number, number>
  /** saveCourseProgress 自动填充，调用方可省略 */
  updatedAt?: string
}

/** 保存课程进度 */
export async function saveCourseProgress(p: CourseProgress): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('courseProgress', 'readwrite')
    const store = tx.objectStore('courseProgress')
    const req = store.put({ ...p, updatedAt: new Date().toISOString() })
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

/** 获取课程进度 */
export async function getCourseProgress(courseId: number): Promise<CourseProgress | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('courseProgress', 'readonly')
    const store = tx.objectStore('courseProgress')
    const req = store.get(courseId)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
}

/** 获取所有课程进度（列表页展示闯关进度用） */
export async function listCourseProgress(): Promise<CourseProgress[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('courseProgress', 'readonly')
    const store = tx.objectStore('courseProgress')
    const req = store.getAll()
    req.onsuccess = () => resolve(req.result as CourseProgress[])
    req.onerror = () => reject(req.error)
  })
}

/* ===== 棋局诊断（v2） ===== */

/** 保存单局诊断结果（按 gameId 覆盖更新） */
export async function saveDiagnosis(diag: import('./diagnosis').GameDiagnosis): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('diagnostics', 'readwrite')
    const store = tx.objectStore('diagnostics')
    const req = store.put(diag)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

/** 获取某局诊断结果；未诊断过返回 null */
export async function getDiagnosis(gameId: number): Promise<import('./diagnosis').GameDiagnosis | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('diagnostics', 'readonly')
    const store = tx.objectStore('diagnostics')
    const req = store.get(gameId)
    req.onsuccess = () => resolve((req.result as import('./diagnosis').GameDiagnosis) ?? null)
    req.onerror = () => reject(req.error)
  })
}

/** 批量获取诊断结果（按时间倒序，最近 limit 条） */
export async function listDiagnoses(limit = 50): Promise<import('./diagnosis').GameDiagnosis[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('diagnostics', 'readonly')
    const store = tx.objectStore('diagnostics')
    const req = store.getAll()
    req.onsuccess = () => {
      const all = (req.result as import('./diagnosis').GameDiagnosis[]).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      resolve(all.slice(0, limit))
    }
    req.onerror = () => reject(req.error)
  })
}

/** 删除某局诊断结果 */
export async function deleteDiagnosis(gameId: number): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('diagnostics', 'readwrite')
    const store = tx.objectStore('diagnostics')
    const req = store.delete(gameId)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}
