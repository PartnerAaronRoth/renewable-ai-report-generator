
import React, { useRef, useState, useCallback } from 'react';
import { UploadCloud, FileArchive, AlertCircle, Zap, Plus, FilePlus, FolderInput, Files } from 'lucide-react';

interface DropZoneProps {
  onFilesSelect: (files: File[]) => void;
  isProcessing: boolean;
  variant?: 'default' | 'compact';
}

export const DropZone: React.FC<DropZoneProps> = ({ onFilesSelect, isProcessing, variant = 'default' }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isProcessing) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  // Recursive function to traverse directories
  const traverseFileTree = async (item: any, path = ''): Promise<File[]> => {
    if (item.isFile) {
      return new Promise((resolve) => {
        item.file((file: File) => {
          // Fix for some browsers losing the path info
          // We can optionally manipulate the name here to include path if needed, 
          // but for now we keep standard behavior
          resolve([file]);
        });
      });
    } else if (item.isDirectory) {
      const dirReader = item.createReader();
      return new Promise((resolve) => {
        const readEntries = async () => {
          let entries: any[] = [];
          
          // readEntries only returns up to 100 entries, so we loop
          const readBatch = (): Promise<any[]> => {
             return new Promise((res) => {
                 dirReader.readEntries((batch: any[]) => {
                     res(batch);
                 });
             });
          };

          let batch = await readBatch();
          while (batch.length > 0) {
              entries = entries.concat(batch);
              batch = await readBatch();
          }
          
          const filePromises = entries.map((entry) => traverseFileTree(entry, path + item.name + "/"));
          const filesArrays = await Promise.all(filePromises);
          resolve(filesArrays.flat());
        };
        readEntries();
      });
    }
    return [];
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (isProcessing) return;

    setError(null);
    const items = e.dataTransfer.items;
    
    if (items && items.length > 0) {
        const promises: Promise<File[]>[] = [];
        
        for (let i = 0; i < items.length; i++) {
            const item = items[i].webkitGetAsEntry();
            if (item) {
                promises.push(traverseFileTree(item));
            } else {
                // Fallback for browsers not supporting webkitGetAsEntry
                const file = items[i].getAsFile();
                if (file) promises.push(Promise.resolve([file]));
            }
        }

        const filesArrays = await Promise.all(promises);
        const flatFiles = filesArrays.flat();
        
        if (flatFiles.length > 0) {
            validateAndPassFiles(flatFiles);
        }
    } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        // Standard file drop fallback
        validateAndPassFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      validateAndPassFiles(Array.from(e.target.files));
    }
  };

  const validateAndPassFiles = (files: File[]) => {
    setError(null);
    
    // Filter out obviously bad files (system files, zero byte files)
    const validFiles = files.filter(f => {
        return !f.name.startsWith('.') && !f.name.startsWith('__MACOSX') && f.size > 0;
    });

    if (validFiles.length === 0) {
      setError('No valid files found.');
      return;
    }

    // Check Total Size Limit (2GB) for the batch
    const totalSize = validFiles.reduce((acc, f) => acc + f.size, 0);
    const maxSize = 2 * 1024 * 1024 * 1024;
    
    if (totalSize > maxSize) {
       setError('Total batch size is too large (Max 2GB).');
       return;
    }

    onFilesSelect(validFiles);
  };

  if (variant === 'compact') {
      return (
        <div 
            className={`
                relative border-2 border-dashed rounded-xl p-6 transition-all duration-200
                ${isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-slate-50 hover:bg-white hover:border-slate-400'}
                ${isProcessing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            `}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => !isProcessing && inputRef.current?.click()}
        >
             <input
                type="file"
                ref={inputRef}
                onChange={handleInputChange}
                className="hidden"
                disabled={isProcessing}
                multiple
            />
            <div className="flex flex-col items-center justify-center text-center gap-2">
                <div className={`p-2 rounded-full ${isDragging ? 'bg-indigo-200 text-indigo-700' : 'bg-white text-slate-500 shadow-sm'}`}>
                    <FilePlus size={20} />
                </div>
                <div>
                    <h4 className="text-sm font-semibold text-slate-700">Add More Documents</h4>
                    <p className="text-xs text-slate-500">Drop files or folders here</p>
                </div>
                {error && (
                    <span className="text-xs text-red-500 font-medium">{error}</span>
                )}
            </div>
        </div>
      );
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div
        className={`relative border-2 border-dashed rounded-2xl p-10 transition-all duration-300 ease-in-out
          ${isDragging 
            ? 'border-blue-500 bg-blue-50/50 scale-[1.02]' 
            : 'border-slate-300 bg-white hover:border-slate-400'
          }
          ${isProcessing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !isProcessing && inputRef.current?.click()}
      >
        <input
          type="file"
          ref={inputRef}
          onChange={handleInputChange}
          className="hidden"
          disabled={isProcessing}
          multiple // Allow multiple files
        />

        <div className="flex flex-col items-center justify-center text-center space-y-4">
          <div className={`p-4 rounded-full ${isDragging ? 'bg-blue-100' : 'bg-slate-100'}`}>
            {isDragging ? (
                <FolderInput className="w-10 h-10 text-blue-600" />
            ) : (
                <Files className="w-10 h-10 text-slate-500" />
            )}
          </div>
          
          <div className="space-y-2">
            <h3 className="text-xl font-semibold text-slate-800">
              {isDragging ? 'Drop Files & Folders Here' : 'Upload Dataroom'}
            </h3>
            <p className="text-slate-500 max-w-xs mx-auto">
              Drag and drop Files, Folders, or Zip archives. We will analyze everything inside.
            </p>
          </div>

          {error && (
            <div className="flex items-center space-x-2 text-red-500 bg-red-50 px-4 py-2 rounded-lg">
              <AlertCircle size={18} />
              <span className="text-sm font-medium">{error}</span>
            </div>
          )}
          
          <div className="pt-4 flex flex-col md:flex-row items-center gap-4 text-xs text-slate-400 font-medium uppercase tracking-wider justify-center">
            <span className="flex items-center gap-1">
              <UploadCloud size={14} /> Supports Nested Folders
            </span>
            <span className="hidden md:inline">•</span>
            <span className="flex items-center gap-1 text-indigo-400">
              <Zap size={14} /> Auto-Extraction
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
