// SPDX-License-Identifier: AGPL-3.0-only

"use client"; // 必须标记为客户端组件，才能访问浏览器API

import { useEffect } from "react";

export default function ContextMenuInterceptor() {
  useEffect(() => {
    // 右键菜单拦截处理函数
    const handleContextMenu = (e: MouseEvent) => {
      // 核心：阻止浏览器默认右键菜单
      e.preventDefault();
    };

    // 全局监听contextmenu事件（window上监听可捕获整个页面的事件）
    window.addEventListener("contextmenu", handleContextMenu);

    // 组件卸载时移除监听，避免内存泄漏和重复绑定
    return () => {
      window.removeEventListener("contextmenu", handleContextMenu);
    };
  }, []); // 空依赖：仅在组件挂载/卸载时执行一次

  // 无UI渲染，仅做事件监听
  return null;
}
