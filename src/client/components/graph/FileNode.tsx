import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";

const DOC_TYPE_COLORS: Record<string, string> = {
  spec: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  decision: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  meeting: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  research: "bg-green-500/20 text-green-400 border-green-500/30",
  sprint: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  task: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  agent: "bg-pink-500/20 text-pink-400 border-pink-500/30",
};

const DOC_TYPE_BORDER: Record<string, string> = {
  spec: "border-blue-500/40",
  decision: "border-purple-500/40",
  meeting: "border-zinc-600/40",
  research: "border-green-500/40",
  sprint: "border-orange-500/40",
  task: "border-cyan-500/40",
  agent: "border-pink-500/40",
};

export type FileNodeData = {
  label: string;
  docType: string;
  totalTokens: number;
};

type FileNodeType = Node<FileNodeData, "file">;

export function FileNode({ data }: NodeProps<FileNodeType>) {
  const { label, docType, totalTokens } = data;
  const fileName = label.split("/").pop() ?? label;
  const badgeClass = DOC_TYPE_COLORS[docType] ?? DOC_TYPE_COLORS.meeting;
  const borderClass = DOC_TYPE_BORDER[docType] ?? "border-zinc-700";

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-zinc-500 !w-2 !h-2" />
      <div
        className={`rounded-lg border ${borderClass} bg-zinc-900 px-3 py-2 shadow-lg min-w-[120px] max-w-[200px]`}
      >
        {/* DocType badge */}
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${badgeClass}`}>
            {docType}
          </span>
          <span className="text-[10px] text-zinc-500">{totalTokens.toLocaleString()}t</span>
        </div>
        {/* Filename */}
        <div className="text-xs text-zinc-200 font-medium truncate" title={label}>
          {fileName}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-zinc-500 !w-2 !h-2" />
    </>
  );
}
