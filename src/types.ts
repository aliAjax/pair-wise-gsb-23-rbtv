// 领域模型：阈值版本、巡检记录、草稿、审计事件

export type Grade = "ISO 5" | "ISO 6" | "ISO 7" | "黄光区";

export const GRADES: Grade[] = ["ISO 5", "ISO 6", "ISO 7", "黄光区"];

export type MetricKey =
  | "particle05"
  | "particle5"
  | "temperature"
  | "humidity"
  | "pressure";

export type EquipmentStatus = "正常" | "维保" | "故障";
export const EQUIPMENT_STATUSES: EquipmentStatus[] = ["正常", "维保", "故障"];

/** 单个洁净等级的阈值（粒子只有上限，温湿度/压差为区间） */
export interface GradeThreshold {
  particle05Max: number;
  particle5Max: number;
  tempMin: number;
  tempMax: number;
  humidityMin: number;
  humidityMax: number;
  pressureMin: number;
  pressureMax: number;
}

/** 阈值版本：一旦发布不可修改，只追加新版本 */
export interface ThresholdVersion {
  id: string;
  label: string; // v1.0 / v2.0 ...
  effectiveFrom: string; // ISO 时间，当班版本 = effectiveFrom <= now 中最新的一版
  publishedAt: string;
  publishedBy: string;
  note: string;
  values: Record<Grade, GradeThreshold>;
}

export type Verdict = "normal" | "watch" | "abnormal";

export interface MetricResult {
  key: MetricKey;
  value: number | null;
  result: Verdict;
  reason: string;
}

export type RecordStatus = "pending_review" | "approved" | "rejected";

/** 表单中的原始输入（未提交时允许空值） */
export interface InspectionInput {
  room: string;
  grade: Grade;
  metrics: Record<MetricKey, number | "">;
  equipment: EquipmentStatus;
  note: string;
  /** 新建时锁定的当班阈值版本；编辑历史记录时沿用记录原版本 */
  thresholdVersionId: string;
}

export interface ReviewInfo {
  result: "approved" | "rejected";
  by: string;
  at: string;
  comment: string;
}

export interface InspectionRecord {
  id: string;
  revision: number; // 记录版本，每次保存/复核 +1，用于乐观锁
  room: string;
  grade: Grade;
  metrics: Record<MetricKey, number | "">;
  equipment: EquipmentStatus;
  note: string;
  overall: Verdict;
  results: MetricResult[];
  // 判定快照：记录永远带着提交时的阈值版本与数值
  thresholdVersionId: string;
  thresholdVersionLabel: string;
  thresholdSnapshot: GradeThreshold;
  evaluatedAt: string;
  status: RecordStatus;
  createdBy: string;
  createdAt: string;
  submittedBy: string;
  submittedAt: string;
  updatedBy?: string;
  updatedAt?: string;
  review?: ReviewInfo;
}

export type DraftKind = "new" | "edit" | "conflict";

export interface ConflictInfo {
  revision: number;
  by: string;
  at: string;
}

/** 未提交草稿（含被版本冲突拦下时保留的草稿） */
export interface Draft {
  id: string;
  kind: DraftKind;
  recordId?: string;
  baseRevision?: number;
  data: InspectionInput;
  savedAt: string;
  conflict?: ConflictInfo;
}

export interface AuditEvent {
  id: string;
  ts: string;
  actor: string;
  action: string;
  target: string;
  detail: string;
  recordVersion?: number;
  thresholdVersion?: string;
}

export interface PersistShape {
  seq: number;
  thresholdVersions: ThresholdVersion[];
  records: InspectionRecord[];
  drafts: Draft[];
  audit: AuditEvent[];
}
