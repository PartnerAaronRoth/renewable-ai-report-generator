
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { splitPdf } from './pdfService';
import { classifyAndAnalyzeDocument, generateProjectSummary } from './geminiService';
import { processExcelFile } from './excelService';
import { LogMessage, InventoryItem, ProcessedFile } from '../types';
import { REQUEST_FORM_TEMPLATE } from '../constants';
import { enableHighPerformanceMode, disableHighPerformanceMode } from './wakeLockService';

const MAX_PDF_SIZE = 50 * 1024 * 1024; // 50MB
const EXTRACTION_CONCURRENCY = 25; // Increased to 25

// Traffic Control Settings
const MAX_HEAVY_REQUESTS = 2;   // Max simultaneous uploads > 5MB
const MAX_LIGHT_REQUESTS = 35;  // Increased to 35 for speed
const HEAVY_THRESHOLD = 5 * 1024 * 1024; // 5MB

/**
 * Shared logic to process a list of files (from a zip or single upload), analyze them, and return results.
 */
const processFilePipeline = async (
    filesToProcess: {name: string, data: () => Promise<ArrayBuffer>, size: number}[],
    projectName: string,
    addLog: (msg: Omit<LogMessage, 'id' | 'timestamp'>) => void,
    onProgress: (percent: number, msg: string) => void,
    onItemAnalyzed: (item: InventoryItem) => void,
    bulkModel: string
): Promise<{ newInventory: InventoryItem[], newFiles: ProcessedFile[] }> => {

    const newInventory: InventoryItem[] = [];
    const newFiles: ProcessedFile[] = [];
    
    // -- Metrics --
    let totalItemsToProcess = filesToProcess.length; // Approximate initial
    let processedCount = 0;
    
    // -- Queues --
    let activeHeavy = 0;
    let activeLight = 0;
    
    interface AnalysisTask {
        size: number;
        execute: () => Promise<void>;
    }
    const analysisQueue: AnalysisTask[] = [];

    // The Traffic Controller
    const pumpAnalysisQueue = () => {
        for (let i = 0; i < analysisQueue.length; i++) {
            const task = analysisQueue[i];
            const isHeavy = task.size > HEAVY_THRESHOLD;

            let canRun = false;
            if (isHeavy) {
                if (activeHeavy < MAX_HEAVY_REQUESTS) canRun = true;
            } else {
                if (activeLight < MAX_LIGHT_REQUESTS) canRun = true;
            }

            if (canRun) {
                analysisQueue.splice(i, 1);
                i--;
                if (isHeavy) activeHeavy++; else activeLight++;

                task.execute().finally(() => {
                    if (isHeavy) activeHeavy--; else activeLight--;
                    processedCount++;
                    updateProgress();
                    pumpAnalysisQueue();
                });
            }
        }
    };

    const queueAnalysisTask = (size: number, execute: () => Promise<void>) => {
        totalItemsToProcess = Math.max(totalItemsToProcess, analysisQueue.length + processedCount + 1); 
        analysisQueue.push({ size, execute });
        pumpAnalysisQueue();
    };

    const updateProgress = () => {
        const percent = Math.min(Math.round((processedCount / totalItemsToProcess) * 100), 99);
        onProgress(percent, `Analyzing ${processedCount}/${totalItemsToProcess} items...`);
    };

    // Analysis Logic
    const performAnalysis = async (fileName: string, blob: Blob, textContent?: string) => {
        newFiles.push({ fileName, blob });

        if (blob.size > MAX_PDF_SIZE && !fileName.endsWith('.pdf') && !textContent) {
            const item: InventoryItem = {
                id: '...', sourceFileName: fileName, sourceTypes: ["Uncategorized (Too Large)"],
                title: fileName, date: "N/A", pageCount: 0, tokenCount: 0, summary: "File too large for analysis."
            };
            newInventory.push(item);
            onItemAnalyzed(item);
            return;
        }

        addLog({ message: `Analyzing ${fileName}...`, type: 'info' });
        try {
            // PASS BULK MODEL & PROJECT NAME
            const analysis = await classifyAndAnalyzeDocument(blob, fileName, projectName, textContent, bulkModel);
            let pages = 0;
            if (fileName.toLowerCase().endsWith('.pdf')) {
                try {
                    const pdfDoc = await PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true });
                    pages = pdfDoc.getPageCount();
                } catch (e) { /* ignore */ }
            } else if (textContent) {
                pages = 1; 
            }

            const item: InventoryItem = {
                id: '...', sourceFileName: fileName, sourceTypes: analysis.documentTypes,
                title: analysis.title, date: analysis.date, pageCount: pages, tokenCount: analysis.tokenCount, summary: analysis.summary
            };
            newInventory.push(item);
            onItemAnalyzed(item);

        } catch (err: any) {
            addLog({ message: `Analysis failed for ${fileName}`, type: 'error' });
            const item: InventoryItem = {
                id: '...', sourceFileName: fileName, sourceTypes: ["Analysis Error"],
                title: fileName, date: "Unknown", pageCount: 0, tokenCount: 0, summary: `Failed: ${err.message}`
            };
            newInventory.push(item);
            onItemAnalyzed(item);
        }
    };

    // Extraction Logic
    const processExtraction = async (name: string, dataProvider: () => Promise<ArrayBuffer>, size: number) => {
        try {
            const contentBuffer = await dataProvider();
            const fileNameLower = name.toLowerCase();

            if (fileNameLower.endsWith('.xlsx') || fileNameLower.endsWith('.xls') || fileNameLower.endsWith('.xlsm')) {
                const excelBlob = new Blob([contentBuffer]);
                let textContent: string | undefined;
                try {
                    textContent = await processExcelFile(excelBlob);
                } catch (e) {
                    addLog({ message: `Excel read error ${name}`, type: 'warning' });
                }
                queueAnalysisTask(size, () => performAnalysis(name, excelBlob, textContent));
            }
            else if (fileNameLower.endsWith('.pdf') && size > MAX_PDF_SIZE) {
                addLog({ message: `Splitting large PDF: ${name}...`, type: 'warning' });
                try {
                    const bigFile = new File([contentBuffer], name, { type: 'application/pdf' });
                    const chunks = await splitPdf(bigFile, MAX_PDF_SIZE);
                    chunks.forEach(chunk => {
                        queueAnalysisTask(chunk.size, () => performAnalysis(chunk.fileName, chunk.blob));
                    });
                } catch (e) {
                    addLog({ message: `Split failed for ${name}. Processing original.`, type: 'error' });
                    queueAnalysisTask(size, () => performAnalysis(name, new Blob([contentBuffer], { type: 'application/pdf' })));
                }
            } else {
                let mime = 'application/octet-stream';
                if (fileNameLower.endsWith('.pdf')) mime = 'application/pdf';
                const blob = new Blob([contentBuffer], { type: mime });
                queueAnalysisTask(size, () => performAnalysis(name, blob));
            }
        } catch (err) {
            addLog({ message: `Extraction failed for ${name}`, type: 'error' });
        }
    };

    // Run Processing
    let activeExtractions = 0;
    const extractionQueue = [...filesToProcess];
    
    const runNextExtraction = async () => {
        if (extractionQueue.length === 0) return;
        const entry = extractionQueue.shift();
        if (!entry) return;
        
        activeExtractions++;
        await processExtraction(entry.name, entry.data, entry.size);
        activeExtractions--;
        runNextExtraction();
    };

    const extractionPromises = [];
    for(let i=0; i<EXTRACTION_CONCURRENCY; i++) {
        extractionPromises.push(runNextExtraction());
    }
    await Promise.all(extractionPromises);

    // Wait for analysis to drain
    while (activeHeavy > 0 || activeLight > 0 || analysisQueue.length > 0) {
        await new Promise(r => setTimeout(r, 500));
    }

    return { newInventory, newFiles };
};


