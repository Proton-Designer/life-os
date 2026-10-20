"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Highlighter } from "lucide-react";
import type { DocWords } from "@/lib/reader/doc-words";
import { blockSlotOf, wordIndexAtOffset } from "@/lib/reader/doc-words";
import { clampRange, rangesByBlock, segmentBlock, wordIsHighlighted, type WordRange } from "@/lib/reader/highlights";
import type { ReaderBlock, ReaderDoc } from "@/lib/reader/types";
import { cn } from "@/lib/utils";

// Saved highlights are a soft band behind the words, in the theme's focal colour.
const MARK_CLASS = "rounded-sm bg-[color-mix(in_srgb,var(--reader-focal)_28%,transparent)] text-inherit";

// Only the block holding the current word is split into per-word spans; every other block is one plain text node, so
// a 100k-word book stays a few thousand paragraphs. Tapping elsewhere finds the word from the caret position.
const StaticBlock = memo(function StaticBlock({ block, blockId, ranges }: { block: ReaderBlock; blockId: number; ranges: readonly WordRange[] }) {
  const Tag = block.kind === "h" ? "h2" : "p";
  return (
    <Tag
      data-block={blockId}
      data-first-word={block.firstWord}
      className={block.kind === "h" ? "mt-10 text-xl font-semibold leading-snug" : "mt-5"}
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 6rem" }}
    >
      {ranges.length === 0
        ? block.text
        : segmentBlock(block.text, block.firstWord, ranges).map((run, i) =>
            run.marked ? (
              <mark key={i} data-highlight className={MARK_CLASS}>
                {run.text}
              </mark>
            ) : (
              run.text
            )
          )}
    </Tag>
  );
});

function ActiveBlock({
  block,
  blockId,
  start,
  words,
  index,
  ranges,
  onSeek,
}: {
  block: ReaderBlock;
  blockId: number;
  start: number;
  words: string[];
  index: number;
  ranges: readonly WordRange[];
  onSeek: (wordIndex: number) => void;
}) {
  const Tag = block.kind === "h" ? "h2" : "p";
  return (
    <Tag data-block={blockId} data-first-word={start} className={block.kind === "h" ? "mt-10 text-xl font-semibold leading-snug" : "mt-5"}>
      {words.map((w, i) => {
        const active = start + i === index;
        return (
          <span key={i}>
            <span
              data-word={start + i}
              data-active={active ? "true" : undefined}
              data-highlight={!active && wordIsHighlighted(ranges, start + i) ? "" : undefined}
              onClick={() => onSeek(start + i)}
              className={active ? "rounded-sm bg-[var(--reader-hl-bg)] text-[var(--reader-hl-fg)]" : wordIsHighlighted(ranges, start + i) ? MARK_CLASS : undefined}
            >
              {w}
            </span>
            {i < words.length - 1 ? " " : null}
          </span>
        );
      })}
    </Tag>
  );
}

function caretOffsetAt(x: number, y: number): { node: Node; offset: number } | null {
  const d = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const pos = d.caretPositionFromPoint?.(x, y);
  if (pos) return { node: pos.offsetNode, offset: pos.offset };
  const range = d.caretRangeFromPoint?.(x, y);
  if (range) return { node: range.startContainer, offset: range.startOffset };
  return null;
}

