// ============================================
// 写作项目视图 — 项目管理 + 内嵌层级规划/章节生成
// ============================================

'use client';

import { useState, useCallback, useEffect } from 'react';
import { Plus, Trash2, FolderOpen, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { useSourceLibraryStore } from '@/lib/store/source-library';
import { useProjectStore } from '@/lib/store/project';
import { SourceRoleSelector } from './SourceRoleSelector';
import { LayerGenerationView } from '@/components/generation/LayerGenerationView';
import { ChapterGenerationView } from '@/components/chapter/ChapterGenerationView';
import type { SourceRole, WritingProject } from '@/types';
import { nanoid } from 'nanoid';

export function WritingProjectView() {
  const { sourceNovels } = useSourceLibraryStore();
  const { projects, loadProjects, addProject, removeProject, activeProjectId, setActiveProjectId } = useProjectStore();

  const [title, setTitle] = useState('');
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [roles, setRoles] = useState<Record<string, SourceRole['role']>>({});
  const [activeTab, setActiveTab] = useState<'settings' | 'layers' | 'chapters'>('settings');

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const readyNovels = sourceNovels.filter((n) => n.status === 'ready');
  const activeProject = projects.find((p) => p.id === activeProjectId);

  // ── 项目已打开：内嵌标签页模式 ──

  if (activeProject) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 项目头部 */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
          <button
            onClick={() => setActiveProjectId(null)}
            className="p-1.5 rounded hover:bg-accent transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="text-xl font-bold text-foreground">{activeProject.title}</h1>
          <span className="text-xs text-muted-foreground">
            层级 {activeProject.currentLayer}/5 · {activeProject.chapters?.length ?? 0} 章
          </span>
        </div>

        {/* 标签页 */}
        <div className="flex gap-1 px-6 border-b border-border">
          <button
            onClick={() => setActiveTab('settings')}
            className={`px-4 py-2.5 text-sm font-medium transition-colors relative
              ${activeTab === 'settings' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}
            `}
          >
            项目设置
            {activeTab === 'settings' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
          </button>
          <button
            onClick={() => setActiveTab('layers')}
            className={`px-4 py-2.5 text-sm font-medium transition-colors relative
              ${activeTab === 'layers' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}
            `}
          >
            层级规划
            {activeTab === 'layers' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
          </button>
          <button
            onClick={() => setActiveTab('chapters')}
            className={`px-4 py-2.5 text-sm font-medium transition-colors relative
              ${activeTab === 'chapters' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}
            `}
          >
            章节生成
            {activeTab === 'chapters' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
          </button>
        </div>

        {/* 标签页内容 */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {activeTab === 'settings' && (
            <ProjectSettings
              project={activeProject}
              readyNovels={readyNovels}
              onClose={() => setActiveProjectId(null)}
              onDelete={async (id) => {
                await fetch('/api/project/delete', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ id }),
                });
                removeProject(id);
                toast.success('项目已删除');
              }}
            />
          )}
          {activeTab === 'layers' && (
            <LayerGenerationView embedded key={activeProjectId} />
          )}
          {activeTab === 'chapters' && (
            <ChapterGenerationView embedded />
          )}
        </div>
      </div>
    );
  }

  // ── 项目未打开：列表 + 创建表单 ──

  const toggleSource = (id: string) => {
    setSelectedSourceIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const handleCreate = async () => {
    if (!title.trim()) {
      toast.error('请输入项目名称');
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
  };

  const handleOpenProject = (project: WritingProject) => {
    setActiveProjectId(project.id);
    setActiveTab('layers');
  };

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
                {selectedSourceIds.includes(novel.id) ? (
                  <SourceRoleSelector
                    sourceTitle={novel.title}
                    role={roles[novel.id] ?? 'style_and_plot'}
                    onChange={(r) => setRoles((prev) => ({ ...prev, [novel.id]: r }))}
                  />
                ) : (
                  <span className="text-sm text-muted-foreground">《{novel.title}》</span>
                )}
              </div>
            ))}
          </div>
        )}

        <button
          onClick={handleCreate}
          disabled={!title.trim()}
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
              onClick={() => handleOpenProject(project)}
              className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-accent/50 transition-colors cursor-pointer"
            >
              <FolderOpen className="w-4 h-4 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{project.title}</p>
                <p className="text-xs text-muted-foreground">
                  层级 {project.currentLayer}/5 · {project.chapters?.length ?? 0} 章
                </p>
              </div>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  await fetch('/api/project/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: project.id }),
                  });
                  removeProject(project.id);
                  toast.success('项目已删除');
                }}
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

// ── 项目设置标签页 ──

function ProjectSettings({
  project,
  readyNovels,
  onClose,
  onDelete,
}: {
  project: WritingProject;
  readyNovels: { id: string; title: string; status: string }[];
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const sourceNovels = useSourceLibraryStore((s) => s.sourceNovels);
  const projectSources = sourceNovels.filter((s) => project.sourceNovelIds.includes(s.id));

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* 基本信息 */}
      <div className="p-4 rounded-lg border border-border bg-card">
        <h3 className="text-sm font-medium text-foreground mb-3">项目信息</h3>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-20">项目名称</span>
            <span className="text-foreground">{project.title}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-20">创建时间</span>
            <span className="text-foreground">{new Date(project.createdAt).toLocaleDateString('zh-CN')}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-20">当前层级</span>
            <span className="text-foreground">{project.currentLayer}/5</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-20">已生成章节</span>
            <span className="text-foreground">{project.chapters?.length ?? 0} 章</span>
          </div>
        </div>
      </div>

      {/* 关联的源小说 */}
      <div className="p-4 rounded-lg border border-border bg-card">
        <h3 className="text-sm font-medium text-foreground mb-3">关联源小说</h3>
        {projectSources.length === 0 ? (
          <p className="text-xs text-muted-foreground">无关联源小说</p>
        ) : (
          <div className="space-y-2">
            {projectSources.map((novel) => {
              const role = project.sourceRoles.find((r) => r.sourceNovelId === novel.id);
              const roleLabel = role?.role === 'style' ? '仅文风' : role?.role === 'plot' ? '仅情节' : '文风+情节';
              return (
                <div key={novel.id} className="flex items-center gap-2 text-sm">
                  <span className="text-foreground">《{novel.title}》</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">{roleLabel}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 危险操作 */}
      <div className="p-4 rounded-lg border border-destructive/20 bg-destructive/5">
        <h3 className="text-sm font-medium text-destructive mb-3">危险操作</h3>
        <div className="flex gap-3">
          <button
            onClick={() => onDelete(project.id)}
            className="px-4 py-2 rounded-lg text-sm border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
          >
            删除项目
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm border border-border text-muted-foreground hover:bg-accent transition-colors"
          >
            关闭项目
          </button>
        </div>
      </div>
    </div>
  );
}
