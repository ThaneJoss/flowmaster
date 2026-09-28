import type { Metadata } from "next";
import "./globals.css";
import "./webapps-theme.css";
export const metadata: Metadata = { title: "FlowMaster · 智能研究编排平台", description: "从研究假设到实验结论，在一个工作区编排、验证和复现。", icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" } };
export default function RootLayout({ children }: {
    children: React.ReactNode;
}) { return <html lang="zh-CN"><body>{children}</body></html>; }
