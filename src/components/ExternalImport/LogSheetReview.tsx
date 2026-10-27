'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Label } from '@/src/components/ui/label';
import { useLocalization } from '@/src/context/localization';
import type { ExistingBaby } from './external-import.types';
import type { LogSheetCandidate, LogSheetSourcePage } from '@/src/lib/importers/log-sheet/types';

interface Props {
  readonly rows: readonly LogSheetCandidate[];
  readonly pages: readonly LogSheetSourcePage[];
  readonly babies: readonly ExistingBaby[];
  readonly babyId: string;
  readonly timezone: string;
  readonly onRowsChange: (rows: LogSheetCandidate[]) => void;
  readonly onBabyChange: (id: string) => void;
  readonly onTimezoneChange: (timezone: string) => void;
}

function updateRow(row: LogSheetCandidate, patch: Partial<LogSheetCandidate>): LogSheetCandidate {
  return { ...row, ...patch };
}

function editedWarnings(row: LogSheetCandidate): string[] {
  const warnings: string[] = [];
  if (!row.eventKind) warnings.push('Choose feeding or diaper');
  if (!row.date) warnings.push('Date is required');
  if (!row.time) warnings.push('Time is required');
  if (row.eventKind === 'feeding' && !row.feedKind) warnings.push('Feeding method is required');
  if (row.eventKind === 'feeding' && row.feedKind === 'BOTTLE' && !row.amount) warnings.push('Bottle amount is required');
  if (row.eventKind === 'feeding' && row.feedKind === 'BOTTLE' && !row.unit) warnings.push('Bottle unit is required');
  if (row.eventKind === 'feeding' && row.feedKind === 'BOTTLE' && row.amount && (!Number.isFinite(Number(row.amount)) || Number(row.amount) <= 0 || Number(row.amount) > 2000)) warnings.push('Bottle amount must be between 0 and 2,000');
  if (row.eventKind === 'diaper' && !row.diaperType) warnings.push('Diaper type is required');
  return warnings;
}

