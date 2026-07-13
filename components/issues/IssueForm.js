const FIELD_CLASS = 'mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-200';

export const EMPTY_ISSUE_FORM = {
    name: '',
    schoolYear: '',
    volumeNumber: '',
    issueNumber: '',
    targetPublicationDate: '',
    theme: '',
    editorNote: '',
    internalNote: '',
    status: 'planning',
};

export default function IssueForm({value, onChange, onSubmit, saving = false, submitLabel = 'Save issue', showStatus = false}) {
    const setField = (field) => (event) => onChange({...value, [field]: event.target.value});

    return (
        <form onSubmit={onSubmit} className="space-y-6">
            <div className="grid gap-5 sm:grid-cols-2">
                <label className="text-sm font-bold text-slate-800 sm:col-span-2">
                    Issue name
                    <input required value={value.name} onChange={setField('name')} placeholder="Winter 2026" className={FIELD_CLASS}/>
                </label>
                <label className="text-sm font-bold text-slate-800">
                    School year
                    <input required value={value.schoolYear} onChange={setField('schoolYear')} placeholder="2026–27" className={FIELD_CLASS}/>
                </label>
                <label className="text-sm font-bold text-slate-800">
                    Issue publication date
                    <input required type="date" value={value.targetPublicationDate} onChange={setField('targetPublicationDate')} className={FIELD_CLASS}/>
                </label>
                <label className="text-sm font-bold text-slate-800">
                    Volume <span className="font-normal text-slate-500">(optional)</span>
                    <input type="number" min="1" step="1" value={value.volumeNumber} onChange={setField('volumeNumber')} className={FIELD_CLASS}/>
                </label>
                <label className="text-sm font-bold text-slate-800">
                    Issue number <span className="font-normal text-slate-500">(optional)</span>
                    <input type="number" min="1" step="1" value={value.issueNumber} onChange={setField('issueNumber')} className={FIELD_CLASS}/>
                </label>
                {showStatus && <label className="text-sm font-bold text-slate-800 sm:col-span-2">
                    Lifecycle status
                    <select value={value.status} onChange={setField('status')} className={FIELD_CLASS}>
                        <option value="planning">Planning</option>
                        <option value="active">Active</option>
                        <option value="closed">Closed</option>
                        <option value="published">Published</option>
                        <option value="archived">Archived</option>
                    </select>
                </label>}
                <label className="text-sm font-bold text-slate-800 sm:col-span-2">
                    Theme or editorial focus <span className="font-normal text-slate-500">(optional)</span>
                    <input value={value.theme} onChange={setField('theme')} placeholder="Community, change, and new beginnings" className={FIELD_CLASS}/>
                </label>
                <label className="text-sm font-bold text-slate-800 sm:col-span-2">
                    Public editor&rsquo;s note <span className="font-normal text-slate-500">(optional)</span>
                    <textarea rows="5" value={value.editorNote} onChange={setField('editorNote')} placeholder="A short introduction readers will see on the issue page…" className={FIELD_CLASS}/>
                </label>
                <label className="text-sm font-bold text-slate-800 sm:col-span-2">
                    Internal production note <span className="font-normal text-slate-500">(staff only)</span>
                    <textarea rows="4" value={value.internalNote} onChange={setField('internalNote')} placeholder="Deadlines, assignments, cover plans, or private context for the staff…" className={FIELD_CLASS}/>
                </label>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-4 border-t border-slate-200 pt-5">
                <button disabled={saving} className="rounded-full border-2 border-slate-900 bg-yellow-300 px-6 py-3 text-sm font-bold text-slate-900 shadow-sm transition hover:-translate-y-0.5 hover:bg-yellow-200 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-500 disabled:cursor-wait disabled:translate-y-0 disabled:border-slate-400 disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none">
                    {saving ? 'Saving…' : submitLabel}
                </button>
            </div>
        </form>
    );
}
