import { useMemo, useState } from "react";
import { formatTs } from "../domain";
import { useStore } from "../store";

const ACTIONS = ["全部", "提交巡检", "保存编辑", "版本冲突", "复核通过", "复核驳回", "阈值发布", "并发保存", "丢弃草稿", "重置演示"];

export default function AuditTrail() {
  const audit = useStore((s) => s.audit);
  const [action, setAction] = useState("全部");
  const [keyword, setKeyword] = useState("");

  const list = useMemo(
    () =>
      audit.filter(
        (e) =>
          (action === "全部" || e.action === action) &&
          (keyword.trim() === "" ||
            e.actor.includes(keyword.trim()) ||
            e.target.includes(keyword.trim()) ||
            e.detail.includes(keyword.trim()))
      ),
    [audit, action, keyword]
  );

  return (
    <section className="panel audit-page">
      <div className="section-heading">
        <div>
          <p>审计轨迹</p>
          <h2>谁在什么时间改了什么版本</h2>
        </div>
      </div>
      <div className="audit-filters">
        <select value={action} onChange={(e) => setAction(e.target.value)}>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <input
          placeholder="搜索操作人 / 记录ID / 详情"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>

      <ol className="audit-timeline">
        {list.map((e) => (
          <li key={e.id} className={`audit-item audit-${e.action.replace(/\s/g, "")}`}>
            <div className="audit-dot" />
            <div className="audit-body">
              <div className="audit-head">
                <b>{e.action}</b>
                <span>{e.actor}</span>
                <time>{formatTs(e.ts)}</time>
              </div>
              <p className="audit-target">{e.target}</p>
              <p className="audit-detail">{e.detail}</p>
              <div className="audit-tags">
                {e.recordVersion !== undefined && (
                  <code className="tag-version">记录版本 v{e.recordVersion}</code>
                )}
                {e.thresholdVersion && (
                  <code className="tag-threshold">阈值版本 {e.thresholdVersion}</code>
                )}
              </div>
            </div>
          </li>
        ))}
        {list.length === 0 && <p className="empty-hint">暂无匹配的审计事件</p>}
      </ol>
    </section>
  );
}
