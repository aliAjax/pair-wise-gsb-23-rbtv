// 数据模型与持久化：阈值版本 / 巡检记录 / 未提交草稿 / 审计轨迹
// 所有数据存 localStorage，页面关闭后可恢复；多标签页通过 storage 事件同步。

export type CleanClass = "ISO 5" | "ISO 6" | "ISO 7" | "黄光区";
export const CLEAN_CLASSES: CleanClass[] = ["ISO 5", "ISO 6", "ISO 7", "黄光区"];

export type Role = "巡检员" | "厂务工程师" | "班组长";
export const ROLES: Role[] = ["巡检员", "厂务工程师", "班组长"];

export const EQUIPMENT_STATUS = ["正常运行", "待机", "维修中", "停机保养"];

export interface ThresholdSet {
  particleLimit: number; // 0.5µm 粒子上限（个/m³），达到即异常
  tempMin: number;
  tempMax: number;
  humidityMin: number;
  humidityMax: number;
  pressureMin: number;
  pressureMax: number;
}

export interface ThresholdVersion {
  id: string;
  name: string;
  status: "active" | "archived";
  publishedAt: string;
  publishedBy: string;
  note: string;
  limits: Record<CleanClass, ThresholdSet>;
}

export interface JudgmentItem {
  key: "particle" | "temperature" | "humidity" | "pressure";
  label: string;
  value: number;
  limitText: string;
  abnormal: boolean;
  reason: string;
}

export interface RecordValues {
  roomId: string;
  cleanClass: CleanClass;
  particle: number;
  temperature: number;
  humidity: number;
  pressure: number;
  equipmentStatus: string;
  note: string;
}

export interface InspectionRecord extends RecordValues {
  id: string;
  status: "submitted" | "approved"; // approved = 厂务工程师复核通过，之后锁定不可改
  recordVersion: number; // 乐观并发版本号，每次保存 +1
  thresholdVersionId: string;
  thresholdVersionName: string;
  thresholdSnapshot: ThresholdSet; // 提交时的阈值快照，历史记录永远按原版本判定
  judgment: JudgmentItem[];
  abnormal: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

// 草稿数值用字符串保存，避免 NaN 序列化问题，提交时再解析校验
export interface DraftValues {
  roomId: string;
  cleanClass: CleanClass;
  particle: string;
  temperature: string;
  humidity: string;
  pressure: string;
  equipmentStatus: string;
  note: string;
}

export interface Draft {
  key: string; // "new" 或记录 id
  recordId: string | null;
  baseVersion: number; // 草稿基于的记录版本，提交时用于冲突检测
  values: DraftValues;
  savedAt: string;
}

export interface AuditEvent {
  id: string;
  at: string;
  actor: string;
  action: string;
  detail: string;
}

export interface StoreData {
  thresholds: ThresholdVersion[];
  records: InspectionRecord[];
  audit: AuditEvent[];
  nextId: number;
}

export const DATA_KEY = "hxwl09:data:v1";
export const DRAFTS_KEY = "hxwl09:drafts:v1";

export const fmtNum = (n: number) => n.toLocaleString("en-US");
export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("zh-CN", { hour12: false });

// 判定规则：达到/超过上限（含等于上限）或低于下限即判异常
export function judgeValues(
  v: Pick<RecordValues, "particle" | "temperature" | "humidity" | "pressure">,
  t: ThresholdSet
): JudgmentItem[] {
  const items: JudgmentItem[] = [];
  const pBad = v.particle >= t.particleLimit;
  items.push({
    key: "particle",
    label: "0.5µm粒子",
    value: v.particle,
    limitText: `上限 ${fmtNum(t.particleLimit)} 个/m³`,
    abnormal: pBad,
    reason: pBad
      ? `达到/超过上限（${fmtNum(v.particle)} ≥ ${fmtNum(t.particleLimit)}）`
      : "低于上限",
  });
  const range = (
    key: JudgmentItem["key"],
    label: string,
    value: number,
    min: number,
    max: number,
    unit: string
  ): JudgmentItem => {
    const over = value >= max;
    const under = value < min;
    return {
      key,
      label,
      value,
      limitText: `${min}–${max} ${unit}`,
      abnormal: over || under,
      reason: over
        ? `达到/超过上限（${value} ≥ ${max}）`
        : under
          ? `低于下限（${value} < ${min}）`
          : "在区间内",
    };
  };
  items.push(range("temperature", "温度", v.temperature, t.tempMin, t.tempMax, "℃"));
  items.push(range("humidity", "湿度", v.humidity, t.humidityMin, t.humidityMax, "%RH"));
  items.push(range("pressure", "压差", v.pressure, t.pressureMin, t.pressureMax, "Pa"));
  return items;
}

export function parseNumbers(v: DraftValues) {
  const strs = [v.particle, v.temperature, v.humidity, v.pressure];
  if (strs.some((s) => s.trim() === "")) return null;
  const nums = strs.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return { particle: nums[0], temperature: nums[1], humidity: nums[2], pressure: nums[3] };
}

export function parseValues(v: DraftValues): RecordValues | null {
  const nums = parseNumbers(v);
  if (!nums || !v.roomId.trim()) return null;
  return {
    roomId: v.roomId.trim(),
    cleanClass: v.cleanClass,
    ...nums,
    equipmentStatus: v.equipmentStatus,
    note: v.note.trim(),
  };
}

export function blankDraftValues(): DraftValues {
  return {
    roomId: "",
    cleanClass: "ISO 5",
    particle: "",
    temperature: "",
    humidity: "",
    pressure: "",
    equipmentStatus: EQUIPMENT_STATUS[0],
    note: "",
  };
}

export function draftValuesFromRecord(r: InspectionRecord): DraftValues {
  return {
    roomId: r.roomId,
    cleanClass: r.cleanClass,
    particle: String(r.particle),
    temperature: String(r.temperature),
    humidity: String(r.humidity),
    pressure: String(r.pressure),
    equipmentStatus: r.equipmentStatus,
    note: r.note,
  };
}

export function activeThreshold(d: StoreData): ThresholdVersion {
  return d.thresholds.find((t) => t.status === "active") ?? d.thresholds[0];
}

export function suggestThresholdName(activeName: string): string {
  const m = activeName.match(/^(.*-)([A-Z])$/);
  if (m) return m[1] + String.fromCharCode(m[2].charCodeAt(0) + 1);
  const d = new Date();
  return `V${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}-A`;
}

export function pushAudit(d: StoreData, actor: string, action: string, detail: string) {
  d.audit.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    actor,
    action,
    detail,
  });
  if (d.audit.length > 300) d.audit.length = 300;
}

