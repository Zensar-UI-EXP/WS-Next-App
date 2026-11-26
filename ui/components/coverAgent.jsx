import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { decideCoverAgent, errorMessage, getCoverAgent, startCoverAgent } from "../api.js";
import { coverFromTemplate } from "../cover.js";
import CoverSheet from "./CoverSheet.jsx";

/** The options the cover agent works on (mirrors lib/coverAgent.ts AGENT_KEYS); the cover's words stay with the wealth manager. */
export const AGENT_KEYS = [
  "layout", "band", "bandAngle", "image", "overlay", "titlePosition", "titleAlign",
  "theme", "logo", "logoPosition", "logoSize", "coBrand", "businessTag",
  "titleFont", "titleSize", "titleWeight", "letterSpacing", "eyebrowCase",
  "language", "salutation", "rmCard",
];
const WATCHED = [...AGENT_KEYS, "templateId"];
const WORDS = ["eyebrow", "title", "subtitle", "reportType", "headline", "note"];
const TYPED = ["coBrand", "overlay"]; // typed or dragged: wait until the wealth manager stops
const TYPED_MS = 700;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const changedKeys = (from, to) => WATCHED.filter((k) => !same(from?.[k], to?.[k]));

/** Applies changes to a cover. A template switch starts from the template and keeps the cover's words. */
export function applyProposals(cover, items, templates) {
  const t = items.find((p) => p.key === "templateId");
  const template = t && templates.find((x) => x.coverTemplateId === Number(t.value) && x.approved);
  let next = template ? coverFromTemplate(template, Object.fromEntries(WORDS.map((k) => [k, cover[k]]))) : { ...cover };
  for (const p of items) if (p.key !== "templateId") next = { ...next, [p.key]: p.value };
  return next;
}

/** What the drawn cover's measurements say is wrong (empty when it works). */
export function coverProblems(m) {
  if (!m) return [];
  return [
    m.titleLines > 2 ? `the title takes ${m.titleLines} lines` : null,
    ...(m.overlaps ?? []),
    m.contentRunsIntoFooter ? "the text runs into the footer" : null,
    m.contentOutsidePage ? "the text runs off the page" : null,
  ].filter(Boolean);
}

/**
 * The cover agent for a report (V9). When the Cover tab opens it plans ahead in one call: its recommendations (★) and, for
 * each choice the wealth manager may make next, which other options go with it. A planned choice is applied at once, with no
 * call. The browser then measures the drawn cover; if the choice was not planned, or the drawing fails a check, one quick call
 * decides what else to change. The agent's changes are applied straight away and can be undone.
 */
