import { METRIC_LABEL } from "./domain";
import type { InspectionRecord, ThresholdVersion } from "./types";

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * 导出摘要：每行都带「记录版本」和「阈值版本」，
 * 历史记录按其提交时锁定的阈值版本快照展示判定。
 */
export function exportSummary(
  records: InspectionRecord[],
  versions: ThresholdVersion[]
): void {
  const header = [
    "记录ID",
    "记录版本",
    "房间编号",
    "洁净等级",
    "0.5μm粒子数(粒/m³)",
    "5.0μm粒子数(粒/m³)",
    "温度(℃)",
    "湿度(%RH)",
    "压差(Pa)",
    "设备状态",
    "综合判定",
    "阈值版本",
    "阈值生效时间",
    "判定口径",
    "记录状态",
    "提交人",
    "提交时间",
    "最后修改人",
    "最后修改时间",
    "复核人",
    "复核备注",
    "处理备注",
  ];

  const versionMap = new Map(versions.map((v) => [v.id, v]));
  const statusText = {
    pending_review: "待复核",
    approved: "复核通过(已锁定)",
    rejected: "已驳回",
  } as const;

  const lines = records.map((r) => {
    const version = versionMap.get(r.thresholdVersionId);
    return [
      r.id,
      `v${r.revision}`,
      r.room,
      r.grade,
      r.metrics.particle05,
      r.metrics.particle5,
      r.metrics.temperature,
      r.metrics.humidity,
      r.metrics.pressure,
      r.equipment,
      r.overall === "abnormal" ? "异常" : r.overall === "watch" ? "关注" : "正常",
      r.thresholdVersionLabel,
      version ? new Date(version.effectiveFrom).toLocaleString("zh-CN") : "未知",
      "等于上限/下限即判异常；90%边缘带判关注",
      statusText[r.status],
      r.submittedBy,
      new Date(r.submittedAt).toLocaleString("zh-CN"),
      r.updatedBy ?? "",
      r.updatedAt ? new Date(r.updatedAt).toLocaleString("zh-CN") : "",
      r.review?.by ?? "",
      r.review?.comment ?? "",
      r.note,
    ]
      .map(csvCell)
      .join(",");
  });

  // 文件头注释，说明口径
  const banner = [
    `# 洁净室巡检摘要 导出时间=${new Date().toLocaleString("zh-CN")}`,
    `# 判定口径：各测量值等于上限/下限即判异常；阈值边缘10%为关注；设备故障直接判异常`,
    `# 版本规则：每条记录按提交时当班阈值版本锁定判定，新阈值发布不影响历史记录；记录版本为乐观锁版本号`,
  ].join("\n");

  const csv =
    "﻿" + banner + "\n" + header.map(csvCell).join(",") + "\n" + lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `洁净室巡检摘要_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function recordMetricLine(r: InspectionRecord): string {
  return (["particle05", "particle5", "temperature", "humidity", "pressure"] as const)
    .map((k) => `${METRIC_LABEL[k]}=${r.metrics[k] === "" ? "-" : r.metrics[k]}`)
    .join("，");
}
