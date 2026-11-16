import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  GripVertical,
  RotateCcw,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  OVERVIEW_METRIC_META,
  OVERVIEW_WIDGET_META,
  type OverviewLayoutConfig,
  type OverviewMetricId,
  type OverviewWidgetId,
} from '../hooks/useOverviewLayout';

interface OverviewCustomizeModalProps {
  open: boolean;
  onClose: () => void;
  layout: OverviewLayoutConfig;
  hiddenWidgetSet: Set<OverviewWidgetId>;
  hiddenMetricSet: Set<OverviewMetricId>;
  isCustomized: boolean;
  onToggleWidget: (id: OverviewWidgetId) => void;
  onMoveWidget: (fromId: OverviewWidgetId, toId: OverviewWidgetId) => void;
  onStepWidget: (id: OverviewWidgetId, delta: -1 | 1) => void;
  onToggleMetric: (id: OverviewMetricId) => void;
  onMoveMetric: (fromId: OverviewMetricId, toId: OverviewMetricId) => void;
  onStepMetric: (id: OverviewMetricId, delta: -1 | 1) => void;
  onShowAll: () => void;
  onResetLayout: () => void;
}

export function OverviewCustomizeModal({
  open,
  onClose,
  layout,
  hiddenWidgetSet,
  hiddenMetricSet,
  isCustomized,
  onToggleWidget,
  onMoveWidget,
  onStepWidget,
  onToggleMetric,
  onMoveMetric,
  onStepMetric,
  onShowAll,
  onResetLayout,
}: OverviewCustomizeModalProps) {
  const [draggingWidget, setDraggingWidget] = useState<OverviewWidgetId | null>(null);
  const [dragOverWidget, setDragOverWidget] = useState<OverviewWidgetId | null>(null);
  const [draggingMetric, setDraggingMetric] = useState<OverviewMetricId | null>(null);
  const [dragOverMetric, setDragOverMetric] = useState<OverviewMetricId | null>(null);

  if (!open) return null;

  const summaryMetricsHidden = hiddenWidgetSet.has('summaryMetrics');
  const anyHidden = hiddenWidgetSet.size > 0 || hiddenMetricSet.size > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Customize Overview Layout"
      className="fixed inset-0 z-50 bg-slate-900/40 dark:bg-black/60 flex items-center justify-center p-4"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <SlidersHorizontal className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
            <div className="min-w-0">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                Customize Overview
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                Drag and drop to reorder sections, or toggle widgets and metrics on or off
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close customize overview modal"
            className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Widgets & Charts Order + Visibility */}
          <section aria-label="Overview Widgets and Charts" className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Overview Sections &amp; Charts
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Drag handles or use arrows to arrange your Overview layout ({layout.widgetOrder.length - hiddenWidgetSet.size}/{layout.widgetOrder.length} visible)
                </p>
              </div>
            </div>

            <div className="space-y-2">
              {layout.widgetOrder.map((widgetId, idx) => {
                const meta = OVERVIEW_WIDGET_META[widgetId];
                const isVisible = !hiddenWidgetSet.has(widgetId);
                const isDragging = draggingWidget === widgetId;
                const isDropTarget = dragOverWidget === widgetId && draggingWidget !== widgetId;

                return (
                  <div
                    key={widgetId}
                    draggable
                    onDragStart={(e) => {
                      setDraggingWidget(widgetId);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', widgetId);
                    }}
                    onDragOver={(e) => {
                      if (!draggingWidget) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (dragOverWidget !== widgetId) setDragOverWidget(widgetId);
                    }}
                    onDragLeave={() => {
                      if (dragOverWidget === widgetId) setDragOverWidget(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (draggingWidget && draggingWidget !== widgetId) {
                        onMoveWidget(draggingWidget, widgetId);
                      }
                      setDraggingWidget(null);
                      setDragOverWidget(null);
                    }}
                    onDragEnd={() => {
                      setDraggingWidget(null);
                      setDragOverWidget(null);
                    }}
                    className={`rounded-xl border px-3.5 py-3 flex items-center justify-between gap-3 transition-colors select-none ${
                      isDropTarget
                        ? 'border-teal-600 dark:border-teal-400 bg-teal-50/70 dark:bg-teal-950/40'
                        : isDragging
                          ? 'opacity-50 border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950'
                          : isVisible
                            ? 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/70'
                            : 'border-slate-200/80 dark:border-slate-800/70 bg-slate-50/70 dark:bg-slate-950/30 opacity-75'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        title="Drag to reorder"
                        className="p-1 text-slate-400 dark:text-slate-500 cursor-grab active:cursor-grabbing shrink-0"
                      >
                        <GripVertical className="w-4 h-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {meta.label}
                          </span>
                          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                            · {meta.category}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                          {meta.description}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => onStepWidget(widgetId, -1)}
                        aria-label={`Move ${meta.label} up`}
                        className="p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 cursor-pointer disabled:cursor-default"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === layout.widgetOrder.length - 1}
                        onClick={() => onStepWidget(widgetId, 1)}
                        aria-label={`Move ${meta.label} down`}
                        className="p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 cursor-pointer disabled:cursor-default"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        role="switch"
                        aria-checked={isVisible}
                        aria-label={`Toggle ${meta.label}`}
                        onClick={() => onToggleWidget(widgetId)}
                        className={`ml-1 px-2.5 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                          isVisible
                            ? 'bg-teal-700 border-teal-700 text-white hover:bg-teal-800 dark:bg-teal-600 dark:border-teal-600 dark:hover:bg-teal-500'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        {isVisible ? (
                          <>
                            <Eye className="w-3.5 h-3.5" />
                            <span>Visible</span>
                          </>
                        ) : (
                          <>
                            <EyeOff className="w-3.5 h-3.5" />
                            <span>Hidden</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Individual KPI Metrics */}
          <section
            aria-label="Summary Metric Cards"
            className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Summary Metric Cards
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {summaryMetricsHidden
                    ? 'Enable "Summary Metric Cards" above to show this strip on Overview'
                    : `Choose and reorder individual KPI cards (${layout.metricOrder.length - hiddenMetricSet.size}/${layout.metricOrder.length} visible)`}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {layout.metricOrder.map((metricId, idx) => {
                const meta = OVERVIEW_METRIC_META[metricId];
                const isVisible = !hiddenMetricSet.has(metricId);
                const isDragging = draggingMetric === metricId;
                const isDropTarget = dragOverMetric === metricId && draggingMetric !== metricId;

                return (
                  <div
                    key={metricId}
                    draggable
                    onDragStart={(e) => {
                      setDraggingMetric(metricId);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', metricId);
                    }}
                    onDragOver={(e) => {
                      if (!draggingMetric) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (dragOverMetric !== metricId) setDragOverMetric(metricId);
                    }}
                    onDragLeave={() => {
                      if (dragOverMetric === metricId) setDragOverMetric(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (draggingMetric && draggingMetric !== metricId) {
                        onMoveMetric(draggingMetric, metricId);
                      }
                      setDraggingMetric(null);
                      setDragOverMetric(null);
                    }}
                    onDragEnd={() => {
                      setDraggingMetric(null);
                      setDragOverMetric(null);
                    }}
                    className={`rounded-xl border px-3 py-2.5 flex items-center justify-between gap-2 transition-colors select-none ${
                      isDropTarget
                        ? 'border-teal-600 dark:border-teal-400 bg-teal-50/70 dark:bg-teal-950/40'
                        : isDragging
                          ? 'opacity-50 border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950'
                          : isVisible && !summaryMetricsHidden
                            ? 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/70'
                            : 'border-slate-200/80 dark:border-slate-800/70 bg-slate-50/70 dark:bg-slate-950/30 opacity-70'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        title="Drag to reorder metric"
                        className="p-0.5 text-slate-400 dark:text-slate-500 cursor-grab active:cursor-grabbing shrink-0"
                      >
                        <GripVertical className="w-3.5 h-3.5" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {meta.label}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {meta.description}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => onStepMetric(metricId, -1)}
                        aria-label={`Move ${meta.label} left`}
                        className="p-1 rounded text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 cursor-pointer disabled:cursor-default"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === layout.metricOrder.length - 1}
                        onClick={() => onStepMetric(metricId, 1)}
                        aria-label={`Move ${meta.label} right`}
                        className="p-1 rounded text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 cursor-pointer disabled:cursor-default"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isVisible}
                        aria-label={`Toggle ${meta.label} card`}
                        onClick={() => onToggleMetric(metricId)}
                        className={`p-1.5 rounded-md border transition-colors cursor-pointer ${
                          isVisible
                            ? 'bg-teal-700 border-teal-700 text-white hover:bg-teal-800 dark:bg-teal-600 dark:border-teal-600'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        {isVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0 bg-slate-50/70 dark:bg-slate-950/50">
          <div className="flex items-center gap-2">
            {anyHidden && (
              <button
                type="button"
                onClick={onShowAll}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Show All
              </button>
            )}
            {isCustomized && (
              <button
                type="button"
                onClick={onResetLayout}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset to Default</span>
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 text-white text-xs sm:text-sm font-semibold cursor-pointer ml-auto"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
