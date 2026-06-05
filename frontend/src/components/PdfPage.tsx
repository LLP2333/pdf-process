import { forwardRef, useEffect, useRef, useState } from "react";
import { Stage, Layer, Image as KImage, Line, Circle, Rect, Text, Group } from "react-konva";
import type Konva from "konva";
import type { DerivedQuestion, Divider, PageInfo } from "../types";

interface Props {
  page: PageInfo;
  dividers: Divider[];
  questions: DerivedQuestion[];
  activeQuestionIndex: number | null;
  /** 单击空白处:在该页 y 处新建一条分割线。 */
  onAddDivider: (page: number, y: number) => void;
  /** Shift+单击分割线 或 点击 × 按钮:删除该分割线。 */
  onRemoveDivider: (id: string) => void;
  /** 拖动分割线:仅修改 y(同页内移动)。 */
  onMoveDivider: (id: string, y: number) => void;
  /** 单击分割线(无 Shift):选中分割线下方那道题。 */
  onSelectQuestion: (qi: number) => void;
}

const MAX_DISPLAY_WIDTH = 920;

/**
 * 单页 PDF + 透明 Konva 叠加层。
 *
 * 交互模型:
 * - 在空白处单击:新增分割线
 * - 拖动分割线:调整 y
 * - Shift+单击 / 点 × :删除
 * - 单击:选中下方的题目并高亮
 *
 * 用 `forwardRef` 暴露外层 DOM,方便上层 `scrollIntoView`。
 */
const PdfPage = forwardRef<HTMLDivElement, Props>(function PdfPage(
  {
    page,
    dividers,
    questions,
    activeQuestionIndex,
    onAddDivider,
    onRemoveDivider,
    onMoveDivider,
    onSelectQuestion,
  },
  ref,
) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = new window.Image();
    img.src = page.image_url;
    img.onload = () => setImage(img);
  }, [page.image_url]);

  const displayWidth = Math.min(page.image_width, MAX_DISPLAY_WIDTH);
  const scale = displayWidth / page.image_width;
  const displayHeight = page.image_height * scale;
  const pdfToDisplay = displayHeight / page.height;

  const pageDividers = dividers
    .filter((d) => d.page === page.index)
    .sort((a, b) => a.y - b.y);

  const stageRef = useRef<Konva.Stage>(null);

  /** 找出穿过本页的所有题目区间(用于显示题号大字 + 选中高亮)。 */
  const pageRanges = questions
    .map((q, qi) => {
      const seg = q.segments.find((s) => s.page === page.index);
      if (!seg) return null;
      return { qi, no: q.no, y1: Math.min(seg.y1, seg.y2), y2: Math.max(seg.y1, seg.y2) };
    })
    .filter((r): r is { qi: number; no: number; y1: number; y2: number } => r !== null);

  const handleStageClick = (evt: Konva.KonvaEventObject<MouseEvent>) => {
    // 点到非 Stage 子节点(例如分割线 Group)时,evt.target !== stage,跳过新增分割线
    const stage = evt.target.getStage();
    if (!stage) return;
    if (evt.target !== stage) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    const yPdf = clamp(pos.y / pdfToDisplay, 0, page.height);
    onAddDivider(page.index, yPdf);
  };

  return (
    <div ref={ref} className="pdf-page" data-page={page.index}>
      <div className="pdf-page-head">
        <span className="pdf-page-no">第 {page.index + 1} 页</span>
        <span className="pdf-page-hint">
          单击 = 新增分割线 · 拖动 = 调整 · Shift+单击 / × = 删除
        </span>
      </div>
      <div
        className="pdf-page-stage"
        style={{ width: displayWidth, height: displayHeight }}
      >
        {image && (
          <img
            className="pdf-page-img"
            src={page.image_url}
            alt={`page-${page.index + 1}`}
            style={{ width: displayWidth, height: displayHeight }}
            draggable={false}
          />
        )}
        <Stage
          ref={stageRef}
          width={displayWidth}
          height={displayHeight}
          onClick={handleStageClick}
          onTap={handleStageClick}
          className="pdf-page-stage-canvas"
        >
          <Layer>
            {image && (
              // 透明背景,仅用于命中 Stage onClick
              <KImage image={image} width={displayWidth} height={displayHeight} opacity={0} listening={false} />
            )}

            {/* 选中题目对应区间的高亮 */}
            {pageRanges
              .filter((r) => r.qi === activeQuestionIndex)
              .map((r) => (
                <Rect
                  key={`hl-${r.qi}`}
                  x={0}
                  y={r.y1 * pdfToDisplay}
                  width={displayWidth}
                  height={(r.y2 - r.y1) * pdfToDisplay}
                  fill="#22c55e"
                  opacity={0.1}
                  listening={false}
                />
              ))}

            {/* 题号水印:在每题在本页可见区间的中部画大数字 */}
            {pageRanges.map((r) => {
              const yMid = ((r.y1 + r.y2) / 2) * pdfToDisplay;
              return (
                <Text
                  key={`no-${r.qi}`}
                  x={6}
                  y={yMid - 14}
                  text={`#${r.no}`}
                  fontSize={20}
                  fontStyle="bold"
                  fill="#94a3b8"
                  opacity={r.qi === activeQuestionIndex ? 0.9 : 0.45}
                  listening={false}
                />
              );
            })}

            {/* 分割线 */}
            {pageDividers.map((d) => (
              <DividerLine
                key={d.id}
                divider={d}
                width={displayWidth}
                displayHeight={displayHeight}
                pdfToDisplay={pdfToDisplay}
                onRemove={() => onRemoveDivider(d.id)}
                onMove={(yDisplay) =>
                  onMoveDivider(d.id, clamp(yDisplay / pdfToDisplay, 0, page.height))
                }
                onSelectAdjacent={() => {
                  // 选中该分割线下方的题目(若有);否则上方
                  const idx = questions.findIndex((q) =>
                    q.segments.some(
                      (s) => s.page === d.page && Math.abs(Math.min(s.y1, s.y2) - d.y) < 1,
                    ),
                  );
                  if (idx >= 0) onSelectQuestion(idx);
                }}
              />
            ))}
          </Layer>
        </Stage>
      </div>
    </div>
  );
});