export function PageView({
  doc,
  dw,
  index,
  playing,
  fontScale,
  highlights = [],
  onSeek,
  onHighlight,
}: {
  doc: ReaderDoc;
  dw: DocWords;
  index: number;
  playing: boolean;
  fontScale: number;
  /** Saved highlight ranges (global word indices), drawn over the text. */
  highlights?: readonly WordRange[];
  onSeek: (wordIndex: number) => void;
  /** The person chose "Highlight" for the text they selected. */
  onHighlight?: (range: WordRange) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const programmaticUntil = useRef(0);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const blockRanges = useMemo(() => rangesByBlock(dw, highlights), [dw, highlights]);
  const [selection, setSelection] = useState<WordRange | null>(null);

  // Track what the person has selected, as a word range, so "Highlight" saves whole words however the selection was dragged.
  useEffect(() => {
    if (!onHighlight) return;
    function wordAt(node: Node, offset: number, isEnd: boolean): number | null {
      const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
      const wordEl = el?.closest<HTMLElement>("[data-word]");
      if (wordEl) return Number(wordEl.dataset.word);
      const blockEl = el?.closest<HTMLElement>("[data-block]");
      if (!blockEl) return null;
      const id = Number(blockEl.dataset.block);
      const block = doc.blocks[id];
      const first = Number(blockEl.dataset.firstWord);
      if (!block || !Number.isFinite(first)) return null;
      const r = document.createRange();
      r.selectNodeContents(blockEl);
      r.setEnd(node, offset);
      const chars = r.toString().length;
      return first + wordIndexAtOffset(block.text, isEnd ? Math.max(0, chars - 1) : chars);
    }
    function onSelectionChange() {
      const sel = document.getSelection();
      const root = scrollRef.current;
      if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !root) return setSelection(null);
      const range = sel.getRangeAt(0);
      if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return setSelection(null);
      const a = wordAt(range.startContainer, range.startOffset, false);
      const b = wordAt(range.endContainer, range.endOffset, true);
      if (a === null || b === null) return setSelection(null);
      setSelection(clampRange({ start: Math.min(a, b), end: Math.max(a, b) }));
    }
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [doc, onHighlight]);

  const slot = dw.blockStarts.length === 0 ? -1 : blockSlotOf(dw, index);
  const activeBlockId = slot < 0 ? -1 : dw.blockIds[slot];
  const firstWordOfBlock = new Map<number, number>();
  dw.blockIds.forEach((id, s) => firstWordOfBlock.set(id, dw.blockStarts[s]));

  // Keep the current word in the middle band of the page while reading advances or after a seek elsewhere.
  useEffect(() => {
    const root = scrollRef.current;
    const el = root?.querySelector<HTMLElement>('[data-active="true"]');
    if (!root || !el) return;
    const r = root.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    const inBand = e.top >= r.top + r.height * 0.2 && e.bottom <= r.top + r.height * 0.8;
    if (inBand) return;
    programmaticUntil.current = Date.now() + 700;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: playing || reduce ? "auto" : "smooth" });
  }, [index, playing]);

  useEffect(() => () => {
    if (settle.current) clearTimeout(settle.current);
  }, []);

  // Reading by scrolling: once the user stops scrolling, and the current word is off screen, the position follows the
  // first paragraph on screen. Programmatic scrolls above are ignored so this never fights the auto-follow.
  function onScroll() {
    if (playing || Date.now() < programmaticUntil.current) return;
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      const root = scrollRef.current;
      if (!root) return;
      const r = root.getBoundingClientRect();
      const cur = root.querySelector<HTMLElement>('[data-active="true"]');
      if (cur) {
        const c = cur.getBoundingClientRect();
        if (c.bottom > r.top && c.top < r.bottom) return;
      }
      for (const el of root.querySelectorAll<HTMLElement>("[data-block]")) {
        if (el.getBoundingClientRect().bottom > r.top + 24) {
          const first = Number(el.dataset.firstWord);
          if (Number.isFinite(first)) onSeek(first);
          return;
        }
      }
    }, 250);
  }

  function onClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest("[data-word]")) return; // the active block's own spans handle themselves
    const blockEl = target.closest<HTMLElement>("[data-block]");
    if (!blockEl) return;
    const blockId = Number(blockEl.dataset.block);
    const block = doc.blocks[blockId];
    const first = firstWordOfBlock.get(blockId);
    if (!block || first === undefined) return;
    const caret = caretOffsetAt(e.clientX, e.clientY);
    const within = caret && blockEl.contains(caret.node) ? wordIndexAtOffset(block.text, caret.offset) : 0;
    onSeek(first + within);
  }

  return (
    <div className="relative h-full">
    <div
      ref={scrollRef}
      onScroll={onScroll}
      onClick={onClick}
      data-testid="page-view"
      className="h-full overflow-y-auto overscroll-contain px-5 pb-24 pt-2 [-webkit-overflow-scrolling:touch]"
    >
      <article
        className="mx-auto max-w-[40rem] font-serif leading-[1.75]"
        style={{ fontSize: `calc(1.125rem * ${fontScale})` }}
      >
        {doc.blocks.map((block, id) => {
          const first = firstWordOfBlock.get(id);
          if (first === undefined) return null;
          if (id === activeBlockId) {
            const end = (dw.blockStarts[slot + 1] ?? dw.words.length);
            return (
              <ActiveBlock key={id} block={block} blockId={id} start={first} words={dw.words.slice(first, end)} index={index} ranges={blockRanges.get(id)} onSeek={onSeek} />
            );
          }
          return <StaticBlock key={id} block={block} blockId={id} ranges={blockRanges.get(id)} />;
        })}
      </article>
    </div>
    {selection && onHighlight ? (
      <button
        type="button"
        data-testid="highlight-selection"
        // Keep the text selected while the button is pressed (a click would otherwise collapse it first on some browsers).
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => {
          onHighlight(selection);
          document.getSelection()?.removeAllRanges();
          setSelection(null);
        }}
        className={cn(
          "absolute bottom-3 left-1/2 flex min-h-11 -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--reader-border)]",
          "bg-[var(--reader-surface)] px-5 text-sm font-medium text-[var(--reader-fg)] shadow-lg"
        )}
      >
        <Highlighter className="size-4" aria-hidden />
        Highlight
      </button>
    ) : null}
    </div>
  );
}
