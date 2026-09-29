import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import {
  CLEAN_CLASSES,
  DATA_KEY,
  DRAFTS_KEY,
  EQUIPMENT_STATUS,
  ROLES,
  activeThreshold,
  blankDraftValues,
  buildCsv,
  draftValuesFromRecord,
  fmtNum,
  fmtTime,
  judgeValues,
  loadData,
  loadDrafts,
  parseNumbers,
  parseValues,
  pushAudit,
  saveData,
  saveDrafts,
  suggestThresholdName,
  type CleanClass,
  type Draft,
  type DraftValues,
  type InspectionRecord,
  type Role,
  type StoreData,
  type ThresholdSet,
  type ThresholdVersion,
} from "./store";

const project = {
  id: "hxwl-09",
  port: 5109,
  title: "半导体洁净室巡检",
  subtitle: "洁净等级阈值、粒子计数与异常处理看板",
};

function MetricCard({ label, value, index }: { label: string; value: number; index: number }) {
  const colors = ["status-ok", "status-watch", "status-danger", "status-ok"];
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <i className={colors[index % colors.length]} />
    </article>
  );
}

function JudgmentChips({ record }: { record: InspectionRecord }) {
  return (
    <div className="judgment-chips">
      {record.judgment.map((j) => (
        <span
          key={j.key}
          className={j.abnormal ? "j-chip bad" : "j-chip ok"}
          title={`${j.limitText} · ${j.reason}`}
        >
          {j.label} {j.abnormal ? "✗ 异常" : "✓ 正常"}
        </span>
      ))}
    </div>
  );
}

function ValuesList({ v }: { v: DraftValues }) {
  const rows: [string, string][] = [
    ["房间编号", v.roomId || "—"],
    ["洁净等级", v.cleanClass],
    ["0.5µm粒子", v.particle === "" ? "—" : `${fmtNum(Number(v.particle))} 个/m³`],
    ["温度", v.temperature === "" ? "—" : `${v.temperature} ℃`],
    ["湿度", v.humidity === "" ? "—" : `${v.humidity} %RH`],
    ["压差", v.pressure === "" ? "—" : `${v.pressure} Pa`],
    ["设备状态", v.equipmentStatus],
    ["处理备注", v.note || "—"],
  ];
  return (
    <dl className="values-list">
      {rows.map(([k, val]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{val}</dd>
        </div>
      ))}
    </dl>
  );
}

