/**
 * GTP 坐标转换（KataGo 分析协议 ⇄ 内部 [x, y] 坐标）。
 *
 * 与后端 app/services/katago_analysis.py 的 vertex_to_gtp / gtp_to_vertex 对应，
 * 双端测试共享 shared/coordinate-cases.json 同一输入矩阵（禁止各自复制）。
 * 注：GTP 列字母统一跳过 I（与棋盘尺寸无关），行号从底部起。
 */

/** 内部 [x, y]（y=0 在顶部）→ GTP 坐标，如 [15, 3] → 'Q16'。 */
export function vertexToGtp(
  vertex: [number, number],
  boardSize: number,
): string {
  const [x, y] = vertex
  const col = x >= 8 ? x + 1 : x // 跳过 I
  const row = boardSize - y
  return `${String.fromCharCode(65 + col)}${row}`
}

/** GTP 坐标（如 "Q16"）→ 内部 [x, y]。pass/resign/空串返回 null。 */
export function gtpToVertex(
  coord: string,
  boardSize: number,
): [number, number] | null {
  if (!coord || coord === 'pass' || coord === 'resign') return null
  const colChar = coord.charCodeAt(0)
  let x = colChar - 65 // 'A' = 0
  if (colChar > 73) x-- // 跳过 'I'
  const y = boardSize - parseInt(coord.slice(1), 10)
  return [x, y]
}
