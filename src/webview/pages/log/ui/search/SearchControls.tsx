import { useEffect, useRef, useState } from 'react';

import { Icon } from '@webview/shared/ui';

import styles from './SearchControls.module.css';
import { SearchOption } from './SearchOption';

export function SearchControls({
  text,
  onApply,
  regex,
  matchCase,
  onOptionsChange,
}: {
  text: string;
  onApply(this: void, text: string): void;
  regex: boolean;
  matchCase: boolean;
  onOptionsChange(
    this: void,
    options: { regex: boolean; matchCase: boolean },
  ): void;
}) {
  const [draft, setDraft] = useState(text);
  const focused = useRef(false);
  const applied = useRef(text);

  useEffect(() => {
    applied.current = text;
    if (!focused.current) setDraft(text);
  }, [text]);
  const submit = () => {
    if (draft !== applied.current) {
      applied.current = draft;
      onApply(draft);
    }
  };

  return (
    <div id="search-controls" className={styles.controls}>
      <label>
        <span className={styles.searchIcon} aria-hidden="true">
          <Icon name="search" />
        </span>
        <input
          id="search"
          type="search"
          placeholder="Text or hash"
          aria-label="Text or hash"
          value={draft}
          onFocus={() => {
            focused.current = true;
          }}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            focused.current = false;
            submit();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
        />
      </label>
      <div className={styles.options}>
        {(
          [
            {
              label: 'Regular expression',
              name: 'regex',
              pressed: regex,
              icon: 'regex',
              explanation:
                'Search commit messages with a regular expression pattern, for example fix.*bug.',
            },
            {
              label: 'Match case',
              name: 'matchCase',
              pressed: matchCase,
              icon: 'case-sensitive',
              explanation:
                'Match uppercase and lowercase letters exactly in commit messages.',
            },
          ] as const
        ).map((option) => (
          <SearchOption
            key={option.name}
            label={option.label}
            explanation={option.explanation}
            icon={option.icon}
            pressed={option.pressed}
            onClick={() =>
              onOptionsChange({
                regex,
                matchCase,
                [option.name]: !option.pressed,
              })
            }
          />
        ))}
      </div>
    </div>
  );
}
