"""自定义 uvicorn 事件循环工厂。

uvicorn 在 --reload 模式下会把 Windows 事件循环切成 SelectorEventLoop
（uvicorn/loops/asyncio.py：win32 且 use_subprocess=True 时返回 Selector），
而 SelectorEventLoop 在 Windows 上不支持 asyncio.subprocess，
导致 KataGo 引擎（Analysis/GTP 均基于子进程）启动失败：
asyncio.base_events._make_subprocess_transport -> NotImplementedError。

这里强制使用 ProactorEventLoop（Windows 下唯一支持子进程的循环），
使 --reload 热重载与 KataGo 子进程可以共存。
"""
import asyncio


def proactor_loop_factory(
    use_subprocess: bool = False,
) -> asyncio.ProactorEventLoop:
    """返回 ProactorEventLoop 实例，忽略 uvicorn 传入的 use_subprocess 参数。

    uvicorn 对自定义 --loop 的契约是 `() -> AbstractEventLoop`，
    因此这里直接返回实例。
    """
    return asyncio.ProactorEventLoop()
