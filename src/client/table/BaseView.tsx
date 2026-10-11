import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { GameView } from "../../protocol/messages.ts";
import { Card } from "../cards/Card.tsx";
import { layoutOf, type Placement } from "./layout.ts";
import styles from "./BaseView.module.css";

type Base = GameView["players"][number]["base"];
const CELL = 90;
const PAD = 18;

/** What a pending decision offers on this Base: cells to pick and a card not yet in it. */
export interface Offer {
  /** One outline per cell; each is a button with this name. */
  readonly cells: readonly { readonly x: number; readonly y: number; readonly label: string }[];
  /** The card as it would lie; a press on it is `onPreview`. */
  readonly preview: (Placement & { readonly cardId: string; readonly label: string }) | null;
  /** Every placement the offer can show: the Base is fitted around all of them. */
  readonly extent: readonly Placement[];
  readonly onCell: (x: number, y: number) => void;
  readonly onPreview: () => void;
}

interface BaseViewProps {
  readonly base: Base;
  readonly small?: boolean;
  /** Instances of cards to mark: a pending decision points at them. */
  readonly highlighted?: ReadonlySet<string>;
  readonly offer?: Offer;
  readonly targets?: ReadonlyMap<string, { label: string; onPress: () => void }>;
}

/** A press on a control of the stage is a press, not the start of a drag of the Base. */
function keepFromDrag(event: PointerEvent): void {
  event.stopPropagation();
}