export default PdfPage;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

interface DividerLineProps {
  divider: Divider;
  width: number;
  displayHeight: number;
  pdfToDisplay: number;
  onRemove: () => void;
  onMove: (yDisplay: number) => void;
  onSelectAdjacent: () => void;
}

/** 一条可拖动 + 可单击 + 可 shift-删的分割线,含右侧 × 删除按钮。 */
function DividerLine({
  divider,
  width,
  displayHeight,
  pdfToDisplay,
  onRemove,
  onMove,
  onSelectAdjacent,
}: DividerLineProps) {
  const y = divider.y * pdfToDisplay;

  return (
    <Group
      x={0}
      y={y}
      draggable
      dragBoundFunc={(pos) => ({ x: 0, y: clamp(pos.y, 0, displayHeight) })}
      onDragMove={(e) => onMove(e.target.y())}
      onDragEnd={(e) => onMove(e.target.y())}
      onClick={(e) => {
        e.cancelBubble = true;
        if (e.evt.shiftKey) onRemove();
        else onSelectAdjacent();
      }}
      onTap={(e) => {
        // 触摸事件没有 shift,移动端只能选中(删除请通过 × 按钮)
        e.cancelBubble = true;
        onSelectAdjacent();
      }}
    >
      <Line
        points={[0, 0, width - 30, 0]}
        stroke="#dc2626"
        strokeWidth={2}
        dash={[6, 4]}
        hitStrokeWidth={14}
      />
      <Circle
        x={width - 16}
        y={0}
        radius={11}
        fill="#dc2626"
        stroke="#fff"
        strokeWidth={2}
        onClick={(e) => {
          e.cancelBubble = true;
          onRemove();
        }}
        onTap={(e) => {
          e.cancelBubble = true;
          onRemove();
        }}
      />
      <Text
        x={width - 24}
        y={-7}
        width={16}
        height={14}
        text="×"
        fontSize={14}
        fontStyle="bold"
        fill="#fff"
        align="center"
        verticalAlign="middle"
        listening={false}
      />
    </Group>
  );
}
