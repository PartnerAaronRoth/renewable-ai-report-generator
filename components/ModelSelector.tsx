
import React, { useEffect, useState } from 'react';
import { Settings, RefreshCw, Cpu, Zap, ChevronDown } from 'lucide-react';
import { fetchAvailableModels } from '../services/geminiService';
import { ModelSelection } from '../types';

interface ModelSelectorProps {
  onModelChange: (selection: ModelSelection) => void;
  selection: ModelSelection;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({ onModelChange, selection }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  
  const refreshModels = async () => {
    setLoading(true);
    try {
      const fetched = await fetchAvailableModels();
      setModels(fetched);
    } catch (e) {
      // Should effectively never happen due to service fallback, but just in case
      console.error("Critical model fetch error", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshModels();
  }, []);

  return (
    <div className="relative">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors border border-slate-200 text-sm font-medium"
      >
        <Settings size={16} />
        <span className="hidden sm:inline">Model Settings</span>
        <ChevronDown size={14} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)}></div>
          <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl shadow-xl border border-slate-200 z-50 p-5 animate-in fade-in slide-in-from-top-2">
            
            <div className="flex items-center justify-between mb-5 pb-3 border-b border-slate-100">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                    <Cpu size={18} className="text-indigo-600"/> Gemini Models
                </h3>
                <button 
                    onClick={refreshModels} 
                    className={`p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-indigo-600 transition-colors ${loading ? 'animate-spin' : ''}`}
                    title="Refresh Models"
                >
                    <RefreshCw size={14} />
                </button>
            </div>

            <div className="space-y-5">
                {/* Bulk Model Selector */}
                <div className="relative group">
                    <div className="flex items-center justify-between mb-1.5">
                         <label className="text-xs font-bold text-slate-600 uppercase flex items-center gap-1.5">
                            <Zap size={14} className="text-yellow-500 fill-yellow-500" />
                            Bulk Processing
                        </label>
                        <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">Fast & Cheap</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mb-2 leading-tight">
                        Used for initial classification, splitting, and summary of thousands of pages.
                    </p>
                    <div className="relative">
                        <select 
                            value={selection.bulkModel}
                            onChange={(e) => onModelChange({...selection, bulkModel: e.target.value})}
                            disabled={loading}
                            className="w-full text-sm border border-slate-300 rounded-lg py-2 pl-3 pr-8 focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500 shadow-sm appearance-none bg-white text-slate-800 font-medium"
                        >
                            {models.map(m => (
                                <option key={m} value={m}>{m}</option>
                            ))}
                        </select>
                        <ChevronDown size={14} className="absolute right-3 top-3 text-slate-400 pointer-events-none"/>
                    </div>
                </div>

                {/* Reasoning Model Selector */}
                <div className="relative group">
                    <div className="flex items-center justify-between mb-1.5">
                         <label className="text-xs font-bold text-slate-600 uppercase flex items-center gap-1.5">
                            <Cpu size={14} className="text-purple-500 fill-purple-500" />
                            Deep Reasoning
                        </label>
                        <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">High Quality</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mb-2 leading-tight">
                        Used for complex report writing, data extraction, and conclusions.
                    </p>
                    <div className="relative">
                         <select 
                            value={selection.reasoningModel}
                            onChange={(e) => onModelChange({...selection, reasoningModel: e.target.value})}
                            disabled={loading}
                            className="w-full text-sm border border-slate-300 rounded-lg py-2 pl-3 pr-8 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 shadow-sm appearance-none bg-white text-slate-800 font-medium"
                        >
                            {models.map(m => (
                                <option key={m} value={m}>{m}</option>
                            ))}
                        </select>
                        <ChevronDown size={14} className="absolute right-3 top-3 text-slate-400 pointer-events-none"/>
                    </div>
                </div>
            </div>

            <div className="mt-5 pt-3 border-t border-slate-100 text-[10px] text-slate-400 text-center leading-relaxed">
                If the API fails to list models, a default set of known Gemini models is provided.
            </div>

          </div>
        </>
      )}
    </div>
  );
};
