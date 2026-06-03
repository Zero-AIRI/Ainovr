// ============================================
// 小说问答视图 — 基于上传内容的实时对话
// ============================================

'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Send, MessageCircle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { StreamingText } from '@/components/StreamingText';
import { useAppStore } from '@/lib/store';
import { needsApiKey, type ChatMessage } from '@/types';

export function ChatView() {
  const novels = useAppStore((s) => s.novels);
  const providerType = useAppStore((s) => s.providerType);
  const apiKey = useAppStore((s) => s.apiKey);
  const model = useAppStore((s) => s.model);
  const baseURL = useAppStore((s) => s.baseURL);
  const thinkingMode = useAppStore((s) => s.thinkingMode);
  const thinkingEffort = useAppStore((s) => s.thinkingEffort);
  const customProviders = useAppStore((s) => s.customProviders);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 自动滚到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamContent]);

  const noApiKey = needsApiKey(providerType) && !apiKey.trim();
  const noNovels = novels.length === 0;
  const canSend = input.trim().length > 0 && !isStreaming && !noApiKey && !noNovels;

  const handleSend = useCallback(async () => {
    if (!canSend) return;

    const question = input.trim();
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: question }]);
    setIsStreaming(true);
    setStreamContent('');

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          novelTexts: novels.map((n) => n.sampleText),
          novelTitles: novels.map((n) => n.title),
          history: messages,
          question,
          provider: providerType,
          apiKey,
          model,
          baseURL: baseURL || undefined,
          thinkingMode,
          thinkingEffort,
          customProviders,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: '请求失败' }));
        throw new Error(err.error || '问答请求失败');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');

      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        fullText += chunk;
        setStreamContent(fullText);
      }

      setMessages((prev) => [...prev, { role: 'assistant', content: fullText }]);
      setStreamContent('');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : '未知错误';
      setMessages((prev) => [...prev, { role: 'assistant', content: `❌ ${errMsg}` }]);
      setStreamContent('');
    } finally {
      setIsStreaming(false);
    }
  }, [canSend, input, messages, novels, providerType, apiKey, model, baseURL, thinkingMode, thinkingEffort, customProviders]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setStreamContent('');
  };

  // 空状态
  if (noNovels || noApiKey) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-3">
          <MessageCircle className="w-12 h-12 text-primary/30 mx-auto" />
          <p className="text-muted-foreground">
            {noNovels ? '请先在左侧导入小说文件' : '请先在设置中配置 API Key'}
          </p>
          <p className="text-xs text-muted-foreground/60">
            导入小说后即可基于内容提问
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-card/50">
        <div>
          <h2 className="text-sm font-medium">小说问答</h2>
          <p className="text-xs text-muted-foreground">
            基于 {novels.length} 本小说的内容回答
          </p>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearChat} className="text-muted-foreground hover:text-foreground">
            <Trash2 className="w-3.5 h-3.5 mr-1" />
            清空
          </Button>
        )}
      </div>

      {/* 消息区 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && !isStreaming && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
            <MessageCircle className="w-10 h-10 text-primary/30" />
            <div className="space-y-1">
              <p className="text-muted-foreground">向小说提问</p>
              <p className="text-xs text-muted-foreground/60">
                可以问剧情、人物、写作手法，或让 AI 模仿原文风格创作
              </p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center max-w-md">
              {[
                '主角的性格特点是什么？',
                '分析一下作者的叙事手法',
                '这段情节为什么这样安排？',
                '模仿原文风格写一段对话',
              ].map((hint) => (
                <button
                  key={hint}
                  onClick={() => setInput(hint)}
                  className="text-xs px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
                >
                  {hint}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card border border-border text-foreground'
              }`}
            >
              {msg.role === 'assistant' ? (
                <div className="prose prose-sm max-w-none whitespace-pre-wrap">
                  {msg.content}
                </div>
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}

        {/* 流式输出中的 assistant 消息 */}
        {isStreaming && streamContent && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-2xl px-4 py-3 bg-card border border-border">
              <StreamingText content={streamContent} isStreaming={true} />
            </div>
          </div>
        )}

        {/* 等待响应 */}
        {isStreaming && !streamContent && (
          <div className="flex justify-start">
            <div className="rounded-2xl px-4 py-3 bg-card border border-border text-sm text-muted-foreground">
              思考中...
            </div>
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div className="border-t border-border px-6 py-3 bg-card/50">
        <div className="flex items-end gap-2 max-w-4xl mx-auto">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入你的问题... (Enter 发送, Shift+Enter 换行)"
            rows={1}
            className="resize-none min-h-[40px] max-h-[120px] flex-1"
            disabled={isStreaming}
          />
          <Button
            onClick={handleSend}
            disabled={!canSend}
            size="icon"
            className="h-10 w-10 shrink-0"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
