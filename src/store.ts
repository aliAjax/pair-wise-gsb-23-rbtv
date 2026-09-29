import { useSyncExternalStore } from "react";
import {
  emptyMetrics,
  evaluateAll,
  findVersion,
  nowIso,
  seedData,
} from "./domain";
import type {
  AuditEvent,
  Draft,
  GradeThreshold,
  InspectionInput,
  InspectionRecord,
  PersistShape,
  ThresholdVersion,
} from "./types";

const STORAGE_KEY = "hxwl-09.cleanroom.v1";

export type ActionResult =
  | { ok: true; message?: string; draftId?: string }
  | { ok: false; code: string; message: string; conflict?: { revision: number; by: string; at: string } };

function load(): PersistShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistShape;
      if (parsed.thresholdVersions?.length) return parsed;
    }
  } catch {
    // 损坏数据回退到种子
  }
  const seeded = seedData();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
  } catch {
    // 存储不可用时仅保留内存态
  }
  return seeded;
}

let state: PersistShape = load();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota errors
  }
}

function emit() {
  persist();
  listeners.forEach((l) => l());
}

function addAudit(
  actor: string,
  action: string,
  target: string,
  detail: string,
  extra?: { recordVersion?: number; thresholdVersion?: string }
) {
  const ev: AuditEvent = {
    id: `aud-${state.audit.length + 1}-${Date.now()}`,
    ts: nowIso(),
    actor,
    action,
    target,
    detail,
    ...extra,
  };
  state.audit = [ev, ...state.audit];
}

function getSnapshotVersion(): PersistShape {
  return state;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY && e.newValue) {
      try {
        state = JSON.parse(e.newValue) as PersistShape;
        cb();
      } catch {
        // ignore
      }
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useStore<T>(selector: (s: PersistShape) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(getSnapshotVersion()),
    () => selector(getSnapshotVersion())
  );
}

export function getState(): PersistShape {
  return state;
}

function nextRecordId(): string {
  state.seq += 1;
  return `INS-2026-${String(state.seq).padStart(3, "0")}`;
}

function snapshotThreshold(
  input: InspectionInput
): { version: ThresholdVersion; grade: GradeThreshold } {
  const version = findVersion(state.thresholdVersions, input.thresholdVersionId);
  return { version, grade: version.values[input.grade] };
}

function buildRecord(
  id: string,
  input: InspectionInput,
  actor: string,
  at: string
): InspectionRecord {
  const { version, grade } = snapshotThreshold(input);
  const { overall, results } = evaluateAll(input, grade, input.equipment);
  return {
    id,
    revision: 1,
    room: input.room.trim(),
    grade: input.grade,
    metrics: { ...input.metrics },
    equipment: input.equipment,
    note: input.note.trim(),
    overall,
    results,
    thresholdVersionId: version.id,
    thresholdVersionLabel: version.label,
    thresholdSnapshot: grade,
    evaluatedAt: at,
    status: "pending_review",
    createdBy: actor,
    createdAt: at,
    submittedBy: actor,
    submittedAt: at,
  };
}

function removeDraft(predicate: (d: Draft) => boolean) {
  state.drafts = state.drafts.filter((d) => !predicate(d));
}

/** 提交新巡检 */
export function submitNew(input: InspectionInput, actor: string): ActionResult {
  const invalid = validate(input);
  if (invalid) return { ok: false, code: "invalid", message: invalid };
  const at = nowIso();
  const id = nextRecordId();
  const rec = buildRecord(id, input, actor, at);
  state.records = [rec, ...state.records];
  removeDraft((d) => d.kind === "new");
  addAudit(actor, "提交巡检", id, `提交 ${rec.room}（${rec.grade}）记录，判定：${verdictName(rec.overall)}，等待复核`, {
    recordVersion: 1,
    thresholdVersion: rec.thresholdVersionLabel,
  });
  emit();
  return { ok: true, message: `${id} 已提交，等待厂务工程师复核` };
}

