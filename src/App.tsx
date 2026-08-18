import { Toaster } from "sonner";
import { AinovrWorkbench } from "@/components/workbench/AinovrWorkbench";

/** 最终桌面入口：业务状态来自 SQLite Application Service，而非旧 JSON/Zustand 工作流。 */
export default function App() {
  return <>
    <AinovrWorkbench />
    <Toaster position="top-right" richColors closeButton />
  </>;
}
