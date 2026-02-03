
import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, FileText, CheckSquare, Square, ChevronRight, ChevronDown, Play, FileCheck, Save, Loader2, Table as TableIcon, MessageSquare, RefreshCw, FileInput, Trash2, Send, Download, TerminalSquare, Layers, Search, X, Plus, Edit3, AlertTriangle, Lock, FolderInput, ImageIcon, PenTool } from 'lucide-react';
import { InventoryItem, ProcessedFile, ProjectStage, ReportLevel, ReportSection, ReportSubsection, DataEntryRow, LogMessage, ModelSelection, ExecutiveSummaryData } from '../types';
import { parseDataEntryCSV, generateWordReport, generateConsolidatedCSV } from '../services/reportService';
import { analyzeReportSection, generateSectionConclusion, generateExecutiveSummaryNarrative, generateSectionSummaryForTable, regenerateNarrativeFromRows } from '../services/geminiService';
import { SystemLog } from './SystemLog';
import { ModelSelector } from './ModelSelector';

interface ReportGenerationViewProps {
  inventory: InventoryItem[];
  processedFiles: ProcessedFile[];
  projectName: string;
  onBack: () => void;
  models: ModelSelection;
  onModelChange: (models: ModelSelection) => void;
  proposalText: string;
  proposalFileName: string;
}

