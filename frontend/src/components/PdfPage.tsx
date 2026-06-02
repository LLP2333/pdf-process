import { useEffect, useRef, useState } from "react";
import { Stage, Layer, Image as KImage, Line, Circle, Rect, Text } from "react-konva";
import type Konva from "konva";
import type { PageInfo, Question } from "../types";

interface PageLine {
  questionIndex: number;
  segmentIndex: number;
  edge: "y1" | "y2";
  no: number;
  yPdf: number;
  active: boolean;
}

interface Props {
  page: PageInfo;
  questions: Question[];
  activeQuestion: number | null;
  activeSegment: number | null;
  /** 双击页面:加 shift = 设 y1,否则 = 设 y2;若当前题在该页还没段则新建。 */
  onClickPage: (page: number, yPdf: number, shift: boolean) => void;
  /** 拖动某条线 */
  onDragLine: (
    questionIndex: number,
    segmentIndex: number,
    edge: "y1" | "y2",
    yPdf: number
  ) => void;
  /** 用户在本页"新建段"按钮 */
  onAddSegmentInPage: (page: number) => void;
  /** 选中段 */
  onSelectSegment: (questionIndex: number, segmentIndex: number) => void;
}

const MAX_DISPLAY_WIDTH = 920;

/** 把一页 PDF 渲染成图片 + Konva 透明层(用于绘制起始/结束行)。 */
export default function PdfPage({
  page,
  questions,
  activeQuestion,
  activeSegment,
  onClickPage,
  onDragLine,
  onAddSegmentInPage,
  onSelectSegment,
}: Props) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = new window.Image();
    img.src = page.image_url;
    img.onload = () => setImage(img);
  }, [page.image_url]);

  const displayWidth = Math.min(page.image_width, MAX_DISPLAY_WIDTH);
  const scale = displayWidth / page.image_width;
  const displayHeight = page.image_height * scale;
  const pdfToDisplay = displayHeight / page.height; // 1 pt -> displayHeight/page.height px

  const lines: PageLine[] = [];
  questions.forEach((q, qi) => {
    q.segments.forEach((seg, si) => {
      if (seg.page !== page.index) return;
      const isActive = qi === activeQuestion && si === activeSegment;
      lines.push({
        questionIndex: qi,
        segmentIndex: si,
        edge: "y1",
        no: q.no,
        yPdf: seg.y1,
        active: isActive,
      });
      lines.push({
        questionIndex: qi,
        segmentIndex: si,
        edge: "y2",
        no: q.no,
        yPdf: seg.y2,
        active: isActive,
      });
    });
  });

  const stageRef = useRef<Konva.Stage>(null);

  const handleStageDblClick = (evt: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = evt.target.getStage();
    if (!stage) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    const yPdf = clamp(pos.y / pdfToDisplay, 0, page.height);
    onClickPage(page.index, yPdf, evt.evt.shiftKey);
  };

  return (
    <div className="pdf-page">
      <div className="pdf-page-head">
        <span className="pdf-page-no">第 {page.index + 1} 页</span>
        <button className="mini" onClick={() => onAddSegmentInPage(page.index)}>
          + 在本页新建段
        </button>
        <span className="pdf-page-hint">
          双击 = 设置结束行(Shift+双击 = 设置起始行)
        </span>
      </div>
      <div
        className="pdf-page-stage"
        style={{ width: displayWidth, height: displayHeight }}
      >
        {/* 背景:PDF 渲染图,放在原生 img 而非 Konva,让事件交给 Konva Stage 处理 */}
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
          onDblClick={handleStageDblClick}
          onDblTap={handleStageDblClick}
          className="pdf-page-stage-canvas"
        >
          <Layer>
            {image && (
              // 透明矩形撑满 Stage 以便接收事件
              <KImage image={image} width={displayWidth} height={displayHeight} opacity={0} listening={false} />
            )}
            {lines.map((ln) => {
              const y = ln.yPdf * pdfToDisplay;
              const color = ln.edge === "y1" ? "#2563eb" : "#ea580c";
              const dash = ln.active ? [10, 4] : [4, 4];
              return (
                <Line
                  key={`${ln.questionIndex}-${ln.segmentIndex}-${ln.edge}`}
                  points={[0, y, displayWidth, y]}
                  stroke={color}
                  strokeWidth={ln.active ? 2 : 1.2}
                  dash={dash}
                  opacity={ln.active ? 1 : 0.55}
                  listening={false}
                />
              );
            })}
            {/* 高亮选中段范围 */}
            {questions[activeQuestion ?? -1]?.segments[activeSegment ?? -1]?.page === page.index && (() => {
              const seg = questions[activeQuestion!].segments[activeSegment!];
              const top = Math.min(seg.y1, seg.y2) * pdfToDisplay;
              const bottom = Math.max(seg.y1, seg.y2) * pdfToDisplay;
              return (
                <Rect
                  x={0}
                  y={top}
                  width={displayWidth}
                  height={bottom - top}
                  fill="#22c55e"
                  opacity={0.08}
                  listening={false}
                />
              );
            })()}
            {/* 拖拽手柄 + 题号标签 */}
            {lines.map((ln) => {
              const y = ln.yPdf * pdfToDisplay;
              const color = ln.edge === "y1" ? "#2563eb" : "#ea580c";
              return (
                <Handle
                  key={`h-${ln.questionIndex}-${ln.segmentIndex}-${ln.edge}`}
                  x={displayWidth - 18}
                  y={y}
                  color={color}
                  label={`${ln.no}${ln.edge === "y1" ? "起" : "止"}`}
                  active={ln.active}
                  onClick={() => onSelectSegment(ln.questionIndex, ln.segmentIndex)}
                  onDrag={(dy) => {
                    const newY = clamp((y + dy) / pdfToDisplay, 0, page.height);
                    onDragLine(ln.questionIndex, ln.segmentIndex, ln.edge, newY);
                  }}
                  displayHeight={displayHeight}
                />
              );
            })}
          </Layer>
        </Stage>
      </div>
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

interface HandleProps {
  x: number;
  y: number;
  color: string;
  label: string;
  active: boolean;
  onClick: () => void;
  onDrag: (dy: number) => void;
  displayHeight: number;
}

function Handle({ x, y, color, label, active, onClick, onDrag, displayHeight }: HandleProps) {
  return (
    <>
      <Rect
        x={x - 22}
        y={y - 10}
        width={48}
        height={20}
        cornerRadius={4}
        fill={color}
        opacity={active ? 1 : 0.7}
        draggable
        dragBoundFunc={(pos) => ({ x: x - 22, y: Math.max(-10, Math.min(displayHeight - 10, pos.y)) })}
        onDragMove={(e) => {
          const node = e.target;
          const newY = node.y() + 10;
          onDrag(newY - y);
          // 立即归位,避免因为父组件状态延迟带来抖动
          node.y(y - 10);
        }}
        onClick={onClick}
        onTap={onClick}
      />
      <Text
        x={x - 22}
        y={y - 9}
        width={48}
        height={18}
        align="center"
        verticalAlign="middle"
        text={label}
        fontSize={11}
        fill="#fff"
        listening={false}
      />
      <Circle x={x - 36} y={y} radius={4} fill={color} opacity={active ? 1 : 0.7} listening={false} />
    </>
  );
}
