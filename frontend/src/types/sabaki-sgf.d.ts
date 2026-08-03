/**
 * @sabaki/sgf 类型声明（npm 包未附带 .d.ts）。
 * 仅声明本项目使用的 API 子集。
 */
declare module '@sabaki/sgf' {
  export interface SgfNode {
    id: number
    /** SGF 属性：属性名 -> 值数组（值已 unescape） */
    data: Record<string, string[]>
    parentId: number | null
    children: SgfNode[]
  }

  /** 解析 SGF 文本，返回根节点数组（每个根节点是一棵对局树） */
  export function parse(
    contents: string,
    options?: { getId?: () => number },
  ): SgfNode[]

  /** 序列化节点树为 SGF 文本 */
  export function stringify(
    nodes: SgfNode[] | SgfNode,
    options?: { linebreak?: string; indent?: string },
  ): string

  /** SGF 坐标（如 'dd'）-> 顶点 [x, y]；非法输入返回 [-1, -1] */
  export function parseVertex(input: string): [number, number]

  /** 顶点 -> SGF 坐标字符串；非法顶点返回 '' */
  export function stringifyVertex(vertex: [number, number]): string

  /** 展开压缩坐标列表（如 'aa:cc'）为顶点数组 */
  export function parseCompressedVertices(input: string): [number, number][]

  /** 转义 SGF 文本值中的 \ 与 ] */
  export function escapeString(input: string): string

  /** 反转义 SGF 文本值 */
  export function unescapeString(input: string): string
}