// Simple Markdown Renderer component for Tables and Paragraphs
const SimpleMarkdownViewer: React.FC<{ content: string }> = ({ content }) => {
    if (!content) return null;
    
    const lines = content.split('\n');
    const elements: React.ReactNode[] = [];
    let tableBuffer: string[] = [];
    let inTable = false;

    const renderTable = (rows: string[], key: number) => {
        // Simple MD Table parser
        // Filter out separator rows like |---|---|
        const dataRows = rows.filter(r => !r.trim().match(/^\|?[-:\s|]+\|?$/));
        
        if (dataRows.length === 0) return null;

        const headers = dataRows[0].split('|').filter(c => c.trim() !== '').map(c => c.trim());
        const body = dataRows.slice(1).map(r => r.split('|').filter(c => c.trim() !== '').map(c => c.trim()));

        return (
            <div key={key} className="my-4 overflow-x-auto border border-slate-200 rounded-lg shadow-sm">
                <table className="min-w-full text-sm text-left">
                    <thead className="bg-slate-100 text-slate-700 font-semibold">
                        <tr>
                            {headers.map((h, i) => <th key={i} className="px-4 py-2 border-b border-slate-200">{h}</th>)}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {body.map((row, i) => (
                            <tr key={i} className="hover:bg-slate-50">
                                {row.map((cell, j) => <td key={j} className="px-4 py-2 text-slate-600 border-r border-slate-100 last:border-0">{cell}</td>)}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    };

    lines.forEach((line, idx) => {
        const trimmed = line.trim();
        const isTableLine = trimmed.startsWith('|') || (trimmed.includes('|') && trimmed.split('|').length > 2);

        if (isTableLine) {
            inTable = true;
            tableBuffer.push(trimmed);
        } else {
            if (inTable) {
                // Flush table
                elements.push(renderTable(tableBuffer, idx));
                tableBuffer = [];
                inTable = false;
            }
            if (trimmed.length > 0) {
                // Check for Table Caption
                if (trimmed.startsWith('Table')) {
                     elements.push(<p key={idx} className="text-sm font-semibold text-slate-500 text-center mt-6 mb-2">{trimmed}</p>);
                } else {
                     elements.push(<p key={idx} className="mb-4 leading-relaxed whitespace-pre-wrap">{trimmed}</p>);
                }
            }
        }
    });

    if (inTable) {
         elements.push(renderTable(tableBuffer, lines.length));
    }

    return <div className="text-slate-700 text-sm">{elements}</div>;
};

// Helper component for cells 
const EditableCellWithTooltip: React.FC<{
    value: string;
    onChange: (val: string) => void;
    placeholder?: string;
    onHover?: (e: React.MouseEvent, text: string) => void;
    onLeave?: () => void;
}> = ({ value, onChange, placeholder, onHover, onLeave }) => {
    return (
        <div className="relative w-full">
            <input
                type="text"
                className="w-full bg-transparent border border-transparent rounded px-1 h-8 focus:bg-white focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 outline-none transition-all duration-200 truncate text-slate-700"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                onMouseEnter={(e) => onHover && onHover(e, value)}
                onMouseLeave={onLeave}
            />
        </div>
    );
};

export const ReportGenerationView: React.FC<ReportGenerationViewProps> = ({ 
    inventory, 
    processedFiles, 
    projectName, 
    onBack, 
    models, 
    onModelChange,
    proposalText,
    proposalFileName 
}) => {
  // Config State
  const [projectNumber, setProjectNumber] = useState<string>(""); 
  const [projectManager, setProjectManager] = useState<string>("");
  const [coverPhoto, setCoverPhoto] = useState<ArrayBuffer | null>(null);
  const [coverFooter, setCoverFooter] = useState<ArrayBuffer | null>(null);
  const [letterHeader, setLetterHeader] = useState<ArrayBuffer | null>(null);
  const [signatureImg, setSignatureImg] = useState<ArrayBuffer | null>(null);
  const [mainReportFooter, setMainReportFooter] = useState<ArrayBuffer | null>(null); // NEW

  const [stage, setStage] = useState<ProjectStage>(ProjectStage.PreConstruction);
  const [level, setLevel] = useState<ReportLevel>(ReportLevel.Standard);
  const [showStageWarning, setShowStageWarning] = useState(false);
  
  // Data State
  const [sections, setSections] = useState<ReportSection[]>([]);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'report' | 'table' | 'inventory' | 'logs'>('report');
  
  // Processing State
  const [isCompiling, setIsCompiling] = useState(false);
  const [compileStatus, setCompileStatus] = useState("");
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [batchProgressPct, setBatchProgressPct] = useState(0);
  const [batchTimeRemaining, setBatchTimeRemaining] = useState("");
  const [batchStatusMessage, setBatchStatusMessage] = useState("");
  
  // Drag State
  const [dragTarget, setDragTarget] = useState<'template' | null>(null);

  // Refinement State (Chat & Doc Selection)
  const [refinementInput, setRefinementInput] = useState("");
  const [activeSubsectionId, setActiveSubsectionId] = useState<string | null>(null);
  const [refinementDocs, setRefinementDocs] = useState<InventoryItem[]>([]);
  const [showDocDropdown, setShowDocDropdown] = useState(false);
  const [docSearch, setDocSearch] = useState("");
  const [isRegenerating, setIsRegenerating] = useState<string | null>(null); 

  // Tooltip State
  const [tooltip, setTooltip] = useState<{ text: string, x: number, y: number } | null>(null);

  // File Inputs Refs
  const templateInputRef = useRef<HTMLInputElement>(null);

  // Helper Log
  const addLog = (msg: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
      setLogs(prev => [...prev, { id: crypto.randomUUID(), timestamp: new Date(), message: msg, type }]);
  };

  const handleCellHover = (e: React.MouseEvent, text: string) => {
      if (!text || text.length <= 20) return;
      const rect = e.currentTarget.getBoundingClientRect();
      // Calculate position to ensure it stays on screen
      let left = rect.left;
      let top = rect.bottom + 5;
      
      // Basic viewport check could be added here if needed, 
      // but keeping it simple aligned to cell start usually works well.
      setTooltip({ text, x: left, y: top });
  };

  const handleCellLeave = () => {
      setTooltip(null);
  };

  // Monitor Stage Change for Warning
  useEffect(() => {
     const hasAnalyzed = sections.some(s => s.subsections.some(sub => sub.isComplete));
     if (hasAnalyzed) {
         setShowStageWarning(true);
     }
  }, [stage]);

  // Initial Auto-Detection logic when proposalText loads (from Step 1)
  useEffect(() => {
      if (proposalText) {
          // Detect Project Number
          const projNumMatch = proposalText.match(/Project\s*(?:No|Number|#|ID)[\.:]?\s*([A-Za-z0-9-]{6,})/i) || proposalText.match(/\b(\d{2}-\d{5,8})\b/);
          if (projNumMatch && projNumMatch[1]) {
             setProjectNumber(projNumMatch[1]);
          }

          // Detect PM
          const pmMatch = proposalText.match(/([A-Z][a-z]+\s+[A-Z][a-z]+)[\r\n\s]+(?:Senior\s+)?Project\s+Manager/m) || proposalText.match(/Project\s+Manager[\s:]+([A-Z][a-z]+\s+[A-Z][a-z]+)/i);
          if (pmMatch && pmMatch[1]) {
              setProjectManager(pmMatch[1]);
          }
      }
  }, [proposalText]);

  // Trigger Auto-Analysis for Proposal Section if Sections loaded
  useEffect(() => {
    if (proposalText && sections.length > 0) {
        const propSec = sections.find(s => s.title.toLowerCase().includes("proposal"));
        // If we have a Proposal section and text is ready, check if we need to run it
        if (propSec && !propSec.subsections[0]?.isAnalyzing && !propSec.subsections[0]?.isComplete) {
            
            // Force Select
            setSections(prev => prev.map(s => {
                 if (s.id === propSec.id) {
                     return { 
                         ...s, 
                         isSelected: true,
                         subsections: s.subsections.map(sub => ({...sub, isSelected: true}))
                     };
                 }
                 return s;
            }));

            // Run Analysis immediately
            const subId = propSec.subsections[0]?.id;
            if (subId) {
                setTimeout(() => runAnalysis(propSec.id, subId), 100);
            }
        }
    }
  }, [proposalText, sections.length]);


  // --- Handlers ---

  const handleTemplateUpload = async (files: File[]) => {
      // ... (Rest of handleTemplateUpload logic same as before) ...
      addLog(`Scanning ${files.length} items in Template Folder...`, 'info');
      
      const csvFile = files.find(f => f.name.toLowerCase().endsWith('.csv'));
      if (csvFile) {
          addLog(`Parsing Data Entry Form: ${csvFile.name}...`, 'info');
          try {
              const parsedSections = await parseDataEntryCSV(csvFile, { stage, level });
              setSections(parsedSections);
              let tableCount = 0;
              parsedSections.forEach(s => s.subsections.forEach(sub => { if(sub.includeTable) tableCount++; }));
              addLog(`Loaded ${parsedSections.length} Sections. ${tableCount} Tables flagged.`, 'success');
              if (parsedSections.length > 0) setActiveSectionId(parsedSections[0].id);
          } catch (err) {
              addLog("Failed to parse CSV.", 'error');
          }
      } else {
          if (sections.length === 0) addLog("No Data Entry CSV found in the uploaded folder.", 'warning');
      }

      // Process Images
      const processImage = async (keyword: string, setter: (b: ArrayBuffer) => void, label: string) => {
          const f = files.find(file => {
              const n = file.name.toLowerCase();
              return n.includes(keyword) && (n.endsWith('.png') || n.endsWith('.jpg') || n.endsWith('.jpeg'));
          });
          if(f) {
              try { setter(await f.arrayBuffer()); addLog(`Found ${label}`, 'success'); } catch(e) {}
          }
      };

      // Helper for complex matches from original code
      const photoFile = files.find(f => {
          const name = f.name.toLowerCase();
          return (name.includes('header') || name.includes('coverpageheader') || name.includes('logo')) && 
                 (name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg')) &&
                 !name.includes('letter');
      });
      if (photoFile) { try { setCoverPhoto(await photoFile.arrayBuffer()); addLog(`Found header image`, 'success'); } catch(e){} }
      else { const fb = files.find(f => f.name.toLowerCase() === 'coverpageheaderphoto.png'); if(fb) try { setCoverPhoto(await fb.arrayBuffer()); } catch(e){} }

      // Other images
      processImage('footer', setCoverFooter, 'cover footer');
      
      const letterHeaderFile = files.find(f => f.name.toLowerCase().includes('letter') && f.name.toLowerCase().includes('header'));
      if(letterHeaderFile) try { setLetterHeader(await letterHeaderFile.arrayBuffer()); addLog('Found letter header', 'success'); } catch(e){}

      const sigFile = files.find(f => f.name.toLowerCase().includes('signature') || f.name.toLowerCase().includes('gage'));
      if(sigFile) try { setSignatureImg(await sigFile.arrayBuffer()); addLog('Found signature', 'success'); } catch(e){}

      const mainFooterFile = files.find(f => f.name.toLowerCase().includes('main') && f.name.toLowerCase().includes('footer'));
      if(mainFooterFile) try { setMainReportFooter(await mainFooterFile.arrayBuffer()); addLog('Found main footer', 'success'); } catch(e){}
  };

  // ... (traverseFileTree, drag handlers, download inventory remain same) ...
  const traverseFileTree = async (item: any, path = ''): Promise<File[]> => {
    if (item.isFile) {
      return new Promise((resolve) => item.file((file: File) => resolve([file])));
    } else if (item.isDirectory) {
      const dirReader = item.createReader();
      return new Promise((resolve) => {
        const readEntries = async () => {
          let entries: any[] = [];
          const readBatch = (): Promise<any[]> => new Promise((res) => dirReader.readEntries((batch: any[]) => res(batch)));
          let batch = await readBatch();
          while (batch.length > 0) { entries = entries.concat(batch); batch = await readBatch(); }
          const filePromises = entries.map((entry) => traverseFileTree(entry, path + item.name + "/"));
          resolve((await Promise.all(filePromises)).flat());
        };
        readEntries();
      });
    }
    return [];
  };

  const handleDragOver = (e: React.DragEvent, target: 'template') => {
      e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy';
      if (dragTarget !== target) setDragTarget(target);
  };
  const handleDragLeave = (e: React.DragEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.currentTarget.contains(e.relatedTarget as Node)) return;
      setDragTarget(null);
  };
  const handleDropTemplate = async (e: React.DragEvent) => {
      e.preventDefault(); e.stopPropagation(); setDragTarget(null);
      const items = e.dataTransfer.items;
      let files: File[] = [];
      if (items && items.length > 0) {
          const promises: Promise<File[]>[] = [];
          for (let i = 0; i < items.length; i++) {
              const item = (items[i] as any).webkitGetAsEntry ? (items[i] as any).webkitGetAsEntry() : null;
              if (item) promises.push(traverseFileTree(item));
              else { const file = items[i].getAsFile(); if (file) promises.push(Promise.resolve([file])); }
          }
          files = (await Promise.all(promises)).flat();
      } else { files = Array.from(e.dataTransfer.files); }
      if (files.length > 0) handleTemplateUpload(files);
  };
  const handleDownloadInventory = () => {
      const header = "ID,Source File Name,Source Type,Title of Source,Date of Source,Number of Pages,Tokens,Summary\n";
      const rows = inventory.map(item => [
          item.id, `"${item.sourceFileName}"`, `"${item.sourceTypes.join('; ')}"`, `"${item.title}"`, `"${item.date}"`, item.pageCount, item.tokenCount, `"${item.summary.replace(/"/g, '""')}"`
      ].join(',')).join('\n');
      const blob = new Blob([header + rows], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${projectName}_Doc_Inventory.csv`; a.click();
  };
  const toggleRefinementDoc = (doc: InventoryItem) => {
      if(refinementDocs.some(d => d.id === doc.id)) setRefinementDocs(prev => prev.filter(d => d.id !== doc.id));
      else setRefinementDocs(prev => [...prev, doc]);
  };
  const selectAllDocs = () => {
      if (refinementDocs.length === inventory.length) setRefinementDocs([]);
      else setRefinementDocs(inventory);
  };
  const openRefinement = (subId: string) => {
      if (activeSubsectionId === subId) setActiveSubsectionId(null);
      else { setActiveSubsectionId(subId); setRefinementDocs([]); setRefinementInput(""); setShowDocDropdown(false); }
  };

  // ... (Row Update, Tree Logic, Analysis, Compile logic same as previous) ...
  const handleRowUpdate = (secId: string, subId: string, rowId: string, field: keyof DataEntryRow, value: string | boolean) => {
      setSections(prev => prev.map(sec => {
          if (sec.id !== secId) return sec;
          return { ...sec, subsections: sec.subsections.map(sub => {
                  if (sub.id !== subId) return sub;
                  return { ...sub, rows: sub.rows.map(row => {
                          if (row.rowId !== rowId) return row;
                          return { ...row, [field]: value };
                      })};
              })};
      }));
  };
  const toggleSection = (secId: string) => {
      setSections(prev => prev.map(s => {
          if (s.id === secId) { const newState = !s.isSelected; return { ...s, isSelected: newState, subsections: s.subsections.map(sub => ({...sub, isSelected: newState})) }; }
          return s;
      }));
  };
  const toggleSubsection = (secId: string, subId: string) => {
      setSections(prev => prev.map(s => {
          if (s.id === secId) {
              const newSubs = s.subsections.map(sub => sub.id === subId ? { ...sub, isSelected: !sub.isSelected } : sub);
              const anySelected = newSubs.some(sub => sub.isSelected);
              return { ...s, isSelected: anySelected ? true : s.isSelected, subsections: newSubs };
          }
          return s;
      }));
  };
  const toggleSubsectionTable = (secId: string, subId: string) => {
      setSections(prev => prev.map(s => {
          if (s.id === secId) {
              return { ...s, subsections: s.subsections.map(sub => {
                      if (sub.id === subId) return { ...sub, includeTable: !sub.includeTable };
                      return sub;
                  })};
          }
          return s;
      }));
  };

  const runAnalysis = async (secId: string, subId: string, customInstruction?: string, forcedDocs?: string[]) => {
      setShowStageWarning(false);
      const sectionIndex = sections.findIndex(s => s.id === secId);
      if (sectionIndex === -1) return;
      const subIndex = sections[sectionIndex].subsections.findIndex(s => s.id === subId);
      if (subIndex === -1) return;
      const targetSub = sections[sectionIndex].subsections[subIndex];
      const filteredRows = targetSub.rows.filter(r => r.DDLevel <= level);
      if (!isBatchProcessing) addLog(`Analyzing: ${targetSub.title} (Level ${level}, ${filteredRows.length} items)...`, 'info');
      setSections(prev => prev.map((sec, i) => {
          if (i === sectionIndex) {
              return { ...sec, subsections: sec.subsections.map((sub, j) => {
                      if (j === subIndex) return { ...sub, isAnalyzing: true };
                      return sub;
                  })};
          }
          return sec;
      }));
      try {
          const { filledRows, content } = await analyzeReportSection(
              sections[sectionIndex].title, targetSub.title, filteredRows, inventory, processedFiles, proposalText,
              { stage, level }, customInstruction, forcedDocs, isBatchProcessing ? undefined : addLog, models.reasoningModel
          );
          setSections(prev => prev.map((sec, i) => {
              if (i === sectionIndex) {
                  return { ...sec, subsections: sec.subsections.map((sub, j) => {
                          if (j === subIndex) {
                              const updatedRows = sub.rows.map(originalRow => {
                                  const filled = filledRows.find(fr => fr.rowId === originalRow.rowId);
                                  return filled ? filled : originalRow;
                              });
                              return { ...sub, rows: updatedRows, content: content, isAnalyzing: false, isComplete: true };
                          }
                          return sub;
                      })};
              }
              return sec;
          }));
      } catch (e: any) {
          console.error(e);
          if (!isBatchProcessing) addLog(`Error analyzing ${targetSub.title}: ${e.message}`, 'error');
          setSections(prev => prev.map((sec, i) => {
              if (i === sectionIndex) {
                  return { ...sec, subsections: sec.subsections.map((sub, j) => {
                          if (j === subIndex) return { ...sub, isAnalyzing: false };
                          return sub;
                      })};
              }
              return sec;
          }));
      }
  };

  const handleRegenerateNarrative = async (secId: string, subId: string) => {
      const section = sections.find(s => s.id === secId);
      const sub = section?.subsections.find(s => s.id === subId);
      if (!section || !sub) return;
      setIsRegenerating(subId);
      addLog(`Regenerating narrative for ${sub.title} based on manual edits...`, 'info');
      try {
          const filteredRows = sub.rows.filter(r => r.DDLevel <= level);
          const newContent = await regenerateNarrativeFromRows(sub.title, filteredRows, { stage, level }, models.reasoningModel);
          setSections(prev => prev.map(s => {
              if (s.id !== secId) return s;
              return { ...s, subsections: s.subsections.map(sb => {
                      if (sb.id !== subId) return sb;
                      return { ...sb, content: newContent };
                  })};
          }));
          addLog("Narrative updated from table data.", 'success');
      } catch (e) { addLog("Failed to regenerate narrative.", 'error'); } finally { setIsRegenerating(null); }
  };

  const handleBatchAnalyze = async () => {
    const targets: {secId: string, subId: string, rowCount: number}[] = [];
    setShowStageWarning(false);
    sections.forEach(sec => {
        if(sec.isSelected) {
            sec.subsections.forEach(sub => {
                if(sub.isSelected && !sub.isAnalyzing) targets.push({secId: sec.id, subId: sub.id, rowCount: sub.rows.length});
            });
        }
    });
    if(targets.length === 0) { addLog("No subsections selected for analysis.", 'warning'); return; }
    setIsBatchProcessing(true); setBatchProgressPct(0);
    const CHUNK_SIZE = 5; const TOTAL_CHUNKS = Math.ceil(targets.length / CHUNK_SIZE);
    const isFastModel = models.reasoningModel.toLowerCase().includes('flash');
    const speedMultiplier = isFastModel ? 0.6 : 1.0; 
    let totalEstimatedSeconds = 0;
    for(let i=0; i<targets.length; i+=CHUNK_SIZE) {
        const chunk = targets.slice(i, i+CHUNK_SIZE);
        const maxRowsInChunk = Math.max(...chunk.map(t => t.rowCount));
        const estimatedItemTime = 15 + (maxRowsInChunk * 2); 
        totalEstimatedSeconds += (estimatedItemTime * speedMultiplier);
    }
    totalEstimatedSeconds = Math.round(totalEstimatedSeconds * 1.1);
    const formatTime = (secs: number) => secs < 60 ? `${secs}s` : `${Math.floor(secs/60)}m ${secs%60}s`;
    setBatchTimeRemaining(formatTime(totalEstimatedSeconds));
    setBatchStatusMessage(`Queueing ${targets.length} items...`);
    addLog(`Starting Batch Analysis. Targets: ${targets.length}. Est Time: ${formatTime(totalEstimatedSeconds)}`, 'info');
    const startTime = Date.now();
    for(let i=0; i<targets.length; i+=CHUNK_SIZE) {
        const chunkIndex = Math.floor(i/CHUNK_SIZE);
        const chunk = targets.slice(i, i+CHUNK_SIZE);
        setBatchStatusMessage(`Processing Batch ${chunkIndex + 1} of ${TOTAL_CHUNKS}...`);
        await Promise.all(chunk.map(t => runAnalysis(t.secId, t.subId)));
        const processedCount = Math.min(i + CHUNK_SIZE, targets.length);
        const progress = (processedCount / targets.length) * 100;
        setBatchProgressPct(progress);
        const elapsed = (Date.now() - startTime) / 1000;
        const avgTimePerItem = elapsed / processedCount;
        const remainingItems = targets.length - processedCount;
        const newEstRemaining = Math.round(avgTimePerItem * remainingItems);
        setBatchTimeRemaining(formatTime(newEstRemaining));
    }
    setIsBatchProcessing(false); addLog("Batch Analysis Complete.", 'success');
  };

  const handleCompile = async () => {
      setIsCompiling(true); setCompileStatus("Analyzing Conclusions..."); addLog("Starting Compilation...", 'info');
      try {
          const finalSections = sections.filter(s => !s.title.toLowerCase().includes("proposal")).map(sec => ({
                  ...sec, subsections: sec.subsections.map(sub => ({
                      ...sub, rows: sub.rows.filter(r => r.DDLevel <= level)
                  })).filter(sub => sub.rows.length > 0)
              })).filter(sec => sec.subsections.length > 0);
          for (let i = 0; i < finalSections.length; i++) {
              const sec = finalSections[i];
              if (!sec.isSelected) continue;
              const activeSubs = sec.subsections.filter(s => s.isSelected);
              if (activeSubs.length === 0) continue;
              const combinedContent = activeSubs.map(s => s.content || "").join("\n\n");
              const highRiskRows = activeSubs.flatMap(s => s.rows.filter(r => r.Risk === '2' || r.Risk === '3'));
              if (!sec.title.toLowerCase().includes("project description")) {
                   addLog(`Generating Conclusion for ${sec.title}...`, 'info');
                   const conclusion = await generateSectionConclusion(sec.title, combinedContent, highRiskRows, models.reasoningModel);
                   finalSections[i].conclusionContent = conclusion;
              }
          }
          setCompileStatus("Building Executive Summary..."); addLog("Generating Executive Summary...", 'info');
          const execNarrative = await generateExecutiveSummaryNarrative(proposalText, stage, models.reasoningModel);
          const sectionSummaries: { sectionTitle: string; summary: string; moderateRiskCount: number; highRiskCount: number; }[] = [];
          for (const sec of finalSections) {
             if (!sec.isSelected) continue;
             let modCount = 0; let highCount = 0; let combinedText = "";
             sec.subsections.forEach(sub => {
                 if (!sub.isSelected) return;
                 combinedText += (sub.content || "") + "\n";
                 sub.rows.forEach(r => { if (r.Risk === '2') modCount++; if (r.Risk === '3') highCount++; });
             });
             const tableSummary = await generateSectionSummaryForTable(sec.title, combinedText || sec.conclusionContent || "", models.bulkModel);
             sectionSummaries.push({ sectionTitle: sec.title, summary: tableSummary, moderateRiskCount: modCount, highRiskCount: highCount });
          }
          const execData: ExecutiveSummaryData = { narrative: execNarrative, sectionSummaries: sectionSummaries };
          setCompileStatus("Creating Documents...");
          const docBlob = await generateWordReport(
              finalSections, execData, inventory, projectNumber, 
              coverPhoto ? coverPhoto : undefined, coverFooter ? coverFooter : undefined, projectName, 
              letterHeader ? letterHeader : undefined, signatureImg ? signatureImg : undefined, mainReportFooter ? mainReportFooter : undefined, sections
          ); 
          const csvString = generateConsolidatedCSV(finalSections);
          const urlDoc = URL.createObjectURL(docBlob); const a1 = document.createElement('a'); a1.href = urlDoc; a1.download = `${projectName.replace(/\s+/g, '_')}_IE_Report.docx`; a1.click();
          const blobCsv = new Blob([csvString], { type: 'text/csv' }); const urlCsv = URL.createObjectURL(blobCsv); const a2 = document.createElement('a'); a2.href = urlCsv; a2.download = `${projectName.replace(/\s+/g, '_')}_Data_Form_Filled.csv`; a2.click();
          addLog("Compilation Complete. Downloads started.", 'success');
      } catch (e) { console.error(e); addLog("Compilation failed.", 'error'); alert("Compilation failed."); } finally { setIsCompiling(false); setCompileStatus(""); }
  };

  const activeSection = sections.find(s => s.id === activeSectionId);
  
  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans text-slate-900 relative">

        {/* Global Floating Tooltip */}
        {tooltip && (
            <div 
                className="fixed z-[9999] bg-white text-slate-700 text-xs p-3 rounded-lg shadow-xl border border-slate-200 whitespace-pre-wrap break-words max-w-sm animate-in fade-in zoom-in-95 duration-100"
                style={{ 
                    top: Math.min(tooltip.y, window.innerHeight - 200), // Prevent going off bottom
                    left: Math.min(tooltip.x, window.innerWidth - 320), // Prevent going off right
                }}
            >
                {tooltip.text}
            </div>
        )}

        {/* LEFT PANEL: Inputs & Tree */}
        <div className="w-1/3 min-w-[400px] max-w-[500px] bg-white border-r border-slate-200 flex flex-col z-10 shadow-md">
            {/* ... (Left Panel Content Unchanged) ... */}
            <div className="p-6 border-b border-slate-100 space-y-6 bg-slate-50/50">
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold text-slate-800">Report Generation</h2>
                    <button onClick={onBack} className="text-xs text-slate-500 hover:text-slate-800 underline">Back to Dataroom</button>
                </div>
                {/* Drag Drop Inputs */}
                <div className="grid grid-cols-1 gap-3">
                    <div 
                        className={`
                            border-2 border-dashed rounded-lg p-3 transition-all duration-200 cursor-pointer bg-white relative
                            ${dragTarget === 'template' ? 'border-emerald-600 bg-emerald-100 ring-4 ring-emerald-200 scale-[1.02] shadow-xl z-20' : 'border-slate-300 hover:border-emerald-400 hover:bg-emerald-50'}
                        `}
                        onDragOver={(e) => handleDragOver(e, 'template')} onDragLeave={handleDragLeave} onDrop={handleDropTemplate} onClick={() => templateInputRef.current?.click()}
                    >
                        <input type="file" ref={templateInputRef} className="hidden" multiple onChange={(e) => e.target.files && handleTemplateUpload(Array.from(e.target.files) as File[])} />
                        <div className="flex items-center gap-3 pointer-events-none">
                            <div className={`p-2 rounded-md transition-colors ${dragTarget === 'template' ? 'bg-emerald-600 text-white' : 'bg-emerald-100 text-emerald-600'}`}>
                                <FolderInput size={18} />
                            </div>
                            <div className="flex-1 overflow-hidden">
                                <p className="text-xs font-bold text-slate-700 uppercase">1. Template Folder</p>
                                <p className="text-sm text-slate-500 truncate">
                                    {sections.length > 0 ? `${sections.length} Sections Loaded` : (dragTarget === 'template' ? "DROP FOLDER HERE" : "Drag Template Folder (CSV + Images)")}
                                </p>
                                {coverPhoto && <div className="flex items-center gap-1 mt-0.5 text-emerald-600"><ImageIcon size={10} /><p className="text-[10px] font-bold">+ Cover Header</p></div>}
                                {coverFooter && <div className="flex items-center gap-1 mt-0.5 text-emerald-600"><ImageIcon size={10} /><p className="text-[10px] font-bold">+ Cover Footer</p></div>}
                                {letterHeader && <div className="flex items-center gap-1 mt-0.5 text-emerald-600"><ImageIcon size={10} /><p className="text-[10px] font-bold">+ Letter Header</p></div>}
                                {signatureImg && <div className="flex items-center gap-1 mt-0.5 text-emerald-600"><PenTool size={10} /><p className="text-[10px] font-bold">+ Signature</p></div>}
                                {mainReportFooter && <div className="flex items-center gap-1 mt-0.5 text-emerald-600"><ImageIcon size={10} /><p className="text-[10px] font-bold">+ Main Footer</p></div>}
                            </div>
                            {sections.length > 0 && <CheckSquare className="text-emerald-500" size={20} />}
                        </div>
                    </div>
                </div>
                {/* Settings Dropdowns */}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5 flex justify-between">
                           Development Stage {showStageWarning && <AlertTriangle size={12} className="text-yellow-500 animate-pulse" title="Stage changed. Re-analyze required." />}
                        </label>
                        <div className="relative">
                            <select value={stage} onChange={(e) => setStage(Number(e.target.value))} disabled={isBatchProcessing} className={`w-full text-sm font-semibold text-slate-900 bg-white border rounded-lg px-3 py-2 focus:ring-2 outline-none shadow-sm appearance-none disabled:opacity-50 disabled:bg-slate-100 ${showStageWarning ? 'border-yellow-400 ring-2 ring-yellow-100' : 'border-slate-300 focus:ring-indigo-500'}`}>
                                <option value={1} className="text-slate-900 bg-white">1 - Early Stage Dev</option>
                                <option value={2} className="text-slate-900 bg-white">2 - Late Stage Dev</option>
                                <option value={3} className="text-slate-900 bg-white">3 - Pre-Construction</option>
                                <option value={4} className="text-slate-900 bg-white">4 - Construction</option>
                                <option value={5} className="text-slate-900 bg-white">5 - Tax Equity / Late</option>
                                <option value={6} className="text-slate-900 bg-white">6 - Operational</option>
                            </select>
                            <ChevronDown size={14} className="absolute right-3 top-3 text-slate-400 pointer-events-none"/>
                        </div>
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5">Report Level</label>
                        <div className="relative">
                            <select value={level} onChange={(e) => setLevel(Number(e.target.value))} disabled={isBatchProcessing} className="w-full text-sm font-semibold text-slate-900 bg-white border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm appearance-none disabled:opacity-50 disabled:bg-slate-100">
                                <option value={1} className="text-slate-900 bg-white">1 - Lite</option>
                                <option value={2} className="text-slate-900 bg-white">2 - Standard</option>
                                <option value={3} className="text-slate-900 bg-white">3 - Pro</option>
                            </select>
                            <ChevronDown size={14} className="absolute right-3 top-3 text-slate-400 pointer-events-none"/>
                        </div>
                    </div>
                </div>
                {/* Analyze Button */}
                <div className="flex items-center justify-between gap-2">
                    {isBatchProcessing ? (
                        <div className="flex-1 bg-indigo-50 border border-indigo-100 rounded-lg p-2 flex items-center gap-3">
                             <div className="p-1.5 bg-white rounded-md shadow-sm"><Loader2 size={16} className="animate-spin text-indigo-600" /></div>
                             <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-center mb-1"><span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider">{batchStatusMessage}</span><span className="text-[10px] font-mono text-indigo-500">{batchTimeRemaining}</span></div>
                                <div className="h-1.5 w-full bg-indigo-100 rounded-full overflow-hidden"><div className="h-full bg-indigo-500 transition-all duration-300" style={{ width: `${batchProgressPct}%` }}></div></div>
                             </div>
                        </div>
                    ) : (
                        <button onClick={handleBatchAnalyze} disabled={sections.length === 0} className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-white rounded-lg text-sm font-bold uppercase tracking-wide transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm ${showStageWarning ? 'bg-yellow-500 hover:bg-yellow-600 shadow-yellow-200' : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200'}`}>
                            {showStageWarning ? <><RefreshCw size={16}/> Re-Analyze All</> : <><Layers size={16} /> Analyze All Selected</>}
                        </button>
                    )}
                    <div className="w-40"><ModelSelector selection={models} onModelChange={onModelChange} /></div>
                </div>
            </div>

            {/* Tree View */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1 bg-slate-50">
                {sections.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 p-8 text-center border-2 border-dashed border-slate-200 rounded-xl m-4">
                        <UploadCloud size={48} className="mb-4 text-slate-300"/>
                        <p className="text-sm font-medium">No Sections Loaded</p>
                        <p className="text-xs mt-1">Upload the Template Folder (CSV + Images) to begin.</p>
                    </div>
                )}
                {sections.map(sec => {
                    const isProposal = sec.title.toLowerCase().includes("proposal");
                    return (
                        <div key={sec.id} className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
                            <div className={`p-3 flex items-center gap-3 cursor-pointer transition-colors ${sec.isSelected ? 'bg-indigo-50/50' : 'hover:bg-slate-50'} ${activeSectionId === sec.id ? 'ring-1 ring-indigo-500 ring-inset' : ''}`} onClick={() => setActiveSectionId(sec.id)}>
                                <button onClick={(e) => { e.stopPropagation(); if (!isProposal) toggleSection(sec.id); }} className={isProposal ? 'cursor-not-allowed opacity-70' : ''}>
                                    {(sec.isSelected || isProposal) ? <CheckSquare size={18} className="text-indigo-600"/> : <Square size={18} className="text-slate-300"/>}
                                </button>
                                <span className="text-sm font-semibold text-slate-800 flex-1 flex items-center gap-2">{sec.title}{isProposal && <span className="text-[9px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded uppercase font-bold tracking-wider">Locked</span>}</span>
                                <div className="flex gap-1">
                                    {sec.subsections.some(s => s.isAnalyzing) && <Loader2 size={14} className="animate-spin text-indigo-500"/>}
                                    {sec.subsections.every(s => s.isComplete) && sec.subsections.length > 0 && <FileCheck size={14} className="text-green-500"/>}
                                </div>
                            </div>
                            {activeSectionId === sec.id && (
                                <div className="border-t border-slate-100 divide-y divide-slate-50">
                                    {sec.subsections.map(sub => (
                                        <div key={sub.id} className="pl-10 pr-3 py-2.5 flex items-center justify-between group hover:bg-slate-50 transition-colors">
                                            <div className="flex items-center gap-3 overflow-hidden flex-1">
                                                <button onClick={() => toggleSubsection(sec.id, sub.id)}>{sub.isSelected ? <CheckSquare size={14} className="text-indigo-500"/> : <Square size={14} className="text-slate-300"/>}</button>
                                                <div className="flex flex-col overflow-hidden"><span className={`text-xs font-medium truncate ${sub.isSelected ? 'text-slate-700' : 'text-slate-400'}`}>{sub.title}</span></div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <button onClick={(e) => { e.stopPropagation(); toggleSubsectionTable(sec.id, sub.id); }} className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold uppercase transition-all ${sub.includeTable ? 'bg-indigo-50 text-indigo-600 border-indigo-200 hover:bg-indigo-100' : 'bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100 hover:text-slate-500'}`} title={sub.includeTable ? "Table Included (Click to remove)" : "No Table (Click to add)"}><TableIcon size={10} />{sub.includeTable ? "Table" : "Off"}</button>
                                                <div className="flex items-center gap-2">
                                                    {sub.isAnalyzing ? (<div className="flex items-center gap-1.5 px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded text-[10px] font-bold uppercase tracking-wider"><Loader2 size={10} className="animate-spin"/> Analyzing</div>) : sub.isComplete ? (<div className="flex items-center gap-1 text-green-600"><FileCheck size={14} /></div>) : sub.isSelected && (<button onClick={() => runAnalysis(sec.id, sub.id)} className="p-1.5 bg-indigo-100 hover:bg-indigo-600 text-indigo-600 hover:text-white rounded-md transition-all shadow-sm" title="Run Analysis"><Play size={10} className="fill-current"/></button>)}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            <div className="p-4 border-t border-slate-200 bg-white">
                <button onClick={handleCompile} disabled={isCompiling || sections.length === 0} className="w-full flex items-center justify-center gap-2 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed">{isCompiling ? <><Loader2 className="animate-spin" /> {compileStatus || "Compiling..."}</> : <><Save size={18} /> Compile Final Report</>}</button>
            </div>
        </div>

        {/* CENTER PANEL: Preview & Edit */}
        <div className="flex-1 flex flex-col bg-white min-w-[500px]">
            {/* Toolbar */}
            <div className="h-16 border-b border-slate-200 px-6 flex items-center justify-between bg-white sticky top-0 z-20">
                <div>
                    <h3 className="text-lg font-bold text-slate-800">{activeSection ? activeSection.title : "Report Preview"}</h3>
                    {activeSection && (<p className="text-xs text-slate-500">{activeSection.subsections.filter(s => s.isSelected).length} subsections selected</p>)}
                </div>
                <div className="flex bg-slate-100 p-1 rounded-lg gap-1">
                    <button onClick={() => setActiveTab('report')} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'report' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Report Language</button>
                    <button onClick={() => setActiveTab('table')} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'table' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Data Entry Table</button>
                    <button onClick={() => setActiveTab('inventory')} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'inventory' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Doc Inventory</button>
                    <button onClick={() => setActiveTab('logs')} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'logs' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>System Log</button>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto p-8 bg-slate-50/50">
                {!activeSection && activeTab !== 'inventory' && activeTab !== 'logs' ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400"><FileText size={48} className="mb-4 opacity-20"/><p>Select a Section from the left to preview.</p></div>
                ) : activeTab === 'logs' ? (
                    <SystemLog logs={logs} />
                ) : activeTab === 'inventory' ? (
                    <div className="max-w-6xl mx-auto space-y-4">
                        <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-slate-200"><h4 className="font-bold text-slate-700">Project Documentation</h4><button onClick={handleDownloadInventory} className="flex items-center gap-2 text-sm text-indigo-600 hover:bg-indigo-50 px-3 py-1.5 rounded transition"><Download size={16}/> Download CSV</button></div>
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                            <table className="w-full text-xs text-left">
                                <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-500"><tr><th className="px-4 py-3">ID</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">File Name</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Summary</th></tr></thead>
                                <tbody className="divide-y divide-slate-100">{inventory.map(item => (<tr key={item.id} className="hover:bg-slate-50"><td className="px-4 py-2 font-mono text-slate-400">{item.id}</td><td className="px-4 py-2 text-indigo-600 font-medium">{item.sourceTypes.join('; ')}</td><td className="px-4 py-2 text-slate-700 truncate max-w-[200px]" title={item.sourceFileName}>{item.sourceFileName}</td><td className="px-4 py-2 text-slate-500">{item.date}</td><td className="px-4 py-2 text-slate-500 truncate max-w-xs" title={item.summary}>{item.summary}</td></tr>))}</tbody>
                            </table>
                        </div>
                    </div>
                ) : (
                    <div className="max-w-4xl mx-auto space-y-8">
                        {activeSection.subsections.filter(s => s.isSelected).length === 0 && (<div className="text-center p-10 text-slate-400 italic">No subsections selected for this section.</div>)}
                        {activeSection.subsections.filter(s => s.isSelected).map(sub => (
                            <div key={sub.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                                <div className="bg-slate-50 px-6 py-3 border-b border-slate-100 flex justify-between items-center">
                                    <h4 className="font-bold text-slate-700">{sub.title}</h4>
                                    <div className="flex items-center gap-2">
                                        {sub.content && (<button onClick={() => handleRegenerateNarrative(activeSection.id, sub.id)} disabled={!!isRegenerating} className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 text-slate-700 hover:text-indigo-600 hover:border-indigo-300 rounded text-xs font-bold transition-all shadow-sm">{isRegenerating === sub.id ? <Loader2 size={12} className="animate-spin" /> : <PenTool size={12} />}{isRegenerating === sub.id ? "Regenerating..." : "Regenerate Narrative from Table Data"}</button>)}
                                        {sub.isAnalyzing ? (<span className="text-xs text-indigo-600 flex items-center gap-1"><Loader2 size={12} className="animate-spin"/> Analyzing...</span>) : sub.content ? (<button onClick={(e) => { e.stopPropagation(); openRefinement(sub.id); }} className={`text-xs flex items-center gap-1 px-2 py-1 rounded transition-colors ${activeSubsectionId === sub.id ? 'bg-indigo-100 text-indigo-700' : 'text-indigo-600 hover:bg-indigo-50'}`}><MessageSquare size={12} /> Refine with AI</button>) : (<button onClick={() => runAnalysis(activeSection.id, sub.id)} className="text-xs flex items-center gap-1 bg-indigo-600 text-white px-3 py-1.5 rounded hover:bg-indigo-700 transition-all shadow-sm"><Play size={10} className="fill-current"/> Generate</button>)}
                                    </div>
                                </div>
                                {activeSubsectionId === sub.id && (
                                    <div className="bg-indigo-50 p-4 border-b border-indigo-100 animate-in slide-in-from-top-2">
                                        <label className="block text-xs font-bold text-indigo-800 mb-2">Refine "{sub.title}"</label>
                                        <div className="flex gap-2">
                                            <input type="text" value={refinementInput} onChange={(e) => setRefinementInput(e.target.value)} className="flex-1 text-sm border-indigo-200 bg-white text-slate-900 rounded-md px-3 py-2 outline-none" onKeyDown={(e) => { if(e.key === 'Enter' && refinementInput.trim()) { runAnalysis(activeSection.id, sub.id, refinementInput); setRefinementInput(""); setActiveSubsectionId(null); } }}/>
                                            <button className="bg-indigo-600 text-white p-2 rounded-md"><Send size={16}/></button>
                                        </div>
                                    </div>
                                )}
                                {activeTab === 'report' ? (
                                    <div className="p-6">{sub.content ? <SimpleMarkdownViewer content={sub.content} /> : <div className="text-slate-400 italic text-sm">Content pending generation...</div>}</div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-xs text-left border-collapse">
                                            <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                                                <tr><th className="px-4 py-2 w-10 text-center">In Table?</th><th className="px-4 py-2 w-10">Lvl</th><th className="px-4 py-2 w-1/4">Item</th><th className="px-4 py-2 w-1/4">Entry</th><th className="px-4 py-2 w-16">ID</th><th className="px-4 py-2 w-16">Risk</th><th className="px-4 py-2">Comments</th></tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {sub.rows.map(row => (
                                                    <tr key={row.rowId} className={`hover:bg-slate-50 ${row.IncludeTable ? 'bg-indigo-50/30' : ''}`}>
                                                        <td className="px-4 py-2 text-center align-top"><button onClick={() => handleRowUpdate(activeSection.id, sub.id, row.rowId, 'IncludeTable', !row.IncludeTable)} className={`p-1 rounded ${row.IncludeTable ? 'text-indigo-600 bg-white shadow-sm' : 'text-slate-300'}`}>{row.IncludeTable ? <CheckSquare size={16} /> : <Square size={16} />}</button></td>
                                                        <td className="px-4 py-2 align-top font-mono text-slate-400"><input type="number" min="1" max="3" className="w-8 bg-transparent outline-none text-center" value={row.DDLevel} onChange={(e) => handleRowUpdate(activeSection.id, sub.id, row.rowId, 'DDLevel', e.target.value)} /></td>
                                                        <td className="px-4 py-2 font-medium text-slate-700 align-top">{row.Item}</td>
                                                        <td className="px-4 py-2 align-top">
                                                            <EditableCellWithTooltip 
                                                                value={row.Entry} 
                                                                onChange={(val) => handleRowUpdate(activeSection.id, sub.id, row.rowId, 'Entry', val)}
                                                                onHover={handleCellHover}
                                                                onLeave={handleCellLeave}
                                                            />
                                                        </td>
                                                        <td className="px-4 py-2 align-top font-mono text-slate-500"><input type="text" className="w-full bg-transparent outline-none" value={row.EntryID} onChange={(e) => handleRowUpdate(activeSection.id, sub.id, row.rowId, 'EntryID', e.target.value)} /></td>
                                                        <td className="px-4 py-2 align-top">
                                                            <select value={row.Risk} onChange={(e) => handleRowUpdate(activeSection.id, sub.id, row.rowId, 'Risk', e.target.value)} className={`w-full p-1 rounded text-xs font-bold outline-none appearance-none text-center ${row.Risk === '3' ? 'bg-red-100 text-red-700' : row.Risk === '2' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
                                                                <option value="1">1</option><option value="2">2</option><option value="3">3</option>
                                                            </select>
                                                        </td>
                                                        <td className="px-4 py-2 text-slate-600 align-top">
                                                            <EditableCellWithTooltip 
                                                                value={row.Comments} 
                                                                onChange={(val) => handleRowUpdate(activeSection.id, sub.id, row.rowId, 'Comments', val)}
                                                                onHover={handleCellHover}
                                                                onLeave={handleCellLeave}
                                                            />
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    </div>
  );
};
