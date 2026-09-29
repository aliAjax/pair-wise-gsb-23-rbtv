import { useMemo, useState } from "react";
import "./styles.css";
import AuditTrail from "./components/AuditTrail";
import Dashboard from "./components/Dashboard";
import DraftBar from "./components/DraftBar";
import InspectionEditor from "./components/InspectionEditor";
import RecordsList from "./components/RecordsList";
import ThresholdAdmin from "./components/ThresholdAdmin";
import { exportSummary } from "./exporter";
import { resetDemo, useStore } from "./store";
import type { Draft, Grade, InspectionRecord, RecordStatus } from "./types";

type Role = "巡检员" | "厂务工程师" | "班组长";
type Tab = "inspect" | "thresholds" | "audit";

const ROLES: Role[] = ["巡检员", "厂务工程师", "班组长"];
const ROLE_KEY = "hxwl-09.role";
const ACTOR_KEY = "hxwl-09.actor";

type EditorState =
  | null
  | { mode: { kind: "new" } }
  | { mode: { kind: "edit"; record: InspectionRecord } }
  | { mode: { kind: "resume"; draft: Draft } };

function loadStr(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export default function App() {
  const records = useStore((s) => s.records);
  const versions = useStore((s) => s.thresholdVersions);

  const [tab, setTab] = useState<Tab>("inspect");
  const [role, setRole] = useState<Role>(() => loadStr(ROLE_KEY, "巡检员") as Role);
  const [actor, setActor] = useState<string>(() => loadStr(ACTOR_KEY, "王巡检"));
  const [editor, setEditor] = useState<EditorState>(null);
  const [gradeFilter, setGradeFilter] = useState<Grade | "全部">("全部");
  const [statusFilter, setStatusFilter] = useState<RecordStatus | "全部">("全部");

  const switchRole = (r: Role) => {
    setRole(r);
    try {
      localStorage.setItem(ROLE_KEY, r);
    } catch {
      // ignore
    }
    if (r === "巡检员" && !actor) setActor("王巡检");
  };

  const changeActor = (name: string) => {
    setActor(name);
    try {
      localStorage.setItem(ACTOR_KEY, name);
    } catch {
      // ignore
    }
  };

  const filtered = useMemo(
    () =>
      records.filter(
        (r) =>
          (gradeFilter === "全部" || r.grade === gradeFilter) &&
          (statusFilter === "全部" || r.status === statusFilter)
      ),
    [records, gradeFilter, statusFilter]
  );

  const resumeDraft = (draft: Draft) => {
    setEditor({ mode: { kind: "resume", draft } });
  };

  const openEdit = (r: InspectionRecord) => {
    setEditor({ mode: { kind: "edit", record: r } });
  };

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-09 · port 5109</p>
          <h1>半导体洁净室巡检</h1>
          <p className="subtitle">
            阈值版本化判定 · 复核锁定 · 乐观锁并发冲突 · 草稿/审计可恢复 · 版本化导出。
            新建巡检按当班阈值版本判定；新阈值只影响之后的新记录，历史记录始终按原版本显示。
          </p>
        </div>
        <div className="stack-card">
          <span>当前身份</span>
          <div className="role-switch">
            {ROLES.map((r) => (
              <button
                key={r}
                className={role === r ? "role-active" : ""}
                onClick={() => switchRole(r)}
              >
                {r}
              </button>
            ))}
          </div>
          <label className="actor-line">
            <span>操作人姓名（审计署名）</span>
            <input value={actor} onChange={(e) => changeActor(e.target.value)} />
          </label>
          <button
            className="reset-btn"
            onClick={() => {
              if (window.confirm("重置为初始演示数据？所有本地记录、草稿、审计将被恢复为种子数据。")) {
                resetDemo(actor || "当前用户");
              }
            }}
          >
            重置演示数据
          </button>
        </div>
      </section>

      <nav className="tab-bar">
        <button className={tab === "inspect" ? "tab-active" : ""} onClick={() => setTab("inspect")}>
          巡检记录
        </button>
        <button className={tab === "thresholds" ? "tab-active" : ""} onClick={() => setTab("thresholds")}>
          阈值版本
        </button>
        <button className={tab === "audit" ? "tab-active" : ""} onClick={() => setTab("audit")}>
          审计轨迹
        </button>
      </nav>

      {tab === "inspect" && (
        <>
          <Dashboard records={records} />

          <DraftBar onResume={resumeDraft} />

          <section className="panel records-panel">
            <div className="section-heading">
              <div>
                <p>巡检记录（判定随记录锁定阈值版本）</p>
                <h2>近期巡检</h2>
              </div>
              <div className="heading-actions">
                <button onClick={() => exportSummary(filtered, versions)}>
                  导出摘要（CSV，含记录/阈值版本）
                </button>
                {role === "巡检员" && (
                  <button className="primary-action" onClick={() => setEditor({ mode: { kind: "new" } })}>
                    新建巡检
                  </button>
                )}
              </div>
            </div>

            <div className="filter-bar">
              <label>
                <span>洁净等级</span>
                <select
                  value={gradeFilter}
                  onChange={(e) => setGradeFilter(e.target.value as Grade | "全部")}
                >
                  <option value="全部">全部</option>
                  <option value="ISO 5">ISO 5</option>
                  <option value="ISO 6">ISO 6</option>
                  <option value="ISO 7">ISO 7</option>
                  <option value="黄光区">黄光区</option>
                </select>
              </label>
              <label>
                <span>记录状态</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as RecordStatus | "全部")}
                >
                  <option value="全部">全部</option>
                  <option value="pending_review">待复核</option>
                  <option value="approved">已锁定</option>
                  <option value="rejected">已驳回</option>
                </select>
              </label>
              <span className="filter-count">共 {filtered.length} 条（按当前筛选导出）</span>
            </div>

            <RecordsList
              records={filtered}
              role={role}
              actor={actor || "当前用户"}
              gradeFilter={gradeFilter}
              statusFilter={statusFilter}
              onEdit={openEdit}
            />
          </section>
        </>
      )}

      {tab === "thresholds" && (
        <ThresholdAdmin actor={actor || "当前用户"} canPublish={role === "厂务工程师"} />
      )}

      {tab === "audit" && <AuditTrail />}

      {editor && (
        <InspectionEditor
          mode={editor.mode}
          actor={actor || "当前用户"}
          onClose={() => setEditor(null)}
        />
      )}

      <footer className="app-footer">
        数据保存在浏览器本地（localStorage）并通过 storage 事件跨标签页同步：
        打开两个标签页同时编辑同一记录可真实复现乐观锁冲突；关闭页面后草稿、已提交记录与审计轨迹都会恢复。
      </footer>
    </main>
  );
}
