
import React, { useMemo } from 'react';
import { InventoryItem } from '../types';
import { FileText, Calendar, Tag, Database } from 'lucide-react';

interface InventoryTableProps {
  items: InventoryItem[];
}

export const InventoryTable: React.FC<InventoryTableProps> = ({ items }) => {
  const totalTokens = useMemo(() => items.reduce((acc, item) => acc + (item.tokenCount || 0), 0), [items]);
  
  return (
    <div className="bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden flex flex-col h-full">
      <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
            <h3 className="text-slate-800 font-semibold flex items-center gap-2">
            <FileText size={18} className="text-indigo-600" />
            Live Inventory
            </h3>
            <span className="text-xs font-medium px-2 py-1 bg-indigo-100 text-indigo-700 rounded-full">
            {items.length} Files
            </span>
        </div>

        {/* Total Usage Display */}
        <div className="flex items-center gap-3 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
            <div className="p-1 bg-indigo-50 rounded-md text-indigo-600">
               <Database size={14}/>
            </div>
            <div className="flex flex-col">
               <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider leading-none mb-0.5">Total Token Usage</span>
               <span className="text-sm font-bold text-slate-800 leading-none">{totalTokens.toLocaleString()}</span>
            </div>
        </div>
      </div>
      
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 text-slate-500 font-medium sticky top-0 z-10 shadow-sm">
            <tr>
              <th className="px-4 py-3 w-12 text-center">#</th>
              <th className="px-4 py-3">File Name</th>
              <th className="px-4 py-3">Classified Type(s)</th>
              <th className="px-4 py-3">Title Inferred</th>
              <th className="px-4 py-3 w-24">Date</th>
              <th className="px-4 py-3 w-24 text-right">Tokens</th>
              <th className="px-4 py-3 w-1/4">Summary</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.length === 0 && (
               <tr>
                 <td colSpan={7} className="px-4 py-10 text-center text-slate-400 italic">
                   Waiting for analysis to begin...
                 </td>
               </tr>
            )}
            {items.map((item, index) => (
              <tr key={index} className="hover:bg-slate-50 transition-colors animate-in fade-in duration-300">
                <td className="px-4 py-3 text-center text-slate-400 font-mono text-xs">
                  {index + 1}
                </td>
                <td className="px-4 py-3 font-medium text-slate-700 max-w-[150px] truncate" title={item.sourceFileName}>
                  {item.sourceFileName}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {item.sourceTypes.map((type, idx) => (
                      <span key={idx} className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium border max-w-[150px] truncate
                        ${type.includes('Error') || type.includes('Uncategorized') 
                           ? 'bg-red-50 text-red-700 border-red-100' 
                           : 'bg-blue-50 text-blue-700 border-blue-100'
                        }
                      `}>
                        <Tag size={10} />
                        {type}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-600 max-w-[150px] truncate" title={item.title}>
                  {item.title}
                </td>
                <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs">
                   <div className="flex items-center gap-1.5">
                     <Calendar size={12} />
                     {item.date}
                   </div>
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-slate-600">
                    {item.tokenCount?.toLocaleString() ?? 0}
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs leading-relaxed max-w-xs truncate" title={item.summary}>
                  {item.summary}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
