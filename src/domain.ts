import type {
  Grade,
  GradeThreshold,
  InspectionInput,
  MetricKey,
  MetricResult,
  PersistShape,
  ThresholdVersion,
  Verdict,
} from "./types";

export const METRICS: {
  key: MetricKey;
  label: string;
  unit: string;
  /** 区间型指标在 90% 阈值宽度时给“关注”预警；粒子上限在 90% 时预警 */
  range?: boolean;
}[] = [
  { key: "particle05", label: "0.5μm 粒子数", unit: "粒/m³" },
  { key: "particle5", label: "5.0μm 粒子数", unit: "粒/m³" },
  { key: "temperature", label: "温度", unit: "℃", range: true },
  { key: "humidity", label: "相对湿度", unit: "%RH", range: true },
  { key: "pressure", label: "压差", unit: "Pa", range: true },
];

export const METRIC_LABEL: Record<MetricKey, string> = {
  particle05: "0.5μm 粒子数",
  particle5: "5.0μm 粒子数",
  temperature: "温度",
  humidity: "相对湿度",
  pressure: "压差",
};

export const VERDICT_TEXT: Record<Verdict, string> = {
  normal: "正常",
  watch: "关注",
  abnormal: "异常",
};

/** 判定规则：等于上限（或下限）即判异常；进入阈值区间 10% 边缘带判关注 */
export function evaluateMetric(
  key: MetricKey,
  value: number,
  t: GradeThreshold
): { result: Verdict; reason: string } {
  const label = METRIC_LABEL[key];
  if (key === "particle05" || key === "particle5") {
    const max = key === "particle05" ? t.particle05Max : t.particle5Max;
    if (value >= max) {
      return {
        result: "abnormal",
        reason: `${label} ${value} ≥ 上限 ${max}（等于上限即异常）`,
      };
    }
    if (value >= max * 0.9) {
      return { result: "watch", reason: `${label} ${value} 接近上限 ${max}` };
    }
    return { result: "normal", reason: `${label} ${value} 低于上限 ${max}` };
  }

  const min =
    key === "temperature"
      ? t.tempMin
      : key === "humidity"
        ? t.humidityMin
        : t.pressureMin;
  const max =
    key === "temperature"
      ? t.tempMax
      : key === "humidity"
        ? t.humidityMax
        : t.pressureMax;

  if (value >= max) {
    return {
      result: "abnormal",
      reason: `${label} ${value} ≥ 上限 ${max}（等于上限即异常）`,
    };
  }
  if (value <= min) {
    return {
      result: "abnormal",
      reason: `${label} ${value} ≤ 下限 ${min}（等于下限即异常）`,
    };
  }
  const band = (max - min) * 0.1;
  if (value >= max - band) {
    return { result: "watch", reason: `${label} ${value} 接近上限 ${max}` };
  }
  if (value <= min + band) {
    return { result: "watch", reason: `${label} ${value} 接近下限 ${min}` };
  }
  return { result: "normal", reason: `${label} ${value} 位于 [${min}, ${max}] 内` };
}

export function evaluateAll(
  input: InspectionInput,
  threshold: GradeThreshold,
  equipment: string
): { overall: Verdict; results: MetricResult[] } {
  const results: MetricResult[] = METRICS.map(({ key }) => {
    const raw = input.metrics[key];
    if (raw === "" || raw === null || raw === undefined || Number.isNaN(raw)) {
      return { key, value: null, result: "normal", reason: `${METRIC_LABEL[key]} 未填写` };
    }
    const v = Number(raw);
    const { result, reason } = evaluateMetric(key, v, threshold);
    return { key, value: v, result, reason };
  });

  let overall: Verdict = "normal";
  for (const r of results) {
    if (r.result === "abnormal") overall = "abnormal";
    if (r.result === "watch" && overall !== "abnormal") overall = "watch";
  }
  // 设备故障直接判异常；维保中判关注（与测量值同级，不覆盖已存在的异常）
  if (equipment === "故障") overall = "abnormal";
  if (equipment === "维保" && overall === "normal") overall = "watch";

  return { overall, results };
}

/** 当班版本：effectiveFrom 不晚于“当班时刻”的最新一版 */
export function currentThresholdVersion(
  versions: ThresholdVersion[],
  at: Date = new Date()
): ThresholdVersion {
  const t = at.getTime();
  const eligible = versions
    .filter((v) => new Date(v.effectiveFrom).getTime() <= t)
    .sort(
      (a, b) =>
        new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime()
    );
  if (eligible.length > 0) return eligible[0];
  // 全部版本都还没生效时，回退到最早发布的一版，保证新建时一定有版本可用
  return [...versions].sort(
    (a, b) =>
      new Date(a.effectiveFrom).getTime() - new Date(b.effectiveFrom).getTime()
  )[0];
}

