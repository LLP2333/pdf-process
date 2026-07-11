import { forwardRef, useEffect, useRef, useState } from "react";
import { Stage, Layer, Rect, Group, Label, Tag, Text, Transformer } from "react-konva";
import Konva from "konva";
import type { EditorRegion, PageInfo, Selection } from "../types";
import { MIN_REGION_SIZE_PT } from "../editorState";

// 单击与拖拽的区分交给 Konva:移动超过 3px 才算拖拽,避免"手抖点击"移动区域
Konva.dragDistance = 3;

/** 画布上一个可交互区域的展示信息(由 App 从题目列表推导)。 */
export interface CanvasRegion {
  region: EditorRegion;
  questionId: string;
  /** 题目在列表中的下标(题号 = 下标 + 1,颜色也由它决定)。 */
  questionIndex: number;
  /** 该区域是题目内的第几段(0 起);>0 时label 带"·n"后缀。 */
  regionIndex: number;
  color: string;
}

interface Props {
  page: PageInfo;
  zoom: number;
  regions: CanvasRegion[];
  selection: Selection | null;
  /** Shift 按住时进入"追加画框"模式:区域层放行事件,任意位置都可画框。 */
  shiftDown: boolean;
  /** 画完一个新框(pt 坐标,已归一);append=true 表示 Shift 追加到当前选中题。 */
  onDrawRegion: (
    rect: { page: number; x1: number; y1: number; x2: number; y2: number },
    append: boolean,
  ) => void;
  onSelectRegion: (selection: Selection) => void;
  onDeselect: () => void;
  /** 移动/缩放手势结束,提交区域的最终几何(pt 坐标)。 */
  onRegionCommit: (
    regionId: string,
    rect: { x1: number; y1: number; x2: number; y2: number },
  ) => void;
}

/** 画布基准宽度(zoom=1 时页面显示宽度,px)。 */
const BASE_DISPLAY_WIDTH = 880;

interface Draft {
  append: boolean;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 单页 PDF + Konva 叠加层:框选交互的主战场。
 *
 * 交互模型:
 * - 空白处拖拽 = 画新框(一道新题);Shift+拖拽 = 给选中题追加区域
 * - 单击区域 = 选中;拖动 = 移动;8 个手柄 = 缩放(Transformer)
 * - 单击空白(位移 < 最小框)= 取消选中
 * - 删除 / 方向键微调在 App 层监听(需要跨页状态)
 *
 * 用 `forwardRef` 暴露外层 DOM,方便题目面板点击后 `scrollIntoView`。
 */
const PageCanvas = forwardRef<HTMLDivElement, Props>(function PageCanvas(
  {
    page,
    zoom,
    regions,
    selection,
    shiftDown,
    onDrawRegion,
    onSelectRegion,
    onDeselect,
    onRegionCommit,
  },
  ref,
) {
  const displayWidth = BASE_DISPLAY_WIDTH * zoom;
  const displayHeight = displayWidth * (page.height / page.width);
  const pdfToDisplay = displayWidth / page.width;

  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const groupRefs = useRef<Map<string, Konva.Group>>(new Map());

  const [draft, setDraftState] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const containerOriginRef = useRef<{ left: number; top: number } | null>(null);
  // 手势回调经 ref 转发,window 级监听器不用随 props 变化反复挂载
  const callbacksRef = useRef({ onDrawRegion, onDeselect });
  callbacksRef.current = { onDrawRegion, onDeselect };
  const geomRef = useRef({ displayWidth, displayHeight, pdfToDisplay, pageIndex: page.index });
  geomRef.current = { displayWidth, displayHeight, pdfToDisplay, pageIndex: page.index };

  const setDraft = (d: Draft | null) => {
    draftRef.current = d;
    setDraftState(d);
  };

  // Transformer 跟随选中区域(选中区域不在本页时脱钩)
  const selectedRegionId =
    selection && regions.some((v) => v.region.id === selection.regionId)
      ? selection.regionId
      : null;
  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    const node = selectedRegionId ? groupRefs.current.get(selectedRegionId) : null;
    transformer.nodes(node ? [node] : []);
    transformer.getLayer()?.batchDraw();
  }, [selectedRegionId, regions]);

