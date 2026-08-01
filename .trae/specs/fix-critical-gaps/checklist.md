# Checklist

- [x] `frontend/index.html` 仅含一套 HTML 文档，无重复的 `<!doctype>` 和 `<html>` 标签
- [x] `CourseDetailPage` 挂载时从 IndexedDB 恢复 `stepIdx`
- [x] `CourseDetailPage` 点击"下一步"后进度持久化到 IndexedDB
- [x] `CourseDetailPage` 点击"完成课程"后进度持久化到 IndexedDB
- [x] `ErrorBoundary.tsx` 组件已创建并包裹 `App.tsx` 根组件
- [x] `ErrorBoundary` 捕获异常后展示友好提示与"返回首页"按钮
- [x] 8 个后端死文件已删除
- [x] `router.py` 不再导入/注册 assessment 和 course 路由
- [x] `models/__init__.py` 不再导入死模型
- [x] `init_db.py` 不再调用 `seed_all`
- [x] 后端 grep `assessment.*router|course.*router|seed_all|seed_data|from app\.models\.(course|problem)` 均无匹配
