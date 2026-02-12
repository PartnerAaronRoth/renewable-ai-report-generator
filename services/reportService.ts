
import * as XLSX from 'xlsx';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, TableOfContents, ShadingType, VerticalAlign, Footer, PageNumber, AlignmentType, NumberFormat, Header, ImageRun, HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom, HeightRule, VerticalPositionAlign, UnderlineType, TableLayoutType } from 'docx';
import { DataEntryRow, ReportSection, ReportSubsection, ReportLevel, ProjectStage, ExecutiveSummaryData, InventoryItem } from '../types';

let originalHeaders: string[] = []; 

// A simple Blue Header Bar as Base64 fallback 
const FALLBACK_HEADER_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFklEQVR42mNkYPhfz0AEYBxVyCksAAAW7AQPC9xwdAAAAABJRU5ErkJggg==";

// Color Constants
const THEME_BLUE = "1F4E78";
const TEXT_BLACK = "000000";

const getPartnerHeaderImg = async (): Promise<ArrayBuffer> => {
    try {
        const response = await fetch(`data:image/png;base64,${FALLBACK_HEADER_BASE64}`);
        return await response.arrayBuffer();
    } catch (error) {
        return new ArrayBuffer(0);
    }
};

export const parseDataEntryCSV = async (
  file: File, 
  config: { stage: ProjectStage, level: ReportLevel }
): Promise<ReportSection[]> => {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  
  const jsonWithHeaders = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as string[][];
  if (jsonWithHeaders.length > 0) {
      originalHeaders = jsonWithHeaders[0];
  }

  const rawData: any[] = XLSX.utils.sheet_to_json(firstSheet);
  const sectionsMap = new Map<string, ReportSection>();

  const getVal = (row: any, keys: string[]) => {
      const rowKeys = Object.keys(row);
      for (const k of keys) {
          if (row[k] !== undefined) return row[k];
          const foundKey = rowKeys.find(rk => rk.toLowerCase().trim() === k.toLowerCase().trim());
          if (foundKey && row[foundKey] !== undefined) return row[foundKey];
      }
      return undefined;
  };

  rawData.forEach((row, index) => {
    const sectionName = getVal(row, ['Section', 'Document Category']);
    const subName = getVal(row, ['Subsection', 'Document Type']);
    
    if (!sectionName || !subName) return;

    const rawLevel = getVal(row, ['DD Level', 'Level']);
    const rowLevel = rawLevel !== undefined ? parseInt(String(rawLevel)) : 1;

    const rawStage = getVal(row, ['Stage', 'Project Stage']);
    const rowStage = rawStage !== undefined ? parseInt(String(rawStage)) : 1;
    
    let includeTable = false;
    const tableFlag = getVal(row, ['Subsection Table', 'Table', 'Table?', 'Include Table', 'Add Table', 'Is Table']);
    if (tableFlag && String(tableFlag).toUpperCase().includes('X')) {
        includeTable = true;
    }

    const rawSecNum = getVal(row, ['Section #', 'Order', 'Section No']);
    if (!includeTable && rawSecNum && String(rawSecNum).toUpperCase().includes('X')) {
        includeTable = true;
    }
    
    const sectionNum = parseFloat(String(rawSecNum).replace(/[^0-9.]/g, '')) || 999;

    const rowData: DataEntryRow = {
      rowId: `row-${index}`,
      Section: sectionName,
      Subsection: subName,
      Item: getVal(row, ['Item', 'Item #']) || `Item ${index}`,
      ItemDesc: getVal(row, ['Item', 'Description', 'Explanation']) || '',
      ItemClarification: getVal(row, ['Item Clarification']) || '',
      DDLevel: rowLevel,
      ProjectStage: rowStage,
      IncludeTable: includeTable,
      Entry: '',
      EntryID: '',
      Risk: '',
      Comments: '',
      ImpliedExplicit: '',
      _raw: row 
    };

    if (!sectionsMap.has(sectionName)) {
      sectionsMap.set(sectionName, {
        id: `sec-${sectionName.replace(/\s/g,'')}`,
        title: sectionName,
        order: sectionNum,
        subsections: [],
        isSelected: false,
        hasConclusion: true
      });
    }

    const section = sectionsMap.get(sectionName)!;
    let subsection = section.subsections.find(s => s.title === subName);

    if (!subsection) {
      subsection = {
        id: `subsec-${sectionName}-${subName}`.replace(/\s/g,''),
        title: subName,
        rows: [],
        isSelected: false,
        includeTable: includeTable, 
        isAnalyzing: false,
        isComplete: false
      };
      section.subsections.push(subsection);
    } else {
        if (includeTable) subsection.includeTable = true;
    }

    subsection.rows.push(rowData);
  });

  const sections = Array.from(sectionsMap.values()).sort((a, b) => a.order - b.order);
  return sections;
};

