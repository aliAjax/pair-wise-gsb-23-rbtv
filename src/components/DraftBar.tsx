import { formatTs } from "../domain";
import { discardDraft, useStore } from "../store";
import type { Draft } from "../types";

interface Props {
  onResume: (draft: Draft) => void;
}

const KIND_TEXT: Record<Draft["kind"], string> = {
  new: "新建巡检",
  edit: "编辑记录",
  conflict: "冲突草稿",
};

export default function DraftBar({ onResume }: Props) {
  const drafts = useStore((s) => s.drafts);
  const records = useStore((s) => s.records);
  const versions = useStore((s) => s.thresholdVersions);

  if (drafts.length === 0) return null;

  return (
    <section className="panel draft-bar">
      <div className="section-heading">
        <div>
          <p>未提交草稿（本地持久化，关闭页面后可恢复）</p>
          <h2>待恢复草稿 · {drafts.length}</h2>
        </div>
      </div>
      <div className="draft-list">
        {drafts.map((d) => {
          const rec = d.recordId ? records.find((r) => r.id === d.recordId) : undefined;
          const vanished = d.recordId && !rec;
          return (
            <article
              key={d.id}
              className={`draft-card draft-${d.kind} ${vanished ? "draft-vanished" : ""}`}
            >
              <div className="draft-main">
                <em className={`draft-kind kind-${d.kind}`}>{KIND_TEXT[d.kind]}</em>
                <h3>
                  {d.kind === "new"
                    ? `新记录 · ${d.data.room || "未填房间"}`
                    : `${d.recordId} · ${d.data.room || rec?.room || ""}`}
                </h3>
                <p>
                  {d.data.grade} · 粒子 {d.data.metrics.particle05 || "—"} /{" "}
                  {d.data.metrics.particle5 || "—"} · 阈值{" "}
                  {versions.find((v) => v.id === d.data.thresholdVersionId)?.label ??
                    d.data.thresholdVersionId}
                  {d.baseRevision ? ` · 基于 v${d.baseRevision}` : ""}
                </p>
                <small>自动保存于 {formatTs(d.savedAt)}</small>
                {d.conflict && (
                  <p className="draft-conflict">
                    ⚠ 保存时被版本冲突拦下：对方已保存 v{d.conflict.revision}（{d.conflict.by}），
                    草稿原样保留，恢复后可逐字段合并
                  </p>
                )}
                {vanished && <p className="draft-conflict">该记录已不存在，草稿仅作留存</p>}
              </div>
              <div className="draft-actions">
                <button className="primary-action" onClick={() => onResume(d)}>
                  恢复编辑
                </button>
                <button onClick={() => discardDraft(d.id)}>丢弃</button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
