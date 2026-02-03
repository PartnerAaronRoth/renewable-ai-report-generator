
import React, { useEffect, useRef } from 'react';
import { LogMessage } from '../types';
import { AlertCircle, CheckCircle, Info, AlertTriangle } from 'lucide-react';

interface SystemLogProps {
  logs: LogMessage[];
}

export const SystemLog: React.FC<SystemLogProps> = ({ logs }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="bg-slate-900 rounded-xl overflow-hidden shadow-lg border border-slate-700 flex flex-col h-full">
      <div className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h3 className="text-slate-200 font-mono text-sm font-semibold">System Log</h3>
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-500"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-green-500"></div>
        </div>
      </div>
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-xs"
      >
        {logs.length === 0 && (
            <div className="text-slate-500 italic">Waiting for processes to start...</div>
        )}
        {logs.map((log) => (
          <div key={log.id} className="flex items-start gap-2 animate-in fade-in slide-in-from-left-2 duration-300">
             <div className="mt-0.5 shrink-0">
               {log.type === 'info' && <Info size={14} className="text-blue-400" />}
               {log.type === 'success' && <CheckCircle size={14} className="text-green-400" />}
               {log.type === 'warning' && <AlertTriangle size={14} className="text-yellow-400" />}
               {log.type === 'error' && <AlertCircle size={14} className="text-red-400" />}
             </div>
             <div>
               <span className="text-slate-500 mr-2">[{log.timestamp.toLocaleTimeString()}]</span>
               <span className={`
                 ${log.type === 'info' ? 'text-slate-300' : ''}
                 ${log.type === 'success' ? 'text-green-300' : ''}
                 ${log.type === 'warning' ? 'text-yellow-300' : ''}
                 ${log.type === 'error' ? 'text-red-300' : ''}
               `}>{log.message}</span>
             </div>
          </div>
        ))}
      </div>
    </div>
  );
};