  // 画框手势期间挂 window 级监听,鼠标滑出页面也能继续/正常结束
  const draftActive = draft !== null;
  useEffect(() => {
    if (!draftActive) return;
    const handleMove = (ev: MouseEvent) => {
      const current = draftRef.current;
      const origin = containerOriginRef.current;
      if (!current || !origin) return;
      const { displayWidth: w, displayHeight: h } = geomRef.current;
      setDraft({
        ...current,
        x1: clamp(ev.clientX - origin.left, 0, w),
        y1: clamp(ev.clientY - origin.top, 0, h),
      });
    };
    const handleUp = () => {
      const current = draftRef.current;
      setDraft(null);
      if (!current) return;
      const { pdfToDisplay: s, pageIndex } = geomRef.current;
      const minPx = MIN_REGION_SIZE_PT * s;
      if (Math.abs(current.x1 - current.x0) < minPx || Math.abs(current.y1 - current.y0) < minPx) {
        // 位移太小视为"点击空白" → 取消选中
        callbacksRef.current.onDeselect();
        return;
      }
      callbacksRef.current.onDrawRegion(
        {
          page: pageIndex,
          x1: Math.min(current.x0, current.x1) / s,
          y1: Math.min(current.y0, current.y1) / s,
          x2: Math.max(current.x0, current.x1) / s,
          y2: Math.max(current.y0, current.y1) / s,
        },
        current.append,
      );
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [draftActive]);

  const handleStageMouseDown = (evt: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = evt.target.getStage();
    if (!stage || evt.target !== stage) return;
    if (evt.evt.button !== 0) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    const rect = stage.container().getBoundingClientRect();
    containerOriginRef.current = { left: rect.left, top: rect.top };
    setDraft({ append: evt.evt.shiftKey, x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y });
  };

  /** 手势结束后从 Konva 节点读回最终几何(考虑 Transformer 留下的 scale)并提交。 */
  const commitFromNode = (group: Konva.Group, regionId: string) => {
    const rectNode = group.findOne<Konva.Rect>(".region-rect");
    if (!rectNode) return;
    const w = rectNode.width() * group.scaleX();
    const h = rectNode.height() * group.scaleY();
    group.scaleX(1);
    group.scaleY(1);
    const x1 = clamp(group.x(), 0, displayWidth);
    const y1 = clamp(group.y(), 0, displayHeight);
    const x2 = clamp(group.x() + w, 0, displayWidth);
    const y2 = clamp(group.y() + h, 0, displayHeight);
    onRegionCommit(regionId, {
      x1: x1 / pdfToDisplay,
      y1: y1 / pdfToDisplay,
      x2: x2 / pdfToDisplay,
      y2: y2 / pdfToDisplay,
    });
  };

  return (
    <div ref={ref} className="page-canvas" data-page={page.index}>
      <div className="page-canvas-head">
        <span className="page-canvas-no">第 {page.index + 1} 页</span>
      </div>
      <div
        className={"page-canvas-stage" + (shiftDown ? " shift-mode" : "")}
        style={{ width: displayWidth, height: displayHeight }}
      >
        <img
          className="page-canvas-img"
          src={page.image_url}
          alt={`第 ${page.index + 1} 页`}
          style={{ width: displayWidth, height: displayHeight }}
          draggable={false}
        />
        <Stage
          ref={stageRef}
          width={displayWidth}
          height={displayHeight}
          onMouseDown={handleStageMouseDown}
          className="page-canvas-overlay"
        >
          <Layer>
            {regions.map((view) => {
              const r = view.region;
              const isSelected = selection?.regionId === r.id;
              const x = r.x1 * pdfToDisplay;
              const y = r.y1 * pdfToDisplay;
              const w = (r.x2 - r.x1) * pdfToDisplay;
              const h = (r.y2 - r.y1) * pdfToDisplay;
              const label =
                view.regionIndex === 0
                  ? `${view.questionIndex + 1}`
                  : `${view.questionIndex + 1} · ${view.regionIndex + 1}`;
              return (
                <Group
                  key={r.id}
                  name="region-group"
                  ref={(node) => {
                    if (node) groupRefs.current.set(r.id, node);
                    else groupRefs.current.delete(r.id);
                  }}
                  x={x}
                  y={y}
                  draggable={!shiftDown}
                  listening={!shiftDown}
                  dragBoundFunc={(pos) => ({
                    x: clamp(pos.x, 0, displayWidth - w),
                    y: clamp(pos.y, 0, displayHeight - h),
                  })}
                  onMouseDown={(e) => {
                    if (e.evt.button !== 0) return;
                    e.cancelBubble = true;
                    onSelectRegion({ questionId: view.questionId, regionId: r.id });
                  }}
                  onTap={(e) => {
                    e.cancelBubble = true;
                    onSelectRegion({ questionId: view.questionId, regionId: r.id });
                  }}
                  onDragEnd={(e) => commitFromNode(e.target as Konva.Group, r.id)}
                  onTransformEnd={(e) => commitFromNode(e.target as Konva.Group, r.id)}
                  onMouseEnter={(e) => {
                    const container = e.target.getStage()?.container();
                    if (container) container.style.cursor = "move";
                  }}
                  onMouseLeave={(e) => {
                    const container = e.target.getStage()?.container();
                    if (container) container.style.cursor = "";
                  }}
                >
                  <Rect
                    name="region-rect"
                    width={w}
                    height={h}
                    fill={view.color + (isSelected ? "3d" : "21")}
                    stroke={view.color}
                    strokeWidth={isSelected ? 2 : 1.4}
                    strokeScaleEnabled={false}
                    cornerRadius={2}
                  />
                  <Label x={0} y={0} listening={false}>
                    <Tag fill={view.color} cornerRadius={[2, 0, 4, 0]} opacity={0.92} />
                    <Text
                      text={label}
                      fontSize={12}
                      fontStyle="bold"
                      fill="#ffffff"
                      padding={4}
                    />
                  </Label>
                </Group>
              );
            })}

            {/* 正在拖拽的画框草稿 */}
            {draft && (
              <Rect
                x={Math.min(draft.x0, draft.x1)}
                y={Math.min(draft.y0, draft.y1)}
                width={Math.abs(draft.x1 - draft.x0)}
                height={Math.abs(draft.y1 - draft.y0)}
                stroke={draft.append ? "#a855f7" : "#3b82f6"}
                strokeWidth={1.5}
                dash={[6, 4]}
                fill={draft.append ? "#a855f71a" : "#3b82f61a"}
                listening={false}
              />
            )}

            <Transformer
              ref={transformerRef}
              rotateEnabled={false}
              keepRatio={false}
              ignoreStroke
              anchorSize={9}
              anchorCornerRadius={2}
              anchorStroke="#3b82f6"
              anchorFill="#ffffff"
              borderStroke="#3b82f6"
              borderDash={[4, 3]}
              boundBoxFunc={(oldBox, newBox) => {
                const minPx = 8;
                if (newBox.width < minPx || newBox.height < minPx) return oldBox;
                if (
                  newBox.x < -0.5 ||
                  newBox.y < -0.5 ||
                  newBox.x + newBox.width > displayWidth + 0.5 ||
                  newBox.y + newBox.height > displayHeight + 0.5
                ) {
                  return oldBox;
                }
                return newBox;
              }}
            />
          </Layer>
        </Stage>
      </div>
    </div>
  );
});

export default PageCanvas;
