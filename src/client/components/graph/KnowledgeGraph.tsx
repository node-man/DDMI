import { useCallback, useMemo } from "react";
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type ColorMode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { FileNode, type FileNodeData } from "./FileNode";
import type { GraphData } from "../../lib/client";

const nodeTypes = { file: FileNode };

const EDGE_COLORS: Record<string, string> = {
  references: "#3b82f6",       // blue-500
  depends_on: "#3b82f6",       // blue-500
  derived_from: "#8b5cf6",     // purple-500
  contradicts: "#ef4444",      // red-500
  supersedes: "#f59e0b",       // yellow-500
};

// 원형 레이아웃 계산
function layoutNodes(data: GraphData): Node<FileNodeData>[] {
  const count = data.nodes.length;
  if (count === 0) return [];

  const radius = Math.max(300, count * 40);
  const cx = 0;
  const cy = 0;

  return data.nodes.map((n, i) => {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
    return {
      id: n.id,
      type: "file",
      position: {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      },
      data: {
        label: n.label,
        docType: n.docType,
        totalTokens: n.totalTokens,
      },
    };
  });
}

function buildEdges(data: GraphData): Edge[] {
  return data.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: "default",
    animated: e.type === "contradicts",
    style: {
      stroke: EDGE_COLORS[e.type] ?? "#71717a",
      strokeWidth: e.type === "contradicts" ? 2.5 : 1.5,
    },
    label: e.type,
    labelStyle: { fontSize: 10, fill: "#a1a1aa" },
    labelBgStyle: { fill: "#18181b", fillOpacity: 0.8 },
    labelBgPadding: [4, 2] as [number, number],
  }));
}

interface Props {
  data: GraphData;
  onNodeClick?: (nodeId: string) => void;
}

export function KnowledgeGraph({ data, onNodeClick }: Props) {
  const initialNodes = useMemo(() => layoutNodes(data), [data]);
  const initialEdges = useMemo(() => buildEdges(data), [data]);

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onNodeClick?.(node.id);
    },
    [onNodeClick],
  );

  const colorMode: ColorMode = "dark";

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={handleNodeClick}
      nodeTypes={nodeTypes}
      colorMode={colorMode}
      fitView
      minZoom={0.1}
      maxZoom={2}
      defaultEdgeOptions={{ type: "default" }}
    >
      <Controls className="!bg-zinc-900 !border-zinc-700 !shadow-lg [&>button]:!bg-zinc-800 [&>button]:!border-zinc-700 [&>button]:!text-zinc-300 [&>button:hover]:!bg-zinc-700" />
      <MiniMap
        className="!bg-zinc-900 !border-zinc-700"
        nodeColor="#3f3f46"
        maskColor="rgba(0,0,0,0.6)"
      />
      <Background variant={BackgroundVariant.Dots} color="#27272a" gap={20} size={1} />
    </ReactFlow>
  );
}