export function useCoverAgent({ kind, id, cover, ctx, templates, onChange, enabled }) {
  const [plan, setPlan] = useState(null);
  const [last, setLast] = useState(null);      // the latest choice and what the agent changed with it
  const [working, setWorking] = useState(null); // "plan" | "decide"
  const [error, setError] = useState(null);
  const [usage, setUsage] = useState(null);
  const settled = useRef(cover);     // the cover the agent has already handled
  const latest = useRef(cover);
  latest.current = cover;
  const planRef = useRef(plan);
  planRef.current = plan;
  const userKeys = useRef(new Set()); // options the wealth manager chose themselves: the agent leaves them alone
  const seq = useRef(0);
  const deciding = useRef(0);
  const planning = useRef(false);
  const timer = useRef(null);
  const hasCover = !!cover;

  const refreshUsage = useCallback(() => getCoverAgent(kind, id).then((d) => setUsage(d.totals)).catch(() => {}), [kind, id]);
  const record = (runId, body) => runId && decideCoverAgent(kind, id, runId, body).catch(() => {});

  const makePlan = useCallback(async () => {
    if (planning.current) return;
    planning.current = true;
    setWorking("plan");
    setError(null);
    try {
      const sent = latest.current;
      const measurements = await measureCover(sent, ctx).catch(() => null);
      // How each template draws on its own settings, so the plan can fix what a switch would break (no call when it is picked).
      const templateMeasurements = {};
      for (const t of templates.filter((x) => x.approved)) {
        const start = applyProposals(sent, [{ key: "templateId", value: t.coverTemplateId }], templates);
        const m = await measureCover(start, ctx).catch(() => null);
        if (!m) continue;
        // A title too long for the template: which size and weight keep it to two lines.
        if (m.titleLines > 2) {
          m.titleFits = [];
          for (const titleSize of ["l", "m", "s"]) for (const titleWeight of ["bold", "regular"]) {
            const f = await measureCover({ ...start, titleSize, titleWeight }, ctx).catch(() => null);
            if (f && f.titleLines <= 2) m.titleFits.push({ titleSize, titleWeight });
          }
        }
        templateMeasurements[t.coverTemplateId] = m;
      }
      setPlan(await startCoverAgent(kind, id, { mode: "plan", cover: sent, measurements, templateMeasurements }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      planning.current = false;
      setWorking(deciding.current ? "decide" : null);
      refreshUsage();
    }
  }, [kind, id, ctx, templates, refreshUsage]);

  // The kept plan, or a new one the first time the tab opens with a designed cover.
  useEffect(() => {
    if (!enabled || !hasCover) return;
    let gone = false;
    getCoverAgent(kind, id).then((d) => {
      if (gone) return;
      setUsage(d.totals);
      if (d.plan) setPlan(d.plan);
      else makePlan();
    }).catch((e) => setError(errorMessage(e)));
    return () => { gone = true; };
  }, [kind, id, enabled, hasCover, makePlan]);

  const react = useCallback(async () => {
    const previous = settled.current, chosen = latest.current;
    const keys = changedKeys(previous, chosen);
    if (!keys.length) return;
    const my = ++seq.current;
    // A template switch is one choice: it brings the template's own settings, so earlier choices no longer hold.
    const choice = keys.includes("templateId") ? ["templateId"] : keys;
    if (choice[0] === "templateId") userKeys.current = new Set();
    choice.forEach((k) => userKeys.current.add(k));
    const label = { keys: choice, cover: chosen };

    // 1. The plan: applied at once.
    const p = planRef.current;
    const entry = choice.length === 1 && p?.plan?.find((e) => e.key === choice[0] && same(e.value, chosen[choice[0]]));
    const planned = entry ? entry.changes.filter((c) => !userKeys.current.has(c.key) && !same(chosen[c.key], c.value))
      .map((c) => ({ ...c, current: chosen[c.key], by: "plan" })) : [];
    const next = planned.length ? applyProposals(chosen, planned, templates) : chosen;
    settled.current = next;
    if (planned.length) {
      onChange(next);
      record(p.runId, { applied: planned.map(({ key, value }) => ({ key, value })), after: choice.join(", ") });
      setPlan((x) => x && { ...x, recommendations: x.recommendations.filter((r) => !planned.some((c) => c.key === r.key)) });
    }
    setLast({ choice: label, changes: planned, source: entry ? "plan" : null, pending: true });

    // 2. Check the drawing: a planned choice that works needs no call.
    const measurements = await measureCover(next, ctx).catch(() => null);
    if (my !== seq.current) return;
    const problems = coverProblems(measurements);
    if (entry && !problems.length) { setLast({ choice: label, changes: planned, source: "plan" }); return; }

    // 3. One quick call decides what else goes with it.
    deciding.current++;
    setWorking("decide");
    try {
      const out = await startCoverAgent(kind, id, {
        mode: "decide", cover: next, previous, changedKeys: choice, userKeys: [...userKeys.current], measurements,
        planned: planned.map(({ key, value, reason }) => ({ key, value, reason })),
      });
      // Changed again meanwhile: that choice gets its own answer.
      if (my !== seq.current || !same(latest.current, next)) return;
      const changes = out.changes.filter((c) => !userKeys.current.has(c.key)).map((c) => ({ ...c, current: next[c.key], by: "agent" }));
      if (changes.length) {
        const after = applyProposals(next, changes, templates);
        settled.current = after;
        onChange(after);
        record(out.runId, { applied: changes.map(({ key, value }) => ({ key, value })), after: choice.join(", ") });
        setPlan((x) => x && { ...x, recommendations: x.recommendations.filter((r) => !changes.some((c) => c.key === r.key)) });
      }
      // One line per option: undo goes back to the value before the plan or the agent touched it.
      const merged = [...planned.filter((c) => !changes.some((d) => d.key === c.key)),
        ...changes.map((c) => ({ ...c, current: planned.find((d) => d.key === c.key)?.current ?? c.current }))];
      setLast({ choice: label, changes: merged, source: entry ? "plan+agent" : "agent", problems, summary: out.summary, ms: out.ms, tokens: out.tokens, runId: out.runId });
    } catch (e) {
      // The agent could not check this choice: say so, and show only what the plan already changed.
      if (my === seq.current) { setError(errorMessage(e)); setLast(planned.length ? { choice: label, changes: planned, source: "plan" } : null); }
    } finally {
      deciding.current--;
      if (!deciding.current) setWorking(planning.current ? "plan" : null);
      refreshUsage();
    }
  }, [kind, id, ctx, templates, onChange, refreshUsage]);
  const reactRef = useRef(react);
  reactRef.current = react; // onChange is a new function on every render; the timer must not restart because of it

  // Every choice in the Cover tab goes through the agent; typing and dragging wait until the wealth manager stops.
  useEffect(() => {
    if (!enabled || !cover) return;
    if (!settled.current) { settled.current = cover; return; }
    const keys = changedKeys(settled.current, cover);
    if (!keys.length) return;
    setError(null);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => reactRef.current(), keys.every((k) => TYPED.includes(k)) ? TYPED_MS : 0);
    return () => clearTimeout(timer.current);
  }, [cover, enabled]);

  const take = (items) => {
    const next = applyProposals(latest.current, items, templates);
    settled.current = next; // the agent's own advice is not a new choice to react to
    onChange(next);
  };

  return {
    plan, last, working, error, usage,
    makePlan,
    applyRecommendation: (keys) => {
      // A template switch brings the template's own settings, so the other recommendations go on top of it again.
      const items = plan.recommendations.filter((p) => keys.includes(p.key) || (keys.length > 1 && keys.includes("templateId")));
      items.forEach((p) => userKeys.current.add(p.key));
      take(items);
      record(plan.runId, { applied: items.map(({ key, value }) => ({ key, value })), after: "recommendations" });
    },
    /** Puts the options the agent changed back to what they were; the agent then leaves them alone. */
    undo: (keys) => {
      const items = (last?.changes ?? []).filter((c) => keys.includes(c.key) && !c.undone);
      if (!items.length) return;
      items.forEach((c) => userKeys.current.add(c.key));
      take(items.map((c) => ({ key: c.key, value: c.current })));
      const runId = last.runId ?? plan?.runId;
      record(runId, { undone: items.map((c) => c.key), after: last.choice.keys.join(", ") });
      setLast({ ...last, changes: last.changes.map((c) => (keys.includes(c.key) ? { ...c, undone: true } : c)) });
    },
    clearLast: () => setLast(null),
  };
}

// ---------- drawing the cover to measure it ----------

/** Draws the cover off-screen and measures it (title lines, overlaps, text in the footer). No picture is taken. */
export async function measureCover(settings, ctx) {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:560px;pointer-events:none;";
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(<CoverSheet cover={settings} ctx={ctx} />));
    await document.fonts.ready;
    return measure(host.querySelector(".cover-sheet"));
  } finally {
    root.unmount();
    host.remove();
  }
}

