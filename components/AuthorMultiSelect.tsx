import {Combobox, Transition} from '@headlessui/react';
import {CheckIcon, ChevronUpDownIcon, XMarkIcon} from '@heroicons/react/20/solid';
import {Fragment, useMemo, useRef, useState} from 'react';
import {AuthorRecord} from '../lib/authors';

interface AuthorMultiSelectProps {
    id: string;
    authors: AuthorRecord[];
    value: string[];
    onChange: (nextIds: string[]) => void;
    helperText?: string;
    placeholder?: string;
    disabled?: boolean;
}

const isAuthorActive = (author: AuthorRecord | undefined | null) => {
    if (!author) return false;
    if (author.isHidden) return false;
    if (author.hasDeparted) return false;
    if (!author.graduationYear) return true;
    const cutoff = new Date(author.graduationYear, 5, 30, 23, 59, 59);
    return new Date() <= cutoff;
};

export default function AuthorMultiSelect({
    id,
    authors,
    value,
    onChange,
    helperText,
    placeholder = 'Search for staff',
    disabled = false,
}: AuthorMultiSelectProps) {
    const [query, setQuery] = useState('');
    const inputRef = useRef<HTMLInputElement | null>(null);

    const authorMap = useMemo(() => {
        const map = new Map<string, AuthorRecord>();
        for (const author of authors) {
            if (author && author.id) {
                map.set(author.id, author);
            }
        }
        return map;
    }, [authors]);

    const selectedRecords = useMemo(() => {
        return value
            .map((idValue) => authorMap.get(idValue))
            .filter((record): record is AuthorRecord => Boolean(record));
    }, [authorMap, value]);

    const selectedIdSet = useMemo(() => new Set(value), [value]);

    const optionPool = useMemo(() => {
        const active: AuthorRecord[] = [];
        const inactive: AuthorRecord[] = [];

        for (const author of authors) {
            if (!author || !author.id) continue;
            const isSelected = selectedIdSet.has(author.id);
            if (author.isHidden && !isSelected) {
                continue;
            }
            if (isAuthorActive(author)) {
                active.push(author);
            } else {
                inactive.push(author);
            }
        }

        const byName = (a: AuthorRecord, b: AuthorRecord) =>
            (a.fullName || '').localeCompare(b.fullName || '');

        active.sort(byName);
        inactive.sort(byName);

        return [...active, ...inactive];
    }, [authors, selectedIdSet]);

    const filteredOptions = useMemo(() => {
        if (!query.trim()) {
            return optionPool;
        }
        const normalizedQuery = query.trim().toLowerCase();
        return optionPool.filter((author) => {
            const tokens = [author.fullName || '', author.position || '', author.graduationYear ? String(author.graduationYear) : '']
                .join(' ')
                .toLowerCase();
            return tokens.includes(normalizedQuery);
        });
    }, [optionPool, query]);

    const commitSelection = (nextRecords: AuthorRecord[]) => {
        const uniqueIds = Array.from(
            new Set(nextRecords.map((record) => record.id).filter((idValue): idValue is string => Boolean(idValue)))
        );
        onChange(uniqueIds);
        setQuery('');
    };

    const handleRemove = (authorId: string) => {
        const remaining = selectedRecords.filter((record) => record.id !== authorId);
        commitSelection(remaining);
    };

    const helperId = helperText ? `${id}-helper` : undefined;

    return (
        <div>
            <Combobox value={selectedRecords} onChange={commitSelection} multiple disabled={disabled}>
                <div className="relative mt-1">
                    <div
                        className={`relative flex min-h-[2.75rem] w-full cursor-text flex-wrap items-center gap-2 rounded-md border border-gray-300 bg-white py-2 pl-3 pr-10 text-left shadow-sm focus-within:ring-2 focus-within:ring-indigo-500 sm:text-sm ${
                            disabled ? 'opacity-70' : ''
                        }`}
                        onClick={() => inputRef.current?.focus()}
                    >
                        {selectedRecords.map((record) => (
                            <span
                                key={record.id}
                                className="flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 pl-1 pr-2 py-1 text-xs font-medium text-indigo-700"
                            >
                                <span className="relative inline-flex h-6 w-6 overflow-hidden rounded-full bg-indigo-100">
                                    {record.photoUrl ? (
                                        <img
                                            src={record.photoUrl}
                                            alt={record.fullName}
                                            className="h-full w-full object-cover"
                                        />
                                    ) : (
                                        <span className="flex h-full w-full items-center justify-center text-[0.65rem] font-semibold text-indigo-600">
                                            {(record.fullName || '?')
                                                .split(' ')
                                                .map((word) => word[0])
                                                .join('')
                                                .slice(0, 2)
                                                .toUpperCase()}
                                        </span>
                                    )}
                                </span>
                                <span>{record.fullName}</span>
                                <button
                                    type="button"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        handleRemove(record.id);
                                    }}
                                    className="rounded-full p-0.5 text-indigo-600 hover:bg-indigo-100 hover:text-indigo-800 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                                    aria-label={`Remove ${record.fullName}`}
                                >
                                    <XMarkIcon className="h-3.5 w-3.5" aria-hidden="true"/>
                                </button>
                            </span>
                        ))}

                        <Combobox.Input
                            id={id}
                            ref={inputRef}
                            className="flex-1 border-0 bg-transparent py-1 text-sm text-gray-900 placeholder-gray-400 focus:ring-0"
                            displayValue={() => ''}
                            onChange={(event) => setQuery(event.target.value)}
                            value={query}
                            placeholder={selectedRecords.length ? '' : placeholder}
                        />
                        <Combobox.Button className="absolute inset-y-0 right-0 flex items-center pr-2">
                            <ChevronUpDownIcon className="h-5 w-5 text-gray-400" aria-hidden="true"/>
                        </Combobox.Button>
                    </div>

                    <Transition
                        as={Fragment}
                        leave="transition ease-in duration-100"
                        leaveFrom="opacity-100"
                        leaveTo="opacity-0"
                        afterLeave={() => setQuery('')}
                    >
                        <Combobox.Options className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm">
                            {filteredOptions.length === 0 ? (
                                <div className="relative cursor-default select-none px-4 py-2 text-gray-700">
                                    {query ? 'No matches found' : 'No staff available'}
                                </div>
                            ) : (
                                filteredOptions.map((author) => {
                                    const active = isAuthorActive(author);
                                    const shouldDisable = !active && !selectedIdSet.has(author.id);
                                    return (
                                        <Combobox.Option
                                            key={author.id}
                                            className={({active: isActiveOption}) =>
                                                `relative cursor-default select-none py-2 pl-3 pr-9 ${
                                                    isActiveOption ? 'bg-indigo-600 text-white' : 'text-gray-900'
                                                } ${shouldDisable ? 'opacity-50' : ''}`
                                            }
                                            disabled={shouldDisable}
                                            value={author}
                                        >
                                            {({selected: isSelected, active: isActiveOption}) => (
                                                <>
                                                    <div className="flex items-center gap-3">
                                                        <span className="inline-flex h-8 w-8 overflow-hidden rounded-full bg-indigo-100">
                                                            {author.photoUrl ? (
                                                                <img
                                                                    src={author.photoUrl}
                                                                    alt={author.fullName}
                                                                    className="h-full w-full object-cover"
                                                                />
                                                            ) : (
                                                                <span className="flex h-full w-full items-center justify-center text-xs font-semibold text-indigo-600">
                                                                    {(author.fullName || '?')
                                                                        .split(' ')
                                                                        .map((word) => word[0])
                                                                        .join('')
                                                                        .slice(0, 2)
                                                                        .toUpperCase()}
                                                                </span>
                                                            )}
                                                        </span>
                                                        <div className="min-w-0 flex-1">
                                                            <p
                                                                className={`truncate text-sm font-medium ${
                                                                    isActiveOption ? 'text-white' : 'text-gray-900'
                                                                }`}
                                                            >
                                                                {author.fullName}
                                                            </p>
                                                            <p
                                                                className={`truncate text-xs ${
                                                                    isActiveOption ? 'text-indigo-100' : 'text-gray-500'
                                                                }`}
                                                            >
                                                                {author.position || 'Staff'}
                                                                {author.graduationYear ? ` • ${author.graduationYear}` : ''}
                                                                {author.hasDeparted ? ' • Departed' : ''}
                                                            </p>
                                                            {!active ? (
                                                                <p
                                                                    className={`truncate text-[0.65rem] ${
                                                                        isActiveOption ? 'text-indigo-100' : 'text-amber-600'
                                                                    }`}
                                                                >
                                                                    {author.hasDeparted
                                                                        ? 'Departed — inactive profile'
                                                                        : 'Alumni — inactive profile'}
                                                                </p>
                                                            ) : null}
                                                        </div>
                                                    </div>
                                                    {isSelected ? (
                                                        <span
                                                            className={`absolute inset-y-0 right-0 flex items-center pr-4 ${
                                                                isActiveOption ? 'text-white' : 'text-indigo-600'
                                                            }`}
                                                        >
                                                            <CheckIcon className="h-5 w-5" aria-hidden="true"/>
                                                        </span>
                                                    ) : null}
                                                </>
                                            )}
                                        </Combobox.Option>
                                    );
                                })
                            )}
                        </Combobox.Options>
                    </Transition>
                </div>
            </Combobox>
            {helperText ? (
                <p id={helperId} className="mt-2 text-xs text-gray-500">
                    {helperText}
                </p>
            ) : null}
        </div>
    );
}
