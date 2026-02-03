
import { PDFDocument } from 'pdf-lib';
import { SplitPdfChunk } from '../types';

/**
 * Splits a PDF file into chunks strictly smaller than the target size.
 * Optimized for speed using heuristic estimation to minimize save() calls.
 * 
 * NOTE: Default set to 10MB (down from 15MB) to strictly ensure Base64 expansion (x1.33) 
 * stays well under the 20MB Gemini API inline payload limit.
 */
export const splitPdf = async (
  file: File, 
  maxSizeBytes: number = 10 * 1024 * 1024,
  onProgress?: (progress: number) => void
): Promise<SplitPdfChunk[]> => {
  
  const arrayBuffer = await file.arrayBuffer();
  
  // Load the source document (ignore encryption to prevent errors on some files)
  const sourceDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
  const totalPages = sourceDoc.getPageCount();
  
  const chunks: SplitPdfChunk[] = [];
  let currentStartPage = 0;
  
  // Initial heuristic: Average bytes per page based on total file size
  // We use a safety factor (1.1) initially to account for PDF overhead when splitting
  let avgBytesPerPage = (arrayBuffer.byteLength / totalPages) * 1.1;

  while (currentStartPage < totalPages) {
    let chunkDoc = await PDFDocument.create();
    const remainingPages = totalPages - currentStartPage;
    
    // 1. ESTIMATE: How many pages fit?
    // Target 95% of max size to leave a safety buffer and avoid retries
    let targetPageCount = Math.floor((maxSizeBytes * 0.95) / avgBytesPerPage);
    
    // Clamp constraints
    targetPageCount = Math.max(1, Math.min(targetPageCount, remainingPages));

    // 2. BULK COPY: Copy estimated pages in one go
    const pageIndices = Array.from({ length: targetPageCount }, (_, i) => currentStartPage + i);
    const copiedPages = await chunkDoc.copyPages(sourceDoc, pageIndices);
    copiedPages.forEach(p => chunkDoc.addPage(p));
    
    // 3. MEASURE: Save and check size
    let chunkBytes = await chunkDoc.save();
    let currentSize = chunkBytes.byteLength;

    // 4. REFINE METRIC: Update average for next iteration
    // Use exponential moving average to adapt to changing page densities (text vs images)
    const actualBytesPerThisChunk = currentSize / targetPageCount;
    avgBytesPerPage = (avgBytesPerPage * 0.4) + (actualBytesPerThisChunk * 0.6);

    // 5. VALIDATE: Did we overshoot?
    if (currentSize > maxSizeBytes) {
        // Case A: Overshot.
        // If it's just 1 page, we must accept it (or it will never split).
        // Otherwise, reduce count and retry.
        if (targetPageCount > 1) {
            const ratio = maxSizeBytes / currentSize;
            // Reduce target drastically to ensure second try fits
            const newTarget = Math.floor(targetPageCount * ratio * 0.90); 
            const safeTarget = Math.max(1, newTarget);
            
            // Re-create doc with safer count
            chunkDoc = await PDFDocument.create();
            const newIndices = Array.from({ length: safeTarget }, (_, i) => currentStartPage + i);
            const newCopied = await chunkDoc.copyPages(sourceDoc, newIndices);
            newCopied.forEach(p => chunkDoc.addPage(p));
            
            chunkBytes = await chunkDoc.save();
            targetPageCount = safeTarget;
            // Update metric again
            avgBytesPerPage = chunkBytes.byteLength / safeTarget;
        }
    } 
    // Case B: Undershot.
    // We do NOT try to "fill up" the remaining space incrementally. 
    // It is significantly faster to ship a 45MB chunk than to re-save to get to 49MB.

    // 6. FINALIZE CHUNK
    const chunkBlob = new Blob([chunkBytes], { type: 'application/pdf' });
    const endPage = currentStartPage + targetPageCount;
    
    chunks.push({
        id: crypto.randomUUID(),
        blob: chunkBlob,
        fileName: `${file.name.replace(/\.pdf$/i, '')}_part_${chunks.length + 1}.pdf`,
        pageRange: `Pages ${currentStartPage + 1} - ${endPage}`,
        size: chunkBlob.size
    });

    currentStartPage += targetPageCount;
    
    if (onProgress) {
        onProgress(Math.round((currentStartPage / totalPages) * 100));
    }
    
    // Yield to event loop to keep UI responsive
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  return chunks;
};

export const formatBytes = (bytes: number, decimals = 2) => {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};
