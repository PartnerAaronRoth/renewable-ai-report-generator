
import React, { useState, useCallback, useEffect } from 'react';
import { DropZone } from './components/DropZone';
import { SystemLog } from './components/SystemLog';
import { InventoryTable } from './components/InventoryTable';
import { ReportGenerationView } from './components/ReportGenerationView';
import { ModelSelector } from './components/ModelSelector';
import { processDataroom, addFileToDataroom, generateInventoryCSV } from './services/dataroomService';
import { extractTextFromPdf } from './services/geminiService';
import { formatBytes } from './services/pdfService';
import { DEFAULT_BULK_MODEL, DEFAULT_REASONING_MODEL } from './services/geminiService';
import { ProcessingStatus, LogMessage, InventoryItem, ProcessedFile, ModelSelection } from './types';
import { Scissors, RefreshCcw, FolderArchive, Download, Clock, Table2, TerminalSquare, Building2, MapPin, Zap, Calendar, FileText, ArrowRight, FileCheck, Loader2 } from 'lucide-react';

export default function App() {
  const [step, setStep] = useState<1 | 2>(1); // Step 1: Dataroom, Step 2: Report
  const [status, setStatus] = useState<ProcessingStatus>({ state: 'idle' });
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [processedFiles, setProcessedFiles] = useState<ProcessedFile[]>([]);
  const [projectName, setProjectName] = useState<string>("");
  const [projectDescription, setProjectDescription] = useState<string>("");
  const [activeTab, setActiveTab] = useState<'inventory' | 'logs'>('inventory');
  
  // Proposal State
  const [proposalFile, setProposalFile] = useState<File | null>(null);
  const [proposalText, setProposalText] = useState<string>("");
  // isProposalProcessing is no longer needed since we don't block
  
  // Model State
  const [models, setModels] = useState<ModelSelection>({
      bulkModel: DEFAULT_BULK_MODEL,
      reasoningModel: DEFAULT_REASONING_MODEL
  });

  const addLog = useCallback((msg: Omit<LogMessage, 'id' | 'timestamp'>) => {
    setLogs(prev => [
      ...prev,
      { ...msg, id: crypto.randomUUID(), timestamp: new Date() }
    ]);
  }, []);

  const handleInventoryItem = useCallback((item: InventoryItem) => {
    setInventoryItems(prev => [...prev, item]);
  }, []);

  const handleFileSelect = useCallback(async (files: File[], isProposalBatch: boolean = false) => {
    if (!projectName.trim()) {
        if (!isProposalBatch) {
            alert("Please enter a Project Name before uploading.");
            return;
        }
    }

    if (!isProposalBatch && !proposalFile) {
        alert("Please upload the Proposal first.");
        return;
    }

    if (!isProposalBatch && status.state !== 'success') {
        setStatus({ state: 'processing', progress: 0, timeRemaining: "Calculating..." });
        setProjectDescription("");
    }

    const typeMsg = isProposalBatch ? "Proposal" : "Dataroom";
    addLog({ message: `Processing ${typeMsg} files...`, type: 'info' });

    try {
      let filesToProcess = [...files];
      
      // If this is the main Dataroom upload, verify the proposal is included/processed
      if (!isProposalBatch && proposalFile) {
          // Check if proposal is already in the inventory (by name)
          const isProposalAlreadyProcessed = inventoryItems.some(i => i.sourceFileName === proposalFile.name);
          
          if (!isProposalAlreadyProcessed) {
              addLog({ message: "Including staged Proposal in analysis batch...", type: 'info' });
              filesToProcess = [proposalFile, ...files];
              
              // Trigger text extraction independently so we have the text variable ready for Step 2
              extractTextFromPdf(proposalFile).then(text => {
                  setProposalText(text);
                  addLog({ message: "Proposal text extracted for report generation.", type: 'success' });
              }).catch(e => {
                  console.error(e);
                  addLog({ message: "Proposal text extraction failed (will rely on file content).", type: 'warning' });
              });
          }
      }

      // Use addFileToDataroom logic for both to append/merge
      const result = await addFileToDataroom(
        filesToProcess,
        inventoryItems,
        processedFiles,
        projectName || "Project", 
        addLog,
        handleInventoryItem,
        models.bulkModel,
        (percent, msg) => {
            if (!isProposalBatch) {
                setStatus(prev => ({
                    ...prev,
                    state: 'processing',
                    progress: percent,
                    timeRemaining: msg
                }));
            }
        }
      );
      
      setInventoryItems(result.inventory);
      if (!isProposalBatch) {
          setProjectDescription(result.description);
          setStatus({ state: 'success' });
      } 
      setProcessedFiles(result.processedFiles);
      
    } catch (error) {
      console.error(error);
      addLog({ message: `Error processing ${typeMsg}.`, type: 'error' });
      if (!isProposalBatch) {
          setStatus({ 
            state: 'error', 
            message: 'An error occurred while processing. Check logs for details.' 
          });
      }
    }
  }, [addLog, handleInventoryItem, projectName, models.bulkModel, proposalFile, inventoryItems, processedFiles, status.state]);

  const handleProposalSelect = useCallback((files: File[]) => {
      if (files.length === 0) return;
      const file = files[0];
      setProposalFile(file);
      addLog({ message: `Proposal staged: ${file.name}. Ready for Dataroom upload.`, type: 'info' });
  }, [addLog]);

  const handleReset = () => {
    setStatus({ state: 'idle' });
    setLogs([]);
    setInventoryItems([]);
    setProcessedFiles([]);
    setProjectDescription("");
    setProposalFile(null);
    setProposalText("");
    setStep(1);
  };

  const handleDownloadCsv = () => {
    const csvContent = generateInventoryCSV(inventoryItems);
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName}_Inventory.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (step === 2) {
      return (
          <ReportGenerationView 
              inventory={inventoryItems}
              processedFiles={processedFiles}
              projectName={projectName}
              onBack={() => setStep(1)}
              models={models}
              onModelChange={setModels}
              proposalText={proposalText} // Pass extracted text
              proposalFileName={proposalFile?.name || ""}
          />
      );
  }

  // Determine if Dataroom dropzone should be enabled
  // Enabled as soon as a proposal file is selected
  const isProposalReady = !!proposalFile;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="bg-indigo-600 p-2 rounded-lg text-white shadow-lg shadow-indigo-200">
              <FolderArchive size={20} />
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-slate-800 to-slate-600">
              Partner - Renewable Energy - IE Analysis & Report Generator
            </h1>
          </div>

          <div className="flex items-center gap-4">
              <ModelSelector selection={models} onModelChange={setModels} />
              
              {status.state === 'success' && (
                  <button 
                    onClick={() => setStep(2)}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold shadow-md transition-all"
                  >
                      Generate IE Report <ArrowRight size={16}/>
                  </button>
              )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-10 flex flex-col gap-8">
        
        {/* Intro / Dropzone */}
        {status.state === 'idle' && (
          <div className="flex flex-col items-center justify-center flex-1 animate-in fade-in duration-500 space-y-8 w-full max-w-5xl mx-auto">
             <div className="text-center max-w-2xl">
              <h2 className="text-4xl font-extrabold text-slate-900 mb-6 tracking-tight">
                Dataroom Analysis
              </h2>
              <p className="text-lg text-slate-500 leading-relaxed mb-4">
                Begin by uploading the project proposal, then the full dataroom.
              </p>
            </div>

            {/* Project Name Input */}
            <div className="w-full max-w-md">
                <label className="block text-sm font-bold text-slate-700 mb-2">Project Name (Required)</label>
                <input 
                    type="text" 
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="e.g. CMC Farms"
                    className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 shadow-sm transition-all text-lg"
                />
            </div>

            {/* Grid Layout for Dropzones */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
                
                {/* Proposal Dropzone */}
                <div className={`border-2 border-dashed rounded-xl p-6 transition-all h-full flex flex-col ${isProposalReady ? 'border-green-400 bg-green-50' : 'border-indigo-200 bg-indigo-50/50'}`}>
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-slate-700 text-sm">1. Upload Proposal (Required)</h3>
                        {isProposalReady && <span className="text-xs bg-green-200 text-green-800 px-2 py-1 rounded-full flex items-center gap-1"><FileCheck size={12}/> Ready</span>}
                    </div>
                    
                    <div className="flex-1 flex flex-col justify-center">
                        {proposalFile ? (
                            <div className="text-sm text-slate-600 flex flex-col items-center justify-center gap-2 p-4 bg-white/50 rounded-lg border border-green-200">
                                <FileText size={24} className="text-indigo-600"/>
                                <span className="font-medium truncate max-w-[200px]" title={proposalFile.name}>{proposalFile.name}</span>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); setProposalFile(null); }}
                                    className="text-xs text-red-500 hover:text-red-700 underline mt-1"
                                >
                                    Change File
                                </button>
                            </div>
                        ) : (
                            <DropZone onFilesSelect={handleProposalSelect} isProcessing={false} variant="compact" />
                        )}
                    </div>
                </div>

                {/* Dataroom Dropzone */}
                <div className={`border-2 border-dashed rounded-xl p-6 transition-all h-full flex flex-col duration-300 ${!isProposalReady ? 'opacity-50 pointer-events-none grayscale border-slate-200 bg-slate-50' : 'border-indigo-200 bg-white hover:border-indigo-300'}`}>
                     <h3 className="font-bold text-slate-700 mb-4 text-sm">2. Upload Dataroom (Required)</h3>
                     <div className="flex-1 flex flex-col justify-center">
                        <DropZone onFilesSelect={(f) => handleFileSelect(f, false)} isProcessing={false} variant="compact" />
                     </div>
                     <div className="flex flex-wrap gap-2 justify-center text-[10px] font-medium text-slate-400 mt-4">
                         <span className="bg-slate-100 px-2 py-1 rounded border border-slate-200">Max 2GB Total</span>
                         <span className="bg-slate-100 px-2 py-1 rounded border border-slate-200">Auto-Splitting {'>'} 50MB</span>
                    </div>
                </div>

            </div>

          </div>
        )}

        {/* Processing View */}
        {(status.state === 'processing' || status.state === 'success' || status.state === 'error') && (
          <div className="flex flex-col gap-8 h-full">
            
            {/* Row 1: Status & Actions */}
            <div className="w-full">
              
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                <div className="mb-4 pb-4 border-b border-slate-100">
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Active Project</div>
                    <div className="text-lg font-bold text-slate-900 truncate" title={projectName}>{projectName}</div>
                </div>

                <h2 className="text-lg font-bold text-slate-800 mb-4">Processing Status</h2>
                
                {status.state === 'processing' && (
                  <div className="space-y-4">
                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-indigo-600 transition-all duration-500 ease-out"
                        style={{ width: `${status.progress}%` }}
                      ></div>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="font-semibold text-indigo-600">{status.progress}% Complete</span>
                      <span className="text-slate-400 flex items-center gap-1">
                        <Clock size={14} /> {status.timeRemaining}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-2">
                      Please do not close this tab. Processing large datarooms may take up to 15 minutes.
                    </p>
                  </div>
                )}

                {status.state === 'success' && (
                   <div className="text-center space-y-6 animate-in zoom-in-50 duration-300 max-w-3xl mx-auto">
                      <div className="flex items-center justify-center gap-4">
                        <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center">
                            <FolderArchive size={32} />
                        </div>
                        <div className="text-left">
                            <h3 className="text-xl font-bold text-slate-900">Dataroom Ready</h3>
                            <p className="text-slate-500 text-sm mt-1">Files Processed: {inventoryItems.length}</p>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <button 
                            onClick={handleDownloadCsv}
                            className="w-full flex items-center justify-center gap-2 py-3 bg-white border-2 border-indigo-600 text-indigo-600 hover:bg-indigo-50 rounded-xl font-semibold transition-all"
                          >
                            <Table2 size={18} />
                            Download Inventory CSV
                          </button>

                          <button 
                            onClick={() => setStep(2)}
                            className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold shadow-lg shadow-indigo-200 transition-all"
                          >
                            <FileText size={18} />
                            Go to Step 2: Write Report
                          </button>
                      </div>

                      <div className="py-2 border-t border-b border-slate-100">
                         <DropZone 
                            onFilesSelect={(f) => handleFileSelect(f, false)} 
                            isProcessing={false} 
                            variant="compact" 
                         />
                      </div>

                      <button 
                         onClick={handleReset}
                         className="text-slate-400 hover:text-slate-600 text-sm font-medium flex items-center justify-center gap-1 mx-auto"
                      >
                         <RefreshCcw size={14} /> Process New Project
                      </button>
                   </div>
                )}

                {status.state === 'error' && (
                  <div className="text-center space-y-4">
                    <div className="p-4 bg-red-50 text-red-600 rounded-xl text-sm">
                       {status.message}
                    </div>
                    <button 
                       onClick={handleReset}
                       className="w-full py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800"
                    >
                       Try Again
                    </button>
                  </div>
                )}
              </div>

            </div>

            {/* Row 2: Logs & Live Inventory */}
            <div className="w-full space-y-4">
              
              {/* Tab Switcher */}
              <div className="flex bg-slate-100 p-1 rounded-lg w-fit">
                <button
                  onClick={() => setActiveTab('inventory')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    activeTab === 'inventory' 
                      ? 'bg-white text-slate-900 shadow-sm' 
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Table2 size={16} /> Live Inventory
                </button>
                <button
                  onClick={() => setActiveTab('logs')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    activeTab === 'logs' 
                      ? 'bg-white text-slate-900 shadow-sm' 
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <TerminalSquare size={16} /> System Log
                </button>
              </div>

              <div className="h-[650px]">
                {activeTab === 'inventory' ? (
                  <InventoryTable items={inventoryItems} />
                ) : (
                  <SystemLog logs={logs} />
                )}
              </div>
              
              <div className="text-center text-xs text-slate-400 italic">
                * Final item IDs will be re-assigned sequentially (1, 2, 3...) after sorting by filename in the exported CSV.
              </div>

            </div>
            
            {/* Row 3: Project Executive Summary (Appears on Success) */}
            {status.state === 'success' && projectDescription && (
              <div className="w-full mt-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="bg-white rounded-2xl shadow-lg border border-indigo-100 overflow-hidden">
                  <div className="bg-indigo-600 px-6 py-4 flex items-center justify-between">
                    <h3 className="text-white font-bold text-lg flex items-center gap-2">
                      <Building2 size={20} className="text-indigo-200" />
                      Project Executive Summary
                    </h3>
                    <span className="text-indigo-200 text-xs font-mono uppercase tracking-widest border border-indigo-400/50 rounded-full px-2 py-0.5">
                        AI Generated ({models.bulkModel})
                    </span>
                  </div>
                  <div className="p-8">
                     <div className="prose prose-slate max-w-none text-slate-700 leading-relaxed whitespace-pre-line">
                         {projectDescription}
                     </div>
                     <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4 border-t border-slate-100 pt-6">
                         <div className="flex flex-col gap-1">
                             <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Project Name</span>
                             <span className="font-semibold text-slate-900">{projectName}</span>
                         </div>
                         <div className="flex flex-col gap-1">
                             <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Generated</span>
                             <span className="font-semibold text-slate-900">{new Date().toLocaleDateString()}</span>
                         </div>
                         <div className="flex flex-col gap-1">
                             <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Files</span>
                             <span className="font-semibold text-slate-900">{inventoryItems.length}</span>
                         </div>
                     </div>
                  </div>
                </div>
              </div>
            )}

          </div>
        )}

      </main>

      <footer className="bg-white border-t border-slate-200 py-6 mt-auto">
        <div className="max-w-7xl mx-auto px-4 text-center text-slate-400 text-sm">
          <p>© {new Date().getFullYear()} Partner Engineering and Science, Inc.</p>
        </div>
      </footer>
    </div>
  );
}