/**
 * Helper to generate summary - simplified (no zip packing)
 */
const finalizeDataroom = async (
    allInventory: InventoryItem[],
    allFiles: ProcessedFile[],
    projectName: string,
    addLog: (msg: Omit<LogMessage, 'id' | 'timestamp'>) => void,
    bulkModel: string
): Promise<{ description: string }> => {
    
    // Sort and Re-ID
    // IMPORTANT: Force Proposal to the top (ID 1)
    allInventory.sort((a, b) => {
        const isProposalA = a.sourceFileName.toLowerCase().includes('proposal') || a.sourceTypes.some(t => t.toLowerCase().includes('proposal'));
        const isProposalB = b.sourceFileName.toLowerCase().includes('proposal') || b.sourceTypes.some(t => t.toLowerCase().includes('proposal'));
        
        if (isProposalA && !isProposalB) return -1;
        if (!isProposalA && isProposalB) return 1;
        return a.sourceFileName.localeCompare(b.sourceFileName);
    });

    allInventory.forEach((item, index) => {
        item.id = (index + 1).toString();
    });

    // Generate Summary
    addLog({ message: "Regenerating Project Executive Summary...", type: 'info' });
    let projectDescription = "Summary generation failed.";
    try {
        // PASS BULK MODEL
        projectDescription = await generateProjectSummary(allInventory, projectName, bulkModel);
    } catch (e) {
        addLog({ message: "Could not generate project summary.", type: 'warning' });
    }

    return { description: projectDescription };
};

