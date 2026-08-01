# 修复关键缺陷 Spec

## Why
学习者在课程页面刷新后进度归零、页面崩溃无恢复机制、`index.html` 含合并冲突残留两套 HTML 文档、后端存在大量前端已不使用的死代码（评估/课程/题目 API、模型、种子数据），每次启动仍建无用表和写入无用数据。

## What Changes
- 修复 `index.html` 中重复的 HTML 文档块
- `CourseDetailPage.tsx` 接上已存在的 IndexedDB 进度持久化
- 新增 React Error Boundary 组件
- 清除后端死代码：评估/课程/题目相关 API、模型、服务、种子数据

## Impact
- Affected specs: 无（新增）
- Affected code: `frontend/index.html`, `frontend/src/pages/CourseDetailPage.tsx`, `frontend/src/main.tsx`, `backend/app/api/v1/router.py`, `backend/app/models/__init__.py`, `backend/app/core/init_db.py`

## ADDED Requirements

### Requirement: 修复 index.html 双重文档
`index.html` 中 SHALL 仅保留一套完整的 HTML 文档块（第 1–17 行），删除第 18–30 行的重复块。

#### Scenario: 清理后文件
- **WHEN** 开发者打开 `frontend/index.html`
- **THEN** 文件内容只含一个 `<!doctype html>` 声明

---

### Requirement: 课程进度持久化
`CourseDetailPage` SHALL 在组件挂载时从 IndexedDB 恢复 `stepIdx`，在用户点击"下一步"/"完成课程"时保存当前进度。使用 `db.ts` 中已实现的 `getCourseProgress` 和 `saveCourseProgress`。

#### Scenario: 首次学习一门课程
- **WHEN** 用户首次打开某课程
- **THEN** `stepIdx` 从第 0 步开始，进度正常递增

#### Scenario: 刷新页面后恢复进度
- **WHEN** 用户在第 3 步时刷新页面
- **THEN** 组件恢复后 `stepIdx` 仍为 3，`answered` 状态重置为 null

#### Scenario: 完成课程
- **WHEN** 用户点击"完成课程"
- **THEN** 保存 `lastStepIndex = flatSteps.length - 1`, `completedSteps = flatSteps.length`

---

### Requirement: Error Boundary
应用 SHALL 包含一个顶层 Error Boundary，捕获未处理异常后展示友好提示与"返回首页"按钮，替代默认白屏。

#### Scenario: 引擎初始化失败
- **WHEN** 引擎初始化或 Worker 加载抛出未捕获异常
- **THEN** 页面显示错误提示而非白屏，提供"返回首页"操作入口

---

### Requirement: 清除后端死代码
后端 SHALL 删除前端已不使用的评估、课程、题目相关代码。

#### 要删除的文件列表
**API 层**: `app/api/v1/assessment.py`, `app/api/v1/course.py`
**服务层**: `app/services/assessment.py`
**Schema 层**: `app/schemas/assessment.py`
**种子数据**: `app/core/seed_data.py`
**模型层**: `app/models/course.py`, `app/models/problem.py`
**测试**: `tests/test_assessment.py`（依赖已删除的 assessment 服务）

#### 要修改的文件
- `app/api/v1/router.py`: 移除 `assessment_router` 和 `course_router` 的导入与注册
- `app/models/__init__.py`: 移除 `Course`, `CourseProgress`, `Lesson`, `Step`, `Problem` 的导入
- `app/core/init_db.py`: 移除 `seed_all` 的导入与调用

#### Scenario: 后端启动
- **WHEN** 后端启动并执行数据库迁移/初始化
- **THEN** 不创建 `problems`, `courses`, `lessons`, `steps`, `course_progress` 表，`/api/v1/assessment` 和 `/api/v1/course` 端点不存在

## MODIFIED Requirements
无。

## REMOVED Requirements
无。
