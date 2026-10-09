import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';

import { CompilerProbe } from '../fixtures/CompilerProbe';

test('the component pipeline retains derived options during unrelated updates', async () => {
  const user = userEvent.setup();

  render(<CompilerProbe />);
  const changes = screen.getByLabelText('Derived options changes');

  expect(changes).toHaveTextContent('1');
  await user.click(
    screen.getByRole('button', { name: 'Update unrelated state' }),
  );
  expect(screen.getByText('Updates: 1', { exact: true })).toBeInTheDocument();
  expect(changes).toHaveTextContent('1');
});
