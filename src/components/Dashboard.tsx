import { useMemo } from "react";
import { VERDICT_TEXT } from "../domain";
import type { InspectionRecord } from "../types";

export default function Dashboard({ records }: { records: InspectionRecord[] }) {
  const stats = useMemo(() => {
    const abnormal = records.filter((r) => r.overall === "abnormal").length;
    const watch = records.filter((r) => r.overall === "watch").length;
    const pending = records.filter((r) => r.status === "pending_review").length;
    const rejected = records.filter((r) => r.status === "rejected").length;
    const locked = records.filter((r) => r.status === "approved").length;
    // 按记录锁定的阈值版本分组，直观体现历史版本保留
    const byVersion = new Map<string, number>();
    records.forEach((r) =>
      byVersion.set(r.thresholdVersionLabel, (byVersion.get(r.thresholdVersionLabel) ?? 0) + 1)
    );
    return { abnormal, watch, pending, rejected, locked, byVersion };
  }, [records]);

  const cards = [
    { label: "粒子/压差异常（按各自阈值版本判定）", value: stats.abnormal, tone: "danger" },
    { label: "关注（边缘带 / 维保）", value: stats.watch, tone: "watch" },
    { label: "待厂务复核", value: stats.pending, tone: "accent" },
    { label: "已复核锁定", value: stats.locked, tone: "ok" },
  ];

  return (
    <section className="metrics-grid">
      {cards.map((c) => (
        <article key={c.label} className={`metric-card tone-${c.tone}`}>
          <span>{c.label}</span>
          <strong>{c.value}</strong>
          <i className={`status-bar bar-${c.tone}`} />
        </article>
      ))}
      <article className="metric-card metric-wide">
        <span>判定分布（含驳回 {stats.rejected}）</span>
        <div className="dist-bar">
          <b style={{ flexGrow: stats.abnormal }} className="seg-abnormal">
            {stats.abnormal > 0 && `异常 ${stats.abnormal}`}
          </b>
          <b style={{ flexGrow: stats.watch }} className="seg-watch">
            {stats.watch > 0 && `关注 ${stats.watch}`}
          </b>
          <b
            style={{ flexGrow: Math.max(records.length - stats.abnormal - stats.watch, 0) }}
            className="seg-normal"
          >
            {records.length - stats.abnormal - stats.watch > 0 &&
              `正常 ${records.length - stats.abnormal - stats.watch}`}
          </b>
        </div>
        <small>
          阈值版本分布：
          {[...stats.byVersion.entries()].map(([label, n]) => `${label} × ${n}`).join("　")}
          {stats.byVersion.size === 0 && "暂无记录"}
        </small>
        {records.some((r) => r.overall === "abnormal") && (
          <small className="rule-note">判定口径：{VERDICT_TEXT.abnormal} = 测量值 ≥ 上限 / ≤ 下限，或设备故障</small>
        )}
      </article>
    </section>
  );
}
