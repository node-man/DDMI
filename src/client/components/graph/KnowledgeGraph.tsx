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
import Dagre from "@dagrejs/dagre";
import { FileNode, type FileNodeData } from "./FileNode";
import type { GraphData } from "../../lib/client";

const nodeTypes = { file: FileNode };

const NODE_WIDTH = 200;
const NODE_HEIGHT = 60;

const EDGE_COLORS: Record<string, string> = {
  references: "#3b82f6",       // blue-500
  depends_on: "#3b82f6",       // blue-500
  derived_from: "#8b5cf6",     // purple-500
  contradicts: "#ef4444",      // red-500
  supersedes: "#f59e0b",       // yellow-500
};

// dagre 자동 레이아웃 — 위→아래 방향, 노드 간 간격 자동 계산
function getLayoutedElements(
  rawNodes: Node<FileNodeData>[],
  rawEdges: Edge[],
): { nodes: Node<FileNodeData>[]; edges: Edge[] } {
  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 80, ranksep: 100 });

  for (const node of rawNodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of rawEdges) {
    g.setEdge(edge.source, edge.target);
  }

  Dagre.layout(g);

  const nodes = rawNodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    };
  });

  return { nodes, edges: rawEdges };
}

function buildNodes(data: GraphData): Node<FileNodeData>[] {
  return data.nodes.map((n) => ({
    id: n.id,
    type: "file" as const,
    position: { x: 0, y: 0 }, // dagre가 덮어씀
    data: {
      label: n.label,
      docType: n.docType,
      totalTokens: n.totalTokens,
    },
  }));
}

function buildEdges(data: GraphData): Edge[] {
  return data.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: "smoothstep",
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
  const { nodes: layoutedNodes, edges: layoutedEdges } = useMemo(() => {
    const rawNodes = buildNodes(data);
    const rawEdges = buildEdges(data);
    return getLayoutedElements(rawNodes, rawEdges);
  }, [data]);

  const [nodes, , onNodesChange] = useNodesState(layoutedNodes);
  const [edges, , onEdgesChange] = useEdgesState(layoutedEdges);

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
      defaultEdgeOptions={{ type: "smoothstep" }}
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
