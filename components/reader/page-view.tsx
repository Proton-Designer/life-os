"use client";

import { memo, useEffect, useRef } from "react";
import type { DocWords } from "@/lib/reader/doc-words";
import { blockSlotOf, wordIndexAtOffset } from "@/lib/reader/doc-words";
import type { ReaderBlock, ReaderDoc } from "@/lib/reader/types";

// Only the block holding the current word is split into per-word spans; every other block is one plain text node, so
// a 100k-word book stays a few thousand paragraphs. Tapping elsewhere finds the word from the caret position.
const StaticBlock = memo(function StaticBlock({ block, blockId }: { block: ReaderBlock; blockId: number }) {
  const Tag = block.kind === "h" ? "h2" : "p";
  return (
    <Tag
      data-block={blockId}
      data-first-word={block.firstWord}
      className={block.kind === "h" ? "mt-10 text-xl font-semibold leading-snug" : "mt-5"}
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 6rem" }}
    >
      {block.text}
    </Tag>
  );
});

function ActiveBlock({
  block,
  blockId,
  start,
  words,
  index,
  onSeek,
}: {
  block: ReaderBlock;
  blockId: number;
  start: number;
  words: string[];
  index: number;
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
              onClick={() => onSeek(start + i)}
              className={active ? "rounded-sm bg-[var(--reader-hl-bg)] text-[var(--reader-hl-fg)]" : undefined}
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
  onSeek,
}: {
  doc: ReaderDoc;
  dw: DocWords;
  index: number;
  playing: boolean;
  fontScale: number;
  onSeek: (wordIndex: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const programmaticUntil = useRef(0);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        {/* R7 slot: saved highlight ranges are drawn over these blocks. */}
        {doc.blocks.map((block, id) => {
          const first = firstWordOfBlock.get(id);
          if (first === undefined) return null;
          if (id === activeBlockId) {
            const end = (dw.blockStarts[slot + 1] ?? dw.words.length);
            return (
              <ActiveBlock key={id} block={block} blockId={id} start={first} words={dw.words.slice(first, end)} index={index} onSeek={onSeek} />
            );
          }
          return <StaticBlock key={id} block={block} blockId={id} />;
        })}
      </article>
    </div>
  );
}
