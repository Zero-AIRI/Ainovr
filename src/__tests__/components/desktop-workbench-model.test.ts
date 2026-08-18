import { describe, expect, it } from "vitest";
import { calculateTextDiff, compareProviderProfileDraft, parseProviderRoutes, WORKBENCH_NAVIGATION, selectExistingProject } from "@/components/workbench/desktop-workbench-model";

describe("R6 桌面工作台模型", () => {
  it("一级导航固定为作品、参考、待处理和设置，不恢复画布或聊天入口", () => {
    expect(WORKBENCH_NAVIGATION.map((item) => item.id)).toEqual(["works", "references", "pending", "settings"]);
    expect(WORKBENCH_NAVIGATION.map((item) => item.label)).toEqual(["作品", "参考", "待处理", "设置"]);
  });

  it("外部 change feed 刷新后保留仍存在的选择，否则稳定回退到首个项目", () => {
    const projects = [{ projectId: "project_b" }, { projectId: "project_a" }];
    expect(selectExistingProject("project_b", projects)).toBe("project_b");
    expect(selectExistingProject("removed", projects)).toBe("project_b");
    expect(selectExistingProject("project_b", [])).toBe("");
  });

  it("版本比较按 Unicode 代码点定位最小改动区间，不把 CJK 文本拆成 UTF-16 半字符", () => {
    expect(calculateTextDiff("钟楼在退潮时倒走七分钟。", "钟楼在退潮时倒走八分钟。")).toEqual({
      unchanged: false,
      prefix: "钟楼在退潮时倒走",
      beforeChanged: "七",
      afterChanged: "八",
      suffix: "分钟。",
    });
    expect(calculateTextDiff("同一版本", "同一版本")).toEqual({
      unchanged: true,
      prefix: "同一版本",
      beforeChanged: "",
      afterChanged: "",
      suffix: "",
    });
  });

  it("将设置页的角色路由草稿解析为唯一的非空路由", () => {
    expect(parseProviderRoutes("writer = qwen3.5:9b\nreviewer=qwen3:8b")).toEqual([
      { role: "reviewer", model: "qwen3:8b" },
      { role: "writer", model: "qwen3.5:9b" },
    ]);
    expect(() => parseProviderRoutes("writer=a\nwriter=b")).toThrow(/重复/);
    expect(() => parseProviderRoutes("writer")).toThrow(/角色=模型/);
  });

  it("CAS 冲突时逐字段展示本地草稿与最新 Provider revision 的差异", () => {
    expect(compareProviderProfileDraft(
      { name: "本机 Ollama（草稿）", baseURL: "http://localhost:11434/v1", defaultModel: "qwen3:8b", routes: [{ role: "writer", model: "qwen3:8b" }] },
      { name: "本机 Ollama", baseURL: "http://localhost:11434/v1", defaultModel: "qwen3.5:9b", routes: [{ role: "reviewer", model: "qwen3:8b" }, { role: "writer", model: "qwen3.5:9b" }] },
    )).toEqual([
      { label: "显示名称", local: "本机 Ollama（草稿）", current: "本机 Ollama" },
      { label: "默认模型", local: "qwen3:8b", current: "qwen3.5:9b" },
      { label: "角色路由", local: "writer=qwen3:8b", current: "reviewer=qwen3:8b\nwriter=qwen3.5:9b" },
    ]);
  });
});