/**
 * Normalizes input files (which may contain mixed ZIPs and standard files) into a flat entry list.
 */
const normalizeInputFiles = async (
    files: File[], 
    addLog: (msg: Omit<LogMessage, 'id' | 'timestamp'>) => void
): Promise<{name: string, data: () => Promise<ArrayBuffer>, size: number}[]> => {
    
    let entries: {name: string, data: () => Promise<ArrayBuffer>, size: number}[] = [];

    for (const file of files) {
        if (file.name.toLowerCase().endsWith('.zip')) {
            try {
                addLog({ message: `Expanding Archive: ${file.name}...`, type: 'info' });
                const jszip = new JSZip();
                const loadedZip = await jszip.loadAsync(file);
                
                const zipEntries = (Object.values(loadedZip.files) as JSZip.JSZipObject[])
                    .filter((f) => !f.dir && !f.name.startsWith('__MACOSX'))
                    .map(f => ({
                        name: f.name, // Preserves internal path in zip
                        data: () => f.async('arraybuffer'),
                        size: (f as any)._data ? (f as any)._data.uncompressedSize : 0
                    }));
                
                entries = [...entries, ...zipEntries];
            } catch (e) {
                addLog({ message: `Failed to unzip ${file.name}. Treating as individual file.`, type: 'warning' });
                 entries.push({
                    name: file.name,
                    data: () => file.arrayBuffer(),
                    size: file.size
                });
            }
        } else {
            // Standard File
            entries.push({
                name: file.name, // Or file.webkitRelativePath if available and relevant, but name is safer cross-browser
                data: () => file.arrayBuffer(),
                size: file.size
            });
        }
    }
    return entries;
};

/**
 * Main Entry Point: Process Initial Batch (Files, Folders, or Zips)
 */
export const processDataroom = async (
  files: File[],
  projectName: string,
  addLog: (msg: Omit<LogMessage, 'id' | 'timestamp'>) => void,
  updateProgress: (percent: number, timeRemaining?: string) => void,
  onItemAnalyzed: (item: InventoryItem) => void,
  bulkModel: string
): Promise<{ inventory: InventoryItem[]; description: string; processedFiles: ProcessedFile[] }> => {
  
  await enableHighPerformanceMode();
  addLog({ message: "High Performance Mode active.", type: 'info' });

  try {
    addLog({ message: `Processing ${files.length} input item(s)...`, type: 'info' });
    
    const fileEntries = await normalizeInputFiles(files, addLog);

    addLog({ message: `Found ${fileEntries.length} total files to analyze. Starting Pipeline...`, type: 'info' });

    const { newInventory, newFiles } = await processFilePipeline(
        fileEntries,
        projectName,
        addLog, 
        (pct, msg) => updateProgress(pct, msg), 
        onItemAnalyzed,
        bulkModel
    );

    updateProgress(98, "Finalizing...");
    const { description } = await finalizeDataroom(newInventory, newFiles, projectName, addLog, bulkModel);
    
    updateProgress(100, "Done!");
    addLog({ message: "Processing Complete.", type: 'success' });
    
    return { inventory: newInventory, description, processedFiles: newFiles };
  
  } finally {
      disableHighPerformanceMode();
  }
};

