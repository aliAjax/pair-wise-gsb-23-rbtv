import { useEffect, useMemo, useRef, useState } from "react";
import {
  METRICS,
  VERDICT_TEXT,
  currentThresholdVersion,
  evaluateAll,
  findVersion,
  formatTs,
} from "../domain";
import {
  EQUIPMENT_STATUSES,
  GRADES,
} from "../types";
import {
  discardDraft,
  saveEdit,
  saveEditDraft,
  saveNewDraft,
  submitNew,
  useStore,
  type ActionResult,
} from "../store";
import type {
  Draft,
  Grade,
  InspectionInput,
  InspectionRecord,
  MetricKey,
} from "../types";

interface EditorProps {
  mode:
    | { kind: "new" }
    | { kind: "edit"; record: InspectionRecord }
    | { kind: "resume"; draft: Draft };
  actor: string;
  onClose: () => void;
}

function recordToInput(r: InspectionRecord): InspectionInput {
  return {
    room: r.room,
    grade: r.grade,
    metrics: { ...r.metrics },
    equipment: r.equipment,
    note: r.note,
    thresholdVersionId: r.thresholdVersionId,
  };
}

export default function InspectionEditor({ mode, actor, onClose }: EditorProps) {
  const versions = useStore((s) => s.thresholdVersions);
  const records = useStore((s) => s.records);

  const [draftId, setDraftId] = useState<string | null>(
    mode.kind === "resume" ? mode.draft.id : mode.kind === "edit" ? null : null
  );
  const [baseRevision, setBaseRevision] = useState<number>(
    mode.kind === "edit" ? mode.record.revision : mode.kind === "resume" ? mode.draft.baseRevision ?? 0 : 0
  );
  const [recordId, setRecordId] = useState<string | undefined>(
    mode.kind === "edit" ? mode.record.id : mode.kind === "resume" ? mode.draft.recordId : undefined
  );

  const initial: InspectionInput = useMemo(() => {
    if (mode.kind === "edit") return recordToInput(mode.record);
    if (mode.kind === "resume") return { ...mode.draft.data, metrics: { ...mode.draft.data.metrics } };
    return {
      room: "",
      grade: "ISO 5",
      metrics: { particle05: "", particle5: "", temperature: "", humidity: "", pressure: "" },
      equipment: "正常",
      note: "",
      thresholdVersionId: currentThresholdVersion(versions).id,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [data, setData] = useState<InspectionInput>(initial);
  const [feedback, setFeedback] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(
    mode.kind === "resume" ? mode.draft.savedAt : null
  );
  const [conflict, setConflict] = useState<Draft["conflict"] | undefined>(
    mode.kind === "resume" ? mode.draft.conflict : undefined
  );
  const [showMerge, setShowMerge] = useState(false);
  const firstRun = useRef(true);

  const isEdit = recordId !== undefined;
  const version = findVersion(versions, data.thresholdVersionId);
  const gradeThreshold = version.values[data.grade];
  const live = useMemo(
    () => evaluateAll(data, gradeThreshold, data.equipment),
    [data, gradeThreshold]
  );

  const serverRecord = useMemo(
    () => (recordId ? records.find((r) => r.id === recordId) : undefined),
    [recordId, records]
  );

  // 锁定态：复核通过的记录只读
  const locked = serverRecord?.status === "approved";

  // 自动保存草稿（输入停顿 500ms）
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const timer = setTimeout(() => {
      if (isEdit && recordId) {
        const res = saveEditDraft(recordId, baseRevision, data);
        if (res.ok && res.draftId) setDraftId(res.draftId);
      } else {
        const res = saveNewDraft(data);
        if (res.ok && res.draftId) setDraftId(res.draftId);
      }
      setSavedAt(new Date().toISOString());
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // 另一页面把记录改成新版本时（复核通过），实时反映锁定状态
  useEffect(() => {
    if (serverRecord && serverRecord.revision !== baseRevision && isEdit) {
      // 由 storage 事件驱动的外部更新：提示但不自动覆盖草稿
      if (!conflict) {
        setConflict({
          revision: serverRecord.revision,
          by: serverRecord.updatedBy ?? serverRecord.submittedBy,
          at: serverRecord.updatedAt ?? serverRecord.submittedAt,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverRecord?.revision]);

  const updateMetric = (key: MetricKey, raw: string) => {
    if (locked) return;
    setData((d) => ({
      ...d,
      metrics: { ...d.metrics, [key]: raw === "" ? "" : Number(raw) },
    }));
  };

  const handleSubmit = () => {
    let res: ActionResult;
    if (isEdit && recordId) {
      res = saveEdit(recordId, baseRevision, data, actor);
      if (res.ok) {
        setFeedback({ type: "ok", text: res.message ?? "已保存" });
        setTimeout(onClose, 900);
        return;
      }
      if (res.code === "conflict") {
        setConflict(res.conflict);
        setFeedback({ type: "error", text: res.message });
        return;
      }
      setFeedback({ type: "error", text: res.message });
      return;
    }
    res = submitNew(data, actor);
    if (res.ok) {
      setFeedback({ type: "ok", text: res.message ?? "已提交" });
      setTimeout(onClose, 900);
      return;
    }
    setFeedback({ type: "error", text: res.message });
  };

  const handleDiscardDraft = () => {
    if (draftId) discardDraft(draftId);
    onClose();
  };

  const copyFieldFromServer = (key: MetricKey | "room" | "note" | "equipment" | "grade") => {
    if (!serverRecord) return;
    setData((d) => {
      if (key === "room") return { ...d, room: serverRecord.room };
      if (key === "note") return { ...d, note: serverRecord.note };
      if (key === "equipment") return { ...d, equipment: serverRecord.equipment };
      if (key === "grade") return { ...d, grade: serverRecord.grade };
      return { ...d, metrics: { ...d.metrics, [key]: serverRecord.metrics[key] } };
    });
  };

  const adoptServerAndReload = () => {
    if (!serverRecord) return;
    setData(recordToInput(serverRecord));
    setBaseRevision(serverRecord.revision);
    setConflict(undefined);
    setFeedback({ type: "ok", text: `已载入对方保存的 v${serverRecord.revision}，可在此基础上继续修改` });
    setShowMerge(false);
  };

  const title = isEdit
    ? `编辑巡检 ${recordId}`
    : mode.kind === "resume" && mode.draft.kind !== "new"
      ? "恢复冲突草稿"
      : "新建巡检";

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="modal editor-modal">
        <header className="modal-head">
          <div>
            <h2>{title}</h2>
            <p className="modal-sub">
              {isEdit ? (
                <>
                  基于记录版本 <b>v{baseRevision}</b> 编辑 · 判定沿用原阈值版本{" "}
                  <b>{version.label}</b>（历史记录不随新阈值改版）
                </>
              ) : (
                <>
                  新建时锁定当班阈值版本：<b>{version.label}</b>（生效于 {formatTs(version.effectiveFrom)}）
                  ，提交后即使发布新版本，本记录仍按 {version.label} 判定
                </>
              )}
            </p>
          </div>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </header>

        {mode.kind === "resume" && (
          <div className="banner banner-info">
            已恢复 {formatTs(mode.draft.savedAt)} 自动保存的未提交草稿
            {mode.draft.conflict ? "（该草稿曾因版本冲突被拦下，内容完整保留）" : ""}
          </div>
        )}

        {conflict && (
          <div className="banner banner-conflict">
            <strong>⚠ 版本冲突</strong>
            <span>
              {conflict.by} 已于 {formatTs(conflict.at)} 将该记录保存为{" "}
              <b>v{conflict.revision}</b>。你的草稿没有被覆盖，已完整保留。
            </span>
            <div className="banner-actions">
              <button className="primary-action" onClick={() => setShowMerge((s) => !s)}>
                {showMerge ? "收起对比" : "对比并合并"}
              </button>
              <button onClick={adoptServerAndReload}>放弃草稿，载入对方版本</button>
            </div>
          </div>
        )}

        {locked && (
          <div className="banner banner-locked">
            🔒 该记录已由厂务工程师复核通过并锁定，不能再修改。
          </div>
        )}

        {showMerge && serverRecord && (
          <MergePanel data={data} server={serverRecord} onCopy={copyFieldFromServer} />
        )}

        <div className="form-grid">
          <label className={locked ? "disabled" : ""}>
            <span>房间编号 *</span>
            <input
              value={data.room}
              disabled={locked}
              placeholder="如 CR-1201"
              onChange={(e) => setData((d) => ({ ...d, room: e.target.value }))}
            />
          </label>
          <label className={locked ? "disabled" : ""}>
            <span>洁净等级 *</span>
            <select
              value={data.grade}
              disabled={locked}
              onChange={(e) => setData((d) => ({ ...d, grade: e.target.value as Grade }))}
            >
              {GRADES.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="form-grid metrics-inputs">
          {METRICS.map(({ key, label, unit }) => {
            const r = live.results.find((x) => x.key === key);
            return (
              <label key={key} className={`metric-input ${locked ? "disabled" : ""}`}>
                <span>
                  {label} ({unit})
                </span>
                <input
                  type="number"
                  step="any"
                  disabled={locked}
                  value={data.metrics[key]}
                  placeholder="填写数值"
                  onChange={(e) => updateMetric(key, e.target.value)}
                />
                {r && data.metrics[key] !== "" && (
                  <em className={`verdict-tag tag-${r.result}`}>
                    {VERDICT_TEXT[r.result]} · 限{" "}
                    {key.includes("particle")
                      ? `≤${key === "particle05" ? gradeThreshold.particle05Max : gradeThreshold.particle5Max}`
                      : `${key === "temperature"
                          ? `${gradeThreshold.tempMin}~${gradeThreshold.tempMax}`
                          : key === "humidity"
                            ? `${gradeThreshold.humidityMin}~${gradeThreshold.humidityMax}`
                            : `${gradeThreshold.pressureMin}~${gradeThreshold.pressureMax}`}`}
                  </em>
                )}
              </label>
            );
          })}
        </div>

        <div className="form-grid">
          <label className={locked ? "disabled" : ""}>
            <span>设备状态</span>
            <select
              value={data.equipment}
              disabled={locked}
              onChange={(e) =>
                setData((d) => ({ ...d, equipment: e.target.value as InspectionInput["equipment"] }))
              }
            >
              {EQUIPMENT_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <div className={`overall-box overall-${live.overall}`}>
            <span>实时综合判定（{version.label}）</span>
            <strong>{VERDICT_TEXT[live.overall]}</strong>
            <small>等于上限/下限即异常 · 设备故障直接异常</small>
          </div>
        </div>

        <label className={locked ? "disabled" : ""}>
          <span>处理备注</span>
          <textarea
            rows={3}
            disabled={locked}
            value={data.note}
            placeholder="异常处置、通知对象、复测计划…"
            onChange={(e) => setData((d) => ({ ...d, note: e.target.value }))}
          />
        </label>

        <div className="live-reasons">
          {live.results.filter((r) => r.value !== null).map((r) => (
            <p key={r.key} className={`reason-line tag-${r.result}-text`}>{r.reason}</p>
          ))}
        </div>

        {feedback && (
          <div className={`banner ${feedback.type === "ok" ? "banner-ok" : "banner-error"}`}>
            {feedback.text}
          </div>
        )}

        <footer className="modal-foot">
          <span className="autosave-hint">
            {savedAt ? `草稿已于 ${formatTs(savedAt)} 自动保存，关闭页面不丢失` : "输入后自动保存草稿"}
          </span>
          <div className="foot-actions">
            <button onClick={handleDiscardDraft} disabled={locked}>
              {isEdit ? "关闭（草稿已自动保留）" : "丢弃草稿"}
            </button>
            {!locked && (
              <button className="primary-action" onClick={handleSubmit}>
                {isEdit ? `保存为 v${baseRevision + 1}` : "提交巡检"}
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}

function MergePanel({
  data,
  server,
  onCopy,
}: {
  data: InspectionInput;
  server: InspectionRecord;
  onCopy: (key: MetricKey | "room" | "note" | "equipment" | "grade") => void;
}) {
  const fields: { key: MetricKey | "room" | "note"; label: string; mine: string | number; theirs: string | number }[] = [
    { key: "room", label: "房间", mine: data.room, theirs: server.room },
    ...(["particle05", "particle5", "temperature", "humidity", "pressure"] as MetricKey[]).map((k) => ({
      key: k,
      label: METRICS.find((m) => m.key === k)!.label,
      mine: data.metrics[k] === "" ? "—" : Number(data.metrics[k]),
      theirs: server.metrics[k] === "" ? "—" : Number(server.metrics[k]),
    })),
    { key: "note", label: "备注", mine: data.note || "—", theirs: server.note || "—" },
  ];
  return (
    <div className="merge-panel">
      <h4>逐字段合并（你的草稿 v{server.revision - 1} → 对方已保存 v{server.revision}）</h4>
      <table>
        <thead>
          <tr>
            <th>字段</th>
            <th>我的草稿</th>
            <th>对方已保存</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => (
            <tr key={f.key} className={String(f.mine) !== String(f.theirs) ? "row-diff" : ""}>
              <td>{f.label}</td>
              <td>{f.mine}</td>
              <td>{f.theirs}</td>
              <td>
                {String(f.mine) !== String(f.theirs) && (
                  <button className="mini" onClick={() => onCopy(f.key)}>取对方值</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