export function loadData(): StoreData {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (raw) return JSON.parse(raw) as StoreData;
  } catch {
    // 数据损坏时重新播种
  }
  const d = seed();
  saveData(d);
  return d;
}

export function saveData(d: StoreData) {
  localStorage.setItem(DATA_KEY, JSON.stringify(d));
}

export function loadDrafts(): Record<string, Draft> {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    if (raw) return JSON.parse(raw) as Record<string, Draft>;
  } catch {
    // ignore
  }
  return {};
}

export function saveDrafts(d: Record<string, Draft>) {
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(d));
}

export function buildCsv(d: StoreData): string {
  const header = [
    "记录编号", "房间编号", "洁净等级", "记录版本", "阈值版本",
    "粒子计数(个/m³)", "温度(℃)", "湿度(%RH)", "压差(Pa)",
    "判定结果", "异常项", "设备状态", "处理备注",
    "记录状态", "创建人", "创建时间", "复核人", "复核时间",
  ];
  const rows = d.records.map((r) => {
    const bad = r.judgment.filter((j) => j.abnormal).map((j) => j.label).join("、");
    return [
      r.id, r.roomId, r.cleanClass, `v${r.recordVersion}`, r.thresholdVersionName,
      String(r.particle), String(r.temperature), String(r.humidity), String(r.pressure),
      r.abnormal ? "异常" : "稳定", bad || "-", r.equipmentStatus, r.note || "-",
      r.status === "approved" ? "已复核锁定" : "待复核",
      r.createdBy, fmtTime(r.createdAt),
      r.reviewedBy ?? "-", r.reviewedAt ? fmtTime(r.reviewedAt) : "-",
    ];
  });
  const esc = (c: string) => `"${c.replace(/"/g, '""')}"`;
  return "﻿" + [header, ...rows].map((row) => row.map(esc).join(",")).join("\r\n");
}

