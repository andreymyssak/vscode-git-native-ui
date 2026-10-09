import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { SearchControls } from '../../src/webview/pages/log/ui/search/SearchControls';

test('search applies a focused draft once across Enter and blur', async () => {
  const user = userEvent.setup();
  const apply = vi.fn();
  const props = {
    text: '',
    onApply: apply,
    regex: false,
    matchCase: false,
    onOptionsChange: vi.fn(),
  };
  const { rerender } = render(<SearchControls {...props} />);
  const input = screen.getByRole('searchbox', { name: 'Text or hash' });

  await user.type(input, 'unfinished');
  rerender(<SearchControls {...props} />);
  expect(input).toHaveFocus();
  expect(input).toHaveValue('unfinished');
  await user.keyboard('{Enter}{Tab}');
  expect(apply).toHaveBeenCalledExactlyOnceWith('unfinished');
});
test('regex and case toggles preserve the draft and expose their current matching mode', async () => {
  const user = userEvent.setup();
  const options = vi.fn();
  const props = {
    text: '',
    onApply: vi.fn(),
    regex: false,
    matchCase: false,
    onOptionsChange: options,
  };
  const { rerender } = render(<SearchControls {...props} />);
  const input = screen.getByRole('searchbox', { name: 'Text or hash' });

  await user.type(input, 'unfinished');
  await user.click(screen.getByRole('button', { name: 'Regular expression' }));
  expect(options).toHaveBeenLastCalledWith({ regex: true, matchCase: false });
  rerender(<SearchControls {...props} regex={true} />);
  await user.click(screen.getByRole('button', { name: 'Match case' }));
  expect(options).toHaveBeenLastCalledWith({ regex: true, matchCase: true });
  expect(input).toHaveValue('unfinished');
  expect(
    screen.getByRole('button', { name: 'Regular expression' }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('search mode explanations appear on hover and focus and dismiss with Escape', async () => {
  const user = userEvent.setup();

  render(
    <SearchControls
      text=""
      onApply={vi.fn()}
      regex={false}
      matchCase={false}
      onOptionsChange={vi.fn()}
    />,
  );
  const regex = screen.getByRole('button', { name: 'Regular expression' });

  await user.hover(regex);
  expect(await screen.findByRole('tooltip')).toHaveTextContent(/pattern/);
  await user.unhover(regex);
  await user.tab();
  await user.tab();
  await user.tab();
  const matchCase = screen.getByRole('button', { name: 'Match case' });

  expect(matchCase).toHaveFocus();
  expect(await screen.findByRole('tooltip')).toHaveTextContent(
    /uppercase and lowercase/,
  );
  expect(matchCase).toHaveAccessibleDescription(/uppercase and lowercase/);
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
});