function measure(sheet) {
  const box = (el) => el && el.getBoundingClientRect();
  const page = box(sheet);
  const parts = {
    logo: box(sheet.querySelector(".cv-logo")), businessTag: box(sheet.querySelector(".cv-tag")), title: box(sheet.querySelector(".cv-title")),
    footer: box(sheet.querySelector(".cv-foot")), rmCard: box(sheet.querySelector(".cv-rm")), image: box(sheet.querySelector(".cv-image")),
  };
  const children = [...sheet.querySelectorAll(".cv-body > *")].map(box);
  const content = children.length ? {
    top: Math.min(...children.map((b) => b.top)), bottom: Math.max(...children.map((b) => b.bottom)),
    left: Math.min(...children.map((b) => b.left)), right: Math.max(...children.map((b) => b.right)),
  } : null;
  const hit = (a, b) => a && b && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
  const overlaps = [["logo", "title"], ["logo", "footer"], ["logo", "businessTag"], ["businessTag", "title"], ["rmCard", "footer"], ["logo", "rmCard"]]
    .filter(([a, b]) => hit(parts[a], parts[b])).map(([a, b]) => `${a} overlaps ${b}`);
  if (hit(parts.logo, content) && !overlaps.includes("logo overlaps title")) overlaps.push("logo overlaps the cover text");
  const title = sheet.querySelector(".cv-title");
  const style = title && getComputedStyle(title);
  const lineHeight = style ? parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.08 : 0;
  const eyebrow = sheet.querySelector(".cv-eyebrow");
  const eyebrowStyle = eyebrow && getComputedStyle(eyebrow);
  const px = (n) => Math.round(n);
  return {
    pageSize: `${px(page.width)}x${px(page.height)}`,
    textColumnWidth: content ? px(content.right - content.left) : null,
    titleLines: title && lineHeight ? Math.round(parts.title.height / lineHeight) : 0,
    eyebrowLines: eyebrow ? Math.round(box(eyebrow).height / (parseFloat(eyebrowStyle.lineHeight) || 12)) : 0,
    titleFontSize: style ? style.fontSize : null,
    titleOnImage: !!hit(parts.title, parts.image),
    overlaps,
    contentRunsIntoFooter: !!(content && parts.footer && content.bottom > parts.footer.top + 1),
    contentOutsidePage: !!(content && (content.top < page.top || content.bottom > page.bottom || content.left < page.left || content.right > page.right + 1)),
  };
}