export function findVersion(
  versions: ThresholdVersion[],
  id: string
): ThresholdVersion {
  const v = versions.find((x) => x.id === id);
  if (!v) throw new Error(`阈值版本 ${id} 不存在`);
  return v;
}

export function emptyMetrics(): Record<MetricKey, number | ""> {
  return {
    particle05: "",
    particle5: "",
    temperature: "",
    humidity: "",
    pressure: "",
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function formatTs(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours()
  )}:${p(d.getMinutes())}`;
}

/** datetime-local 用：当前时间向下取整到分钟 */
export function nowLocalInput(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours()
  )}:${p(d.getMinutes())}`;
}

export function nextLabel(versions: ThresholdVersion[]): string {
  const nums = versions
    .map((v) => /v(\d+)\.(\d+)/i.exec(v.label))
    .filter(Boolean)
    .map((m) => (m ? Number(m[1]) * 100 + Number(m[2]) : 0));
  const top = nums.length ? Math.max(...nums) : 0;
  return `v${Math.floor(top / 100) + 1}.0`;
}

// ---------- 种子数据 ----------

const v1: ThresholdVersion = {
  id: "thr-v1",
  label: "v1.0",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  publishedAt: "2025-12-28T03:10:00.000Z",
  publishedBy: "李工",
  note: "投产基线：ISO 14644-1 常规限值",
  values: {
    "ISO 5": {
      particle05Max: 3520,
      particle5Max: 29,
      tempMin: 20,
      tempMax: 24,
      humidityMin: 40,
      humidityMax: 60,
      pressureMin: 10,
      pressureMax: 25,
    },
    "ISO 6": {
      particle05Max: 10200,
      particle5Max: 102,
      tempMin: 19,
      tempMax: 25,
      humidityMin: 35,
      humidityMax: 65,
      pressureMin: 8,
      pressureMax: 25,
    },
    "ISO 7": {
      particle05Max: 29300,
      particle5Max: 293,
      tempMin: 18,
      tempMax: 26,
      humidityMin: 30,
      humidityMax: 70,
      pressureMin: 5,
      pressureMax: 20,
    },
    黄光区: {
      particle05Max: 35200,
      particle5Max: 400,
      tempMin: 20,
      tempMax: 23,
      humidityMin: 42,
      humidityMax: 55,
      pressureMin: 8,
      pressureMax: 20,
    },
  },
};

/** 从 v1 派生 v2：湿度/压差窗口收紧（演示“新版本只影响之后新记录”） */
function deriveV2(): ThresholdVersion {
  const values = JSON.parse(JSON.stringify(v1.values)) as Record<
    Grade,
    GradeThreshold
  >;
  for (const g of Object.keys(values) as Grade[]) {
    values[g].humidityMax -= 5;
    values[g].pressureMax -= 3;
  }
  return {
    id: "thr-v2",
    label: "v2.0",
    effectiveFrom: "2026-07-01T00:00:00.000Z",
    publishedAt: "2026-06-25T08:30:00.000Z",
    publishedBy: "李工",
    note: "夏季湿度管控收紧，压差窗口下调 3Pa（只影响生效后的新记录）",
    values,
  };
}

function seedRecord(
  seq: number,
  parts: {
    room: string;
    grade: Grade;
    version: ThresholdVersion;
    metrics: Record<MetricKey, number>;
    equipment: "正常" | "维保" | "故障";
    note: string;
    createdBy: string;
    createdAt: string;
    status: "pending_review" | "approved" | "rejected";
    reviewBy?: string;
  }
): import("./types").InspectionRecord {
  const input: InspectionInput = {
    room: parts.room,
    grade: parts.grade,
    metrics: { ...parts.metrics },
    equipment: parts.equipment,
    note: parts.note,
    thresholdVersionId: parts.version.id,
  };
  const { overall, results } = evaluateAll(
    input,
    parts.version.values[parts.grade],
    parts.equipment
  );
  const rec: import("./types").InspectionRecord = {
    id: `INS-2026-${String(seq).padStart(3, "0")}`,
    revision: parts.status === "approved" ? 2 : 1,
    room: parts.room,
    grade: parts.grade,
    metrics: input.metrics,
    equipment: parts.equipment,
    note: parts.note,
    overall,
    results,
    thresholdVersionId: parts.version.id,
    thresholdVersionLabel: parts.version.label,
    thresholdSnapshot: parts.version.values[parts.grade],
    evaluatedAt: parts.createdAt,
    status: parts.status,
    createdBy: parts.createdBy,
    createdAt: parts.createdAt,
    submittedBy: parts.createdBy,
    submittedAt: parts.createdAt,
  };
  if (parts.status === "approved") {
    rec.review = {
      result: "approved",
      by: parts.reviewBy ?? "李工",
      at: parts.createdAt,
      comment: "复核通过",
    };
  }
  if (parts.status === "rejected") {
    rec.review = {
      result: "rejected",
      by: parts.reviewBy ?? "李工",
      at: parts.createdAt,
      comment: "请复测后重新提交",
    };
  }
  return rec;
}