interface EditorProps {
  draft: Draft;
  isNew: boolean;
  currentVersion: number | null; // 编辑已有记录时，存储中的最新版本
  getThreshold: (cls: CleanClass) => { name: string; set: ThresholdSet };
  onDraft: (values: DraftValues) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

function RecordEditor({ draft, isNew, currentVersion, getThreshold, onDraft, onSubmit, onCancel }: EditorProps) {
  const [values, setValues] = useState<DraftValues>(draft.values);
  const update = (patch: Partial<DraftValues>) => {
    const next = { ...values, ...patch };
    setValues(next);
    onDraft(next);
  };
  const th = getThreshold(values.cleanClass);
  const nums = parseNumbers(values);
  const preview = nums ? judgeValues(nums, th.set) : null;
  const ready = parseValues(values) !== null;
  const stale = currentVersion !== null && currentVersion !== draft.baseVersion;

  const numField = (
    label: string,
    key: "particle" | "temperature" | "humidity" | "pressure",
    placeholder: string,
    step = "any"
  ) => (
    <label>
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={values[key]}
        placeholder={placeholder}
        onChange={(e) => update({ [key]: e.target.value })}
      />
    </label>
  );

  return (
    <section className="panel editor-panel">
      <div className="section-heading">
        <div>
          <p>{isNew ? "新建巡检" : `编辑 ${draft.recordId}`}</p>
          <h2>{isNew ? "按当班阈值版本判定" : "修改已提交记录"}</h2>
        </div>
        <span className="badge badge-info">判定阈值 {th.name}</span>
      </div>

      {!isNew && (
        <p className="muted small">
          记录当前版本 v{currentVersion ?? "?"}，本草稿基于 v{draft.baseVersion}
          {stale && <strong className="warn-text">　⚠ 他人已保存新版本，提交时将触发版本冲突</strong>}
        </p>
      )}

      <div className="field-grid">
        <label>
          <span>房间编号 *</span>
          <input
            value={values.roomId}
            placeholder="如 CR-1201"
            onChange={(e) => update({ roomId: e.target.value })}
          />
        </label>
        <label>
          <span>洁净等级</span>
          <select
            value={values.cleanClass}
            onChange={(e) => update({ cleanClass: e.target.value as CleanClass })}
          >
            {CLEAN_CLASSES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        {numField("0.5µm粒子计数（个/m³）", "particle", `上限 ${fmtNum(th.set.particleLimit)}`, "1")}
        {numField("温度（℃）", "temperature", `${th.set.tempMin}–${th.set.tempMax}`)}
        {numField("湿度（%RH）", "humidity", `${th.set.humidityMin}–${th.set.humidityMax}`)}
        {numField("压差（Pa）", "pressure", `${th.set.pressureMin}–${th.set.pressureMax}`)}
        <label>
          <span>设备状态</span>
          <select
            value={values.equipmentStatus}
            onChange={(e) => update({ equipmentStatus: e.target.value })}
          >
            {EQUIPMENT_STATUS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          <span>处理备注</span>
          <input
            value={values.note}
            placeholder="异常情况与处理措施"
            onChange={(e) => update({ note: e.target.value })}
          />
        </label>
      </div>

      <div className="judgment-preview">
        <p className="preview-title">
          实时预判 · 按 {th.name}（{values.cleanClass}）· 达到/超过上限（含等于上限）或低于下限即判异常
        </p>
        {preview ? (
          <table className="preview-table">
            <thead>
              <tr><th>项目</th><th>实测</th><th>限值</th><th>判定</th></tr>
            </thead>
            <tbody>
              {preview.map((j) => (
                <tr key={j.key} className={j.abnormal ? "row-bad" : ""}>
                  <td>{j.label}</td>
                  <td>{fmtNum(j.value)}</td>
                  <td>{j.limitText}</td>
                  <td>{j.abnormal ? `异常 · ${j.reason}` : "正常"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted small">填写完整数值后显示预判</p>
        )}
      </div>

      <div className="editor-actions">
        <button className="primary-action" disabled={!ready} onClick={onSubmit}>
          {isNew
            ? `提交巡检（按 ${th.name} 判定）`
            : `提交更新（v${draft.baseVersion} → v${draft.baseVersion + 1}，仍按 ${th.name} 判定）`}
        </button>
        <button onClick={onCancel}>取消（草稿保留）</button>
        <span className="muted small">草稿已自动保存 · {fmtTime(draft.savedAt)}</span>
      </div>
    </section>
  );
}

function PublishForm({
  active,
  existingNames,
  onPublish,
  onCancel,
}: {
  active: ThresholdVersion;
  existingNames: string[];
  onPublish: (name: string, note: string, limits: Record<CleanClass, ThresholdSet>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(() => suggestThresholdName(active.name));
  const [note, setNote] = useState("");
  const [limits, setLimits] = useState<Record<CleanClass, ThresholdSet>>(() =>
    JSON.parse(JSON.stringify(active.limits))
  );
  const [err, setErr] = useState<string | null>(null);

  const setLimit = (cls: CleanClass, key: keyof ThresholdSet, raw: string) => {
    const n = Number(raw);
    setLimits((prev) => ({ ...prev, [cls]: { ...prev[cls], [key]: Number.isFinite(n) ? n : 0 } }));
  };

  const numCell = (cls: CleanClass, key: keyof ThresholdSet, step = "any") => (
    <td>
      <input
        className="cell-input"
        type="number"
        step={step}
        value={limits[cls][key]}
        onChange={(e) => setLimit(cls, key, e.target.value)}
      />
    </td>
  );

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return setErr("请填写版本号");
    if (existingNames.includes(trimmed)) return setErr(`版本号 ${trimmed} 已存在`);
    for (const c of CLEAN_CLASSES) {
      const l = limits[c];
      if (!(l.particleLimit > 0)) return setErr(`${c}：粒子上限必须大于 0`);
      if (!(l.tempMin < l.tempMax)) return setErr(`${c}：温度下限必须小于上限`);
      if (!(l.humidityMin < l.humidityMax)) return setErr(`${c}：湿度下限必须小于上限`);
      if (!(l.pressureMin < l.pressureMax)) return setErr(`${c}：压差下限必须小于上限`);
    }
    onPublish(trimmed, note.trim(), limits);
  };

  return (
    <div className="publish-form">
      <h3>发布新阈值版本</h3>
      <p className="muted small">
        发布后 {active.name} 自动归档；新阈值只对之后新建的记录生效，历史记录仍按原版本判定。
      </p>
      <div className="field-grid">
        <label>
          <span>版本号 *</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span>发布说明</span>
          <input value={note} placeholder="本次调整原因" onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <table className="limit-table editable">
        <thead>
          <tr>
            <th>等级</th><th>粒子上限</th><th>温度下限</th><th>温度上限</th>
            <th>湿度下限</th><th>湿度上限</th><th>压差下限</th><th>压差上限</th>
          </tr>
        </thead>
        <tbody>
          {CLEAN_CLASSES.map((c) => (
            <tr key={c}>
              <td>{c}</td>
              {numCell(c, "particleLimit", "1")}
              {numCell(c, "tempMin")}
              {numCell(c, "tempMax")}
              {numCell(c, "humidityMin")}
              {numCell(c, "humidityMax")}
              {numCell(c, "pressureMin")}
              {numCell(c, "pressureMax")}
            </tr>
          ))}
        </tbody>
      </table>
      {err && <p className="warn-text small">{err}</p>}
      <div className="editor-actions">
        <button className="primary-action" onClick={submit}>发布并启用</button>
        <button onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState<StoreData>(() => loadData());
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => loadDrafts());
  const [role, setRole] = useState<Role>("巡检员");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ draft: Draft; current: InspectionRecord } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [classFilter, setClassFilter] = useState<string>("全部");
  const [onlyAbnormal, setOnlyAbnormal] = useState(false);
  const [showPublish, setShowPublish] = useState(false);

  // 其他标签页写入 localStorage 时同步刷新，保证两个页面看到同一份数据
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === DATA_KEY) setData(loadData());
      if (e.key === DRAFTS_KEY) setDrafts(loadDrafts());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const active = activeThreshold(data);
  const archived = data.thresholds.filter((t) => t.status === "archived");
  const canEdit = role !== "班组长";
  const canApprove = role === "厂务工程师";
  const canPublish = role === "厂务工程师";

  const metrics = useMemo(() => {
    const has = (r: InspectionRecord, key: string) =>
      r.judgment.some((j) => j.key === key && j.abnormal);
    return [
      { label: "粒子异常", value: data.records.filter((r) => has(r, "particle")).length },
      { label: "压差异常", value: data.records.filter((r) => has(r, "pressure")).length },
      { label: "温湿度偏移", value: data.records.filter((r) => has(r, "temperature") || has(r, "humidity")).length },
      { label: "待复核", value: data.records.filter((r) => r.status === "submitted").length },
    ];
  }, [data]);

  const filteredRecords = useMemo(
    () =>
      data.records
        .filter((r) => classFilter === "全部" || r.cleanClass === classFilter)
        .filter((r) => !onlyAbnormal || r.abnormal)
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [data, classFilter, onlyAbnormal]
  );

  const draftList = useMemo(
    () => Object.values(drafts).sort((a, b) => b.savedAt.localeCompare(a.savedAt)),
    [drafts]
  );

  const editingDraft = editingKey ? drafts[editingKey] : undefined;
  const editingRecord =
    editingKey && editingKey !== "new"
      ? data.records.find((r) => r.id === editingKey)
      : undefined;

  // ---------- 草稿 ----------

  const upsertDraft = (d: Draft) => {
    const all = loadDrafts();
    all[d.key] = d;
    saveDrafts(all);
    setDrafts(all);
  };

  const removeDraft = (key: string) => {
    const all = loadDrafts();
    delete all[key];
    saveDrafts(all);
    setDrafts(all);
    if (editingKey === key) setEditingKey(null);
  };

  const startNew = () => {
    if (!drafts["new"]) {
      upsertDraft({
        key: "new",
        recordId: null,
        baseVersion: 0,
        values: blankDraftValues(),
        savedAt: new Date().toISOString(),
      });
    }
    setEditingKey("new");
  };

  const startEdit = (rec: InspectionRecord) => {
    if (!drafts[rec.id]) {
      upsertDraft({
        key: rec.id,
        recordId: rec.id,
        baseVersion: rec.recordVersion,
        values: draftValuesFromRecord(rec),
        savedAt: new Date().toISOString(),
      });
    }
    setEditingKey(rec.id);
  };

  // ---------- 业务操作（每次都先重读 localStorage，保证多标签页下版本检查准确） ----------

  const submitDraft = (draft: Draft) => {
    const parsed = parseValues(draft.values);
    if (!parsed) {
      setNotice("表单数据不完整，无法提交");
      return;
    }
    const d = loadData();
    const now = new Date().toISOString();

    if (draft.recordId) {
      const rec = d.records.find((r) => r.id === draft.recordId);
      if (!rec) {
        setNotice(`记录 ${draft.recordId} 已不存在，草稿已清除`);
        removeDraft(draft.key);
        return;
      }
      if (rec.status === "approved") {
        setNotice(`记录 ${rec.id} 已由厂务工程师复核锁定，不能再修改`);
        return;
      }
      if (rec.recordVersion !== draft.baseVersion) {
        // 版本冲突：不覆盖对方结果，保留草稿并提示
        pushAudit(
          d,
          role,
          "版本冲突",
          `提交 ${rec.id} 时发现他人已保存 v${rec.recordVersion}（本草稿基于 v${draft.baseVersion}），已保留草稿未覆盖`
        );
        saveData(d);
        setData(d);
        setConflict({ draft, current: rec });
        return;
      }
      const tv = d.thresholds.find((t) => t.id === rec.thresholdVersionId);
      const snapshot = tv ? tv.limits[parsed.cleanClass] : rec.thresholdSnapshot;
      const judgment = judgeValues(parsed, snapshot);
      Object.assign(rec, parsed, {
        thresholdSnapshot: snapshot,
        judgment,
        abnormal: judgment.some((j) => j.abnormal),
        recordVersion: rec.recordVersion + 1,
        updatedAt: now,
      });
      pushAudit(d, role, "更新记录", `${rec.id} 更新为 v${rec.recordVersion}（仍按阈值 ${rec.thresholdVersionName} 判定）`);
    } else {
      const th = activeThreshold(d);
      const snapshot = th.limits[parsed.cleanClass];
      const judgment = judgeValues(parsed, snapshot);
      const rec: InspectionRecord = {
        id: `CR-${d.nextId++}`,
        ...parsed,
        status: "submitted",
        recordVersion: 1,
        thresholdVersionId: th.id,
        thresholdVersionName: th.name,
        thresholdSnapshot: snapshot,
        judgment,
        abnormal: judgment.some((j) => j.abnormal),
        createdBy: role,
        createdAt: now,
        updatedAt: now,
      };
      d.records.unshift(rec);
      pushAudit(d, role, "新建记录", `${rec.id} 按当班阈值 ${th.name} 判定：${rec.abnormal ? "异常" : "稳定"}`);
    }

    saveData(d);
    setData(d);
    removeDraft(draft.key);
    setEditingKey(null);
    setNotice(null);
  };

  const approve = (id: string) => {
    const d = loadData();
    const rec = d.records.find((r) => r.id === id);
    if (!rec || rec.status === "approved") return;
    rec.status = "approved";
    rec.reviewedBy = role;
    rec.reviewedAt = new Date().toISOString();
    pushAudit(d, role, "复核通过", `${id} 复核通过并锁定（记录 v${rec.recordVersion}，阈值 ${rec.thresholdVersionName}），之后不可再修改`);
    saveData(d);
    setData(d);
    if (editingKey === id) setEditingKey(null);
  };

  const publishThreshold = (name: string, note: string, limits: Record<CleanClass, ThresholdSet>) => {
    const d = loadData();
    const prev = activeThreshold(d);
    prev.status = "archived";
    d.thresholds.unshift({
      id: `th-${Date.now()}`,
      name,
      status: "active",
      publishedAt: new Date().toISOString(),
      publishedBy: role,
      note,
      limits,
    });
    pushAudit(d, role, "发布阈值", `发布 ${name}，原 ${prev.name} 归档；仅影响之后新建的记录`);
    saveData(d);
    setData(d);
    setShowPublish(false);
  };

  const exportCsv = () => {
    const d = loadData();
    const blob = new Blob([buildCsv(d)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `洁净室巡检摘要_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    pushAudit(d, role, "导出摘要", `导出 ${d.records.length} 条记录（含记录版本与阈值版本）`);
    saveData(d);
    setData(d);
  };

  // ---------- 冲突处理 ----------

  const resolveConflictRebase = () => {
    if (!conflict) return;
    upsertDraft({
      ...conflict.draft,
      baseVersion: conflict.current.recordVersion,
      savedAt: new Date().toISOString(),
    });
    setEditingKey(conflict.draft.key);
    setConflict(null);
  };

  const resolveConflictDiscard = () => {
    if (!conflict) return;
    removeDraft(conflict.draft.key);
    setConflict(null);
  };

  // ---------- 渲染 ----------

  const getThresholdForEditor = (cls: CleanClass): { name: string; set: ThresholdSet } => {
    if (editingRecord) {
      const tv = data.thresholds.find((t) => t.id === editingRecord.thresholdVersionId);
      if (tv) return { name: tv.name, set: tv.limits[cls] };
      return { name: editingRecord.thresholdVersionName, set: editingRecord.thresholdSnapshot };
    }
    return { name: active.name, set: active.limits[cls] };
  };

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">{project.id} · port {project.port}</p>
          <h1>{project.title}</h1>
          <p className="subtitle">
            {project.subtitle}。新建巡检按当班阈值版本判定；厂务工程师复核通过后记录锁定；
            新阈值只影响之后的新记录，历史记录仍按原版本显示判定；达到/超过上限（含等于上限）即判异常。
          </p>
        </div>
        <div className="stack-card">
          <span>当前角色</span>
          <div className="role-switch">
            {ROLES.map((r) => (
              <button
                key={r}
                className={r === role ? "role-btn active" : "role-btn"}
                onClick={() => setRole(r)}
              >
                {r}
              </button>
            ))}
          </div>
          <span>当班阈值版本</span>
          <strong>{active.name}</strong>
          <span className="muted small">发布于 {fmtTime(active.publishedAt)}</span>
        </div>
      </section>

      <section className="metrics-grid">
        {metrics.map((m, i) => (
          <MetricCard key={m.label} label={m.label} value={m.value} index={i} />
        ))}
      </section>

      {notice && (
        <div className="notice" onClick={() => setNotice(null)}>
          {notice}（点击关闭）
        </div>
      )}

      {draftList.length > 0 && (
        <section className="banner">
          <strong>检测到 {draftList.length} 份未提交草稿（页面关闭后已恢复）：</strong>
          {draftList.map((d) => (
            <span key={d.key} className="banner-item">
              {d.recordId ?? "新建巡检"} · 保存于 {fmtTime(d.savedAt)}
              <button onClick={() => setEditingKey(d.key)}>继续编辑</button>
              <button onClick={() => removeDraft(d.key)}>删除</button>
            </span>
          ))}
        </section>
      )}

      <section className="workspace">
        <aside className="panel narrow">
          <div className="section-heading">
            <div>
              <p>洁净等级阈值</p>
              <h2>当班 {active.name}</h2>
            </div>
          </div>
          <table className="limit-table">
            <thead>
              <tr><th>等级</th><th>粒子上限</th><th>温度℃</th><th>湿度%RH</th><th>压差Pa</th></tr>
            </thead>
            <tbody>
              {CLEAN_CLASSES.map((c) => {
                const l = active.limits[c];
                return (
                  <tr key={c}>
                    <td>{c}</td>
                    <td>{fmtNum(l.particleLimit)}</td>
                    <td>{l.tempMin}–{l.tempMax}</td>
                    <td>{l.humidityMin}–{l.humidityMax}</td>
                    <td>{l.pressureMin}–{l.pressureMax}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted small">
            {active.note} · {active.publishedBy} 发布
          </p>
          {canPublish && (
            <button className="wide-btn" onClick={() => setShowPublish((v) => !v)}>
              {showPublish ? "收起发布表单" : "发布新阈值版本"}
            </button>
          )}
          {archived.length > 0 && (
            <details className="history">
              <summary>历史版本（{archived.length}）</summary>
              {archived.map((t) => (
                <div key={t.id} className="history-item">
                  <strong>{t.name}</strong> · 发布于 {fmtTime(t.publishedAt)}
                  {t.note ? ` · ${t.note}` : ""}
                </div>
              ))}
            </details>
          )}
        </aside>

        <div className="workspace-main">
          {showPublish && canPublish && (
            <section className="panel">
              <PublishForm
                active={active}
                existingNames={data.thresholds.map((t) => t.name)}
                onPublish={publishThreshold}
                onCancel={() => setShowPublish(false)}
              />
            </section>
          )}

          {editingDraft && (editingKey === "new" || editingRecord) ? (
            <RecordEditor
              key={`${editingDraft.key}:${editingDraft.baseVersion}`}
              draft={editingDraft}
              isNew={editingKey === "new"}
              currentVersion={editingRecord ? editingRecord.recordVersion : null}
              getThreshold={getThresholdForEditor}
              onDraft={(values) =>
                upsertDraft({ ...editingDraft, values, savedAt: new Date().toISOString() })
              }
              onSubmit={() => submitDraft(drafts[editingDraft.key] ?? editingDraft)}
              onCancel={() => setEditingKey(null)}
            />
          ) : (
            <section className="panel placeholder-panel">
              <p>洁净室巡检</p>
              <h2>记录字段</h2>
              <p className="muted">
                房间编号 · 洁净等级 · 粒子计数 · 温湿度 · 压差 · 设备状态 · 处理备注
              </p>
              {canEdit ? (
                <button className="primary-action" onClick={startNew}>新建巡检</button>
              ) : (
                <p className="muted small">班组长为只读角色，可查看与导出，不能编辑。</p>
              )}
            </section>
          )}
        </div>
      </section>

      <section className="records panel">
        <div className="section-heading">
          <div>
            <p>巡检记录</p>
            <h2>记录列表（{filteredRecords.length}/{data.records.length}）</h2>
          </div>
          <div className="heading-actions">
            {canEdit && <button className="primary-action" onClick={startNew}>新建巡检</button>}
            <button onClick={exportCsv}>导出摘要 CSV</button>
          </div>
        </div>

        <div className="filters-row">
          <div className="chips">
            {["全部", ...CLEAN_CLASSES].map((c) => (
              <button
                key={c}
                className={classFilter === c ? "chip-active" : ""}
                onClick={() => setClassFilter(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={onlyAbnormal}
              onChange={(e) => setOnlyAbnormal(e.target.checked)}
            />
            仅看异常
          </label>
        </div>

        <div className="record-list">
          {filteredRecords.map((rec) => (
            <article key={rec.id} className={rec.abnormal ? "record-card rec-bad" : "record-card"}>
              <div className="record-main">
                <div className="record-head">
                  <h3>{rec.id} · {rec.roomId}</h3>
                  <div className="badges">
                    <span className={rec.abnormal ? "badge badge-danger" : "badge badge-ok"}>
                      {rec.abnormal ? "异常" : "稳定"}
                    </span>
                    <span className="badge badge-neutral">{rec.cleanClass}</span>
                    {rec.status === "approved" ? (
                      <span className="badge badge-lock">已复核 · 锁定</span>
                    ) : (
                      <span className="badge badge-warn">待复核</span>
                    )}
                    {drafts[rec.id] && <span className="badge badge-draft">有未提交草稿</span>}
                  </div>
                </div>
                <div className="record-values">
                  粒子 {fmtNum(rec.particle)} 个/m³ · 温度 {rec.temperature}℃ · 湿度 {rec.humidity}%RH ·
                  压差 {rec.pressure}Pa · {rec.equipmentStatus}
                </div>
                <JudgmentChips record={rec} />
                <div className="record-meta">
                  <span>阈值版本 {rec.thresholdVersionName}</span>
                  <span>记录版本 v{rec.recordVersion}</span>
                  <span>{rec.createdBy} 提交于 {fmtTime(rec.createdAt)}</span>
                  {rec.reviewedBy && (
                    <span>{rec.reviewedBy} 复核于 {rec.reviewedAt ? fmtTime(rec.reviewedAt) : ""}</span>
                  )}
                </div>
                {rec.note && <p className="record-note">备注：{rec.note}</p>}
              </div>
              <div className="record-actions">
                {canEdit && rec.status !== "approved" && (
                  <button onClick={() => startEdit(rec)}>
                    {drafts[rec.id] ? "继续草稿" : "编辑"}
                  </button>
                )}
                {canApprove && rec.status !== "approved" && (
                  <button className="primary-action" onClick={() => approve(rec.id)}>
                    复核通过
                  </button>
                )}
              </div>
            </article>
          ))}
          {filteredRecords.length === 0 && <p className="muted">没有符合条件的记录。</p>}
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>审计轨迹</p>
            <h2>操作日志（{data.audit.length}）</h2>
          </div>
        </div>
        <div className="audit-list">
          {data.audit.map((a) => (
            <div key={a.id} className="audit-item">
              <span className="audit-time">{fmtTime(a.at)}</span>
              <span className="badge badge-neutral">{a.actor}</span>
              <strong>{a.action}</strong>
              <span className="audit-detail">{a.detail}</span>
            </div>
          ))}
        </div>
      </section>

      {conflict && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>版本冲突</h2>
            <p>
              记录 <strong>{conflict.current.id}</strong> 刚被他人保存为
              <strong> v{conflict.current.recordVersion}</strong>（{fmtTime(conflict.current.updatedAt)}），
              而你的草稿基于 v{conflict.draft.baseVersion}。系统不会覆盖对方刚保存的结果，你的草稿已保留。
            </p>
            <div className="conflict-grid">
              <div>
                <h3>对方已保存（v{conflict.current.recordVersion}）</h3>
                <ValuesList v={draftValuesFromRecord(conflict.current)} />
              </div>
              <div>
                <h3>我的草稿（基于 v{conflict.draft.baseVersion}）</h3>
                <ValuesList v={conflict.draft.values} />
              </div>
            </div>
            <div className="editor-actions">
              <button className="primary-action" onClick={resolveConflictRebase}>
                保留草稿，基于 v{conflict.current.recordVersion} 重新编辑
              </button>
              <button onClick={resolveConflictDiscard}>放弃我的草稿</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