/**
 * Entry Point: Add Files (or Zip or Folder content) to existing Dataroom
 */
export const addFileToDataroom = async (
    files: File[], // Changed to array
    existingInventory: InventoryItem[],
    existingFiles: ProcessedFile[],
    projectName: string,
    addLog: (msg: Omit<LogMessage, 'id' | 'timestamp'>) => void,
    onItemAnalyzed: (item: InventoryItem) => void,
    bulkModel: string,
    onProgress?: (percent: number, msg: string) => void // Added Progress Callback
): Promise<{ inventory: InventoryItem[]; description: string; processedFiles: ProcessedFile[] }> => {

    await enableHighPerformanceMode();
    addLog({ message: `Adding ${files.length} new items...`, type: 'info' });

    try {
        const fileEntries = await normalizeInputFiles(files, addLog);

        const { newInventory, newFiles } = await processFilePipeline(
            fileEntries,
            projectName,
            addLog, 
            onProgress || (() => {}), 
            onItemAnalyzed,
            bulkModel
        );

        const allInventory = [...existingInventory, ...newInventory];
        const allFiles = [...existingFiles, ...newFiles];

        addLog({ message: "Merging and Updating...", type: 'info' });
        const { description } = await finalizeDataroom(allInventory, allFiles, projectName, addLog, bulkModel);

        addLog({ message: "Files Added.", type: 'success' });
        return { inventory: allInventory, description, processedFiles: allFiles };

    } finally {
        disableHighPerformanceMode();
    }
};

export const generateInventoryCSV = (inventory: InventoryItem[]): string => {
  const header = "ID,Source File Name,Source Type,Title of Source,Date of Source,Number of Pages,Tokens,Summary\n";
  const rows = inventory.map(item => {
    const safe = (val: string | number) => {
       const str = String(val ?? "").trim();
       const escaped = str.replace(/"/g, '""');
       const oneline = escaped.replace(/[\r\n]+/g, " ");
       return `"${oneline}"`;
    };

    return [
      safe(item.id),
      safe(item.sourceFileName),
      safe(item.sourceTypes.join('; ')), // Join multiple types
      safe(item.title),
      safe(item.date),
      safe(item.pageCount),
      safe(item.tokenCount),
      safe(item.summary)
    ].join(',');
  });
  return header + rows.join('\n');
};

const generateRequestFormCSV = (inventory: InventoryItem[]): string => {
  const header = "Document Category,Document Type,Explanation,ID from Documentation Inventory,Reviewer Comments\n";
  const rows = REQUEST_FORM_TEMPLATE.map(req => {
    // Check if ANY of the item's types match the requested type
    const matches = inventory.filter(inv => {
        return inv.sourceTypes.some(t => t.toLowerCase().trim() === req.type.toLowerCase().trim());
    });
    
    const ids = matches.map(m => m.id).join('; ');
    let comments = "";

    if (req.type.includes("Other") && matches.length > 0) {
        const titles = matches.map(m => m.title).join("; ");
        comments = `Documents provided: ${titles}`;
    } else {
        comments = matches.length > 0 ? "Document found." : "";
    }

    const safe = (str: string) => `"${str.replace(/"/g, '""')}"`;
    
    return [
      safe(req.category),
      safe(req.type),
      safe(req.explanation),
      safe(ids),
      safe(comments)
    ].join(',');
  });

  return header + rows.join('\n');
};