/** 保存编辑（乐观锁：baseRevision 与服务端不一致即冲突，草稿保留不覆盖） */
export function saveEdit(
  recordId: string,
  baseRevision: number,
  input: InspectionInput,
  actor: string
): ActionResult {
  const invalid = validate(input);
  if (invalid) return { ok: false, code: "invalid", message: invalid };
  const idx = state.records.findIndex((r) => r.id === recordId);
  if (idx < 0) return { ok: false, code: "missing", message: "记录不存在" };
  const current = state.records[idx];

  if (current.status === "approved") {
    return {
      ok: false,
      code: "locked",
      message: "该记录已由厂务工程师复核通过并锁定，不能再修改",
    };
  }
  if (current.revision !== baseRevision) {
    const at = nowIso();
    // 关键：冲突时把草稿原样保住，绝不覆盖对方刚保存的版本；已有冲突草稿则就地更新，避免堆积
    const existing = state.drafts.find(
      (d) => d.recordId === recordId && (d.kind === "conflict" || d.kind === "edit")
    );
    const conflictDraft: Draft = existing
      ? {
          ...existing,
          kind: "conflict",
          baseRevision,
          data: input,
          savedAt: at,
          conflict: {
            revision: current.revision,
            by: current.updatedBy ?? current.submittedBy,
            at: current.updatedAt ?? current.submittedAt,
          },
        }
      : {
          id: `conflict-${recordId}-${Date.now()}`,
          kind: "conflict",
          recordId,
          baseRevision,
          data: input,
          savedAt: at,
          conflict: {
            revision: current.revision,
            by: current.updatedBy ?? current.submittedBy,
            at: current.updatedAt ?? current.submittedAt,
          },
        };
    upsertDraft(conflictDraft);
    addAudit(actor, "版本冲突", recordId, `基于 v${baseRevision} 保存被拒，最新为 v${current.revision}，草稿已保留`, {
      recordVersion: current.revision,
      thresholdVersion: current.thresholdVersionLabel,
    });
    emit();
    return {
      ok: false,
      code: "conflict",
      message: `版本冲突：该记录已被 ${current.updatedBy ?? current.submittedBy} 保存为 v${current.revision}，你的草稿已保留`,
      conflict: {
        revision: current.revision,
        by: current.updatedBy ?? current.submittedBy,
        at: current.updatedAt ?? current.submittedAt,
      },
    };
  }

  const at = nowIso();
  // 历史记录沿用原阈值版本重新判定（判定口径不变，只反映新测量值）
  const lockedInput: InspectionInput = {
    ...input,
    thresholdVersionId: current.thresholdVersionId,
  };
  const { version, grade } = (() => {
    const version = findVersion(state.thresholdVersions, current.thresholdVersionId);
    return { version, grade: version.values[lockedInput.grade] };
  })();
  const { overall, results } = evaluateAll(lockedInput, grade, lockedInput.equipment);

  const updated: InspectionRecord = {
    ...current,
    room: lockedInput.room.trim(),
    grade: lockedInput.grade,
    metrics: { ...lockedInput.metrics },
    equipment: lockedInput.equipment,
    note: lockedInput.note.trim(),
    overall,
    results,
    // 阈值版本与快照保持原版本，体现“历史记录仍按原版本显示判定”
    thresholdSnapshot: grade,
    evaluatedAt: at,
    revision: current.revision + 1,
    updatedBy: actor,
    updatedAt: at,
    status: "pending_review",
    review: undefined,
  };
  state.records.splice(idx, 1, updated);
  removeDraft((d) => d.recordId === recordId);
  addAudit(actor, "保存编辑", recordId, `保存 v${updated.revision}，判定：${verdictName(overall)}（沿用阈值 ${version.label}）`, {
    recordVersion: updated.revision,
    thresholdVersion: version.label,
  });
  emit();
  return { ok: true, message: `${recordId} 已保存为 v${updated.revision}` };
}

export function reviewRecord(
  recordId: string,
  result: "approved" | "rejected",
  comment: string,
  actor: string
): ActionResult {
  const idx = state.records.findIndex((r) => r.id === recordId);
  if (idx < 0) return { ok: false, code: "missing", message: "记录不存在" };
  const current = state.records[idx];
  if (current.status === "approved") {
    return { ok: false, code: "locked", message: "已复核通过的记录不能重复复核" };
  }
  const at = nowIso();
  const updated: InspectionRecord = {
    ...current,
    revision: current.revision + 1,
    status: result === "approved" ? "approved" : "rejected",
    review: { result, by: actor, at, comment: comment.trim() || (result === "approved" ? "复核通过" : "复核驳回") },
    updatedBy: actor,
    updatedAt: at,
  };
  state.records.splice(idx, 1, updated);
  removeDraft((d) => d.recordId === recordId);
  addAudit(
    actor,
    result === "approved" ? "复核通过" : "复核驳回",
    recordId,
    result === "approved"
      ? `复核通过，记录锁定为 v${updated.revision}，此后不可修改`
      : `复核驳回（${comment || "无备注"}），巡检员可按原阈值版本修改后重新提交`,
    { recordVersion: updated.revision, thresholdVersion: current.thresholdVersionLabel }
  );
  emit();
  return { ok: true, message: result === "approved" ? "已复核通过并锁定" : "已驳回，等待巡检员修改" };
}

/** 发布新阈值版本（只追加，不改旧版本） */
export function publishThreshold(
  version: Omit<ThresholdVersion, "id" | "publishedAt">,
  actor: string
): ActionResult {
  if (state.thresholdVersions.some((v) => v.label === version.label)) {
    return { ok: false, code: "duplicate", message: `版本号 ${version.label} 已存在` };
  }
  const full: ThresholdVersion = { ...version, id: `thr-${version.label.replace(".", "-")}`, publishedAt: nowIso() };
  state.thresholdVersions = [...state.thresholdVersions, full];
  addAudit(actor, "阈值发布", `阈值版本 ${full.label}`, `${full.note || "发布新版本"}，生效时间 ${new Date(full.effectiveFrom).toLocaleString("zh-CN")}；只影响之后新建的记录`, {
    thresholdVersion: full.label,
  });
  emit();
  return { ok: true, message: `${full.label} 已发布，生效前当班版本不变` };
}