export default function LogSheetReview({ rows, pages, babies, babyId, timezone, onRowsChange, onBabyChange, onTimezoneChange }: Props) {
  const { t } = useLocalization();
  const [mergeIds, setMergeIds] = useState<string[]>([]);
  const [activePage, setActivePage] = useState(0);
  const selected = rows.filter(row => row.selected);
  const incompleteCount = selected.filter(row => editedWarnings(row).length > 0 || !row.reviewed).length;
  const pageKey = pages[activePage] ? `${pages[activePage].fileName}:${pages[activePage].page}` : '';
  const pageRows = useMemo(() => rows.filter(row => `${row.fileName}:${row.page}` === pageKey), [rows, pageKey]);

  const changeRow = (id: string, patch: Partial<LogSheetCandidate>) => {
    onRowsChange(rows.map(row => row.id === id ? updateRow(row, patch) : row));
  };
  const removeRow = (id: string) => onRowsChange(rows.filter(row => row.id !== id));
  const mergeRows = (left: LogSheetCandidate, right: LogSheetCandidate) => {
    const rawText = `${left.rawText}\n${right.rawText}`.slice(0, 1000);
    const merged = updateRow(left, {
      rawText,
      date: '',
      time: '',
      eventKind: null,
      feedKind: '',
      amount: '',
      unit: '',
      diaperType: '',
      reviewed: false,
      warnings: ['merged-row-requires-review', 'event-type-unresolved', 'date-unresolved', 'time-unresolved'],
    });
    onRowsChange(rows.filter(row => row.id !== right.id).map(row => row.id === left.id ? merged : row));
    setMergeIds([]);
  };
  const splitRow = (row: LogSheetCandidate) => {
    const parts = row.rawText.split(/\n+/).map(part => part.trim()).filter(Boolean);
    if (parts.length < 2) return;
    const nextLine = Math.max(0, ...rows.filter(candidate => candidate.documentHash === row.documentHash && candidate.page === row.page).map(candidate => candidate.line)) + 1;
    const newRow: LogSheetCandidate = {
      ...row,
      id: `${row.documentHash.slice(0, 24)}-p${row.page}-l${nextLine}`,
      line: nextLine,
      rawText: parts.slice(1).join(' '),
      confidence: Math.min(row.confidence, 50),
      reviewed: false,
      date: '',
      time: '',
      eventKind: null,
      feedKind: '',
      amount: '',
      unit: '',
      diaperType: '',
      warnings: ['split-row-requires-review', 'event-type-unresolved', 'date-unresolved', 'time-unresolved'],
    };
    onRowsChange(rows.map(candidate => candidate.id === row.id ? { ...candidate, rawText: parts[0] } : candidate).concat(newRow));
  };
  const addManualRow = () => {
    const page = pages[activePage];
    if (!page) return;
    const matchingRows = rows.filter(row => row.fileName === page.fileName && row.page === page.page);
    const line = Math.max(0, ...matchingRows.map(row => row.line)) + 1;
    onRowsChange([...rows, {
      id: `${page.documentHash.slice(0, 24)}-p${page.page}-l${line}`,
      documentHash: page.documentHash,
      fileName: page.fileName,
      page: page.page,
      line,
      rawText: '',
      confidence: 100,
      selected: true,
      reviewed: false,
      eventKind: null,
      date: '',
      time: '',
      feedKind: '',
      bottleType: 'Other',
      amount: '',
      unit: '',
      diaperType: '',
      warnings: ['manual-row-requires-review'],
    }]);
  };

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-amber-700 bg-amber-950/40 p-4 text-sm text-amber-100">
        <h3 className="font-semibold">{t('Check every extracted row')}</h3>
        <p className="mt-1">{t('Handwriting recognition can be wrong. The image is processed in this browser with bundled OCR files. Source pages and OCR text are not uploaded. Nothing is saved until selected rows are corrected and marked reviewed.')}</p>
        <p className="mt-2">{t('Selected rows')}: {selected.length} · {t('Needs review')}: {incompleteCount}</p>
      </section>

      <section className="grid gap-4 rounded-lg border border-slate-600 p-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="log-sheet-baby">{t('Baby')}</Label>
          <select id="log-sheet-baby" className="mt-1 w-full rounded-md border border-slate-500 bg-slate-900 p-2 text-slate-100" value={babyId} onChange={event => onBabyChange(event.target.value)}>
            <option value="">{t('Choose a baby')}</option>
            {babies.map(baby => <option key={baby.id} value={baby.id}>{`${baby.firstName} ${baby.lastName}`.trim()}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="log-sheet-timezone">{t('Source timezone')}</Label>
          <Input id="log-sheet-timezone" value={timezone} onChange={event => onTimezoneChange(event.target.value)} placeholder="America/New_York" />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {pages.map((page, index) => <Button key={`${page.fileName}:${page.page}`} type="button" size="sm" variant={activePage === index ? 'default' : 'outline'} onClick={() => setActivePage(index)}>{page.fileName} · {t('Page')} {page.page}</Button>)}
          </div>
          {pages[activePage] && <figure className="rounded-lg border border-slate-600 p-2">
            <img src={pages[activePage].imageUrl} alt={`${t('Source page')} ${pages[activePage].page}`} className="max-h-[70vh] w-full object-contain" />
            <figcaption className="mt-2 break-all text-xs text-slate-400">{pages[activePage].fileName} · {t('Page')} {pages[activePage].page}</figcaption>
          </figure>}
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-slate-100">{t('Review recognized rows')}</h3>
            <div className="flex gap-2">
              {mergeIds.length === 2 && <Button type="button" size="sm" variant="outline" onClick={() => {
                const [left, right] = mergeIds.map(id => rows.find(row => row.id === id)).filter((row): row is LogSheetCandidate => Boolean(row));
                if (left && right && left.fileName === right.fileName && left.page === right.page) mergeRows(left, right);
              }}>{t('Merge two')}</Button>}
              <Button type="button" size="sm" variant="outline" onClick={addManualRow}>{t('Add missed row')}</Button>
            </div>
          </div>
          <div className="space-y-3">
            {pageRows.map(row => {
              const warnings = editedWarnings(row);
              return <article key={row.id} className="space-y-3 rounded-lg border border-slate-600 p-3">
                <header className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm text-slate-100">
                    <input type="checkbox" checked={row.selected} onChange={event => changeRow(row.id, { selected: event.target.checked, reviewed: false })} />
                    {t('Include row')}
                  </label>
                  <div className="flex items-center gap-3 text-xs text-slate-300">
                    <span>{t('OCR confidence')}: {Math.round(row.confidence)}%</span>
                    <label className="flex items-center gap-1"><input type="checkbox" checked={mergeIds.includes(row.id)} disabled={mergeIds.length >= 2 && !mergeIds.includes(row.id)} onChange={event => setMergeIds(current => event.target.checked ? [...current, row.id] : current.filter(id => id !== row.id))} />{t('Merge')}</label>
                    <button type="button" className="text-red-300 underline" onClick={() => removeRow(row.id)}>{t('Remove')}</button>
                  </div>
                </header>
                <Label htmlFor={`raw-${row.id}`}>{t('Recognized source text')}</Label>
                <textarea id={`raw-${row.id}`} value={row.rawText} onChange={event => changeRow(row.id, { rawText: event.target.value.slice(0, 1000), reviewed: false })} rows={2} maxLength={1000} className="w-full rounded-md border border-slate-500 bg-slate-950 p-2 text-sm text-slate-100" />
                {row.rawText.includes('\n') && <Button type="button" size="sm" variant="outline" onClick={() => splitRow(row)}>{t('Split at line break')}</Button>}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div><Label htmlFor={`event-${row.id}`}>{t('Record type')}</Label><select id={`event-${row.id}`} className="w-full rounded border bg-slate-900 p-2 text-slate-100" value={row.eventKind ?? ''} onChange={event => changeRow(row.id, { eventKind: event.target.value === 'feeding' || event.target.value === 'diaper' ? event.target.value : null, reviewed: false })}><option value="">{t('Choose')}</option><option value="feeding">{t('Feeding')}</option><option value="diaper">{t('Diaper')}</option></select></div>
                  <div><Label htmlFor={`date-${row.id}`}>{t('Date')}</Label><Input id={`date-${row.id}`} type="date" value={row.date} onChange={event => changeRow(row.id, { date: event.target.value, reviewed: false })} /></div>
                  <div><Label htmlFor={`time-${row.id}`}>{t('Time')}</Label><Input id={`time-${row.id}`} type="time" value={row.time} onChange={event => changeRow(row.id, { time: event.target.value, reviewed: false })} /></div>
                  {row.eventKind === 'feeding' && <div><Label htmlFor={`feed-${row.id}`}>{t('Feeding method')}</Label><select id={`feed-${row.id}`} className="w-full rounded border bg-slate-900 p-2 text-slate-100" value={row.feedKind} onChange={event => changeRow(row.id, { feedKind: event.target.value === 'BOTTLE' || event.target.value === 'BREAST' ? event.target.value : '', reviewed: false })}><option value="">{t('Choose')}</option><option value="BOTTLE">{t('Bottle')}</option><option value="BREAST">{t('Breastfeeding')}</option></select></div>}
                  {row.eventKind === 'feeding' && row.feedKind === 'BOTTLE' && <>
                    <div><Label htmlFor={`amount-${row.id}`}>{t('Amount')}</Label><Input id={`amount-${row.id}`} type="number" min="0.01" max="2000" step="any" value={row.amount} onChange={event => changeRow(row.id, { amount: event.target.value, reviewed: false })} /></div>
                    <div><Label htmlFor={`unit-${row.id}`}>{t('Unit')}</Label><select id={`unit-${row.id}`} className="w-full rounded border bg-slate-900 p-2 text-slate-100" value={row.unit} onChange={event => changeRow(row.id, { unit: event.target.value === 'ML' || event.target.value === 'OZ' ? event.target.value : '', reviewed: false })}><option value="">{t('Choose')}</option><option value="ML">mL</option><option value="OZ">oz</option></select></div>
                    <div><Label htmlFor={`bottle-${row.id}`}>{t('Bottle contents')}</Label><select id={`bottle-${row.id}`} className="w-full rounded border bg-slate-900 p-2 text-slate-100" value={row.bottleType} onChange={event => changeRow(row.id, { bottleType: event.target.value as LogSheetCandidate['bottleType'], reviewed: false })}><option value="Formula">{t('Formula')}</option><option value="Breast Milk">{t('Breast Milk')}</option><option value="Other">{t('Other')}</option></select></div>
                  </>}
                  {row.eventKind === 'diaper' && <div><Label htmlFor={`diaper-${row.id}`}>{t('Diaper type')}</Label><select id={`diaper-${row.id}`} className="w-full rounded border bg-slate-900 p-2 text-slate-100" value={row.diaperType} onChange={event => changeRow(row.id, { diaperType: event.target.value === 'WET' || event.target.value === 'DIRTY' || event.target.value === 'BOTH' ? event.target.value : '', reviewed: false })}><option value="">{t('Choose')}</option><option value="WET">{t('Wet')}</option><option value="DIRTY">{t('Dirty')}</option><option value="BOTH">{t('Both')}</option></select></div>}
                </div>
                {row.confidence < 75 && <p className="text-sm text-amber-300">{t('Low OCR confidence: verify this row against the source page.')}</p>}
                {row.selected && warnings.length > 0 && <p className="text-sm text-red-300">{warnings.map(warning => t(warning)).join(' · ')}</p>}
                <label className="flex items-center gap-2 border-t border-slate-700 pt-2 text-sm text-slate-100"><input type="checkbox" checked={row.reviewed} disabled={!row.selected || warnings.length > 0} onChange={event => changeRow(row.id, { reviewed: event.target.checked })} />{t('I checked this row against the source page')}</label>
              </article>;
            })}
            {pageRows.length === 0 && <p className="rounded-lg border border-dashed border-slate-500 p-4 text-sm text-slate-300">{t('No rows were recognized. Add rows manually from the source page.')}</p>}
          </div>
          {incompleteCount > 0 && <p className="text-sm text-amber-300">{t('Selected rows with missing or unreviewed fields will block the import.')}</p>}
        </div>
      </section>
    </div>
  );
}
