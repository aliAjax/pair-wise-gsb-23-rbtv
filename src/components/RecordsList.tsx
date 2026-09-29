import { useMemo, useState } from "react";
import { METRICS, VERDICT_TEXT, formatTs } from "../domain";
import { reviewRecord, simulateConcurrentSave } from "../store";
import type { Grade, InspectionRecord, RecordStatus } from "../types";

type Role = "巡检员" | "厂务工程师" | "班组长";

interface Props {
  records: InspectionRecord[];
  role: Role;
  actor: string;
  gradeFilter: Grade | "全部";
  statusFilter: RecordStatus | "全部";
  onEdit: (r: InspectionRecord) => void;
}

const STATUS_TEXT: Record<RecordStatus, string> = {
  pending_review: "待复核",
  approved: "已锁定",
  rejected: "已驳回",
};

export default function RecordsList({
  records,
  role,
  actor,
  gradeFilter,
  statusFilter,
  onEdit,
}: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      records.filter(
        (r) =>
          (gradeFilter === "全部" || r.grade === gradeFilter) &&
          (statusFilter === "全部" || r.status === statusFilter)
      ),
    [records, gradeFilter, statusFilter]
  );

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  };

  return (
    <div className="records-wrap">
      {toast && <div className="floating-toast">{toast}</div>}
      <div className="record-table">
        <div className="rt-head rt-row">
          <span>记录ID / 房间</span>
          <span>等级</span>
          <span>判定</span>
          <span>记录版本</span>
          <span>阈值版本</span>
          <span>状态</span>
          <span>提交时间</span>
          <span>操作</span>
        </div>
        {filtered.length === 0 && <p className="empty-hint">没有符合条件的记录</p>}
        {filtered.map((r) => {
          const open = expanded === r.id;
          return (
            <div key={r.id} className={`rt-group status-${r.status}`}>
              <div className="rt-row rt-body" onClick={() => setExpanded(open ? null : r.id)}>
                <span>
                  <b>{r.id}</b>
                  <small>{r.room}</small>
                </span>
                <span>{r.grade}</span>
                <span>
                  <em className={`verdict-tag tag-${r.overall}`}>{VERDICT_TEXT[r.overall]}</em>
                </span>
                <span>
                  <code>v{r.revision}</code>
                  {r.updatedBy && <small>改：{r.updatedBy}</small>}
                </span>
                <span>
                  <code>{r.thresholdVersionLabel}</code>
                </span>
                <span>
                  <em className={`status-pill pill-${r.status}`}>{STATUS_TEXT[r.status]}</em>
                </span>
                <span>
                  <small>{formatTs(r.submittedAt)}</small>
                </span>
                <span onClick={(e) => e.stopPropagation()}>
                  {r.status === "approved" ? (
                    <em className="lock-hint">🔒 锁定</em>
                  ) : (
                    <button className="mini" onClick={() => onEdit(r)}>
                      {r.status === "rejected" ? "修改重提" : "编辑"}
                    </button>
                  )}
                </span>
              </div>

              {open && (
                <div className="rt-detail">
                  <div className="detail-grid">
                    {METRICS.map(({ key, label, unit }) => {
                      const res = r.results.find((x) => x.key === key);
                      return (
                        <div key={key} className={`detail-metric tag-${res?.result ?? "normal"}-bg`}>
                          <span>{label}</span>
                          <strong>
                            {r.metrics[key] === "" ? "—" : String(r.metrics[key])}
                            <i> {unit}</i>
                          </strong>
                          <em className={`tag-${res?.result ?? "normal"}`}>
                            {res ? VERDICT_TEXT[res.result] : ""}
                          </em>
                          <small>{res?.reason}</small>
                        </div>
                      );
                    })}
                  </div>

                  <div className="detail-meta">
                    <p>
                      <b>判定依据：</b>按提交时锁定的阈值版本{" "}
                      <code>{r.thresholdVersionLabel}</code> 快照判定
                      {r.evaluatedAt !== r.submittedAt ? `（最近一次判定 ${formatTs(r.evaluatedAt)}）` : ""}
                      ；即使此后发布新阈值，本记录显示不变。
                    </p>
                    <p>
                      <b>阈值快照（{r.grade}）：</b>
                      0.5μm ≤ {r.thresholdSnapshot.particle05Max}，5.0μm ≤{" "}
                      {r.thresholdSnapshot.particle5Max}，温度{" "}
                      {r.thresholdSnapshot.tempMin}~{r.thresholdSnapshot.tempMax}℃，湿度{" "}
                      {r.thresholdSnapshot.humidityMin}~{r.thresholdSnapshot.humidityMax}%RH，压差{" "}
                      {r.thresholdSnapshot.pressureMin}~{r.thresholdSnapshot.pressureMax}Pa
                    </p>
                    <p>
                      <b>设备：</b>{r.equipment} · <b>提交人：</b>{r.submittedBy}
                      {r.updatedBy && <> · <b>最后修改：</b>{r.updatedBy} @ {formatTs(r.updatedAt!)}</>}
                    </p>
                    {r.note && <p className="detail-note">📝 {r.note}</p>}
                    {r.review && (
                      <p className={`detail-review review-${r.review.result}`}>
                        {r.review.result === "approved" ? "✅" : "↩️"} {r.review.by} 于{" "}
                        {formatTs(r.review.at)} {r.review.result === "approved" ? "复核通过" : "驳回"}
                        ：{r.review.comment}
                      </p>
                    )}
                  </div>

                  {role === "厂务工程师" && r.status !== "approved" && (
                    <div className="review-box" onClick={(e) => e.stopPropagation()}>
                      <input
                        placeholder="复核意见（通过后记录锁定不可再改）"
                        value={reviewDrafts[r.id] ?? ""}
                        onChange={(e) =>
                          setReviewDrafts((m) => ({ ...m, [r.id]: e.target.value }))
                        }
                      />
                      <button
                        onClick={() => {
                          const res = reviewRecord(r.id, "rejected", reviewDrafts[r.id] ?? "", actor);
                          if (res.ok) flash(res.message ?? "已驳回");
                        }}
                      >
                        驳回
                      </button>
                      <button
                        className="primary-action"
                        onClick={() => {
                          const res = reviewRecord(r.id, "approved", reviewDrafts[r.id] ?? "", actor);
                          if (res.ok) flash(res.message ?? "已通过");
                        }}
                      >
                        复核通过并锁定
                      </button>
                    </div>
                  )}

                  <div className="demo-box" onClick={(e) => e.stopPropagation()}>
                    <span>并发演示（模拟另一个页面）：</span>
                    <button
                      disabled={r.status === "approved"}
                      onClick={() => {
                        const res = simulateConcurrentSave(r.id, "另一页面的王巡检");
                        if (res.ok) flash(res.message ?? "已模拟并发保存");
                        else flash(res.message);
                      }}
                      title="在另一个浏览器标签页打开本应用，同时编辑该记录，也会产生真实冲突"
                    >
                      模拟他人先保存 v{r.revision + 1}
                    </button>
                    <small>然后你在编辑器里点保存，就会看到版本冲突且草稿不丢失</small>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