// ---------- 草稿 ----------

export function upsertDraft(draft: Draft): ActionResult {
  const idx = state.drafts.findIndex((d) => d.id === draft.id);
  if (idx >= 0) state.drafts.splice(idx, 1, draft);
  else state.drafts = [draft, ...state.drafts];
  persist();
  listeners.forEach((l) => l());
  return { ok: true };
}

export function saveNewDraft(input: InspectionInput): ActionResult {
  const existing = state.drafts.find((d) => d.kind === "new");
  let draftId: string;
  if (existing) {
    draftId = existing.id;
    upsertDraft({ ...existing, data: input, savedAt: nowIso() });
  } else {
    draftId = `draft-new-${Date.now()}`;
    upsertDraft({ id: draftId, kind: "new", data: input, savedAt: nowIso() });
  }
  return { ok: true, draftId };
}

export function saveEditDraft(
  recordId: string,
  baseRevision: number,
  input: InspectionInput
): ActionResult {
  const existing = state.drafts.find((d) => d.recordId === recordId && d.kind === "edit");
  let draftId: string;
  if (existing) {
    draftId = existing.id;
    upsertDraft({ ...existing, baseRevision, data: input, savedAt: nowIso(), conflict: undefined });
  } else {
    draftId = `draft-edit-${recordId}-${Date.now()}`;
    upsertDraft({
      id: draftId,
      kind: "edit",
      recordId,
      baseRevision,
      data: input,
      savedAt: nowIso(),
    });
  }
  return { ok: true, draftId };
}

export function discardDraft(id: string): ActionResult {
  removeDraft((d) => d.id === id);
  addAudit("当前用户", "丢弃草稿", id, "手动删除未提交草稿");
  emit();
  return { ok: true };
}

// ---------- 并发演示工具 ----------

/**
 * 模拟“另一个页面/另一班次的人”刚保存了该记录（revision+1）。
 * 用于在单机演示两个标签页的乐观锁冲突。
 */
export function simulateConcurrentSave(recordId: string, actor: string): ActionResult {
  const idx = state.records.findIndex((r) => r.id === recordId);
  if (idx < 0) return { ok: false, code: "missing", message: "记录不存在" };
  const current = state.records[idx];
  if (current.status === "approved") {
    return { ok: false, code: "locked", message: "已锁定记录不能被并发修改" };
  }
  const at = nowIso();
  const version = findVersion(state.thresholdVersions, current.thresholdVersionId);
  // 对方把备注改了，并把压差微调 +1（其余值不动）
  const metrics = { ...current.metrics, pressure: Number(current.metrics.pressure || 0) + 1 } as InspectionRecord["metrics"];
  const input: InspectionInput = {
    room: current.room,
    grade: current.grade,
    metrics,
    equipment: current.equipment,
    note: current.note + `（${actor} 已修改）`,
    thresholdVersionId: current.thresholdVersionId,
  };
  const { overall, results } = evaluateAll(input, version.values[input.grade], input.equipment);
  const updated: InspectionRecord = {
    ...current,
    metrics,
    note: input.note,
    overall,
    results,
    revision: current.revision + 1,
    status: "pending_review",
    review: undefined,
    updatedBy: actor,
    updatedAt: at,
    evaluatedAt: at,
  };
  state.records.splice(idx, 1, updated);
  addAudit(actor, "并发保存", recordId, `【另一页面】保存为 v${updated.revision}`, {
    recordVersion: updated.revision,
    thresholdVersion: version.label,
  });
  emit();
  return { ok: true, message: `已模拟另一页面保存 ${recordId} v${updated.revision}` };
}

export function resetDemo(actor: string): ActionResult {
  const seeded = seedData();
  state = seeded;
  addAudit(actor, "重置演示", "系统", "清空本地数据并恢复种子数据");
  emit();
  return { ok: true, message: "演示数据已重置" };
}

// ---------- 校验 / 工具 ----------

function validate(input: InspectionInput): string | null {
  if (!input.room.trim()) return "请填写房间编号";
  const missing: string[] = [];
  (Object.keys(input.metrics) as (keyof InspectionInput["metrics"])[]).forEach((k) => {
    if (input.metrics[k] === "" || Number.isNaN(Number(input.metrics[k]))) {
      missing.push(k);
    }
  });
  if (missing.length) return `请完整填写 ${missing.length} 项测量值`;
  return null;
}

function verdictName(v: InspectionRecord["overall"]): string {
  return v === "abnormal" ? "异常" : v === "watch" ? "关注" : "正常";
}

export function blankInput(thresholdVersionId: string): InspectionInput {
  return {
    room: "",
    grade: "ISO 5",
    metrics: emptyMetrics(),
    equipment: "正常",
    note: "",
    thresholdVersionId,
  };
}
