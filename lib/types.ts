export type BOQDocumentType =
  | "construction_sow"
  | "engineering_spec"
  | "boq_or_cost_document"
  | "questionnaire_or_survey"
  | "product_or_software_spec"
  | "creative_or_unstructured"
  | "unknown";

export type BOQEvidenceType =
  | "quoted_scope"
  | "tabulated_scope"
  | "derived_calculation"
  | "metadata_only"
  | "missing";

export type BOQRateSourceCategory =
  | "embedded_market_heuristic"
  | "workbook_local_pattern"
  | "project_consistency_inference"
  | "external_reference_document"
  | "manual_override"
  | "existing_workbook_rate";

export type BOQPricingCategory =
  | "ditto_reference"
  | "pipe_run"
  | "pipe_fitting"
  | "steel_fabrication"
  | "concrete_structure"
  | "earthworks"
  | "finishes"
  | "doors_windows"
  | "electrical_fixture"
  | "treatment_service"
  | "other";

export type BOQRateSkipReason =
  | "specialist_item_requires_local_precedent"
  | "ditto_without_parent"
  | "ai_outlier_rejected"
  | "no_safe_rate_reference";

export type RequiredAttachmentType = "boq" | "drawing" | "spec" | "schedule" | "unknown";
export type SourceBundleStatus =
  | "complete"
  | "missing_required_attachments"
  | "partial_optional_context";

export interface RequiredAttachment {
  type: RequiredAttachmentType;
  reason: string;
  required: boolean;
}

export interface SourceBundleDocument {
  document_id: string;
  name: string;
  document_type: BOQDocumentType | RequiredAttachmentType | "supporting_context";
  role: "primary" | "supporting";
  pages: number | null;
}

export interface BOQItem {
  item_key?: string;
  item_no: string;
  description: string;
  unit: string;
  qty: number | null;
  rate: number | null;
  amount: number | null;
  quantity_source?: "explicit" | "derived" | "assumed";
  quantity_confidence?: number | null; // 0..1
  source_excerpt?: string | null;
  source_anchor?: string | null;
  source_document?: string | null;
  evidence_type?: BOQEvidenceType | null;
  derivation_note?: string | null;
  is_header?: boolean;
  note?: string; // "Incl", "Rate only", etc.
  rate_source?: BOQRateSourceCategory;
  rate_source_detail?: string | null;
  rate_confidence?: number | null;
  pricing_category?: BOQPricingCategory;
  rate_skip_reason?: BOQRateSkipReason | null;
  workbook_row_kind?:
    | "measured_item"
    | "header"
    | "summary_row"
    | "note_row"
    | "preamble"
    | "bill_header";
  workbook_context?: string | null;
}

export interface BOQBill {
  number: number;
  title: string;
  items: BOQItem[];
}

export interface BOQQualityScore {
  score: number;
  grade: "Strong" | "Good" | "Fair" | "Weak";
  summary: string;
  flags: string[];
  subscores?: {
    coverage: number;
    source_completeness: number;
    field_integrity: number;
    evidence_traceability: number;
    boq_semantics: number;
  };
  source?: "deterministic" | "hybrid";
  updated_at?: string;
}

export interface DocumentClassification {
  isSOW: boolean;
  reason: string;
  confidence: number;
  documentType: BOQDocumentType;
  should_block_generation: boolean;
  required_attachments: RequiredAttachment[];
  source_bundle_status: SourceBundleStatus;
  positive_signals: string[];
  negative_signals: string[];
  flags: string[];
}

export interface BOQDocument {
  project: string;
  location: string;
  prepared_by: string;
  date: string;
  bills: BOQBill[];
  project_type?: string;
  
  pipeline_version?: string;
  document_classification?: DocumentClassification;
  source_bundle?: SourceBundleDocument[];
  quality_summary?: BOQQualitySummary;
  artifacts?: BOQArtifacts;
  qa?: BOQQualityScore;
  rate_reference?: BOQRateReference;
  workbook_preservation?: BOQWorkbookPreservation;
}

export interface BOQRateReferenceAssessment {
  source_name: string;
  source_path?: string;
  relevance: "relevant" | "not_relevant" | "unknown";
  reason: string;
  effective_for: Array<"construction_boq_generation" | "construction_rate_filling" | "other">;
}

