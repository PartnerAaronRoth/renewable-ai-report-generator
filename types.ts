
export interface SplitPdfChunk {
  id: string;
  blob: Blob;
  fileName: string;
  pageRange: string;
  size: number;
}

export interface ProcessingStatus {
  state: 'idle' | 'processing' | 'success' | 'error';
  message?: string;
  progress?: number;
  timeRemaining?: string;
}

export enum AnalysisStatus {
  IDLE = 'IDLE',
  ANALYZING = 'ANALYZING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export interface ChunkAnalysis {
  chunkId: string;
  summary: string;
  status: AnalysisStatus;
}

export interface LogMessage {
  id: string;
  timestamp: Date;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

export interface InventoryItem {
  id: string;
  sourceFileName: string;
  sourceTypes: string[]; // Changed to array to support multiple classifications
  title: string;
  date: string;
  pageCount: number;
  tokenCount: number;
  summary: string;
}

export interface RequestFormItem {
  category: string;
  documentType: string;
  explanation: string;
  inventoryIds: string[];
  reviewerComments: string;
}

export interface ProcessedFile {
  fileName: string;
  blob: Blob;
}

export enum ProjectStage {
  EarlyStage = 1,
  LateStage = 2,
  PreConstruction = 3,
  Construction = 4,
  TaxEquity = 5,
  Operational = 6
}

export enum ReportLevel {
  Lite = 1,
  Standard = 2,
  Pro = 3
}

export interface DataEntryRow {
  rowId: string;
  Section: string;
  Subsection: string;
  Item: string;
  ItemDesc: string;
  ItemClarification: string;
  DDLevel: number;
  ProjectStage: number;
  IncludeTable: boolean; // Added for mandatory table generation
  
  Entry: string;
  EntryID: string;
  Risk: string;
  Comments: string;
  ImpliedExplicit: string;
  _raw?: any; 
}

export interface ReportSubsection {
  id: string;
  title: string;
  rows: DataEntryRow[];
  isSelected: boolean;
  content?: string;
  includeTable: boolean;
  tableInstructions?: string;
  isAnalyzing: boolean;
  isComplete: boolean;
}

export interface ReportSection {
  id: string;
  title: string;
  order: number;
  subsections: ReportSubsection[];
  isSelected: boolean;
  hasConclusion: boolean;
  conclusionContent?: string;
}

export interface ProjectConfiguration {
  projectStage: ProjectStage;
  reportLevel: ReportLevel;
  proposalText: string;
}

export interface RefinementRequest {
  subsectionId: string;
  prompt: string;
}

export interface ModelSelection {
  bulkModel: string;
  reasoningModel: string;
}

export interface ExecutiveSummaryData {
  narrative: string;
  sectionSummaries: {
      sectionTitle: string;
      summary: string;
      moderateRiskCount: number;
      highRiskCount: number;
  }[];
}