const parseContentToDocx = (content: string, tableCounter: { current: number }): any[] => {
    const children: any[] = [];
    const cleanContent = content.replace(/\*\*/g, "").replace(/#/g, "").replace(/^Scope:.*$/m, "").trim();
    const lines = cleanContent.split('\n');
    let tableBuffer: string[] = [];
    let inTable = false;

    const flushTable = () => {
        if (tableBuffer.length > 0) {
            const rows = tableBuffer.filter(line => !line.match(/^\|?\s*:?-+:?\s*\|/)); 
            if (rows.length === 0) return;

            const tableRows = rows.map((rowStr, rowIndex) => {
                const cells = rowStr.split('|').map(c => c.trim()).filter((c, i, arr) => {
                        if (i === 0 && c === '') return false;
                        if (i === arr.length - 1 && c === '') return false;
                        return true;
                    });
                const isHeader = rowIndex === 0;
                return new TableRow({
                    children: cells.map(cellText => new TableCell({
                        children: [new Paragraph({
                            children: [new TextRun({ text: cellText, bold: isHeader, color: isHeader ? "FFFFFF" : undefined })],
                            alignment: isHeader ? AlignmentType.CENTER : AlignmentType.LEFT
                        })],
                        width: { size: 100 / cells.length, type: WidthType.PERCENTAGE },
                        shading: isHeader ? { fill: THEME_BLUE, type: ShadingType.CLEAR, color: "auto" } : undefined,
                        verticalAlign: VerticalAlign.CENTER,
                    }))
                });
            });

            children.push(new Table({
                rows: tableRows,
                width: { size: 100, type: WidthType.PERCENTAGE },
                alignment: AlignmentType.CENTER,
            }));
            children.push(new Paragraph({ text: "", spacing: { after: 200 } })); 
            tableBuffer = [];
        }
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('|') || (line.includes('|') && line.split('|').length > 2)) {
            inTable = true;
            tableBuffer.push(line);
        } else {
            if (inTable) { inTable = false; flushTable(); }
            const captionMatch = line.match(/^Table\s*(?:[0-9]+|[xX])[:.]\s*(.*)$/i);
            if (captionMatch) {
                children.push(new Paragraph({ text: `Table ${tableCounter.current}. ${captionMatch[1]}`, style: "Caption", alignment: AlignmentType.CENTER, spacing: { before: 240, after: 120 } }));
                tableCounter.current++;
                continue;
            }
            if (line.length > 0) {
                if (line.startsWith('- ') || line.startsWith('* ')) {
                    // CHANGED: Replaced bullet points with manual hyphens and hanging indent
                    children.push(new Paragraph({ 
                        children: [
                            new TextRun({ text: "- " + line.replace(/^[\-\*] /, '').trim() })
                        ],
                        indent: { left: 720, hanging: 360 } // Creates clean list visual with hyphen
                    }));
                } else {
                    // Check for Risk Headers (Moderate or High)
                    const isRiskHeader = line.includes("Moderate Risks") || line.includes("High Risks");
                    if (isRiskHeader) {
                        // Strip (Level X) and apply underline ONLY (bold removed)
                        const cleanHeader = line.replace(/\(Level \d+\)/, '').trim();
                        children.push(new Paragraph({ 
                            children: [new TextRun({ text: cleanHeader, bold: false, underline: { type: UnderlineType.SINGLE, color: TEXT_BLACK } })],
                            spacing: { after: 120 } 
                        }));
                    } else {
                        children.push(new Paragraph({ text: line, spacing: { after: 120 } }));
                    }
                }
            }
        }
    }
    if (inTable) flushTable();
    return children;
};