export interface BOQRateReference {
  pricing_basis: string;
  currency: string;
  version: string;
  assessed_sources?: BOQRateReferenceAssessment[];
}

export interface BOQComparisonMatchedItem {
  key: string;
  label: string;
  baseline_rate: number;
  candidate_rate: number;
  absolute_delta: number;
  percent_delta: number | null;
  within_10pct: boolean;
  within_20pct: boolean;
}

export interface BOQComparisonReport {
  baseline_label: string;
  candidate_label: string;
  baseline_total_items: number;
  candidate_total_items: number;
  matched_items: number;
  baseline_priced_items: number;
  candidate_priced_items: number;
  comparable_priced_items: number;
  coverage_ratio: number;
  within_10pct_ratio: number;
  within_20pct_ratio: number;
  mean_absolute_percentage_error: number | null;
  mean_rate_delta: number | null;
  median_rate_delta: number | null;
  section_match_ratio: number;
  item_match_ratio: number;
  workbook_fidelity_score: number;
  pricing_accuracy_score: number;
  overall_score: number;
  missing_sections: string[];
  extra_sections: string[];
  missing_item_labels: string[];
  extra_item_labels: string[];
  sample_matches: BOQComparisonMatchedItem[];
}

export interface BOQWorkbookSheetStat {
  sheet_name: string;
  source_row_count: number;
  source_col_count: number;
  mapped_item_rows: number;
  repeated_header_count: number;
  preserved_summary_rows: number;
  rate_column_header?: string | null;
  amount_column_header?: string | null;
  qty_column_header?: string | null;
  ignored_reason?: "no_measurable_items" | "summary_only" | "empty_sheet" | null;
}

export interface BOQWorkbookPreservation {
  sheet_name: string;
  source_row_count: number;
  source_col_count: number;
  mapped_item_rows: number;
  repeated_header_count: number;
  preserved_summary_rows: number;
  ambiguous_item_rows?: number;
  workbook_local_rate_matches?: number;
  ai_priced_rows?: number;
  unresolved_rate_rows?: number;
  outlier_rate_rows?: number;
  rate_column_header?: string | null;
  amount_column_header?: string | null;
  qty_column_header?: string | null;
  workbook_sheet_names?: string[];
  mapped_sheet_names?: string[];
  ignored_sheet_names?: string[];
  total_sheet_count?: number;
  mapped_sheet_count?: number;
  ignored_sheet_count?: number;
  per_sheet_stats?: BOQWorkbookSheetStat[];
}

export interface BOQValidationFlag {
  item_key: string;
  issue:
    | "missing_quantity"
    | "missing_evidence"
    | "invalid_quantity"
    | "invalid_confidence"
    | "weak_source_anchor";
  severity: "info" | "warning";
  code?: string;
  message: string;
}

export interface BOQQualitySummary {
  total_items: number;
  qty_with_evidence: number;
  qty_missing: number;
  low_confidence: number;
  rate_filled?: number;
  rate_missing?: number;
  mapped_rows?: number;
  ambiguous_rows?: number;
  outlier_rows?: number;
  semantic_risk_items?: number;
  evidence_coverage_ratio?: number;
  source_bundle_status?: SourceBundleStatus;
  missing_required_attachments?: number;
}

export interface BOQStructureArtifactItem {
  item_key: string;
  item_no: string;
  description: string;
  unit: string;
  section_context?: string;
  source_excerpt?: string | null;
  is_header?: boolean;
  note?: string;
}

export interface BOQStructureArtifact {
  project: string;
  location: string;
  prepared_by: string;
  date: string;
  bills: Array<{
    number: number;
    title: string;
    items: BOQStructureArtifactItem[];
  }>;
}

export interface BOQQuantityArtifactItem {
  item_key: string;
  qty: number | null;
  unit: string;
  quantity_source?: "explicit" | "derived" | "assumed";
  quantity_confidence?: number | null;
  source_excerpt?: string | null;
  source_anchor?: string | null;
  source_document?: string | null;
  evidence_type?: BOQEvidenceType | null;
  derivation_note?: string | null;
  note?: string;
}

export interface BOQArtifacts {
  structure_v1: BOQStructureArtifact;
  quantities_v1: BOQQuantityArtifactItem[];
  validation_flags: BOQValidationFlag[];
}

export interface ExtractResult {
  text: string;
  pages: number;
}

export interface GenerateResult {
  boq: BOQDocument;
}
