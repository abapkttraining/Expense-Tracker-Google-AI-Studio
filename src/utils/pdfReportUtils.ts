import { ArcElement, Chart, DoughnutController, type Plugin } from 'chart.js';
import { jsPDF } from 'jspdf';
import {
  convertFromINR,
  getFallbackExchangeRates,
  getTodayISO,
  type DisplayCurrency,
} from '../constants';
import type { Expense, Project, Tag } from '../types';

Chart.register(DoughnutController, ArcElement);

interface TagBreakdownRow {
  id: string;
  name: string;
  color: string;
  amount: number;
  percent: number;
}

interface PaymentBreakdownRow {
  method: string;
  count: number;
  amount: number;
  percent: number;
}

export interface MonthlyPdfParams {
  project: Project;
  expenses: Expense[];
  tags: Tag[];
  userName: string;
  currency?: DisplayCurrency;
  rates?: Record<DisplayCurrency, number>;
  inrPerUnit?: Record<DisplayCurrency, number>;
}

function formatPdfCurrency(
  amountInINR: number,
  currency: DisplayCurrency = 'INR',
  rates?: Record<DisplayCurrency, number>
): string {
  if (currency === 'INR') {
    const formatted = new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: amountInINR % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amountInINR);
    return `INR ${formatted}`;
  }
  const activeRates = rates ?? getFallbackExchangeRates().rates;
  const converted = convertFromINR(amountInINR, currency, activeRates);
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: converted === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(converted);
  return `${currency} ${formatted}`;
}

function sanitizePdfText(value: string): string {
  return value
    .replace(/₹/g, 'INR ')
    .replace(/€/g, 'EUR ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
    .trim();
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return [100, 116, 139];
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return [100, 116, 139];
  return [r, g, b];
}

function renderMonthlyDoughnutDataUrl(
  tagBreakdown: TagBreakdownRow[],
  totalSpend: number,
  currency: DisplayCurrency,
  rates?: Record<DisplayCurrency, number>
): string | null {
  if (tagBreakdown.length === 0 || typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 640;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const whiteBgAndCenterPlugin: Plugin<'doughnut'> = {
    id: 'pdfDoughnutDecorator',
    beforeDraw(chart) {
      const c = chart.ctx;
      c.save();
      c.fillStyle = '#FFFFFF';
      c.fillRect(0, 0, chart.width, chart.height);
      c.restore();
    },
    afterDraw(chart) {
      const meta = chart.getDatasetMeta(0);
      const firstArc = meta.data[0];
      if (!firstArc) return;
      const cx = firstArc.x;
      const cy = firstArc.y;
      const c = chart.ctx;
      c.save();
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = '#64748B';
      c.font = '600 22px system-ui, -apple-system, sans-serif';
      c.fillText('MONTHLY TOTAL', cx, cy - 20);
      c.fillStyle = '#0F172A';
      c.font = '700 34px system-ui, -apple-system, sans-serif';
      c.fillText(formatPdfCurrency(totalSpend, currency, rates), cx, cy + 16);
      c.restore();
    },
  };

  const chart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: tagBreakdown.map((t) => t.name),
      datasets: [
        {
          data: tagBreakdown.map((t) => t.amount),
          backgroundColor: tagBreakdown.map((t) => t.color),
          borderColor: '#FFFFFF',
          borderWidth: 5,
        },
      ],
    },
    options: {
      responsive: false,
      animation: false,
      cutout: '62%',
      layout: {
        padding: 12,
      },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
      },
    },
    plugins: [whiteBgAndCenterPlugin],
  });

  chart.draw();
  const dataUrl = canvas.toDataURL('image/png', 1.0);
  chart.destroy();
  return dataUrl;
}

