# Tasks

- [x] Task 1: 修复 `index.html` 双重文档
  - 删除第 18–30 行的重复 HTML 块 ✓
  - 验证文件只有一个 `<!doctype html>` 声明 ✓
- [x] Task 2: 课程进度持久化
  - 组件挂载时调用 `getCourseProgress(courseId)` 恢复 `stepIdx` ✓
  - 点击"下一步"/"完成课程"时调用 `saveCourseProgress()` 保存当前进度 ✓
  - 刷新页面后进度保持不变 ✓
- [x] Task 3: 新增 Error Boundary 组件
  - 创建 `src/components/ErrorBoundary.tsx` ✓
  - 在 `App.tsx` 中包裹根组件 ✓
  - 错误时展示友好提示与"返回首页"链接 ✓
- [x] Task 4: 清除后端死代码
  - 删除 8 个死文件（API/服务/Schema/种子数据/模型/测试） ✓
  - 修改 `router.py` 移除 assessment 和 course 路由注册 ✓
  - 修改 `models/__init__.py` 移除死模型导入 ✓
  - 修改 `init_db.py` 移除 `seed_all` 调用 ✓

# Task Dependencies
- Task 1、3 无依赖，可并行
- Task 2 无依赖，可并行
- Task 4 无依赖，可并行
- 四个任务互不依赖，全部可并行执行
