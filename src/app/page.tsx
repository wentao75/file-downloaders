'use client';

import { useState } from 'react';

interface LogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'error' | 'success';
}

export default function Home() {
  const [date, setDate] = useState<string>(
    new Date(Date.now() - 86400000).toISOString().split('T')[0]
  );
  const [status, setStatus] = useState('idle');
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    setLogs(prev => [...prev, {
      timestamp: new Date().toLocaleTimeString(),
      message,
      type
    }]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('processing');
    setLogs([]); // 清空之前的日志
    
    addLog('开始下载任务...', 'info');
    
    try {
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ date }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '下载失败');
      }
      
      const data = await response.json();
      
      if (data.logs) {
        data.logs.forEach((log: string) => addLog(log, 'info'));
      }
      
      addLog('下载任务完成！', 'success');
      setStatus('success');
    } catch (error) {
      console.error(error);
      addLog(error instanceof Error ? error.message : '未知错误', 'error');
      setStatus('error');
    }
  };

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">聚力维斯对账文件下载</h1>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block mb-2">对账日期</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full p-2 border rounded"
              required
            />
            <p className="text-sm text-gray-500 mt-1">默认为昨天</p>
          </div>

          <button
            type="submit"
            disabled={status === 'processing'}
            className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600 disabled:bg-gray-400"
          >
            {status === 'processing' ? '处理中...' : '开始下载'}
          </button>
        </form>

        {/* 日志显示区域 */}
        <div className="mt-8">
          <h2 className="text-xl font-semibold mb-4">执行日志</h2>
          <div className="bg-gray-50 rounded-lg p-4 h-64 overflow-y-auto font-mono text-sm">
            {logs.length === 0 ? (
              <div className="text-gray-400">等待任务开始...</div>
            ) : (
              logs.map((log, index) => (
                <div
                  key={index}
                  className={`mb-1 ${
                    log.type === 'error' ? 'text-red-600' :
                    log.type === 'success' ? 'text-green-600' :
                    'text-gray-700'
                  }`}
                >
                  <span className="text-gray-400">[{log.timestamp}]</span> {log.message}
                </div>
              ))
            )}
          </div>
        </div>

        {status === 'success' && (
          <div className="mt-4 p-4 bg-green-100 text-green-700 rounded">
            下载成功！
          </div>
        )}

        {status === 'error' && (
          <div className="mt-4 p-4 bg-red-100 text-red-700 rounded">
            下载失败，请查看日志了解详细信息。
          </div>
        )}
      </div>
    </main>
  );
}
