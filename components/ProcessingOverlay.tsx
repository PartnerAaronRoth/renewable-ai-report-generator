
import React from 'react';
import { Loader2 } from 'lucide-react';

interface ProcessingOverlayProps {
  progress: number;
  title?: string;
  message?: string;
  timeRemaining?: string;
}

export const ProcessingOverlay: React.FC<ProcessingOverlayProps> = ({ 
    progress, 
    title = "Processing", 
    message = "Please wait...",
    timeRemaining
}) => {
  return (
    <div className="fixed inset-0 bg-white/90 backdrop-blur-sm z-50 flex flex-col items-center justify-center animate-in fade-in duration-300">
      <div className="bg-white p-8 rounded-2xl shadow-2xl border border-slate-100 max-w-md w-full text-center space-y-6">
        <div className="relative flex justify-center">
          <div className="absolute inset-0 bg-indigo-100 rounded-full animate-ping opacity-75 blur-xl"></div>
          <Loader2 className="w-12 h-12 text-indigo-600 animate-spin relative z-10" />
        </div>
        
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-slate-800">{title}</h2>
          <p className="text-slate-500 text-sm">{message}</p>
        </div>

        <div className="space-y-2">
          <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden shadow-inner">
            <div 
              className="h-full bg-gradient-to-r from-indigo-500 to-purple-600 transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            ></div>
          </div>
          <div className="flex justify-between items-center text-xs font-mono text-slate-400">
             <span>{Math.round(progress)}%</span>
             {timeRemaining && <span>Est. {timeRemaining}</span>}
          </div>
        </div>
      </div>
    </div>
  );
};
