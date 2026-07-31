/**
 * IndexedDB 工具：对局记录与课程进度持久化。
 *
 * 数据库：learning-go
 * 表：
 *   games           — 对局记录（SGF + 元数据）
 *   courseProgress  — 课程学习进度
 */

const DB_NAME = 'learning-go'
const DB_VERSION = 1

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
  updatedAt: string
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
