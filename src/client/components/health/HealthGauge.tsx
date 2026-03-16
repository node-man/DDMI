import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { GaugeChart } from "echarts/charts";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([GaugeChart, CanvasRenderer]);

interface HealthGaugeProps {
  openConflicts: number;
  relations: number;
}

export function HealthGauge({ openConflicts, relations }: HealthGaugeProps) {
  // 일관성 점수: 충돌이 없을수록 높음
  const score = Math.round((1 - openConflicts / Math.max(relations, 1)) * 100);
  const clamped = Math.max(0, Math.min(100, score));

  const color =
    clamped >= 80 ? "#22c55e" : clamped >= 50 ? "#eab308" : "#ef4444";

  const option: echarts.EChartsCoreOption = {
    series: [
      {
        type: "gauge",
        startAngle: 220,
        endAngle: -40,
        min: 0,
        max: 100,
        splitNumber: 10,
        radius: "90%",
        itemStyle: {
          color,
        },
        progress: {
          show: true,
          roundCap: true,
          width: 14,
        },
        pointer: {
          show: false,
        },
        axisLine: {
          roundCap: true,
          lineStyle: {
            width: 14,
            color: [[1, "rgba(255,255,255,0.06)"]],
          },
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        title: {
          show: true,
          offsetCenter: [0, "70%"],
          fontSize: 13,
          color: "#a1a1aa", // zinc-400
          fontFamily: "system-ui, sans-serif",
        },
        detail: {
          valueAnimation: true,
          offsetCenter: [0, "10%"],
          fontSize: 36,
          fontWeight: 700,
          formatter: "{value}%",
          color,
          fontFamily: "system-ui, sans-serif",
        },
        data: [
          {
            value: clamped,
            name: "Consistency",
          },
        ],
      },
    ],
  };

  return (
    <ReactEChartsCore
      echarts={echarts}
      option={option}
      style={{ height: 220, width: 220 }}
      opts={{ renderer: "canvas" }}
      theme="dark"
    />
  );
}
