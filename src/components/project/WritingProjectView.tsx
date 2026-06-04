// ============================================
// 写作项目视图 — 创建/配置项目
// ============================================

'use client';

import { useState, useCallback, useEffect } from 'react';
import { Plus, Trash2, FolderOpen } from 'lucide-react';
import { toast } from 'sonner';
import { useSourceLibraryStore } from '@/lib/store/source-library';
import { useProjectStore } from '@/lib/store/project';
import { SourceRoleSelector } from './SourceRoleSelector';
import type { SourceRole, WritingProject } from '@/types';
import { nanoid } from 'nanoid';

export function WritingProjectView() {
  const { sourceNovels } = useSourceLibraryStore();
  const { projects, loadProjects, addProject, removeProject, setActiveProjectId, setActiveView } = useProjectStore();

  const [title, setTitle] = useState('');
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [roles, setRoles] = useState<Record<string, SourceRole['role']>>({});

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // 可选的源小说（已就绪的）
  const readyNovels = sourceNovels.filter((n) => n.status === 'ready');

  const toggleSource = useCallback((id: string) => {
    setSelectedSourceIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((s) => s !== id);
      }
      return [...prev, id];
    });
  }, []);

  const handleCreate = useCallback(async () => {
    if (!title.trim()) {
      toast.error('请输入项目名称');
      return;
    }
    if (selectedSourceIds.length === 0) {
      toast.error('请至少选择一本源小说');
      return;
    }

    const id = nanoid();
    const sourceRoles: SourceRole[] = selectedSourceIds.map((sid) => ({
      sourceNovelId: sid,
      role: roles[sid] ?? 'style_and_plot',
    }));

    const res = await fetch('/api/project/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, title: title.trim(), sourceNovelIds: selectedSourceIds, sourceRoles }),
    });

    if (res.ok) {
      const { project } = await res.json();
      addProject(project);
      setTitle('');
      setSelectedSourceIds([]);
      setRoles({});
      toast.success(`项目「${title.trim()}」已创建`);
    } else {
      toast.error('创建项目失败');
    }
  }, [title, selectedSourceIds, roles, addProject]);

  const handleOpenProject = useCallback((project: WritingProject) => {
    setActiveProjectId(project.id);
    setActiveView('layer-generation');
  }, [setActiveProjectId, setActiveView]);

  const handleDelete = useCallback(async (id: string) => {
    await fetch('/api/project/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    removeProject(id);
    toast.success('项目已删除');
  }, [removeProject]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-6">
      <h1 className="text-xl font-bold text-foreground mb-6">写作项目</h1>

      {/* 创建项目表单 */}
      <div className="mb-8 p-4 rounded-lg border border-border bg-card">
        <h2 className="text-sm font-medium text-foreground mb-3">新建项目</h2>

        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="项目名称"
          className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm mb-4"
        />

        {/* 源小说选择 */}
        {readyNovels.length === 0 ? (
          <p className="text-xs text-muted-foreground">暂无已处理的源小说，请先到素材库处理小说</p>
        ) : (
          <div className="space-y-2 mb-4">
            {readyNovels.map((novel) => (
              <div key={novel.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedSourceIds.includes(novel.id)}
                  onChange={() => toggleSource(novel.id)}
                  className="rounded"
                />
                {selectedSourceIds.includes(novel.id) && (
                  <SourceRoleSelector
                    sourceTitle={novel.title}
                    role={roles[novel.id] ?? 'style_and_plot'}
                    onChange={(r) => setRoles((prev) => ({ ...prev, [novel.id]: r }))}
                  />
                )}
                {!selectedSourceIds.includes(novel.id) && (
                  <span className="text-sm text-muted-foreground">《{novel.title}》</span>
                )}
              </div>
            ))}
          </div>
        )}

        <button
          onClick={handleCreate}
          disabled={!title.trim() || selectedSourceIds.length === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Plus className="w-4 h-4" />
          创建项目
        </button>
      </div>

      {/* 项目列表 */}
      <h2 className="text-sm font-medium text-foreground mb-3">已有项目</h2>
      <div className="flex-1 overflow-y-auto space-y-2">
        {projects.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">暂无项目</p>
        ) : (
          projects.map((project) => (
            <div
              key={project.id}
              className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-accent/50 transition-colors"
            >
              <FolderOpen className="w-4 h-4 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{project.title}</p>
                <p className="text-xs text-muted-foreground">
                  层级 {project.currentLayer}/5 · {project.chapters?.length ?? 0} 章
                </p>
              </div>
              <button
                onClick={() => handleOpenProject(project)}
                className="px-3 py-1 rounded text-xs bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                打开
              </button>
              <button
                onClick={() => handleDelete(project.id)}
                className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
