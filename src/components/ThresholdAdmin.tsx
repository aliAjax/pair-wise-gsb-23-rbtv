import { useState } from "react";
import { currentThresholdVersion, formatTs, nextLabel, nowLocalInput } from "../domain";
import { getState, publishThreshold, useStore } from "../store";
import { GRADES } from "../types";
import type { Grade, GradeThreshold, ThresholdVersion } from "../types";

interface Props {
  actor: string;
  canPublish: boolean;
}

const FIELD_ROWS: { key: keyof GradeThreshold; label: string; unit: string }[] = [
  { key: "particle05Max", label: "0.5μm 粒子上限", unit: "粒/m³" },
  { key: "particle5Max", label: "5.0μm 粒子上限", unit: "粒/m³" },
  { key: "tempMin", label: "温度下限", unit: "℃" },
  { key: "tempMax", label: "温度上限", unit: "℃" },
  { key: "humidityMin", label: "湿度下限", unit: "%RH" },
  { key: "humidityMax", label: "湿度上限", unit: "%RH" },
  { key: "pressureMin", label: "压差下限", unit: "Pa" },
  { key: "pressureMax", label: "压差上限", unit: "Pa" },
];

export default function ThresholdAdmin({ actor, canPublish }: Props) {
  const versions = useStore((s) => s.thresholdVersions);
  const [publishing, setPublishing] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);

  const current = currentThresholdVersion(versions);
  const sorted = [...versions].sort(
    (a, b) => new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime()
  );

  const [label, setLabel] = useState(nextLabel(versions));
  const [effectiveFrom, setEffectiveFrom] = useState(nowLocalInput());
  const [note, setNote] = useState("");
  const [values, setValues] = useState<Record<Grade, GradeThreshold>>(() =>
    JSON.parse(JSON.stringify(current.values))
  );

  const setCell = (g: Grade, key: keyof GradeThreshold, v: number) => {
    setValues((prev) => ({ ...prev, [g]: { ...prev[g], [key]: v } }));
  };

  const handlePublish = () => {
    const eff = new Date(effectiveFrom).toISOString();
    const res = publishThreshold(
      { label: label.trim(), effectiveFrom: eff, publishedBy: actor, note: note.trim(), values },
      actor
    );
    if (res.ok) {
      setFeedback(res.message ?? "已发布");
      setPublishing(false);
      setNote("");
      // 以发布后的最新当班版本重置表单，便于连续发布下一版
      const latest = currentThresholdVersion(getState().thresholdVersions);
      setLabel(nextLabel(getState().thresholdVersions));
      setValues(JSON.parse(JSON.stringify(latest.values)));
      setFormKey((k) => k + 1);
      setTimeout(() => setFeedback(null), 3000);
    } else {
      setFeedback(res.message);
    }
  };

  return (
    <section className="panel threshold-page">
      <div className="section-heading">
        <div>
          <p>阈值版本管理</p>
          <h2>洁净等级阈值（只追加，不改历史）</h2>
        </div>
        {canPublish && !publishing && (
          <button className="primary-action" onClick={() => setPublishing(true)}>
            发布新阈值版本
          </button>
        )}
      </div>

      <div className="current-threshold-banner">
        当前当班版本：<code>{current.label}</code> · 生效于 {formatTs(current.effectiveFrom)} ·{" "}
        {current.publishedBy} 发布 · 新建巡检按此版本判定
      </div>

      {feedback && <div className="banner banner-ok">{feedback}</div>}
      {!canPublish && (
        <div className="banner banner-info">
          当前角色（巡检员/班组长）只读查看阈值；发布新版本请切换到「厂务工程师」。
        </div>
      )}

      {publishing && canPublish && (
        <div className="publish-form">
          <h3>新版本（基于 {current.label} 复制后调整）</h3>
          <p className="form-warn">
            发布后不可修改；历史记录继续按其原版本显示判定，只有生效时间之后的<strong>新建巡检</strong>采用新版本。
          </p>
          <div className="form-grid">
            <label>
              <span>版本号</span>
              <input value={label} onChange={(e) => setLabel(e.target.value)} />
            </label>
            <label>
              <span>生效时间（当班时刻 ≥ 此时间才采用）</span>
              <input
                type="datetime-local"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </label>
          </div>
          <label>
            <span>发布说明</span>
            <input value={note} placeholder="如：夏季湿度管控收紧" onChange={(e) => setNote(e.target.value)} />
          </label>

          <div className="threshold-edit-table-wrap">
            <table className="threshold-edit-table">
              <thead>
                <tr>
                  <th>等级</th>
                  {FIELD_ROWS.map((f) => (
                    <th key={f.key}>
                      {f.label}
                      <small>({f.unit})</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {GRADES.map((g) => (
                  <tr key={g}>
                    <td><b>{g}</b></td>
                    {FIELD_ROWS.map((f) => (
                      <td key={f.key}>
                        <input
                          type="number"
                          step="any"
                          value={values[g][f.key]}
                          onChange={(e) => setCell(g, f.key, Number(e.target.value))}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="form-actions">
            <button onClick={() => setPublishing(false)}>取消</button>
            <button className="primary-action" onClick={handlePublish}>
              确认发布（仅影响之后新记录）
            </button>
          </div>
        </div>
      )}

      <div key={formKey} className="version-list">
        {sorted.map((v) => (
          <VersionCard key={v.id} v={v} isCurrent={v.id === current.id} />
        ))}
      </div>
    </section>
  );
}

function VersionCard({ v, isCurrent }: { v: ThresholdVersion; isCurrent: boolean }) {
  const [open, setOpen] = useState(isCurrent);
  return (
    <article className={`version-card ${isCurrent ? "version-current" : ""}`}>
      <header onClick={() => setOpen((s) => !s)}>
        <div>
          <h3>
            <code>{v.label}</code>
            {isCurrent && <em className="current-pill">当班生效中</em>}
          </h3>
          <p>
            生效 {formatTs(v.effectiveFrom)} · {v.publishedBy} 发布于 {formatTs(v.publishedAt)}
          </p>
          {v.note && <p className="version-note">{v.note}</p>}
        </div>
        <button className="mini">{open ? "收起" : "查看阈值"}</button>
      </header>
      {open && (
        <div className="threshold-table-wrap">
          <table className="threshold-table">
            <thead>
              <tr>
                <th>等级</th>
                <th>0.5μm ≤</th>
                <th>5.0μm ≤</th>
                <th>温度(℃)</th>
                <th>湿度(%RH)</th>
                <th>压差(Pa)</th>
              </tr>
            </thead>
            <tbody>
              {GRADES.map((g) => {
                const t = v.values[g];
                return (
                  <tr key={g}>
                    <td><b>{g}</b></td>
                    <td>{t.particle05Max}</td>
                    <td>{t.particle5Max}</td>
                    <td>{t.tempMin} ~ {t.tempMax}</td>
                    <td>{t.humidityMin} ~ {t.humidityMax}</td>
                    <td>{t.pressureMin} ~ {t.pressureMax}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}
