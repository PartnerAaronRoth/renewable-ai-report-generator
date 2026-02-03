import React, { useState } from 'react';
import { Download, Sparkles, FileText, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { SplitPdfChunk, AnalysisStatus } from '../types';
import { formatBytes } from '../services/pdfService';
import { analyzePdfChunk } from '../services/geminiService';

interface ChunkCardProps {
  chunk: SplitPdfChunk;
}

export const ChunkCard: React.FC<ChunkCardProps> = ({ chunk }) => {
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>(AnalysisStatus.IDLE);
  const [summary, setSummary] = useState<string | null>(null);

  const handleDownload = () => {
    const url = URL.createObjectURL(chunk.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = chunk.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleAnalyze = async () => {
    if (analysisStatus === AnalysisStatus.ANALYZING) return;

    setAnalysisStatus(AnalysisStatus.ANALYZING);
    try {
      const result = await analyzePdfChunk(chunk.blob);
      setSummary(result);
      setAnalysisStatus(AnalysisStatus.COMPLETED);
    } catch (error) {
      setAnalysisStatus(AnalysisStatus.ERROR);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow duration-300 overflow-hidden flex flex-col">
      <div className="p-5 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-red-50 text-red-600 rounded-lg">
              <FileText size={24} />
            </div>
            <div>
              <h4 className="font-semibold text-slate-800 truncate max-w-[200px]" title={chunk.fileName}>
                {chunk.fileName}
              </h4>
              <p className="text-xs text-slate-500 font-medium flex items-center gap-2">
                <span className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">{chunk.pageRange}</span>
                <span>•</span>
                <span>{formatBytes(chunk.size)}</span>
              </p>
            </div>
          </div>
        </div>

        {summary && (
          <div className="mt-2 p-3 bg-indigo-50/50 rounded-lg border border-indigo-100 text-sm text-slate-700 leading-relaxed animate-in fade-in slide-in-from-top-2">
            <div className="flex items-center gap-2 mb-1 text-indigo-700 font-semibold text-xs uppercase tracking-wide">
              <Sparkles size={12} /> Gemini Summary
            </div>
            {summary}
          </div>
        )}

        {analysisStatus === AnalysisStatus.ERROR && (
          <div className="mt-2 p-3 bg-red-50 text-red-600 text-sm rounded-lg flex items-center gap-2">
            <AlertTriangle size={16} />
            Failed to analyze. Check API Key or try again.
          </div>
        )}
      </div>

      <div className="mt-auto border-t border-slate-100 p-3 bg-slate-50 flex gap-2">
        <button
          onClick={handleDownload}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-colors focus:ring-2 focus:ring-slate-200"
        >
          <Download size={16} />
          Download
        </button>
        
        <button
          onClick={handleAnalyze}
          disabled={analysisStatus === AnalysisStatus.ANALYZING || analysisStatus === AnalysisStatus.COMPLETED}
          className={`
            flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all focus:ring-2
            ${analysisStatus === AnalysisStatus.COMPLETED
              ? 'bg-green-100 text-green-700 border border-green-200 cursor-default'
              : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm shadow-indigo-200 focus:ring-indigo-100'
            }
            ${analysisStatus === AnalysisStatus.ANALYZING ? 'opacity-80 cursor-wait' : ''}
          `}
        >
          {analysisStatus === AnalysisStatus.ANALYZING ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Thinking...
            </>
          ) : analysisStatus === AnalysisStatus.COMPLETED ? (
            <>
              <CheckCircle2 size={16} />
              Analyzed
            </>
          ) : (
            <>
              <Sparkles size={16} />
              Analyze
            </>
          )}
        </button>
      </div>
    </div>
  );
};