export function downloadMonthlyExpensePdf({
  project,
  expenses,
  tags,
  userName,
  currency = 'INR',
  rates,
  inrPerUnit,
}: MonthlyPdfParams): void {
  const fmt = (amtInINR: number) => formatPdfCurrency(amtInINR, currency, rates);
  const todayISO = getTodayISO();
  const monthPrefix = todayISO.slice(0, 7);
  const [yearNum, monthNum] = monthPrefix.split('-').map(Number);
  const monthLabel = new Date(yearNum, (monthNum || 1) - 1, 1).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });

  const tagMap = new Map<string, Tag>();
  for (const t of tags) tagMap.set(t.id, t);

  const monthExpenses = expenses
    .filter((e) => e.date.startsWith(monthPrefix))
    .sort((a, b) => b.date.localeCompare(a.date));

  const totalSpend =
    Math.round(monthExpenses.reduce((sum, e) => sum + e.amount, 0) * 100) / 100;

  // Compute tag breakdown using the same weighted allocation as AnalyticsCharts
  const tagTotals = new Map<string, number>();
  for (const exp of monthExpenses) {
    const expTags = exp.tagIds.length > 0 ? exp.tagIds : ['other'];
    const share = exp.amount / expTags.length;
    for (const tid of expTags) {
      tagTotals.set(tid, (tagTotals.get(tid) ?? 0) + share);
    }
  }

  const rawTagRows = Array.from(tagTotals.entries())
    .map(([tagId, amount]) => {
      const tag = tagMap.get(tagId);
      return {
        id: tagId,
        name: sanitizePdfText(tag?.name ?? 'Other') || 'Other',
        color: tag?.color ?? '#64748B',
        amount: Math.round(amount * 100) / 100,
      };
    })
    .sort((a, b) => b.amount - a.amount);

  const tagGrandTotal = rawTagRows.reduce((sum, r) => sum + r.amount, 0) || 1;
  const tagBreakdown: TagBreakdownRow[] = rawTagRows.map((r) => ({
    ...r,
    percent: Math.round((r.amount / tagGrandTotal) * 1000) / 10,
  }));

  // Payment method breakdown
  const methodAgg = new Map<string, { count: number; amount: number }>();
  for (const exp of monthExpenses) {
    const prev = methodAgg.get(exp.paymentMethod) ?? { count: 0, amount: 0 };
    methodAgg.set(exp.paymentMethod, {
      count: prev.count + 1,
      amount: prev.amount + exp.amount,
    });
  }
  const paymentGrandTotal = totalSpend || 1;
  const paymentBreakdown: PaymentBreakdownRow[] = Array.from(methodAgg.entries())
    .map(([method, stats]) => ({
      method: sanitizePdfText(method),
      count: stats.count,
      amount: Math.round(stats.amount * 100) / 100,
      percent: Math.round((stats.amount / paymentGrandTotal) * 1000) / 10,
    }))
    .sort((a, b) => b.amount - a.amount);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = 210;
  const pageHeight = 297;
  const marginX = 14;
  const contentWidth = pageWidth - marginX * 2; // 182mm

  // Header Banner
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(marginX, 14, contentWidth, 24, 'F');
  doc.setFillColor(13, 148, 136); // teal-600 top accent
  doc.rect(marginX, 14, contentWidth, 2, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(sanitizePdfText(project.name) || 'Expense Workspace', marginX + 5, 24);

  doc.setTextColor(203, 213, 225);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  const rateSuffix =
    currency !== 'INR' && inrPerUnit?.[currency]
      ? `  |  Display: ${currency} (1 ${currency} = INR ${inrPerUnit[currency].toFixed(2)})`
      : '';
  doc.text(`Monthly Expense Summary Report  |  ${monthLabel}${rateSuffix}`, marginX + 5, 31.5);

  doc.setTextColor(148, 163, 184);
  doc.setFontSize(8);
  doc.text(`Generated: ${todayISO}`, pageWidth - marginX - 5, 23.5, { align: 'right' });
  doc.text(
    `Prepared by: ${sanitizePdfText(userName) || 'Member'}`,
    pageWidth - marginX - 5,
    30.5,
    { align: 'right' }
  );

  // 4-Card KPI Row
  let y = 44;
  const gap = 3.33;
  const cardWidth = (contentWidth - gap * 3) / 4;
  const cardHeight = 22;

  const hasBudget = typeof project.monthlyBudget === 'number' && project.monthlyBudget > 0;
  const budgetCap = hasBudget ? project.monthlyBudget! : 0;
  const budgetPct = hasBudget ? Math.round((totalSpend / budgetCap) * 1000) / 10 : 0;
  const budgetRemaining = budgetCap - totalSpend;

  const kpis = [
    {
      label: 'THIS MONTH SPEND',
      value: fmt(totalSpend),
      sub: `${monthExpenses.length} ${monthExpenses.length === 1 ? 'transaction' : 'transactions'}`,
    },
    {
      label: 'MONTHLY BUDGET',
      value: hasBudget ? fmt(budgetCap) : 'No Limit',
      sub: hasBudget
        ? budgetRemaining >= 0
          ? `${budgetPct}% used (${fmt(budgetRemaining)} left)`
          : `${budgetPct}% used (Over by ${fmt(Math.abs(budgetRemaining))})`
        : 'Cap not configured',
    },
    {
      label: 'TOP CATEGORY',
      value: tagBreakdown[0]?.name ?? 'None',
      sub: tagBreakdown[0]
        ? `${fmt(tagBreakdown[0].amount)} (${tagBreakdown[0].percent}%)`
        : `${currency} 0`,
    },
    {
      label: 'TOP METHOD',
      value: paymentBreakdown[0]?.method ?? 'None',
      sub: paymentBreakdown[0]
        ? `${fmt(paymentBreakdown[0].amount)} (${paymentBreakdown[0].percent}%)`
        : `${currency} 0`,
    },
  ];

  kpis.forEach((kpi, idx) => {
    const x = marginX + idx * (cardWidth + gap);
    doc.setFillColor(248, 250, 252); // slate-50
    doc.setDrawColor(226, 232, 240); // slate-200
    doc.roundedRect(x, y, cardWidth, cardHeight, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(kpi.label, x + 3, y + 5.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(15, 23, 42);
    const clippedVal = doc.splitTextToSize(kpi.value, cardWidth - 6)[0] ?? kpi.value;
    doc.text(clippedVal, x + 3, y + 12.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(71, 85, 105);
    const clippedSub = doc.splitTextToSize(kpi.sub, cardWidth - 6)[0] ?? kpi.sub;
    doc.text(clippedSub, x + 3, y + 18.2);
  });

  y += cardHeight + 8;

  // Section: Doughnut Chart + Tag Breakdown
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(`Spending by Tag — ${monthLabel}`, marginX, y);
  y += 2;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('Weighted allocation across categories for the current calendar month', marginX, y + 3);
  y += 7;

  const doughnutUrl = renderMonthlyDoughnutDataUrl(tagBreakdown, totalSpend, currency, rates);

  if (!doughnutUrl || tagBreakdown.length === 0) {
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(marginX, y, contentWidth, 24, 2, 2, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`No expenses recorded for ${monthLabel}.`, marginX + contentWidth / 2, y + 13.5, {
      align: 'center',
    });
    y += 32;
  } else {
    const chartBoxSize = 64;
    const panelHeight = Math.max(chartBoxSize + 6, Math.min(tagBreakdown.length, 9) * 6.5 + 14);
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(marginX, y, contentWidth, panelHeight, 2, 2, 'FD');

    doc.addImage(doughnutUrl, 'PNG', marginX + 3, y + 3, chartBoxSize, chartBoxSize);

    // Legend / Breakdown Table on right
    const listX = marginX + chartBoxSize + 8;
    const listWidth = contentWidth - chartBoxSize - 12;
    let ly = y + 7.5;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('TAG', listX, ly);
    doc.text('SHARE', listX + listWidth - 28, ly, { align: 'right' });
    doc.text('AMOUNT', listX + listWidth, ly, { align: 'right' });
    ly += 2;
    doc.setDrawColor(226, 232, 240);
    doc.line(listX, ly, listX + listWidth, ly);
    ly += 4.5;

    const maxLegendRows = 9;
    const visibleTags = tagBreakdown.slice(0, maxLegendRows);
    const hiddenTags = tagBreakdown.slice(maxLegendRows);

    const rowsToRender =
      hiddenTags.length > 0
        ? [
            ...visibleTags.slice(0, maxLegendRows - 1),
            {
              id: '__remaining__',
              name: `+${hiddenTags.length} other tags`,
              color: '#94A3B8',
              amount: Math.round(hiddenTags.reduce((s, t) => s + t.amount, 0) * 100) / 100,
              percent: Math.round(hiddenTags.reduce((s, t) => s + t.percent, 0) * 10) / 10,
            },
          ]
        : visibleTags;

    rowsToRender.forEach((item) => {
      const [r, g, b] = hexToRgb(item.color);
      doc.setFillColor(r, g, b);
      doc.rect(listX, ly - 2.6, 2.8, 2.8, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.2);
      doc.setTextColor(30, 41, 59);
      const nameClipped = doc.splitTextToSize(item.name, listWidth - 40)[0] ?? item.name;
      doc.text(nameClipped, listX + 4.5, ly);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text(`${item.percent}%`, listX + listWidth - 28, ly, { align: 'right' });

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(fmt(item.amount), listX + listWidth, ly, { align: 'right' });

      ly += 6.2;
    });

    y += panelHeight + 8;
  }

  // Section: Payment Method Breakdown (only if expenses exist)
  if (paymentBreakdown.length > 0) {
    if (y + 36 > pageHeight - 20) {
      doc.addPage();
      y = 18;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text('Payment Method Breakdown', marginX, y);
    y += 4;

    doc.setFillColor(241, 245, 249);
    doc.rect(marginX, y, contentWidth, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text('PAYMENT METHOD', marginX + 3, y + 4.8);
    doc.text('TRANSACTIONS', marginX + 104, y + 4.8, { align: 'right' });
    doc.text('SHARE', marginX + 132, y + 4.8, { align: 'right' });
    doc.text('AMOUNT', marginX + contentWidth - 3, y + 4.8, { align: 'right' });
    y += 7;

    paymentBreakdown.forEach((pm, idx) => {
      if (y + 7 > pageHeight - 20) {
        doc.addPage();
        y = 18;
      }
      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(marginX, y, contentWidth, 6.5, 'F');
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.2);
      doc.setTextColor(30, 41, 59);
      doc.text(pm.method, marginX + 3, y + 4.5);
      doc.text(String(pm.count), marginX + 104, y + 4.5, { align: 'right' });
      doc.text(`${pm.percent}%`, marginX + 132, y + 4.5, { align: 'right' });
      doc.setFont('helvetica', 'bold');
      doc.text(fmt(pm.amount), marginX + contentWidth - 3, y + 4.5, { align: 'right' });
      y += 6.5;
    });

    y += 8;
  }

  // Section: Current Month Expense Ledger
  const drawLedgerHeader = (topY: number) => {
    doc.setFillColor(15, 23, 42);
    doc.rect(marginX, topY, contentWidth, 7.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text('DATE', marginX + 2.5, topY + 5);
    doc.text('DESCRIPTION', marginX + 24, topY + 5);
    doc.text('PAID BY', marginX + 82, topY + 5);
    doc.text('METHOD', marginX + 111, topY + 5);
    doc.text('TAGS', marginX + 137, topY + 5);
    doc.text('AMOUNT', marginX + contentWidth - 2.5, topY + 5, { align: 'right' });
    return topY + 7.5;
  };

  if (monthExpenses.length > 0) {
    if (y + 24 > pageHeight - 20) {
      doc.addPage();
      y = 18;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(`Expense Ledger — ${monthLabel} (${monthExpenses.length})`, marginX, y);
    y += 4;
    y = drawLedgerHeader(y);

    monthExpenses.forEach((exp, idx) => {
      const descText = sanitizePdfText(exp.description || '') || 'No description';
      const paidByText = sanitizePdfText(exp.paidByName || '') || 'Member';
      const methodText = sanitizePdfText(exp.paymentMethod || '');
      const tagNames = exp.tagIds
        .map((id) => sanitizePdfText(tagMap.get(id)?.name ?? ''))
        .filter(Boolean)
        .join(', ');
      const tagsText = tagNames || 'Other';

      const descLines = doc.splitTextToSize(descText, 55) as string[];
      const tagLines = doc.splitTextToSize(tagsText, 24) as string[];
      const maxLines = Math.max(descLines.length, tagLines.length, 1);
      const rowHeight = Math.max(7, maxLines * 4 + 3);

      if (y + rowHeight > pageHeight - 18) {
        doc.addPage();
        y = 18;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(71, 85, 105);
        doc.text(`${sanitizePdfText(project.name)} — ${monthLabel} Ledger (cont.)`, marginX, y);
        y += 4;
        y = drawLedgerHeader(y);
      }

      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(marginX, y, contentWidth, rowHeight, 'F');
      }

      doc.setDrawColor(226, 232, 240);
      doc.line(marginX, y + rowHeight, marginX + contentWidth, y + rowHeight);

      const textY = y + 4.7;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.8);
      doc.setTextColor(71, 85, 105);
      doc.text(exp.date, marginX + 2.5, textY);

      doc.setTextColor(15, 23, 42);
      doc.text(descLines, marginX + 24, textY);

      doc.setTextColor(51, 65, 85);
      const clippedPaidBy = doc.splitTextToSize(paidByText, 26)[0] ?? paidByText;
      doc.text(clippedPaidBy, marginX + 82, textY);

      const clippedMethod = doc.splitTextToSize(methodText, 24)[0] ?? methodText;
      doc.text(clippedMethod, marginX + 111, textY);

      doc.setTextColor(71, 85, 105);
      doc.text(tagLines, marginX + 137, textY);

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(fmt(exp.amount), marginX + contentWidth - 2.5, textY, { align: 'right' });

      y += rowHeight;
    });
  }

  // Page Footers
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p += 1) {
    doc.setPage(p);
    doc.setDrawColor(226, 232, 240);
    doc.line(marginX, pageHeight - 13, pageWidth - marginX, pageHeight - 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `${sanitizePdfText(project.name)} · ${monthLabel} Summary`,
      marginX,
      pageHeight - 8.5
    );
    doc.text(`Page ${p} of ${totalPages}`, pageWidth - marginX, pageHeight - 8.5, {
      align: 'right',
    });
  }

  const slug = project.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'project';
  doc.save(`${slug}-${monthPrefix}-expense-report.pdf`);
}
