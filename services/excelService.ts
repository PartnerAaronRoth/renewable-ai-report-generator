import * as XLSX from 'xlsx';

/**
 * Reads an Excel file (blob) and converts all sheets to a concatenated CSV-like string.
 * This allows the AI to "read" the data without needing to render a visual PDF.
 */
export const processExcelFile = async (blob: Blob): Promise<string> => {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    
    let fullText = "";

    workbook.SheetNames.forEach(sheetName => {
      const sheet = workbook.Sheets[sheetName];
      // Convert sheet to CSV
      const csv = XLSX.utils.sheet_to_csv(sheet);
      
      if (csv && csv.trim().length > 0) {
        fullText += `\n\n--- SHEET: ${sheetName} ---\n`;
        // Limit csv rows to prevent context window explosion if massive
        // Getting first 500 lines is usually enough for classification/summary
        const lines = csv.split('\n');
        if (lines.length > 500) {
            fullText += lines.slice(0, 500).join('\n');
            fullText += `\n... (${lines.length - 500} more rows truncated) ...`;
        } else {
            fullText += csv;
        }
      }
    });

    if (fullText.trim().length === 0) {
        return "This Excel file appears to be empty.";
    }

    return fullText;
  } catch (error) {
    console.error("Excel processing error:", error);
    throw new Error("Failed to parse Excel file. It may be corrupt or password protected.");
  }
};