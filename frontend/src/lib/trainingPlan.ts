/**
 * 规则化训练处方：由多局诊断聚合结果（DiagnosisStats）映射为
 * 可执行的训练建议（死活题难度/题量、定式复习、打谱、复盘重点）。
 *
 * 这是无 LLM 时的降级路径，也是 LLM 报告的基线素材；
 * 映射规则固定、可单测，不依赖外部服务。
 */
import type { DiagnosisType } from './diagnosis'
import type { DiagnosisStats } from './diagnosisStats'

/** 单项训练建议 */
export interface TrainingExercise {
  title: string
  detail: string
  /** 建议每日投入（分钟），可选 */
  dailyMinutes?: number
}

/** 训练处方 */
export interface TrainingPlan {
  topType: DiagnosisType
  /** 一句话诊断结论 */
  headline: string
  exercises: TrainingExercise[]
  resources: string[]
}

const TYPE_LABEL: Record<DiagnosisType, string> = {
  'life-death': '死活漏算',
  joseki: '定式与布局',
  direction: '选点与方向',
  endgame: '官子',
}

/** 常见资源（按类型附加） */
const RESOURCES: Record<DiagnosisType, string[]> = {
  'life-death': ['101 围棋网（101weiqi.com）死活题库', '《李昌镐精讲围棋死活》（1-6 卷，阶梯难度）'],
  joseki: ['本平台「定式」页（离线浏览星位/小目基本定式）', '弈客棋谱库：职业对局打谱，只看前 30 手'],
  direction: ['弈客棋谱库：职业对局打谱，体会大场与急所', 'B 站搜索"布局大场 入门"类教学视频'],
  endgame: ['现阶段优先级最低，暂不列专项资源（3 级后再练官子）'],
}

/** 各类型最高频时的处方 */
function planFor(top: DiagnosisType, userLevel: number): TrainingPlan {
  const low = Math.max(1, userLevel - 1)
  const high = userLevel + 1

  switch (top) {
    case 'life-death':
      return {
        topType: top,
        headline: `你的主要问题是「${TYPE_LABEL[top]}」——中盘战斗中棋子被吃是最大的胜率来源损失。`,
        exercises: [
          {
            title: '死活题专项',
            detail: `在 101 围棋网选择 ${low} 级 ~ ${high} 级难度区间的死活题，每天 12~15 题，约 20 分钟。要求每题先独立计算 3 分钟再对答案。`,
            dailyMinutes: 20,
          },
          {
            title: '复盘被吃棋局',
            detail: '每周挑 1 盘大龙被吃的对局，用 AI 分析找出"被打吃时没补"的转折手，理解漏算过程。',
          },
        ],
        resources: RESOURCES['life-death'],
      }
    case 'joseki':
      return {
        topType: top,
        headline: `你的主要问题是「${TYPE_LABEL[top]}」——前 ${30} 手的选择亏损最集中。`,
        exercises: [
          {
            title: '定式复习',
            detail: '在本平台「定式」页复习星位小飞挂角、小目一间低夹等最常遇到的 2~3 个定式分支，每天 10 分钟，目标：遇到时不再发怵。',
            dailyMinutes: 10,
          },
          {
            title: '布局打谱',
            detail: '每周打 3 盘职业棋谱，只看前 30 手，对照 AI 推荐点思考"为什么走大场而不走小棋"。',
          },
        ],
        resources: RESOURCES.joseki,
      }
    case 'direction':
      return {
        topType: top,
        headline: `你的主要问题是「${TYPE_LABEL[top]}」——没有明显被吃，但中盘选点持续让胜率下滑。`,
        exercises: [
          {
            title: '选点意识训练',
            detail: '每盘对局落子前先自问"这一步是最大的点吗？"，复盘时对比 AI 第一推荐点与你的落点，统计差距。',
          },
          {
            title: '布局概念学习',
            detail: '学习大场与急所的基本概念（B 站入门课程或入门书布局章节），每周 2 次，每次 20 分钟。',
            dailyMinutes: 20,
          },
        ],
        resources: RESOURCES.direction,
      }
    case 'endgame':
      return {
        topType: top,
        headline: `你的主要问题是「${TYPE_LABEL[top]}」——但以你目前水平，官子优先级最低，不必专项训练。`,
        exercises: [
          {
            title: '了解即可',
            detail: '注意终局前"先手官子"的概念（能先收到算先手的地方），不需要精算目数。',
          },
        ],
        resources: RESOURCES.endgame,
      }
  }
}

/**
 * 生成训练处方：取最高频错误类型映射建议；
 * 无问题手时返回通用保持型处方。
 */
export function buildTrainingPlan(stats: DiagnosisStats, userLevel: number): TrainingPlan {
  if (stats.topType == null || stats.totalIssues === 0) {
    return {
      topType: 'direction',
      headline: '最近对局没有检测到明显问题手——继续保持对局量与死活题训练。',
      exercises: [
        {
          title: '保持节奏',
          detail: '每天 1 盘对局 + 15 道死活题，两周后再跑一次诊断对比变化。',
          dailyMinutes: 40,
        },
      ],
      resources: ['101 围棋网', '本平台「研究」页复盘'],
    }
  }
  return planFor(stats.topType, userLevel)
}