function seed(): StoreData {
  const t1: ThresholdVersion = {
    id: "th-202606",
    name: "V2026.06-A",
    status: "archived",
    publishedAt: "2026-06-30T08:30:00+08:00",
    publishedBy: "厂务工程师",
    note: "初版阈值，按 ISO 14644-1 设定",
    limits: {
      "ISO 5": { particleLimit: 3520, tempMin: 20, tempMax: 24, humidityMin: 45, humidityMax: 60, pressureMin: 10, pressureMax: 15 },
      "ISO 6": { particleLimit: 35200, tempMin: 20, tempMax: 24, humidityMin: 45, humidityMax: 60, pressureMin: 10, pressureMax: 15 },
      "ISO 7": { particleLimit: 352000, tempMin: 18, tempMax: 26, humidityMin: 40, humidityMax: 65, pressureMin: 5, pressureMax: 15 },
      "黄光区": { particleLimit: 35200, tempMin: 21, tempMax: 25, humidityMin: 40, humidityMax: 55, pressureMin: 5, pressureMax: 12 },
    },
  };
  const t2: ThresholdVersion = {
    id: "th-202609",
    name: "V2026.09-B",
    status: "active",
    publishedAt: "2026-09-29T08:00:00+08:00",
    publishedBy: "厂务工程师",
    note: "换季收紧：温湿度区间收窄，压差下限上调",
    limits: {
      "ISO 5": { particleLimit: 3520, tempMin: 21, tempMax: 23, humidityMin: 45, humidityMax: 55, pressureMin: 12, pressureMax: 15 },
      "ISO 6": { particleLimit: 35200, tempMin: 21, tempMax: 23, humidityMin: 45, humidityMax: 55, pressureMin: 12, pressureMax: 15 },
      "ISO 7": { particleLimit: 352000, tempMin: 20, tempMax: 25, humidityMin: 40, humidityMax: 60, pressureMin: 8, pressureMax: 15 },
      "黄光区": { particleLimit: 35200, tempMin: 21, tempMax: 24, humidityMin: 45, humidityMax: 55, pressureMin: 6, pressureMax: 12 },
    },
  };

  const mk = (
    id: string,
    vals: RecordValues,
    th: ThresholdVersion,
    extra: Partial<InspectionRecord> & { createdAt: string }
  ): InspectionRecord => {
    const snapshot = th.limits[vals.cleanClass];
    const judgment = judgeValues(vals, snapshot);
    return {
      id,
      ...vals,
      status: extra.status ?? "submitted",
      recordVersion: extra.recordVersion ?? 1,
      thresholdVersionId: th.id,
      thresholdVersionName: th.name,
      thresholdSnapshot: snapshot,
      judgment,
      abnormal: judgment.some((j) => j.abnormal),
      createdBy: extra.createdBy ?? "巡检员",
      createdAt: extra.createdAt,
      updatedAt: extra.updatedAt ?? extra.createdAt,
      reviewedBy: extra.reviewedBy,
      reviewedAt: extra.reviewedAt,
    };
  };

  const records: InspectionRecord[] = [
    mk(
      "CR-3300",
      { roomId: "CR-3300", cleanClass: "ISO 6", particle: 12000, temperature: 22.8, humidity: 60, pressure: 14, equipmentStatus: "正常运行", note: "湿度达到上限，等于上限判异常" },
      t1,
      { createdAt: "2026-09-28T17:25:00+08:00" }
    ),
    mk(
      "Y-0302",
      { roomId: "Y-0302", cleanClass: "黄光区", particle: 30000, temperature: 23, humidity: 54.5, pressure: 8, equipmentStatus: "正常运行", note: "湿度接近上限" },
      t1,
      { createdAt: "2026-09-28T16:50:00+08:00" }
    ),
    mk(
      "CR-2107",
      { roomId: "CR-2107", cleanClass: "ISO 6", particle: 12000, temperature: 22.8, humidity: 58, pressure: 14, equipmentStatus: "正常运行", note: "压差14Pa，温湿度正常（按当班阈值 V2026.06-A）" },
      t1,
      { createdAt: "2026-09-28T14:40:00+08:00", status: "approved", reviewedBy: "厂务工程师", reviewedAt: "2026-09-28T15:10:00+08:00" }
    ),
    mk(
      "CR-1201",
      { roomId: "CR-1201", cleanClass: "ISO 5", particle: 4200, temperature: 22.5, humidity: 50, pressure: 13, equipmentStatus: "维修中", note: "0.5µm粒子超限，已通知厂务" },
      t1,
      { createdAt: "2026-09-27T09:12:00+08:00", updatedAt: "2026-09-27T09:40:00+08:00", recordVersion: 2, status: "approved", reviewedBy: "厂务工程师", reviewedAt: "2026-09-27T10:05:00+08:00" }
    ),
  ];

  const audit: AuditEvent[] = [
    { id: "a8", at: "2026-09-29T08:00:00+08:00", actor: "厂务工程师", action: "发布阈值", detail: "发布 V2026.09-B，原 V2026.06-A 归档；仅影响之后新建的记录" },
    { id: "a7", at: "2026-09-28T17:25:00+08:00", actor: "巡检员", action: "新建记录", detail: "CR-3300 按阈值 V2026.06-A 判定：异常" },
    { id: "a6", at: "2026-09-28T16:50:00+08:00", actor: "巡检员", action: "新建记录", detail: "Y-0302 按阈值 V2026.06-A 判定：稳定" },
    { id: "a5", at: "2026-09-28T15:10:00+08:00", actor: "厂务工程师", action: "复核通过", detail: "CR-2107 复核通过并锁定（记录 v1，阈值 V2026.06-A）" },
    { id: "a4", at: "2026-09-28T14:40:00+08:00", actor: "巡检员", action: "新建记录", detail: "CR-2107 按阈值 V2026.06-A 判定：稳定" },
    { id: "a3", at: "2026-09-27T10:05:00+08:00", actor: "厂务工程师", action: "复核通过", detail: "CR-1201 复核通过并锁定（记录 v2，阈值 V2026.06-A）" },
    { id: "a2", at: "2026-09-27T09:40:00+08:00", actor: "巡检员", action: "更新记录", detail: "CR-1201 更新为 v2（仍按阈值 V2026.06-A 判定）" },
    { id: "a1", at: "2026-09-27T09:12:00+08:00", actor: "巡检员", action: "新建记录", detail: "CR-1201 按阈值 V2026.06-A 判定：异常" },
    { id: "a0", at: "2026-06-30T08:30:00+08:00", actor: "厂务工程师", action: "发布阈值", detail: "发布 V2026.06-A" },
  ];

  return { thresholds: [t2, t1], records, audit, nextId: 3301 };
}