const v2 = deriveV2();

export function seedData(): PersistShape {
  const m = (
    p05: number,
    p5: number,
    temp: number,
    hum: number,
    pres: number
  ): Record<MetricKey, number> => ({
    particle05: p05,
    particle5: p5,
    temperature: temp,
    humidity: hum,
    pressure: pres,
  });

  const records: import("./types").InspectionRecord[] = [
    seedRecord(1, {
      room: "CR-1201",
      grade: "ISO 5",
      version: v1,
      metrics: m(3800, 12, 22.4, 51, 18),
      equipment: "正常",
      note: "0.5μm 粒子超 v1 上限，已通知厂务",
      createdBy: "王巡检",
      createdAt: "2026-06-18T02:40:00.000Z",
      status: "approved",
    }),
    seedRecord(2, {
      room: "CR-2107",
      grade: "ISO 6",
      version: v2,
      metrics: m(6100, 44, 22.1, 58, 15),
      equipment: "正常",
      note: "湿度 58% 接近 v2 上限 60%，其余正常",
      createdBy: "王巡检",
      createdAt: "2026-09-20T09:15:00.000Z",
      status: "approved",
    }),
    seedRecord(3, {
      room: "Y-0302",
      grade: "黄光区",
      version: v2,
      metrics: m(12000, 90, 21.6, 50, 12),
      equipment: "维保",
      note: "FFU 维保中",
      createdBy: "赵巡检",
      createdAt: "2026-09-28T01:05:00.000Z",
      status: "pending_review",
    }),
    seedRecord(4, {
      room: "CR-3305",
      grade: "ISO 7",
      version: v2,
      metrics: m(29300, 120, 24.0, 46, 17),
      equipment: "正常",
      // 29300 恰好等于 v2 上限：演示“等于上限判异常”
      note: "0.5μm 粒子数恰好等于上限",
      createdBy: "赵巡检",
      createdAt: "2026-09-29T03:20:00.000Z",
      status: "pending_review",
    }),
  ];

  const drafts: import("./types").Draft[] = [
    {
      id: "draft-seed-1",
      kind: "new",
      data: {
        room: "CR-0908",
        grade: "ISO 5",
        metrics: { ...emptyMetrics(), temperature: 21.8, particle05: 1400 },
        equipment: "正常",
        note: "中途关闭页面留下的未完成草稿",
        thresholdVersionId: v2.id,
      },
      savedAt: "2026-09-29T05:00:00.000Z",
    },
  ];

  const audit: import("./types").AuditEvent[] = [
    {
      id: "aud-1",
      ts: "2025-12-28T03:10:00.000Z",
      actor: "李工",
      action: "阈值发布",
      target: "阈值版本 v1.0",
      detail: "发布投产基线版本，2026-01-01 起当班生效",
      thresholdVersion: "v1.0",
    },
    {
      id: "aud-2",
      ts: "2026-06-25T08:30:00.000Z",
      actor: "李工",
      action: "阈值发布",
      target: "阈值版本 v2.0",
      detail: "夏季湿度/压差收紧，2026-07-01 起当班生效",
      thresholdVersion: "v2.0",
    },
    {
      id: "aud-3",
      ts: "2026-06-18T03:00:00.000Z",
      actor: "李工",
      action: "复核通过",
      target: "INS-2026-001",
      detail: "复核通过，记录锁定",
      recordVersion: 2,
      thresholdVersion: "v1.0",
    },
    {
      id: "aud-4",
      ts: "2026-09-20T09:40:00.000Z",
      actor: "李工",
      action: "复核通过",
      target: "INS-2026-002",
      detail: "复核通过，记录锁定",
      recordVersion: 2,
      thresholdVersion: "v2.0",
    },
    {
      id: "aud-5",
      ts: "2026-09-29T03:20:00.000Z",
      actor: "赵巡检",
      action: "提交巡检",
      target: "INS-2026-004",
      detail: "提交记录（粒子等于上限判异常），等待复核",
      recordVersion: 1,
      thresholdVersion: "v2.0",
    },
  ];

  return { seq: 4, thresholdVersions: [v1, v2], records, drafts, audit };
}