export const generateWordReport = async (
    sections: ReportSection[], 
    executiveSummary?: ExecutiveSummaryData,
    inventory?: InventoryItem[],
    customProjectNumber?: string,
    customHeaderImage?: ArrayBuffer, 
    customFooterImage?: ArrayBuffer,
    projectName?: string,
    letterHeaderImage?: ArrayBuffer,
    signatureImage?: ArrayBuffer,
    mainReportFooterImage?: ArrayBuffer,
    allSectionsDataSource?: ReportSection[] 
): Promise<Blob> => {
  const frontMatter: any[] = [];
  const letterPage: any[] = [];
  const mainContent: any[] = [];
  const tableCounter = { current: executiveSummary ? 2 : 1 }; 
  const currentYear = new Date().getFullYear().toString().substring(2);
  const projectNum = customProjectNumber || `${currentYear}-${Math.floor(Math.random() * 900000) + 100000}`;
  const displayProjectName = projectName || "Project Name";

  // --- Dynamic Data Extraction ---
  const sourceSections = allSectionsDataSource || sections;

  const findRowValue = (searchKeys: string[]): string | undefined => {
      for (const sec of sourceSections) {
          for (const sub of sec.subsections) {
              for (const row of sub.rows) {
                  const itemName = row.Item.toLowerCase().trim();
                  const match = searchKeys.some(key => {
                      const k = key.toLowerCase();
                      return itemName === k || itemName.includes(k);
                  });
                  
                  if (match && row.Entry && row.Entry.trim().length > 1 && 
                      !row.Entry.toLowerCase().includes("not provided") && 
                      !row.Entry.toLowerCase().includes("n/a") && 
                      !row.Entry.toLowerCase().includes("found in proposal")) {
                      return row.Entry.trim();
                  }
              }
          }
      }
      return undefined;
  };

  const detectedAddress = findRowValue(['Site Address', 'Project Address', 'Property Address', 'Location']) || "[Project Address]";
  const detectedClient = findRowValue(['Client Company Name', 'Client Name', 'Prepared For', 'Client Company']) || "Client Name";
  const detectedClientPOC = findRowValue(['Client POC Name', 'POC Name', 'Contact Name', 'Client Contact']) || "Client Contact";
  const detectedClientAddress = findRowValue(['Client Company Address', 'Client Address', 'Client Location']) || "[Client Address]";

  // --- Footer Configuration (Standard Pages / Main Content) ---
  const footerTextSize = 16;
  const footerTextColor = "808080";

  const footerTableChildren: TableCell[] = [
      new TableCell({
          children: [
              new Paragraph({ text: "Independent Engineering Review", style: "FooterText", spacing: { after: 0 } }),
              new Paragraph({ text: `Project No. ${projectNum}`, style: "FooterText", spacing: { after: 0 } }),
              new Paragraph({ text: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), style: "FooterText", spacing: { after: 0 } }),
              new Paragraph({ 
                  children: [new TextRun({ text: "Page ", style: "FooterText" }), new TextRun({ children: [PageNumber.CURRENT], style: "FooterText" })], 
                  style: "FooterText", spacing: { after: 0 } 
              }),
          ],
          width: { size: 60, type: WidthType.PERCENTAGE },
          borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
      })
  ];

  if (mainReportFooterImage) {
      footerTableChildren.push(
          new TableCell({
              children: [
                   new Paragraph({
                      alignment: AlignmentType.RIGHT,
                      children: [
                          new ImageRun({
                              data: new Uint8Array(mainReportFooterImage),
                              transformation: { width: 1.77 * 96, height: 0.41 * 96 },
                              type: "png"
                          })
                      ]
                  })
              ],
              width: { size: 40, type: WidthType.PERCENTAGE },
              verticalAlign: VerticalAlign.TOP,
              borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
          })
      );
  }

  const reportFooter = new Footer({
      children: [
          // SPACER PARAGRAPH to separate content from footer border
          new Paragraph({ text: "", spacing: { after: 400 } }),
          new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: { 
                  top: { style: BorderStyle.SINGLE, size: 6, color: THEME_BLUE }, 
                  bottom: { style: BorderStyle.NONE }, 
                  left: { style: BorderStyle.NONE }, 
                  right: { style: BorderStyle.NONE }, 
                  insideVertical: { style: BorderStyle.NONE } 
              },
              rows: [
                  new TableRow({
                      children: footerTableChildren
                  })
              ]
          })
      ]
  });


  // Footer Configuration (First Page - Cover Page Image)
  let docFooterFirst: Footer | undefined;
  if (customFooterImage) {
      docFooterFirst = new Footer({
          children: [
              new Paragraph({
                  children: [
                      new ImageRun({
                          data: new Uint8Array(customFooterImage),
                          transformation: { width: 8.53 * 96, height: 1.49 * 96 },
                          type: "png",
                          floating: {
                              horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: -18288 },
                              verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, align: VerticalPositionAlign.BOTTOM }
                          }
                      })
                  ],
                  spacing: { before: 0, after: 0 },
              })
          ]
      });
  }

  // Footer Configuration (Letter Page)
  const letterFooter = new Footer({
      children: [
          new Paragraph({
              children: [
                  // CHANGED: Added bold: true
                  new TextRun({ text: "(800) 419-4926", size: 16, color: THEME_BLUE, bold: true }),
                  new TextRun({ text: "\twww.PARTNEResi.com", size: 16, color: THEME_BLUE, bold: true })
              ],
              border: { top: { color: THEME_BLUE, space: 6, style: BorderStyle.SINGLE, size: 6 } }, 
              spacing: { before: 120 },
              tabStops: [{ type: "right", position: 9600 }]
          })
      ]
  });

  const headerImgBuffer = customHeaderImage || await getPartnerHeaderImg();
  const docHeader = new Header({
    children: [
        new Paragraph({
            children: [
                new ImageRun({
                    data: new Uint8Array(headerImgBuffer),
                    transformation: { width: 8.55 * 96, height: 1.88 * 96 },
                    type: "png",
                    floating: {
                        horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: -18288 },
                        verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 }
                    }
                })
            ]
        })
    ]
  });

  let letterPageHeader: Header | undefined;
  if (letterHeaderImage) {
      letterPageHeader = new Header({
          children: [
              new Paragraph({
                  children: [
                      new ImageRun({
                          data: new Uint8Array(letterHeaderImage),
                          transformation: { width: 8.55 * 96, height: 1.88 * 96 },
                          type: "png",
                          floating: {
                              horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: -18288 },
                              verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 }
                          }
                      })
                  ]
              })
          ]
      });
  }

  const parseAddr = (addr: string): { line1: string, line2: string } => {
      if (addr.includes(',')) {
          const parts = addr.split(',');
          if (parts.length >= 2) {
              return { line1: parts[0].trim(), line2: parts.slice(1).join(',').trim() };
          }
      }
      return { line1: addr, line2: "" };
  };

  const projAddr = parseAddr(detectedAddress);
  const clientAddr = parseAddr(detectedClientAddress);

  // --- 1. Title Page ---
  const coverTable = new Table({
      width: { size: 9720, type: WidthType.DXA }, 
      borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.SINGLE, size: 6, color: "000000" } },
      rows: [
          new TableRow({
              height: { value: 8510, rule: HeightRule.ATLEAST }, 
              children: [
                  new TableCell({ children: [], width: { size: 4896, type: WidthType.DXA } }),
                  new TableCell({
                      width: { size: 4824, type: WidthType.DXA },
                      margins: { left: 400 }, 
                      children: [
                          new Paragraph({ children: [ new TextRun({ text: "INDEPENDENT ENGINEERING REVIEW", color: THEME_BLUE, bold: true, allCaps: true, font: "Segoe UI", size: 36 }) ], spacing: { before: 0, after: 240 } }),
                          new Paragraph({ children: [ new TextRun({ text: displayProjectName, color: THEME_BLUE, bold: true, font: "Segoe UI", size: 24 }) ], spacing: { after: 60 } }),
                          new Paragraph({ children: [ new TextRun({ text: projAddr.line1, color: TEXT_BLACK, font: "Segoe UI", size: 22 }) ], spacing: { after: 0 } }),
                          new Paragraph({ children: [ new TextRun({ text: projAddr.line2, color: TEXT_BLACK, font: "Segoe UI", size: 22 }) ], spacing: { after: 240 } }),
                          new Paragraph({ children: [ new TextRun({ text: "Report Date", color: THEME_BLUE, bold: true, font: "Segoe UI", size: 22 }) ], spacing: { after: 0 } }),
                          new Paragraph({ children: [ new TextRun({ text: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), color: TEXT_BLACK, font: "Segoe UI", size: 22 }) ], spacing: { after: 240 } }),
                          new Paragraph({ children: [ new TextRun({ text: "Partner Project No.", color: THEME_BLUE, bold: true, font: "Segoe UI", size: 22 }) ], spacing: { after: 0 } }),
                          new Paragraph({ children: [ new TextRun({ text: projectNum, color: TEXT_BLACK, font: "Segoe UI", size: 22 }) ], spacing: { after: 240 } }),
                          new Paragraph({ children: [ new TextRun({ text: "Prepared for:", color: THEME_BLUE, bold: true, font: "Segoe UI", size: 22 }) ], spacing: { after: 0 } }),
                          new Paragraph({ children: [ new TextRun({ text: detectedClient, color: TEXT_BLACK, font: "Segoe UI", size: 22 }) ], spacing: { after: 0 } }),
                          new Paragraph({ children: [ new TextRun({ text: clientAddr.line1, color: TEXT_BLACK, font: "Segoe UI", size: 22 }) ], spacing: { after: 0 } }),
                          new Paragraph({ children: [ new TextRun({ text: clientAddr.line2, color: TEXT_BLACK, font: "Segoe UI", size: 22 }) ], spacing: { after: 0 } }),
                      ]
                  })
              ]
          })
      ]
  });

  // Removed explicit pageBreakBefore to prevent gap between Cover and Letter sections
  frontMatter.push(new Paragraph({ text: "", spacing: { before: 1500 } }), coverTable);

  // --- 1.5 Letter Page ---
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  letterPage.push(
      new Paragraph({ children: [ new TextRun({ text: today, bold: false }) ], spacing: { before: 1440, after: 240 } }),
      new Paragraph({ children: [ new TextRun({ text: detectedClientPOC, bold: false }) ] }),
      new Paragraph({ children: [ new TextRun({ text: detectedClient, bold: false }) ] }),
      new Paragraph({ children: [ new TextRun({ text: clientAddr.line1, bold: false }) ] }),
      new Paragraph({ children: [ new TextRun({ text: clientAddr.line2, bold: false }) ], spacing: { after: 240 } }),
      new Paragraph({ children: [ new TextRun({ text: "Subject:\t", bold: false }), new TextRun({ text: "Independent Engineering Review", bold: false }) ], tabStops: [{ type: "left", position: 1440 }] }),
      new Paragraph({ children: [ new TextRun({ text: "\t", bold: false }), new TextRun({ text: `${displayProjectName} located in ${projAddr.line2.replace(/,.*$/, '')}`, bold: false }) ], tabStops: [{ type: "left", position: 1440 }] }),
      new Paragraph({ children: [ new TextRun({ text: "\t", bold: false }), new TextRun({ text: `Partner Project No. ${projectNum}`, bold: true }) ], tabStops: [{ type: "left", position: 1440 }], spacing: { after: 240 } }),
      new Paragraph({ children: [ new TextRun({ text: `Dear ${detectedClientPOC}:`, bold: false }) ], spacing: { after: 240 } }),
      new Paragraph({ children: [ new TextRun({ text: "Partner Engineering and Science, Inc., ('Partner') has completed the Independent Engineering Review of the ", bold: false }), new TextRun({ text: displayProjectName, bold: false }), new TextRun({ text: " located in ", bold: false }), new TextRun({ text: projAddr.line2.replace(/,.*$/, ''), bold: false }), new TextRun({ text: ". The findings are detailed in the attached report. This report should not be construed as a tacit approval of the documents, or an acceptance of responsibility for the design. Some of the information gathered and reviewed is time sensitive and subject to change.", bold: false }) ], spacing: { after: 240 } }),
      new Paragraph({ text: "This assessment was performed utilizing methods and procedures consistent with good commercial or customary practices designed to conform to acceptable industry standards. The independent conclusions represent Partner’s best professional judgement based upon existing conditions and the information and data available to us during the course of this assignment.", spacing: { after: 240 } }),
      new Paragraph({ children: [ new TextRun({ text: "The investigation was conducted on behalf of and for the exclusive use of ", bold: false }), new TextRun({ text: detectedClient, bold: false }), new TextRun({ text: ", its successors, and assigns ('Client'). This report and findings contained herein will not, in whole or in part, be disseminated or conveyed to any other party, nor used by any other party, in whole or in part, without prior written consent of Partner. However, Partner acknowledges and agrees that the report may be conveyed to and relied upon by Client and the title insurer associated with the financing of the subject property.", bold: false }) ], spacing: { after: 240 } }),
      new Paragraph({ text: "We appreciate the opportunity to provide these services. If you have any questions or we can assist you in any other matter, please feel free to contact me at 267-804-5730.", spacing: { after: 240 } }),
      new Paragraph({ text: "Sincerely,", spacing: { after: 240 } }),
      new Paragraph({ text: "Partner Engineering and Science, Inc.", spacing: { after: 480 } }),
      ...(signatureImage ? [new Paragraph({ children: [ new ImageRun({ data: new Uint8Array(signatureImage), transformation: { width: 150, height: 50 }, type: "png" }) ] })] : []),
      new Paragraph({ text: "C. Gage Kellogg", spacing: { before: 120 } }),
      new Paragraph({ text: "Director, Renewable Energy" })
  );

  // --- 2. Main Content ---
  mainContent.push(
      new Paragraph({ text: "TABLE OF CONTENTS", heading: HeadingLevel.HEADING_1, border: { bottom: { color: THEME_BLUE, space: 6, style: BorderStyle.SINGLE, size: 12 } } }),
      new TableOfContents("Summary", { hyperlink: true, headingStyleRange: "1-5" })
  );

  if (executiveSummary) {
      // Added pageBreakBefore: true
      mainContent.push(new Paragraph({ text: "1.0 EXECUTIVE SUMMARY", heading: HeadingLevel.HEADING_1, border: { bottom: { color: THEME_BLUE, space: 6, style: BorderStyle.SINGLE, size: 12 } }, spacing: { before: 400, after: 200 }, pageBreakBefore: true }));
      mainContent.push(...parseContentToDocx(executiveSummary.narrative, tableCounter));
      mainContent.push(new Paragraph({ text: "", spacing: { after: 300 } }), new Paragraph({ text: "Table 1. Project Risk Summary", alignment: AlignmentType.CENTER, spacing: { before: 0, after: 100 }, style: "Caption" }));
      const tableHeaderRow = new TableRow({ children: ["Section Name", "Summary", "Moderate Risk Items", "High Risk Items"].map(text => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: "FFFFFF" })], alignment: AlignmentType.CENTER })], shading: { fill: THEME_BLUE, type: ShadingType.CLEAR, color: "auto" }, verticalAlign: VerticalAlign.CENTER })) });
      const tableBodyRows = executiveSummary.sectionSummaries.map(summary => new TableRow({ children: [new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: summary.sectionTitle, bold: true })] })] }), new TableCell({ children: [new Paragraph(summary.summary)] }), new TableCell({ children: [new Paragraph({ text: summary.moderateRiskCount.toString(), alignment: AlignmentType.CENTER })] }), new TableCell({ children: [new Paragraph({ text: summary.highRiskCount.toString(), alignment: AlignmentType.CENTER })] })] }));
      mainContent.push(new Table({ rows: [tableHeaderRow, ...tableBodyRows], width: { size: 100, type: WidthType.PERCENTAGE }, alignment: AlignmentType.CENTER }));
  }

  let sectionCounter = executiveSummary ? 2 : 1;
  for (const section of sections) {
    const activeSubsections = section.subsections.filter(s => s.isSelected);
    if (activeSubsections.length === 0) continue;
    mainContent.push(new Paragraph({ text: `${sectionCounter}.0 ${section.title}`.toUpperCase(), heading: HeadingLevel.HEADING_1, border: { bottom: { color: THEME_BLUE, space: 6, style: BorderStyle.SINGLE, size: 12 } }, spacing: { before: 400, after: 200 }, pageBreakBefore: true }));
    let subCounter = 1;
    for (const sub of activeSubsections) {
      mainContent.push(new Paragraph({ text: `${sectionCounter}.${subCounter} ${sub.title}`, heading: HeadingLevel.HEADING_2, spacing: { before: 210, after: 150 } }));
      if (sub.content) { mainContent.push(...parseContentToDocx(sub.content, tableCounter)); } else { mainContent.push(new Paragraph({ children: [new TextRun({ text: "Analysis pending.", italics: true })] })); }
      subCounter++;
    }
    if (section.conclusionContent) {
        mainContent.push(new Paragraph({ text: `${sectionCounter}.${subCounter} Conclusion`, heading: HeadingLevel.HEADING_2, spacing: { before: 210, after: 150 } }));
        mainContent.push(...parseContentToDocx(section.conclusionContent, tableCounter));
    }
    sectionCounter++;
  }

  if (inventory && inventory.length > 0) {
      mainContent.push(new Paragraph({ text: "EXHIBIT A: DOCUMENTATION INVENTORY", heading: HeadingLevel.HEADING_1, border: { bottom: { color: THEME_BLUE, space: 6, style: BorderStyle.SINGLE, size: 12 } }, spacing: { before: 400, after: 200 }, pageBreakBefore: true }), new Paragraph({ text: "", spacing: { after: 200 } }));
      
      // Updated Table Widths: 4%, 31%, 30%, 25%, 10%
      const invHeaderRow = new TableRow({
          children: [
              { text: "ID", width: 4 },
              { text: "Type", width: 31 },
              { text: "Title", width: 30 },
              { text: "File Name", width: 25 },
              { text: "Date", width: 10 }
          ].map(col => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: col.text, bold: true, color: "FFFFFF" })], alignment: AlignmentType.CENTER })], shading: { fill: THEME_BLUE, type: ShadingType.CLEAR, color: "auto" }, verticalAlign: VerticalAlign.CENTER, width: { size: col.width, type: WidthType.PERCENTAGE } }))
      });

      const invRows = inventory.map(item => new TableRow({
          children: [
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: item.id, size: 16 })], alignment: AlignmentType.CENTER })], width: { size: 4, type: WidthType.PERCENTAGE } }),
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: item.sourceTypes.join(', '), size: 16 })] })], width: { size: 31, type: WidthType.PERCENTAGE } }),
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: item.title, size: 16 })] })], width: { size: 30, type: WidthType.PERCENTAGE } }),
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: item.sourceFileName, size: 16 })] })], width: { size: 25, type: WidthType.PERCENTAGE } }),
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: item.date, size: 16 })], alignment: AlignmentType.CENTER })], width: { size: 10, type: WidthType.PERCENTAGE } }),
          ]
      }));
      mainContent.push(new Table({ 
          rows: [invHeaderRow, ...invRows], 
          width: { size: 100, type: WidthType.PERCENTAGE }, 
          alignment: AlignmentType.CENTER,
          layout: TableLayoutType.FIXED // UPDATED: Enforce fixed layout for column widths
      }));
  }

  const doc = new Document({
    sections: [
        {
            properties: { titlePage: true, page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
            headers: { first: docHeader },
            footers: { first: docFooterFirst },
            children: frontMatter
        },
        {
            properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
            headers: { default: letterPageHeader },
            footers: { default: letterFooter },
            children: letterPage
        },
        {
            properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 }, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } } },
            headers: { default: new Header({ children: [] }) }, // Explicitly empty header to prevent leakage from previous section
            footers: { default: reportFooter },
            children: mainContent
        }
    ],
    styles: {
        default: { document: { run: { font: "Segoe UI", size: 20 } } },
        paragraphStyles: [
            { id: "Heading1", name: "Heading 1", run: { font: "Segoe UI", size: 32, bold: true, allCaps: true, color: TEXT_BLACK }, paragraph: { spacing: { after: 120 } } },
            { id: "Heading2", name: "Heading 2", run: { font: "Segoe UI", size: 26, bold: true, color: THEME_BLUE }, paragraph: { spacing: { before: 210, after: 120 } } },
            { id: "Strong", name: "Strong", run: { bold: true } },
            { id: "Caption", name: "Caption", run: { italics: true, color: "666666" }, paragraph: { alignment: AlignmentType.CENTER } },
            { id: "FooterText", name: "FooterText", run: { color: footerTextColor, size: footerTextSize } }
        ]
    }
  });

  return await Packer.toBlob(doc);
};

export const generateConsolidatedCSV = (sections: ReportSection[]): string => {
    const outputRows: any[] = [];
    sections.forEach(sec => {
        sec.subsections.forEach(sub => {
            if (sub.rows) {
                sub.rows.forEach(row => {
                    const combinedRow = { ...row._raw, "Entry": row.Entry, "ID": row.EntryID, "Risk": row.Risk, "Comments from Reviewer": row.Comments, "Implied or Explicit": row.ImpliedExplicit };
                    outputRows.push(combinedRow);
                });
            }
        });
    });
    if (outputRows.length === 0) return "";
    const worksheet = XLSX.utils.json_to_sheet(outputRows);
    return XLSX.utils.sheet_to_csv(worksheet);
};