export function BaseView({ base, small = false, highlighted, offer, targets }: BaseViewProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState({ width: small ? 130 : 600, height: small ? 80 : 360 });
  const [zoom, setZoom] = useState<number | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const cards = useMemo(
    () => [
      { instance: base.station.instance, cardId: base.station.cardId, x: 0, y: 0, q: 0 as const },
      ...base.modules,
    ],
    [base],
  );
  const boxes = cards.map((card) => layoutOf(card, CELL));
  // The stage holds the cards and whatever the offer can draw beside them.
  const reach = [...boxes, ...(offer?.extent ?? []).map((placement) => layoutOf(placement, CELL))];
  const left = Math.min(...reach.map((box) => box.x));
  const top = Math.min(...reach.map((box) => box.y));
  const width = Math.max(...reach.map((box) => box.x + box.width)) - left;
  const height = Math.max(...reach.map((box) => box.y + box.height)) - top;
  const preview = offer?.preview ?? null;
  const previewBox = preview === null ? null : layoutOf(preview, CELL);
  const padding = small ? 3 : PAD;
  const fit = Math.min(
    1.5,
    (size.width - padding * 2) / width,
    (size.height - padding * 2) / height,
  );
  const scale = zoom ?? fit;
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => {
      if (element.clientWidth && element.clientHeight) {
        setSize({ width: element.clientWidth, height: element.clientHeight });
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => {
        window.removeEventListener("resize", measure);
      };
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const changeZoom = (factor: number) => {
    setZoom(Math.max(0.15, Math.min(3, scale * factor)));
  };
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element || small) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom((current) =>
        Math.max(0.15, Math.min(3, (current ?? fit) * (event.deltaY < 0 ? 1.1 : 1 / 1.1))),
      );
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", onWheel);
    };
  }, [fit, small]);
  return (
    <div className={`${styles.view} ${small ? styles.small : ""}`}>
      {!small && (
        <div className={styles.controls}>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => {
              changeZoom(1.25);
            }}
          >
            +
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => {
              changeZoom(0.8);
            }}
          >
            −
          </button>
          <button
            type="button"
            aria-label="Fit Base"
            onClick={() => {
              setZoom(null);
              setPan({ x: 0, y: 0 });
            }}
          >
            Fit
          </button>
        </div>
      )}
      <div
        ref={viewport}
        className={styles.viewport}
        data-testid="base-viewport"
        data-scale={scale}
        data-fitted={zoom === null && pan.x === 0 && pan.y === 0}
        tabIndex={small ? undefined : 0}
        aria-label={small ? "Base preview" : "Base grid; drag or use arrow keys to pan"}
        onPointerDown={
          small
            ? undefined
            : (event) => {
                if ((event.target as Element).closest("button")) return;
                dragging.current = { x: event.clientX, y: event.clientY };
                event.currentTarget.setPointerCapture(event.pointerId);
              }
        }
        onPointerMove={
          small
            ? undefined
            : (event) => {
                if (!dragging.current) return;
                const delta = {
                  x: event.clientX - dragging.current.x,
                  y: event.clientY - dragging.current.y,
                };
                dragging.current = { x: event.clientX, y: event.clientY };
                setPan((current) => ({ x: current.x + delta.x, y: current.y + delta.y }));
              }
        }
        onPointerUp={
          small
            ? undefined
            : () => {
                dragging.current = null;
              }
        }
        onPointerCancel={
          small
            ? undefined
            : () => {
                dragging.current = null;
              }
        }
        onKeyDown={
          small
            ? undefined
            : (event) => {
                const shift: Partial<Record<string, [number, number]>> = {
                  ArrowLeft: [-30, 0],
                  ArrowRight: [30, 0],
                  ArrowUp: [0, -30],
                  ArrowDown: [0, 30],
                };
                const move = shift[event.key];
                if (move !== undefined) {
                  event.preventDefault();
                  setPan((current) => ({ x: current.x + move[0], y: current.y + move[1] }));
                }
                if (event.key === "+" || event.key === "=" || event.key === "NumpadAdd") {
                  event.preventDefault();
                  changeZoom(1.25);
                } else if (event.key === "-" || event.key === "NumpadSubtract") {
                  event.preventDefault();
                  changeZoom(0.8);
                }
              }
        }
      >
        <div
          className={styles.stage}
          style={{
            width,
            height,
            left: `calc(50% + ${String(pan.x)}px)`,
            top: `calc(50% + ${String(pan.y)}px)`,
            transform: `translate(-50%, -50%) scale(${String(scale)})`,
          }}
        >
          {cards.map((card, index) => {
            const box = boxes[index];
            return (
              <div
                key={card.instance}
                className={styles.box}
                data-testid="base-card"
                data-card={small ? undefined : card.instance}
                data-highlighted={highlighted?.has(card.instance) === true ? "" : undefined}
                data-grid-x={box.x / CELL}
                data-grid-y={box.y / CELL}
                data-grid-width={box.width / CELL}
                data-grid-height={box.height / CELL}
                style={{
                  left: box.x - left,
                  top: box.y - top,
                  width: box.width,
                  height: box.height,
                }}
              >
                <span className={styles.center}>
                  <Card cardId={card.cardId} width={CELL} turns={(card as Placement).q} />
                </span>
                {!small && targets?.has(card.instance) && (
                  <button
                    type="button"
                    className={styles.target}
                    aria-label={targets.get(card.instance)?.label}
                    onClick={targets.get(card.instance)?.onPress}
                  />
                )}
              </div>
            );
          })}
          {preview === null || previewBox === null ? null : (
            <button
              type="button"
              className={`${styles.box} ${styles.preview}`}
              aria-label={preview.label}
              data-offer-preview=""
              data-turns={preview.q}
              data-grid-x={previewBox.x / CELL}
              data-grid-y={previewBox.y / CELL}
              data-grid-width={previewBox.width / CELL}
              data-grid-height={previewBox.height / CELL}
              style={{
                left: previewBox.x - left,
                top: previewBox.y - top,
                width: previewBox.width,
                height: previewBox.height,
              }}
              onPointerDown={keepFromDrag}
              onClick={offer?.onPreview}
            >
              <span className={styles.center}>
                <Card cardId={preview.cardId} width={CELL} turns={preview.q} />
              </span>
            </button>
          )}
          {offer?.cells.map((cell) => (
            <button
              key={`${String(cell.x)},${String(cell.y)}`}
              type="button"
              className={styles.cell}
              aria-label={cell.label}
              data-offer-cell={`${String(cell.x)},${String(cell.y)}`}
              style={{
                left: cell.x * CELL - left,
                top: cell.y * CELL - top,
                width: CELL,
                height: CELL,
              }}
              onPointerDown={keepFromDrag}
              onClick={() => {
                offer.onCell(cell.x, cell.y);
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
