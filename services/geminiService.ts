
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { SOURCE_TYPE_DEFINITIONS_PROMPT } from "../constants";
import { InventoryItem, DataEntryRow, ProjectStage, ReportLevel, ProcessedFile, LogMessage } from "../types";

// Default models
export const DEFAULT_BULK_MODEL = "gemini-3-flash-preview"; 
export const DEFAULT_REASONING_MODEL = "gemini-2.5-pro";

// Fallback list in case API listing fails
export const KNOWN_MODELS = [
    "gemini-3-flash-preview",
    "gemini-3-pro-preview",
    "gemini-2.5-flash-preview",
    "gemini-2.5-pro",
    "gemini-2.5-pro-preview",
    "gemini-1.5-flash",
    "gemini-1.5-pro",
    "gemini-1.5-flash-8b"
];

const getAiClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key not found in environment");
  }
  return new GoogleGenAI({ apiKey });
};

export const fetchAvailableModels = async (): Promise<string[]> => {
  try {
    const ai = getAiClient();
    const response = await ai.models.list();
    
    const apiModels: string[] = [];
    
    // The response is a Pager<Model>, which is async iterable
    for await (const model of response) {
        if (model.name && model.name.includes('gemini')) {
            apiModels.push(model.name.replace(/^models\//, ''));
        }
    }
        
    if (apiModels.length === 0) return KNOWN_MODELS;
    
    // Merge with known models to ensure we have the basics even if API returns weird subset
    const set = new Set([...apiModels, ...KNOWN_MODELS]);
    return Array.from(set).sort();

  } catch (error) {
    console.warn("Failed to fetch models list from API, using built-in defaults.", error);
    // Return safe list silently so UI doesn't break
    return KNOWN_MODELS;
  }
};

const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

/**
 * Robust JSON repair function to handle LLM output quirks.
 * Fixes trailing commas, missing braces, markdown wrappers.
 */
const repairAndParseJson = (text: string): any => {
    // 1. Strip Markdown
    let clean = text.replace(/```json\s*/g, "").replace(/```\s*$/g, "").replace(/```/g, "").trim();
    
    try {
        // Attempt direct parse
        return JSON.parse(clean);
    } catch (e) {
        // 2. Fix Trailing Commas
        // Replaces ", }" with "}" and ", ]" with "]"
        clean = clean.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
        
        try {
            return JSON.parse(clean);
        } catch (e2) {
            // 3. Last ditch: Extract first valid JSON object block if surrounded by text
            const firstBrace = clean.indexOf('{');
            const lastBrace = clean.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1) {
                const sub = clean.substring(firstBrace, lastBrace + 1);
                try {
                    return JSON.parse(sub);
                } catch (e3) {
                    throw new Error("Response was not valid JSON (Unrepairable)");
                }
            }
            throw new Error("Response was not valid JSON");
        }
    }
};

export const analyzePdfChunk = async (blob: Blob, modelId: string = DEFAULT_BULK_MODEL): Promise<string> => {
  const ai = getAiClient();
  const base64Data = await blobToBase64(blob);

  try {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: {
        parts: [
          { inlineData: { mimeType: "application/pdf", data: base64Data } },
          { text: "Please provide a concise summary of this PDF chunk. Identify the key topics, any important dates, and the general context of the content. Keep it under 150 words." }
        ]
      }
    });

    return response.text || "Summary generation failed.";
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    throw new Error("Failed to analyze PDF chunk. Please try again.");
  }
};

export const extractTextFromPdf = async (blob: Blob, modelId: string = DEFAULT_BULK_MODEL): Promise<string> => {
    // Zero-byte check
    if (!blob || blob.size === 0) {
        console.warn("Skipping text extraction: Empty file.");
        return "";
    }

    const ai = getAiClient();
    const base64Data = await blobToBase64(blob);

    try {
        const response = await ai.models.generateContent({
            model: modelId,
            contents: {
                parts: [
                    { inlineData: { mimeType: "application/pdf", data: base64Data } },
                    { text: "Extract the full text content from this document. Preserve headers and structure where possible." }
                ]
            }
        });
        return response.text || "";
    } catch (e: any) {
        // Gracefully handle "document has no pages" or other invalid argument errors
        if (e.message?.includes("document has no pages") || e.message?.includes("INVALID_ARGUMENT") || e.status === 400) {
            console.warn("PDF Extraction skipped: Document is empty or has no pages.");
            return "";
        }
        console.error("PDF Text Extraction Failed", e);
        return "";
    }
};

export interface AnalysisResult {
  documentTypes: string[]; // Changed to array
  title: string;
  date: string;
  summary: string;
  tokenCount: number;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
    let timeoutId: any;
    const timeoutPromise = new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`Operation timed out after ${ms}ms`));
        }, ms);
    });
    return Promise.race([
        promise.then(res => {
            clearTimeout(timeoutId);
            return res;
        }),
        timeoutPromise
    ]);
};

export const classifyAndAnalyzeDocument = async (blob: Blob, fileName: string, projectName: string, textContent?: string, modelId: string = DEFAULT_BULK_MODEL): Promise<AnalysisResult> => {
  const ai = getAiClient();
  
  let parts: any[] = [];
  if (textContent) {
      parts = [
          { text: `Project Name: ${projectName}\nFilename: ${fileName}\n\nFile Content:\n${textContent}` },
          { text: `${SOURCE_TYPE_DEFINITIONS_PROMPT}\n\nIMPORTANT: Return ONLY raw JSON. No Markdown formatting.` }
      ];
  } else {
      const base64Data = await blobToBase64(blob);
      let mimeType = "application/pdf";
      if (fileName.toLowerCase().endsWith(".png")) mimeType = "image/png";
      else if (fileName.toLowerCase().match(/\.jpe?g$/)) mimeType = "image/jpeg";

      parts = [
          { inlineData: { mimeType: mimeType, data: base64Data } },
          { text: `Project Name: ${projectName}\nFilename: ${fileName}\n\n${SOURCE_TYPE_DEFINITIONS_PROMPT}\n\nIMPORTANT: Return ONLY raw JSON. No Markdown formatting.` }
      ];
  }

  let attempts = 0;
  const maxAttempts = 5; 
  const REQUEST_TIMEOUT = 240000; 

  while (attempts < maxAttempts) {
    try {
      attempts++;
      
      const apiCall = ai.models.generateContent({
        model: modelId,
        contents: { parts },
        config: {
          responseMimeType: "application/json",
        }
      });

      const response = await withTimeout(apiCall, REQUEST_TIMEOUT) as GenerateContentResponse;

      const text = response.text;
      const usage = response.usageMetadata;
      const promptTokens = usage?.promptTokenCount || 0;

      if (!text) throw new Error("Empty response from AI");
      
      const parsed = repairAndParseJson(text);
      
      const summary = parsed.summary?.replace(/[\r\n]+/g, " ").trim();
      
      // Handle array or string logic for backward compatibility
      let docTypes: string[] = [];
      if (Array.isArray(parsed.documentTypes)) {
          docTypes = parsed.documentTypes;
      } else if (parsed.documentType) {
          docTypes = [parsed.documentType];
      } else {
          docTypes = ["Uncategorized"];
      }

      // Cleanup strings
      docTypes = docTypes.map(t => t.replace(/[\r\n]+/g, " ").trim());

      if (!summary || summary.length < 5 || summary.toLowerCase().includes("no summary")) {
           throw new Error("Insufficient summary generated");
      }

      return {
        documentTypes: docTypes,
        title: parsed.title?.replace(/[\r\n]+/g, " ").trim() || fileName,
        date: parsed.date?.replace(/[\r\n]+/g, " ").trim() || "Unknown",
        summary: summary,
        tokenCount: promptTokens
      };

    } catch (error: any) {
      const isRateLimit = error.message?.includes('429') || error.status === 429;
      const isPayloadTooLarge = error.message?.includes('413') || error.status === 413;

      if (isPayloadTooLarge) {
          return {
             documentTypes: ["Uncategorized (Too Large)"],
             title: fileName,
             date: "N/A",
             summary: "Document exceeded API payload limits even after splitting.",
             tokenCount: 0
          };
      }

      const baseDelay = isRateLimit ? 5000 : 3000;
      const waitTime = baseDelay * Math.pow(1.5, attempts);
      
      if (attempts === maxAttempts) throw error;
      await delay(waitTime);
    }
  }

  return {
    documentTypes: ["System Error"],
    title: fileName,
    date: "Unknown",
    summary: "Unexpected execution flow.",
    tokenCount: 0
  };
};

export const generateProjectSummary = async (inventory: InventoryItem[], projectName: string, modelId: string = DEFAULT_BULK_MODEL): Promise<string> => {
    const ai = getAiClient();

    const contextDocs = inventory.filter(i => !i.sourceTypes.some(t => t.includes("Error"))).slice(0, 50);
    const contextText = contextDocs.map(doc => 
        `Title: ${doc.title}\nTypes: ${doc.sourceTypes.join(', ')}\nSummary: ${doc.summary}`
    ).join("\n\n");

    const prompt = `
    You are a Senior Project Engineer. Write a 2-paragraph Executive Summary for "${projectName}".
    Para 1: Project Size, Location, Type.
    Para 2: Projected COD, stakeholders, status.
    Context: ${contextText}
    `;

    try {
        const response = await ai.models.generateContent({
            model: modelId,
            contents: { parts: [{ text: prompt }] }
        });
        return response.text || "Summary failed.";
    } catch (e) {
        return "Summary failed.";
    }
};

const identifyRelevantFiles = async (
    subsectionTitle: string,
    rowItems: string[],
    inventory: InventoryItem[],
    modelId: string = DEFAULT_BULK_MODEL
): Promise<{id: string, relevance: number}[]> => {
    const ai = getAiClient();

    const inventoryList = inventory.map(i => `ID: ${i.id} | Title: ${i.title} | Types: ${i.sourceTypes.join(', ')} | Summary: ${i.summary}`).join('\n');
    
    // Check if this is a design section
    const isDesignSection = subsectionTitle.toLowerCase().includes('design');
    const designInstruction = isDesignSection 
        ? "IMPORTANT: This is a Design section. Prioritize 'Drawings', 'Plans', 'Specifications', 'Single Line Diagrams', and 'Layouts' in your selection." 
        : "";

    const prompt = `
    I need to write an engineering report subsection titled "${subsectionTitle}".
    The specific data points I need to find are: ${rowItems.join(', ')}.
    ${designInstruction}

    Review the document inventory below and select the TOP 5 most relevant documents.
    Rank them by relevance (1 = Most relevant).

    Inventory:
    ${inventoryList}

    Output JSON: { "files": [ { "id": "12", "relevance": 1 }, { "id": "5", "relevance": 2 } ] }
    `;

    try {
        const response = await ai.models.generateContent({
            model: modelId,
            contents: { parts: [{ text: prompt }] },
            config: { responseMimeType: "application/json" }
        });
        const parsed = repairAndParseJson(response.text || "{}");
        return parsed.files || [];
    } catch (e) {
        return [];
    }
};

export const analyzeReportSection = async (
    sectionTitle: string,
    subsectionTitle: string,
    rows: DataEntryRow[],
    inventory: InventoryItem[],
    processedFiles: ProcessedFile[],
    proposalContext: string,
    config: { stage: ProjectStage, level: ReportLevel },
    userPrompt?: string,
    forcedFileIds?: string[],
    logger?: (msg: string, type?: 'info'|'error'|'success') => void,
    modelId: string = DEFAULT_REASONING_MODEL
): Promise<{ filledRows: DataEntryRow[], content: string }> => {
    const ai = getAiClient();

    // -- SPECIAL HANDLING FOR PROPOSAL SECTION --
    const isProposalSection = sectionTitle.toLowerCase().includes('proposal') || sectionTitle.toLowerCase().includes('executed proposal');
    
    let topFiles: {id: string, relevance: number}[] = [];
    let isManualOverride = false;

    if (isProposalSection) {
        // Skip inventory search for Proposal. We use the proposal text context directly.
        topFiles = [];
        if (logger) logger(`Analyzing Proposal using uploaded text context...`, 'info');
    } else if (forcedFileIds && forcedFileIds.length > 0) {
        // Use user-selected files with high relevance
        topFiles = forcedFileIds.map(id => ({ id, relevance: 1 }));
        isManualOverride = true;
        if (logger) logger(`Using ${forcedFileIds.length} manual document references.`, 'info');
    } else {
        const rowDescriptions = rows.map(r => r.ItemDesc || r.Item);
        const relevantFiles = await identifyRelevantFiles(subsectionTitle, rowDescriptions, inventory, DEFAULT_BULK_MODEL);
        topFiles = relevantFiles.sort((a,b) => a.relevance - b.relevance).slice(0, 5); // Max 5 relevant files
    }
    
    // 2. Build Context (Optimized)
    const contextParts: any[] = [];
    
    if (proposalContext) {
        contextParts.push({ text: `EXECUTED PROPOSAL CONTEXT:\n${proposalContext}` });
    }

    // Optimization: 
    // If Manual Override: Attach full blobs for ALL selected files (up to limit of say 5).
    // If Smart Retrieval: Attach 1 full blob (Primary), others as summary.
    let filesAttached = 0;
    const maxAttachments = isManualOverride ? 5 : 1;

    for (const rel of topFiles) {
        const item = inventory.find(i => i.id === rel.id);
        if (!item) continue;
        
        const file = processedFiles.find(f => f.fileName === item.sourceFileName);
        if (file) {
            // Check if we should attach full content
            // Manual: Attach all. Smart: Attach only rank 1.
            const shouldAttachFull = (isManualOverride || rel.relevance === 1) && filesAttached < maxAttachments;

            if (shouldAttachFull && file.fileName.toLowerCase().endsWith('.pdf')) {
                 const base64 = await blobToBase64(file.blob);
                 contextParts.push({ 
                     inlineData: { mimeType: "application/pdf", data: base64 } 
                 });
                 contextParts.push({ text: `[PRIMARY DOC REF ID: ${item.id}] Title: ${item.title}` });
                 filesAttached++;
                 if (logger) logger(`Attached Full Content: ${item.sourceFileName}`, 'info');
            } 
            else {
                 contextParts.push({ text: `[SUPPORTING DOC ID: ${item.id}] Title: ${item.title}\nSummary: ${item.summary}` });
            }
        }
    }

    // Design Specific Context
    const isDesignSection = sectionTitle.toLowerCase().includes('design') || subsectionTitle.toLowerCase().includes('design');
    const designContext = isDesignSection 
        ? "CRITICAL: This section covers Engineering Design. The Engineering Drawings, Plans, and Specifications (e.g. SLDs, Layouts) are the SOURCE OF TRUTH. Prioritize data from these documents over the Proposal or general descriptions. If there is a discrepancy, cite the Drawing/Plan." 
        : "";

    // Table Generation Context
    const tableRows = rows.filter(r => r.IncludeTable);
    const includeTable = tableRows.length > 0;
    const tableInstruction = includeTable 
        ? `
        MANDATORY TABLE REQUIREMENT:
        - The user has requested a table.
        - The 'generatedTable' array MUST ONLY contain the following Items: ${tableRows.map(r => `"${r.Item}"`).join(', ')}.
        - Do NOT include any other items in the table.
        - Populate this table with the 'Item Name' and 'Result' (value found).
        - In the 'reportContent', you MUST insert the text string "{{TABLE_PLACEHOLDER}}" exactly where this table should logically appear in the narrative. Do NOT put it at the very beginning unless it makes sense.
        ` 
        : "No table required for this subsection.";
    
    // Specific instruction for Proposal Section
    // ENHANCED PROMPT: Specifically target metadata that often gets missed in summaries.
    const proposalInstruction = isProposalSection 
        ? `
        CRITICAL: You are analyzing the EXECUTED PROPOSAL document text provided in the context above. 
        Your PRIMARY GOAL is to fill out the Data Entry rows for the Proposal section.
        
        LOOK SPECIFICALLY FOR:
        1. **Partner Project Number**: Often found in the header/footer (e.g., "Project No. 24-123456", "Proposal #", "File Number"). It typically follows the format XX-XXXXXX.
        2. **Partner Project Manager**: Look for the "Prepared by" or "Project Manager" signature block or contact info at the end or beginning.
        3. **Client POC Name**: The person the letter is addressed to ("Dear [Name]").
        4. **Client Company Name**: The entity the proposal is prepared for (e.g., "Prepared for: [Company]").
        5. **Client Company Address**: The address listed for the Client in the header block.
        
        If you find this info in the text, you MUST populate the 'Entry' field for the corresponding Item. 
        Do not say "Not Provided" if the text contains a header like "September 19, 2025... David Kern... Catalyze Holdings...". In that case, "Catalyze Holdings" is the Client.
        `
        : "";
    
    // Stage-based Risk Logic
    const stageName = ProjectStage[config.stage] || "Unknown";
    const stageContext = `
    CRITICAL RISK ASSESSMENT CONTEXT:
    The Project Stage is "${stageName}". You MUST adjust your Risk Assessment (Levels 1, 2, 3) based on this stage.
    Logic Examples:
    - If Stage is "Early Stage Dev" or "Pre-Construction": Missing contracts (O&M, Interconnection) or permits are likely "Moderate Risk (2)" or even "Low Risk (1)" because it is normal for this stage. It is NOT "High Risk (3)".
    - If Stage is "Operational": Missing O&M contracts or final permits is "High Risk (3)".
    - Apply this logic to all findings. Do not over-penalize early stage projects for missing documents that come later.
    `;

    // 3. Construct Prompt
    const prompt = `
    Project Stage: ${config.stage} (${stageName})
    Report Level: ${config.level}
    Section: "${sectionTitle}", Subsection: "${subsectionTitle}".
    User Refinement Instruction (If any): ${userPrompt || "None"}
    ${isManualOverride ? "IMPORTANT: The user has explicitly provided specific documents to use for this analysis. Prioritize information from the attached full documents." : ""}
    ${designContext}
    ${proposalInstruction}
    ${stageContext}

    Context: You are an AI assistant helping to write an Independent Engineering Report.
    
    --- GUIDANCE START ---
    Persona and Expertise:
    - Act as a meticulous and independent engineer named "Partner".
    - Possess deep expertise in all renewable energy-related industries.
    
    STRICT OUTPUT FORMATTING RULES:
    1. NO INTERNAL HEADERS: Do NOT use Markdown headers (e.g., #, ##, ###) inside your 'reportContent'. The application automatically renders the main Section and Subsection titles. Your output must consist ONLY of text paragraphs.
    2. CONTENT STRUCTURE: Use professional, full paragraphs for the narrative.
    3. NO BULLET POINTS: Do NOT use bullet points or numbered lists. Present information in full sentences within paragraphs.
    4. VOICE: Write in the third person as "Partner".
    
    --- GUIDANCE END ---

    TASK 1: FILL DATA ENTRY FORM (JSON)
    For each 'Item':
    1. SEARCH the provided documents/context.
    2. If a specific data point is missing from the provided documents, you MUST use the Google Search tool to find it publicly (e.g. addresses, utility providers, general specs).
    3. ENTRY: Extract exact data. If missing and not found online, type "Not Provided". If N/A, type "N/A".
    4. ID: Output ID numbers (e.g. "1, 4"). If public info/Google Search, type "Public". Use "N/A" if no doc.
    5. RISK: Integer 1, 2, or 3. (Use Stage Context above!)
    6. COMMENTS: Professional commentary following the persona guidance above.
    7. TBD ROWS / MISC ROWS:
       - CAUTION: Do NOT simply repeat findings from previous rows to fill these spots.
       - IF the row is labeled "Misc", "Other", or "TBD":
         - Actively search for relevant risks or findings that did not fit into the specific Item categories above.
         - Do not ignore minor risks if they are relevant to the section.
         - However, DO NOT repeat findings that were already perfectly captured in previous rows.
         - IF NO NEW FINDINGS are found: Set "Entry" to "N/A", "Risk" to "1", and "Comments" to "No additional material risks identified."

    TASK 2: WRITE REPORT NARRATIVE (JSON)
    ${tableInstruction}
    - Adhere strictly to the "STRICT OUTPUT FORMATTING RULES" above.
    - Generate the narrative content for the subsection "${subsectionTitle}".
    - If a table is required, the narrative should analyze the table's contents but NOT repeat every value.

    Input Rows (for data extraction):
    ${JSON.stringify(rows.map(r => ({ Item: r.Item, Desc: r.ItemDesc, Clarification: r.ItemClarification })), null, 2)}

    Output JSON structure:
    {
        "filledRows": [ { "Item": "...", "Entry": "...", "EntryID": "1", "Risk": "1", "Comments": "...", "ImpliedExplicit": "Explicit" } ],
        "generatedTable": [ { "Item Name": "...", "Result": "..." }, { "Item Name": "...", "Result": "..." } ], // ONLY IF table requested
        "reportContent": "..."
    }

    IMPORTANT: Provide your response strictly as a JSON object.
    `;

    contextParts.push({ text: prompt });

    const startTime = Date.now();
    try {
        const response = await ai.models.generateContent({
            model: modelId,
            contents: { parts: contextParts },
            config: {
                // responseMimeType: "application/json", // Removed because it conflicts with tools
                tools: [{ googleSearch: {} }] 
            }
        });

        const usage = response.usageMetadata;
        if (logger) {
            const time = ((Date.now() - startTime) / 1000).toFixed(1);
            logger(`AI Completed in ${time}s. Tokens: ${usage?.totalTokenCount || 0}`, 'success');
        }

        const text = response.text;
        if (!text) throw new Error("Empty AI response");

        const parsed = repairAndParseJson(text);
        
        // Merge results logic
        const filledRows = rows.map(originalRow => {
            const filled = parsed.filledRows?.find((f: any) => f.Item === originalRow.Item) || 
                           (originalRow.Item === 'TBD' ? parsed.filledRows?.find((f:any) => !rows.some(r => r.Item === f.Item)) : null);

            if (filled) {
                return {
                    ...originalRow,
                    Item: filled.Item,
                    Entry: filled.Entry,
                    EntryID: filled.EntryID,
                    Risk: filled.Risk?.toString().replace(/\D/g, '') || "1",
                    Comments: filled.Comments,
                    ImpliedExplicit: filled.ImpliedExplicit
                };
            }
            return originalRow;
        });

        // Assemble Final Content with Table if needed
        let finalContent = parsed.reportContent || "Content generation failed.";
        
        // If the AI returned a table array, construct the markdown
        if (parsed.generatedTable && Array.isArray(parsed.generatedTable) && parsed.generatedTable.length > 0) {
            const tableCaption = `Table X. ${subsectionTitle} Summary`;
            let markdownTable = `\n\n${tableCaption}\n| Item Name | Result |\n|---|---|\n`;
            
            parsed.generatedTable.forEach((row: any) => {
                const name = row["Item Name"] || row.Item || "";
                const val = row["Result"] || row.Entry || "";
                markdownTable += `| ${name} | ${val} |\n`;
            });
            markdownTable += `\n`; // Spacer

            // Inject table at placeholder or append
            if (finalContent.includes("{{TABLE_PLACEHOLDER}}")) {
                finalContent = finalContent.replace("{{TABLE_PLACEHOLDER}}", markdownTable);
            } else {
                finalContent = `${finalContent}\n${markdownTable}`;
            }
        } else {
            // Cleanup placeholder if no table generated
            finalContent = finalContent.replace("{{TABLE_PLACEHOLDER}}", "");
        }

        return {
            filledRows,
            content: finalContent
        };

    } catch (error: any) {
        console.error("Report Analysis Error", error);
        throw error;
    }
};

/**
 * NEW: Re-generates ONLY the narrative content using the provided rows as the source of truth.
 * Skips file search/extraction.
 */
export const regenerateNarrativeFromRows = async (
    subsectionTitle: string,
    rows: DataEntryRow[],
    config: { stage: ProjectStage, level: ReportLevel },
    modelId: string = DEFAULT_REASONING_MODEL
): Promise<string> => {
    const ai = getAiClient();

    // Table Generation Context
    const tableRows = rows.filter(r => r.IncludeTable);
    const includeTable = tableRows.length > 0;
    const tableInstruction = includeTable 
        ? `
        MANDATORY TABLE REQUIREMENT:
        - The user has requested a table.
        - The 'generatedTable' array MUST ONLY contain the following Items: ${tableRows.map(r => `"${r.Item}"`).join(', ')}.
        - Populate this table with the 'Item Name' and 'Result' (values found in the 'Entry' field of the input rows).
        - In the 'reportContent', you MUST insert the text string "{{TABLE_PLACEHOLDER}}" exactly where this table should logically appear in the narrative.
        ` 
        : "No table required.";

    const prompt = `
    You are rewriting the narrative for the report subsection "${subsectionTitle}".
    
    INPUT DATA (SOURCE OF TRUTH):
    The user has manually edited the data entry form below. You MUST use these exact findings to write the report. 
    Do NOT search for new information. Do NOT hallucinate data not present in these rows.
    
    Rows:
    ${JSON.stringify(rows.map(r => ({ Item: r.Item, Finding: r.Entry, RiskLevel: r.Risk, Comments: r.Comments })), null, 2)}

    TASK:
    Write the 'reportContent' narrative based *only* on the input rows above.
    ${tableInstruction}

    STRICT OUTPUT FORMATTING RULES:
    1. NO INTERNAL HEADERS: Do NOT use Markdown headers (e.g., #, ##, ###).
    2. CONTENT STRUCTURE: Use professional, full paragraphs.
    3. NO BULLET POINTS: Do NOT use bullet points.
    4. VOICE: Write in the third person as "Partner".

    Output JSON structure:
    {
        "generatedTable": [ { "Item Name": "...", "Result": "..." } ],
        "reportContent": "..."
    }
    `;

    try {
        const response = await ai.models.generateContent({
            model: modelId,
            contents: { parts: [{ text: prompt }] },
            config: { responseMimeType: "application/json" }
        });

        const text = response.text;
        if (!text) throw new Error("Empty response");

        const parsed = repairAndParseJson(text);
        
        let finalContent = parsed.reportContent || "Content generation failed.";

        // If the AI returned a table array, construct the markdown
        if (parsed.generatedTable && Array.isArray(parsed.generatedTable) && parsed.generatedTable.length > 0) {
            const tableCaption = `Table X. ${subsectionTitle} Summary`;
            let markdownTable = `\n\n${tableCaption}\n| Item Name | Result |\n|---|---|\n`;
            
            parsed.generatedTable.forEach((row: any) => {
                const name = row["Item Name"] || row.Item || "";
                const val = row["Result"] || row.Entry || "";
                markdownTable += `| ${name} | ${val} |\n`;
            });
            markdownTable += `\n`; 

            if (finalContent.includes("{{TABLE_PLACEHOLDER}}")) {
                finalContent = finalContent.replace("{{TABLE_PLACEHOLDER}}", markdownTable);
            } else {
                finalContent = `${finalContent}\n${markdownTable}`;
            }
        } else {
            finalContent = finalContent.replace("{{TABLE_PLACEHOLDER}}", "");
        }

        return finalContent;
    } catch (e) {
        console.error("Regeneration Failed", e);
        return "Failed to regenerate narrative.";
    }
};

export const generateSectionConclusion = async (
    sectionTitle: string,
    subsectionsContent: string,
    highRiskRows: DataEntryRow[],
    modelId: string = DEFAULT_REASONING_MODEL
): Promise<string> => {
    const ai = getAiClient();

    const risksText = highRiskRows.map(r => `- Risk Level ${r.Risk}: ${r.Item}. Finding: ${r.Entry}. Comment: ${r.Comments}`).join('\n');

    const prompt = `
    You are writing the "Conclusion" subsection for Section "${sectionTitle}".
    
    Input:
    Findings: ${subsectionsContent.substring(0, 15000)} ...
    Identified Risks: ${risksText}

    Task:
    1. Write a 1-paragraph summary of findings.
    2. Write the Risks section.

    Requirements:
    - You MUST list EVERY SINGLE Level 2 and Level 3 risk provided in the input "Identified Risks" list above. 
    - Do NOT summarize, group, or omit any risks. 
    - Present them verbatim or slightly polished for grammar.
    - Format them as bullet points under two headers: "**Moderate Risks:**" and "**High Risks:**". 
    - **IMPORTANT:** Do NOT include "(Level 2)" or "(Level 3)" in the headers. Just "Moderate Risks:" and "High Risks:".

    Output Format:
    [Summary Paragraph]

    **Moderate Risks:**
    * [Risk Item]
    * [Risk Item]

    **High Risks:**
    * [Risk Item]
    
    If no risks exist for a category, state "None identified." under the header.
    Do NOT use Markdown Headers (e.g. ##), only bold text for titles.
    `;

    try {
        const response = await ai.models.generateContent({
            model: modelId,
            contents: { parts: [{ text: prompt }] }
        });
        return response.text || "Conclusion generation failed.";
    } catch (e) {
        return "Conclusion generation failed.";
    }
};

export const generateExecutiveSummaryNarrative = async (
    proposalText: string,
    stage: ProjectStage,
    modelId: string = DEFAULT_REASONING_MODEL
): Promise<string> => {
    const ai = getAiClient();
    
    const stageName = ProjectStage[stage] || stage.toString();

    const prompt = `
    Write an "Executive Summary" introduction for an Independent Engineering Report.
    
    1. **Project Description**: Incorporate the following text from the Proposal (summarize it to be concise and professional):
       "${proposalText.substring(0, 3000)}"
    
    2. **Development Stage**: Define the project as currently being in the "${stageName}" stage. Briefly explain what this stage typically entails in the renewable energy industry.

    3. **Risk Definitions**: Define the risk levels used in this report:
       - **Low Risk**: No material impact on project viability. Standard industry practice.
       - **Moderate Risk**: Potential impact on cost/schedule or minor deviation from best practices. Mitigation recommended.
       - **High Risk**: Significant threat to project viability, bankability, or major safety/regulatory compliance issue. Immediate mitigation required.

    STRICT FORMATTING:
    1. NO Conversational filler (e.g. "Here is the report"). Start directly with the content.
    2. NO Markdown Headers (e.g. #, ##). 
    3. Do NOT use headers like "**Project Description**", "**Development Stage**" or "**Risk Definitions**". Write them as standard flowing paragraphs.
    4. The "Risk Assessment Framework" section must not use a header. Just bold the title "**Risk Assessment Framework**" and continue in the paragraph or list below it.
    `;

    try {
         const response = await ai.models.generateContent({
            model: modelId,
            contents: { parts: [{ text: prompt }] }
        });
        return response.text || "";
    } catch (e) {
        return "Executive Summary generation failed.";
    }
};

export const generateSectionSummaryForTable = async (
    sectionTitle: string,
    sectionContent: string,
    modelId: string = DEFAULT_BULK_MODEL
): Promise<string> => {
    const ai = getAiClient();

    const prompt = `
    Read the following engineering report section content:
    "${sectionContent.substring(0, 8000)}"

    Write a summary of this section for a table cell.
    Constraints:
    - Maximum 100 words.
    - Focus on the main findings and associated risks.
    `;

    try {
        const response = await ai.models.generateContent({
           model: modelId,
           contents: { parts: [{ text: prompt }] }
       });
       return response.text || "Summary not available.";
   } catch (e) {
       return "Summary not available.";
   }
};
