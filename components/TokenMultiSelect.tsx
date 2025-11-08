import {Combobox, Transition} from '@headlessui/react';
import {CheckIcon, ChevronUpDownIcon, PlusCircleIcon, XMarkIcon} from '@heroicons/react/20/solid';
import {Fragment, useMemo, useRef, useState} from 'react';

interface TokenMultiSelectProps {
    id: string;
    value: string[];
    onChange: (value: string[]) => void;
    options?: string[];
    placeholder?: string;
    helperText?: string;
    createLabel?: (token: string) => string;
    emptyStateText?: string;
}

const normalizeToken = (token: string) => token.trim();

export default function TokenMultiSelect({
                                             id,
                                             value,
                                             onChange,
                                             options = [],
                                             placeholder = 'Start typing to add items',
                                             helperText,
                                             createLabel = (token) => `Add "${token}"`,
                                             emptyStateText = 'No matches found',
                                         }: TokenMultiSelectProps) {
    const [query, setQuery] = useState('');

    const valueKeySet = useMemo(() => {
        return new Set(value.map((token) => normalizeToken(token).toLowerCase()));
    }, [value]);

    const optionList = useMemo(() => {
        const uniqueOptions: string[] = [];
        const seen = new Set<string>();
        for (const token of [...options, ...value]) {
            const cleaned = normalizeToken(token);
            if (!cleaned) continue;
            const key = cleaned.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            uniqueOptions.push(cleaned);
        }
        return uniqueOptions;
    }, [options, value]);

    const filteredOptions = useMemo(() => {
        if (!query.trim()) {
            return optionList;
        }
        const normalizedQuery = query.trim().toLowerCase();
        return optionList.filter((token) => token.toLowerCase().includes(normalizedQuery));
    }, [optionList, query]);

    const canCreateToken = (() => {
        const trimmed = normalizeToken(query);
        if (!trimmed) return false;
        return !valueKeySet.has(trimmed.toLowerCase());
    })();

    const emitChange = (nextTokens: string[]) => {
        const cleaned: string[] = [];
        const seen = new Set<string>();
        for (const token of nextTokens) {
            const trimmed = normalizeToken(token);
            if (!trimmed) continue;
            const key = trimmed.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            cleaned.push(trimmed);
        }
        onChange(cleaned);
        setQuery('');
    };

    const handleAddQuery = () => {
        const trimmed = normalizeToken(query);
        if (!trimmed) return;
        emitChange([...value, trimmed]);
    };

    const handleRemove = (token: string) => {
        emitChange(value.filter((existing) => existing.trim().toLowerCase() !== token.trim().toLowerCase()));
    };

    const helperId = helperText ? `${id}-helper` : undefined;
    const inputRef = useRef<HTMLInputElement | null>(null);

    return (
        <div>
            <Combobox id={id} value={value} onChange={emitChange} multiple>
                <div className="relative mt-1">
                    <div
                        className="relative flex min-h-[2.75rem] w-full cursor-text flex-wrap items-center gap-2 rounded-md border border-gray-300 bg-white py-2 pl-3 pr-10 text-left shadow-sm focus-within:ring-2 focus-within:ring-indigo-500 sm:text-sm"
                        onClick={() => inputRef.current?.focus()}
                    >
                        {value.map((token) => (
                            <span
                                key={token.toLowerCase()}
                                className="flex items-center gap-1 rounded-full border border-yellow-300 bg-yellow-50 px-3 py-1 text-xs font-medium text-yellow-800"
                            >
                                {token}
                                <button
                                    type="button"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        handleRemove(token);
                                    }}
                                    className="rounded-full p-0.5 text-yellow-700 hover:bg-yellow-100 hover:text-yellow-900 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                                    aria-label={`Remove ${token}`}
                                >
                                    <XMarkIcon className="h-3.5 w-3.5" aria-hidden="true"/>
                                </button>
                            </span>
                        ))}
                        <Combobox.Input
                            id={id}
                            ref={inputRef}
                            className="flex-1 min-w-[6rem] border-none bg-transparent text-sm leading-5 text-gray-900 focus:outline-none"
                            displayValue={() => ''}
                            onChange={(event) => setQuery(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' && canCreateToken) {
                                    event.preventDefault();
                                    handleAddQuery();
                                }
                                if (event.key === 'Backspace' && !query && value.length > 0) {
                                    handleRemove(value[value.length - 1]);
                                }
                            }}
                            placeholder={value.length === 0 ? placeholder : undefined}
                            aria-describedby={helperId}
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
                        <Combobox.Options className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-gray-200 bg-white py-1 text-base shadow-lg focus:outline-none sm:text-sm">
                            {filteredOptions.length === 0 && !canCreateToken ? (
                                <div className="relative cursor-default select-none px-4 py-2 text-gray-500">
                                    {emptyStateText}
                                </div>
                            ) : (
                                <>
                                    {filteredOptions.map((token) => (
                                        <Combobox.Option
                                            key={token.toLowerCase()}
                                            className={({active}) =>
                                                `relative cursor-default select-none py-2 pl-10 pr-4 ${
                                                    active ? 'bg-indigo-600 text-white' : 'text-gray-900'
                                                }`
                                            }
                                            value={token}
                                        >
                                            {({selected, active}) => (
                                                <>
                                                    <span
                                                        className={`block truncate ${selected ? 'font-medium' : 'font-normal'}`}
                                                    >
                                                        {token}
                                                    </span>
                                                    {selected ? (
                                                        <span
                                                            className={`absolute inset-y-0 left-0 flex items-center pl-3 ${
                                                                active ? 'text-white' : 'text-indigo-600'
                                                            }`}
                                                        >
                                                            <CheckIcon className="h-5 w-5" aria-hidden="true"/>
                                                        </span>
                                                    ) : null}
                                                </>
                                            )}
                                        </Combobox.Option>
                                    ))}
                                    {canCreateToken && (
                                        <Combobox.Option
                                            key={`create-${query.trim().toLowerCase()}`}
                                            value={normalizeToken(query)}
                                            className={({active}) =>
                                                `relative cursor-default select-none py-2 pl-10 pr-4 ${
                                                    active ? 'bg-indigo-100 text-indigo-900' : 'text-indigo-700'
                                                }`
                                            }
                                        >
                                            <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                                                <PlusCircleIcon className="h-5 w-5" aria-hidden="true"/>
                                            </span>
                                            <span className="block truncate">
                                                {createLabel(normalizeToken(query))}
                                            </span>
                                        </Combobox.Option>
                                    )}
                                </>
                            )}
                        </Combobox.Options>
                    </Transition>
                </div>
            </Combobox>

            {helperText && (
                <p id={helperId} className="mt-2 text-xs text-gray-500">
                    {helperText}
                </p>
            )}
        </div>
    );
}
